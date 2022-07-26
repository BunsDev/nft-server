import { BigNumber, Event } from "ethers";
import { getLogger } from "../../utils/logger";
import { IMarketOnChainProvider } from "../../interfaces";
import {
  ChainEvents,
  EventMetadata,
  TxReceiptsWithMetadata,
  ReceiptLike,
} from "../BaseMarketOnChainProvider";
import { Blockchain, Marketplace } from "../../types";
import { AdapterState } from "../../models";
import { Block } from "@ethersproject/providers";
import {
  MetricsReporter as DefaultMetricsReporter,
  customMetricsReporter,
} from "../../utils/metrics";
import { ClusterWorker, IClusterProvider } from "../../utils/cluster";
import OpenSeaBaseProvider from "./base";
import dynamodb from "../../utils/dynamodb";

const LOGGER = getLogger("SEAPORT_PROVIDER", {
  datadog: !!process.env.DATADOG_API_KEY,
});

const MATURE_BLOCK_AGE = process.env.MATURE_BLOCK_AGE
  ? parseInt(process.env.MATURE_BLOCK_AGE)
  : 250;
const BLOCK_RANGE = process.env.EVENT_BLOCK_RANGE
  ? parseInt(process.env.EVENT_BLOCK_RANGE)
  : 250;

enum ItemType {
  NATIVE = "native",
  ERC20 = "erc20",
  ERC721 = "erc721",
  ERC1155 = "erc1155",
  UNKNOWN = "unknown",
}

enum ItemTypeNumeric {
  NATIVE = 0,
  ERC20 = 1,
  ERC721 = 2,
  ERC1155 = 3,
  UNKNOWN = -1,
}

enum OrderShape {
  BID = "bid",
  NATIVE = "native",
  TOKEN = "token",
  UNKNOWN = "unknown",
}

type TokenEventMetadataMap = Record<string, EventMetadata>;

function getItemType(itemType: number): ItemType {
  switch (itemType) {
    case 0:
      return ItemType.NATIVE;
    case 1:
      return ItemType.ERC20;
    case 2:
      return ItemType.ERC721;
    case 3:
      return ItemType.ERC1155;
    default:
      return ItemType.UNKNOWN;
  }
}

function getSeaportShape(offer: any, consideration: any) {
  return `${offer.map((o: any) => o.itemType)}:${consideration.map(
    (c: any) => c.itemType
  )}`;
}

