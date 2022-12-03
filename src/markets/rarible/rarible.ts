import { Event, BigNumber } from "ethers";
import { getLogger } from "../../utils/logger";
import { IMarketOnChainProvider } from "../../interfaces";
import {
  ChainEvents,
  EventMetadata,
  TxReceiptsWithMetadata,
  ReceiptLike
} from "../BaseMarketOnChainProvider";
import { Blockchain, Marketplace } from "../../types";
import { AdapterState } from "../../models";
import { Block } from "@ethersproject/providers";
import { customMetricsReporter } from "../../utils/metrics";
import { ClusterWorker, IClusterProvider } from "../../utils/cluster";
import dynamodb from "../../utils/dynamodb";
import BaseProvider from "../BaseProvider";
import { Result } from "ethers/lib/utils";
import { fetchMatchData, MatchData } from "./helpers";

const LOGGER = getLogger("RARIBLE_PROVIDER", {
  datadog: !!process.env.DATADOG_API_KEY
});

const MATURE_BLOCK_AGE = process.env.MATURE_BLOCK_AGE
  ? parseInt(process.env.MATURE_BLOCK_AGE)
  : 250;
const BLOCK_RANGE = process.env.EVENT_BLOCK_RANGE
  ? parseInt(process.env.EVENT_BLOCK_RANGE)
  : 250;

function resultToObject(result?: Result) {
  return (
    result &&
    Object.entries(result).reduce((o, [k, v]) => {
      if (Number.isInteger(parseInt(k))) return o;
      if (Array.isArray(v)) {
        v = resultToObject(v);
      }
      o[k] = v;
      return o;
    }, {} as Record<string, any>)
  );
}

export default class RaribleProvider
  extends BaseProvider
  implements IMarketOnChainProvider, IClusterProvider
{
  public CONTRACT_NAME = "rarible";
  public market = Marketplace.Rarible;
  private matchDatas: MatchData[];
  private shapeCount: Record<string, number> = {};
  private shapeTx: Record<string, string> = {};

  public withWorker(worker: ClusterWorker): void {
    super.withWorker(worker);
    this.MetricsReporter = customMetricsReporter("", "", [
      `worker:${worker.uuid}`
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
      const { deployBlock, contractAddress, providerName, adapterRunName } =
        this.config.chains[chain];
      const currentBlock: number = await this.chains[
        chain
      ].getCurrentBlockNumber();
      const lastMatureBlock = currentBlock - MATURE_BLOCK_AGE;
      let { lastSyncedBlockNumber } = await AdapterState.getSalesAdapterState(
        Marketplace.Rarible,
        chain,
        true,
        deployBlock,
        adapterRunName ?? providerName
      );
      if (deployBlock && Number.isInteger(deployBlock)) {
        if (lastSyncedBlockNumber < deployBlock) {
          AdapterState.updateSalesLastSyncedBlockNumber(
            Marketplace.Rarible,
            deployBlock,
            chain,
            adapterRunName ?? providerName
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
          lastSyncedBlockNumber
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
          range: toBlock - fromBlock
        });

        if (retryQuery) {
          LOGGER.warn(`Retrying query`, {
            fromBlock,
            toBlock,
            range: toBlock - fromBlock,
            retryCount
          });
        }

        try {
          const queryFilterStart = performance.now();
          const events: Array<Event> = (
            await contract.queryFilter(
              {
                address: contractAddress,
                topics: filterTopics
              },
              fromBlock,
              toBlock
            )
          ).filter((e) => !e.removed);
          const queryFilterEnd = performance.now();
          this.MetricsReporter.submit(
            `rarible.${chain}.contract_queryFilter.blockRange`,
            toBlock - fromBlock
          );
          this.MetricsReporter.submit(
            `rarible.${chain}.contract_queryFilter.latency`,
            queryFilterEnd - queryFilterStart
          );

          LOGGER.debug(
            `Found ${events.length} events between ${fromBlock} to ${toBlock}`
          );

          LOGGER.debug("Rarible Events", { fromBlock, toBlock, events });

          if (events.length) {
            this.matchDatas = await fetchMatchData(
              events,
              this.chains[chain].provider
            );
            this.retrieveBlocks(fromBlock, toBlock, chain);
            const blocks = (
              await Promise.all(this.getBlockList(fromBlock, toBlock))
            ).reduce(
              (m: Record<string, Block>, b: Block) => ({
                ...m,
                [b.number.toString()]: b
              }),
              {} as Record<string, Block>
            );

            const receipts: TxReceiptsWithMetadata = {};
            const parsedEvents = this.parseEvents(events, chain);
            for (let i = 0; i < events.length; i++) {
              const event = events[i];
              const parsed = parsedEvents.filter(
                (pe) =>
                  pe &&
                  pe.hash === event.transactionHash &&
                  pe.logIndex === event.logIndex
              );

              if (!(event.transactionHash in receipts)) {
                receipts[event.transactionHash] = {
                  receipt: {
                    blockNumber: event.blockNumber,
                    transactionHash: event.transactionHash
                  } as ReceiptLike,
                  meta: [] as Array<EventMetadata>
                };
              }

              receipts[event.transactionHash].meta.push(...parsed);
            }

            for (let i = 0; i < Object.keys(this.shapeCount).length; i += 25) {
              const updateItems = Object.keys(this.shapeCount)
                .slice(i, i + 25)
                .reduce((items, shape) => {
                  items.push({
                    Key: {
                      PK: "raribleShape",
                      SK: shape
                    },
                    UpdateExpression: `ADD #count :count SET #tx = :tx`,
                    ExpressionAttributeNames: {
                      "#count": "count",
                      "#tx": "tx"
                    },
                    ExpressionAttributeValues: {
                      ":count": this.shapeCount[shape],
                      ":tx": this.shapeTx[shape]
                    }
                  });
                  this.shapeCount[shape] = 0;
                  return items;
                }, []);
              await dynamodb.transactWrite({ updateItems });
            }

            yield {
              blocks,
              chain,
              events,
              blockRange: {
                startBlock: fromBlock,
                endBlock: toBlock
              },
              receipts,
              providerName,
              adapterRunName
            };
          } else {
            yield {
              chain,
              events,
              blockRange: {
                startBlock: fromBlock,
                endBlock: toBlock
              },
              providerName,
              adapterRunName
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
            stack: e.stack.substr(0, 500)
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
      const matchData = this.matchDatas.find(
        (d: MatchData) => d.transactionHash == event.transactionHash
      );

      const parsed = this.parseLog(event, chain);
      let data = resultToObject(parsed.decodedData);
      if (matchData.quantity > 1) data.tokenIDs = matchData.tokenIDs;

      meta.push({
        bundleSale: matchData.quantity > 1,
        buyer: matchData.buyer,
        contract: "rarible",
        contractAddress: matchData.contractAddress,
        eventSignatures: [event.eventSignature],
        hash: event.transactionHash,
        logIndex: event.logIndex,
        payment: matchData.payment,
        price: parsed.decodedData.newLeftFill,
        seller: matchData.seller,
        tokenID: matchData.quantity > 1 ? null : matchData.tokenIDs[0],
        blockNumber: event.blockNumber,
        count: matchData.quantity,
        data
      });
    }
    return meta;
  }
}
