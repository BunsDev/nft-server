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

let MetricsReporter = DefaultMetricsReporter;
const CONTRACT_NAME = "seaport";

export default class SeaportProvider
  extends OpenSeaBaseProvider
  implements IMarketOnChainProvider, IClusterProvider
{
  public CONTRACT_NAME = CONTRACT_NAME;

  public withWorker(worker: ClusterWorker): void {
    super.withWorker(worker);
    MetricsReporter = customMetricsReporter("", "", [`worker:${worker.uuid}`]);
    this.overrideMetricsReporter(MetricsReporter);
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
      const { deployBlock, contractAddress } = this.config.chains[chain];
      const currentBlock: number = await this.chains[
        chain
      ].getCurrentBlockNumber();
      const lastMatureBlock = currentBlock - MATURE_BLOCK_AGE;
      let { lastSyncedBlockNumber } = await AdapterState.getSalesAdapterState(
        Marketplace.Opensea,
        chain,
        true,
        deployBlock,
        CONTRACT_NAME
      );
      if (deployBlock && Number.isInteger(deployBlock)) {
        if (lastSyncedBlockNumber < deployBlock) {
          AdapterState.updateSalesLastSyncedBlockNumber(
            Marketplace.Opensea,
            deployBlock,
            chain,
            CONTRACT_NAME
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

        LOGGER.info("Searching blocks: ", {
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

        this.retrieveBlocks(fromBlock, toBlock, chain);

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
          MetricsReporter.submit(
            `opensea_seaport.${chain}.contract_queryFilter.blockRange`,
            toBlock - fromBlock
          );
          MetricsReporter.submit(
            `opensea_seaport.${chain}.contract_queryFilter.latency`,
            queryFilterEnd - queryFilterStart
          );

          LOGGER.info(
            `Found ${events.length} events between ${fromBlock} to ${toBlock}`
          );

          LOGGER.info("Seaport Events", { fromBlock, toBlock, events });

          if (events.length) {
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
            };
          } else {
            yield {
              chain,
              events,
              blockRange: {
                startBlock: fromBlock,
                endBlock: toBlock,
              },
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
      } else if (
        consideration.length < 2 ||
        consideration.length > 3 ||
        offer.length > 1
      ) {
        LOGGER.error(`Unexpected consideration/offer length`, {
          tx: event.transactionHash,
          considerationLen: consideration.length,
          offerLen: offer.length,
          offer,
          consideration,
          parsed,
          event,
        });
        meta.push(null);
        continue;
      }

      const offerTokenType: ItemType = getItemType(offer[0].itemType);
      const considerationTokenType: ItemType = getItemType(
        consideration[consideration.length - 1].itemType
      );
      const price = consideration
        .filter((c: any) => getItemType(c.itemType) === considerationTokenType)
        .reduce((t: BigNumber, v: any) => t.add(v.amount), BigNumber.from(0));

      let [buyer, seller, contractAddress] = [
        recipient,
        offerer,
        offer[0].token,
      ];
      if (offerTokenType === ItemType.ERC20) {
        buyer = consideration[0].recipient;
        seller = recipient;
        contractAddress = consideration[0].token;
      }

      meta.push({
        buyer,
        seller,
        contractAddress,
        data: {
          offerType: offerTokenType,
          raw: parsed.decodedData,
          considerationType: considerationTokenType,
        },
        price,
        payment: {
          address: consideration[consideration.length - 1].token,
          amount: price,
        },
        tokenID: consideration[consideration.length - 1].token,
        eventSignatures: [parsed.log.signature],
      });
    }
    return meta;
  }
}