export default class SeaportProvider
  extends OpenSeaBaseProvider
  implements IMarketOnChainProvider, IClusterProvider
{
  public CONTRACT_NAME = "seaport";

  public withWorker(worker: ClusterWorker): void {
    super.withWorker(worker);
    this.MetricsReporter = customMetricsReporter("", "", [
      `worker:${worker.uuid}`,
    ]);
  }

  public async dispatchWorkMethod(
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    return Promise.reject(new Error("Not implemented"));
  }

  public async *fetchSales(): AsyncGenerator<ChainEvents> {
    // eslint-disable-next-line no-unreachable-loop
    for (const chain of Object.keys(this.chains) as Blockchain[]) {
      const { deployBlock, contractAddress, providerName } =
        this.config.chains[chain];
      const currentBlock: number = await this.chains[
        chain
      ].getCurrentBlockNumber();
      const lastMatureBlock = currentBlock - MATURE_BLOCK_AGE;
      let { lastSyncedBlockNumber } = await AdapterState.getSalesAdapterState(
        Marketplace.Opensea,
        chain,
        true,
        deployBlock,
        providerName
      );
      if (deployBlock && Number.isInteger(deployBlock)) {
        if (lastSyncedBlockNumber < deployBlock) {
          AdapterState.updateSalesLastSyncedBlockNumber(
            Marketplace.Opensea,
            deployBlock,
            chain,
            providerName
          );
        }
        lastSyncedBlockNumber = Math.max(deployBlock, lastSyncedBlockNumber);
      }
      const contract = this.contracts[chain];
      const filterTopics = this.config.chains[chain].saleTopic
        ? [this.config.chains[chain].saleTopic]
        : this.contracts[chain].interface.encodeFilterTopics(
            this.contracts[chain].interface.getEvent(
              this.config.chains[chain].saleEventName
            ),
            []
          );

      if (lastMatureBlock - lastSyncedBlockNumber <= MATURE_BLOCK_AGE) {
        LOGGER.error(`Not enough mature blocks to scan.`, {
          currentBlock,
          lastMatureBlock,
          lastSyncedBlockNumber,
        });
        return;
      }

      let retryCount = 0;
      let retryQuery = false;

      for (
        let i = 0;
        i < lastMatureBlock - lastSyncedBlockNumber;
        i += BLOCK_RANGE + 1
      ) {
        const fromBlock = lastSyncedBlockNumber + i;
        const toBlock =
          fromBlock + BLOCK_RANGE > currentBlock
            ? currentBlock
            : fromBlock + BLOCK_RANGE;

        LOGGER.debug("Searching blocks: ", {
          fromBlock,
          toBlock,
          range: toBlock - fromBlock,
        });

        if (retryQuery) {
          LOGGER.warn(`Retrying query`, {
            fromBlock,
            toBlock,
            range: toBlock - fromBlock,
            retryCount,
          });
        }

        try {
          const queryFilterStart = performance.now();
          const events: Array<Event> = (
            await contract.queryFilter(
              {
                address: contractAddress,
                topics: filterTopics,
              },
              fromBlock,
              toBlock
            )
          ).filter((e) => !e.removed);
          const queryFilterEnd = performance.now();
          this.MetricsReporter.submit(
            `opensea_seaport.${chain}.contract_queryFilter.blockRange`,
            toBlock - fromBlock
          );
          this.MetricsReporter.submit(
            `opensea_seaport.${chain}.contract_queryFilter.latency`,
            queryFilterEnd - queryFilterStart
          );

          LOGGER.debug(
            `Found ${events.length} events between ${fromBlock} to ${toBlock}`
          );

          LOGGER.debug("Seaport Events", { fromBlock, toBlock, events });

          if (events.length) {
            this.retrieveBlocks(fromBlock, toBlock, chain);
            const blocks = (
              await Promise.all(this.getBlockList(fromBlock, toBlock))
            ).reduce(
              (m: Record<string, Block>, b: Block) => ({
                ...m,
                [b.number.toString()]: b,
              }),
              {} as Record<string, Block>
            );

            const receipts: TxReceiptsWithMetadata = {};
            const parsedEvents = this.parseEvents(events, chain);
            for (let i = 0; i < events.length; i++) {
              const event = events[i];
              const parsed = parsedEvents[i];
              if (!(event.transactionHash in receipts)) {
                receipts[event.transactionHash] = {
                  receipt: {
                    blockNumber: event.blockNumber,
                    transactionHash: event.transactionHash,
                  } as ReceiptLike,
                  meta: [] as Array<EventMetadata>,
                };
              }
              receipts[event.transactionHash].meta.push(parsed);
            }

            yield {
              blocks,
              chain,
              events,
              blockRange: {
                startBlock: fromBlock,
                endBlock: toBlock,
              },
              receipts,
              providerName,
            };
          } else {
            yield {
              chain,
              events,
              blockRange: {
                startBlock: fromBlock,
                endBlock: toBlock,
              },
              providerName,
            };
          }

          retryCount = 0;
          retryQuery = false;
        } catch (e) {
          LOGGER.error(`Query error`, {
            error: /quorum/.test(e.message) ? `Quorum error` : e.message,
            reason: e.reason,
            fromBlock,
            toBlock,
            stack: e.stack.substr(0, 500),
          });
          if (retryCount < 3) {
            // try again
            retryCount++;
            i -= i - (BLOCK_RANGE + 1) < 0 ? i : BLOCK_RANGE + 1;
            retryQuery = true;
          } else if (retryCount > 3) {
            LOGGER.error(`Not able to recover from query errors`);
            throw new Error(`Not able to recover from query errors`);
          }
        }
      }
    }
  }

  public parseEvents(
    events: Array<Event>,
    chain: Blockchain
  ): Array<EventMetadata> {
    const meta: Array<EventMetadata> = [];
    for (const event of events) {
      const parsed = this.parseLog(event, chain);
      const { offerer, recipient, offer, consideration } = parsed.decodedData;

      if (!consideration.length || !offer.length) {
        LOGGER.error(`Empty consideration/offer`, {
          tx: event.transactionHash,
          offer,
          consideration,
          parsed,
          event,
        });
        meta.push(null);
        continue;
      }

      const shape = getSeaportShape(offer, consideration);
      dynamodb.put({
        PK: "seaportShape",
        SK: shape,
        tx: event.transactionHash,
      });

      const orderShape: OrderShape = this.getOrderShape(offer, consideration);
      switch (orderShape) {
        case OrderShape.BID:
          meta.push(
            ...this.getBidMeta(event, offer, consideration, offerer, recipient)
          );
          break;
        case OrderShape.NATIVE:
          meta.push(
            ...this.getNativeMeta(
              event,
              offer,
              consideration,
              offerer,
              recipient
            )
          );
          break;
        case OrderShape.TOKEN:
          meta.push(
            ...this.getTokenMeta(
              event,
              offer,
              consideration,
              offerer,
              recipient
            )
          );
          break;
        case OrderShape.UNKNOWN:
          meta.push(null);
          break;
      }
    }
    return meta;
  }

  public getOrderShape(offer: any, consideration: any): OrderShape {
    // Shapes
    // ERC20 : ERC721/1155+ , ERC20+?
    // ERC721/1155+ : NATIVE+ , ERC721/1155+
    // ERC721/1155+ : ERC20 , ERC721/1155+

    const firstOfferType = offer[0].itemType;
    const firstConsiderationType = consideration[0].itemType;

    switch (true) {
      case [ItemTypeNumeric.ERC721, ItemTypeNumeric.ERC1155].includes(
        firstOfferType
      ) && firstConsiderationType === ItemTypeNumeric.NATIVE:
        return OrderShape.NATIVE;
      case [ItemTypeNumeric.ERC721, ItemTypeNumeric.ERC1155].includes(
        firstOfferType
      ) && firstConsiderationType === ItemTypeNumeric.ERC20:
        return OrderShape.TOKEN;
      case firstOfferType === ItemTypeNumeric.ERC20:
        return OrderShape.BID;
      default:
        return OrderShape.UNKNOWN;
    }
  }

  public getBidMeta(
    event: Event,
    offer: any,
    consideration: any,
    offerer: string,
    recipient: string
  ): Array<EventMetadata> {
    // Basic shape is ERC20 -> ERC721/1155+ , ERC20+?
    return Object.values(
      consideration
        .filter((c: any) =>
          [ItemTypeNumeric.ERC721, ItemTypeNumeric.ERC1155].includes(c.itemType)
        )
        .reduce((c: TokenEventMetadataMap, v: any) => {
          if (!(v.token in c)) {
            c[v.token] = {
              buyer: v.recipient,
              seller: recipient,
              contractAddress: v.token,
              data: [],
              eventSignatures: [event.eventSignature],
              payment: {
                address: null,
                amount: BigNumber.from(0),
              },
              price: BigNumber.from(0),
              tokenID: null,
              count: 0,
            };
          }
          c[v.token] = {
            ...c[v.token],
            payment: {
              address: offer[0].token,
              amount: c[v.token].payment.amount.add(v.amount),
            },
            price: c[v.token].price.add(v.amount),
            count: c[v.token].count++,
            tokenID: v.identifier.toString(),
            data: [
              ...(c[v.token].data as any[]),
              {
                tokenID: v.identifier.toString(),
                type: getItemType(v.itemType),
                event,
                offerer,
                recipient,
                offer,
                consideration,
              },
            ],
          };
          return c;
        }, {} as TokenEventMetadataMap)
    );
  }

  public getNativeMeta(
    event: Event,
    offer: any,
    consideration: any,
    offerer: string,
    recipient: string
  ): Array<EventMetadata> {
    // ERC721/1155+ : NATIVE+ , ERC721/1155+?
    const price = this.getAmountTotal(consideration, ItemTypeNumeric.NATIVE);
    return Object.values(
      offer.reduce((c: TokenEventMetadataMap, v: any) => {
        if (!(v.token in c)) {
          c[v.token] = {
            buyer: recipient,
            seller: offerer,
            contractAddress: v.token,
            data: [],
            eventSignatures: [event.eventSignature],
            payment: {
              address: consideration[0].token,
              amount: price,
            },
            price,
            tokenID: null,
            count: 0,
          };
        }
        c[v.token] = {
          ...c[v.token],
          count: c[v.token].count++,
          tokenID: v.identifier.toString(),
          data: [
            ...(c[v.token].data as any[]),
            {
              tokenID: v.identifier.toString(),
              type: getItemType(v.itemType),
              event,
              offerer,
              recipient,
              offer,
              consideration,
            },
          ],
        };
        return c;
      }, {} as TokenEventMetadataMap)
    );
  }

  public getTokenMeta(
    event: Event,
    offer: any,
    consideration: any,
    offerer: string,
    recipient: string
  ): Array<EventMetadata> {
    // ERC721/1155+ : ERC20 , ERC721/1155+?
    const price = this.getAmountTotal(consideration, ItemTypeNumeric.NATIVE);
    return Object.values(
      offer.reduce((c: TokenEventMetadataMap, v: any) => {
        if (!(v.token in c)) {
          c[v.token] = {
            buyer: recipient,
            seller: offerer,
            contractAddress: v.token,
            data: [],
            eventSignatures: [event.eventSignature],
            payment: {
              address: consideration[0].token,
              amount: price,
            },
            price,
            tokenID: null,
            count: 0,
          };
        }
        c[v.token] = {
          ...c[v.token],
          count: c[v.token].count++,
          tokenID: v.identifier.toString(),
          data: [
            ...(c[v.token].data as any[]),
            {
              tokenID: v.identifier.toString(),
              type: getItemType(v.itemType),
              event,
              offerer,
              recipient,
              offer,
              consideration,
            },
          ],
        };
        return c;
      }, {} as TokenEventMetadataMap)
    );
  }

  public getAmountTotal(
    amtArray: [amount: BigNumber],
    type: ItemTypeNumeric
  ): BigNumber {
    return amtArray
      .filter((a: any) => a.itemType === type)
      .reduce((t: BigNumber, a: any) => t.add(a.amount), BigNumber.from(0));
  }
}
