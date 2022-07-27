import { ethers, BigNumber, Event } from "ethers";
import { getLogger } from "../../utils/logger";
import { IMarketOnChainProvider } from "../../interfaces";
import {
  ChainEvents,
  EventMetadata,
  TxReceiptsWithMetadata,
  EventLogType,
  LogType,
} from "../BaseMarketOnChainProvider";
import { Blockchain, Marketplace } from "../../types";
import { AdapterState } from "../../models";
import { TransactionReceipt, Log, Block } from "@ethersproject/providers";
import { DEFAULT_TOKEN_ADDRESSES } from "../../constants";
import { customMetricsReporter } from "../../utils/metrics";
import { ClusterWorker, IClusterProvider } from "../../utils/cluster";
import { restoreBigNumber } from "../../utils";
import BaseProvider from "../BaseProvider";

const LOGGER = getLogger("OPENSEA_PROVIDER", {
  datadog: !!process.env.DATADOG_API_KEY,
});

const MATURE_BLOCK_AGE = process.env.MATURE_BLOCK_AGE
  ? parseInt(process.env.MATURE_BLOCK_AGE)
  : 250;
const BLOCK_RANGE = process.env.EVENT_BLOCK_RANGE
  ? parseInt(process.env.EVENT_BLOCK_RANGE)
  : 250;
const EVENT_RECEIPT_PARALLELISM: number = process.env.EVENT_RECEIPT_PARALLELISM
  ? parseInt(process.env.EVENT_RECEIPT_PARALLELISM)
  : 4;

/**
 * OpenSea Legacy (wyvern) Contract Chain Provider
 */

export default class WyvernProvider
  extends BaseProvider
  implements IMarketOnChainProvider, IClusterProvider
{
  public market = Marketplace.Opensea;

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
    switch (method) {
      case "getEventReceipts": {
        // eslint-disable-next-line prefer-spread
        return this.getEventReceipts.apply(this, args);
      }
    }
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
      const filterTopics = this.contracts[chain].interface.encodeFilterTopics(
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
            `opensea.${chain}.contract_queryFilter.blockRange`,
            toBlock - fromBlock
          );
          this.MetricsReporter.submit(
            `opensea.${chain}.contract_queryFilter.latency`,
            queryFilterEnd - queryFilterStart
          );

          LOGGER.debug(
            `Found ${events.length} events between ${fromBlock} to ${toBlock}`
          );

          if (events.length) {
            // Only download blocks for block
            // ranges we have events for
            this.retrieveBlocks(fromBlock, toBlock, chain);
            const result: Array<TxReceiptsWithMetadata> =
              await this.cluster.parallelizeMethod<
                Event,
                TxReceiptsWithMetadata
              >("getEventReceipts", events, chain);
            let metaCount = 0;
            const receipts: TxReceiptsWithMetadata = {};
            for (const txsChunk of result) {
              for (const hash of Object.keys(txsChunk)) {
                if (!(hash in receipts)) {
                  receipts[hash] = txsChunk[hash];
                } else {
                  receipts[hash].meta = receipts[hash].meta.concat(
                    txsChunk[hash].meta
                  );
                }
                metaCount += txsChunk[hash].meta.length;
              }
            }

            if (metaCount !== events.length) {
              const evtTxHashes = events.reduce((m, e) => {
                if (!m.includes(e.transactionHash)) {
                  m.push(e.transactionHash);
                }
                return m;
              }, [] as Array<string>);
              LOGGER.alert(`Irregular meta count`, {
                metaCount,
                eventCount: events.length,
                missing: evtTxHashes.flatMap((hash) =>
                  !(hash in receipts) ? [hash] : []
                ),
              });
            }

            const blocks = (
              await Promise.all(this.getBlockList(fromBlock, toBlock))
            ).reduce(
              (m: Record<string, Block>, b: Block) => ({
                ...m,
                [b.number.toString()]: b,
              }),
              {} as Record<string, Block>
            );

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

  public async getEventReceipts(
    events: Array<Event>,
    chain: Blockchain
  ): Promise<TxReceiptsWithMetadata> {
    const receipts: TxReceiptsWithMetadata = {};
    const queryReceiptStart = performance.now();
    const loopEnd =
      events.length +
      Math.abs(
        EVENT_RECEIPT_PARALLELISM - (events.length % EVENT_RECEIPT_PARALLELISM)
      );
    for (let i = 0; i <= loopEnd; i += EVENT_RECEIPT_PARALLELISM) {
      const eventsSlice = events.slice(i, i + EVENT_RECEIPT_PARALLELISM);
      if (!eventsSlice.length) break;
      const promises: Array<Promise<TransactionReceipt>> = [];
      const expectedReceiptCount: Record<string, number> = {};
      const promiseMap: Record<string, number> = {};

      this.incrMetric(
        `opensea.${chain}.event_txReceiptProcess.numReceiptsPerSecond`,
        eventsSlice.length
      );

      for (const event of eventsSlice) {
        if (!(event.transactionHash in expectedReceiptCount)) {
          expectedReceiptCount[event.transactionHash] = 0;
        }
        expectedReceiptCount[event.transactionHash]++;
        if (!(event.transactionHash in promiseMap)) {
          promiseMap[event.transactionHash] =
            promises.push(this.getEventReceipt(event, chain)) - 1;
        }
      }

      const txReceipts = await Promise.all(promises);

      const queryReceiptEnd = performance.now();
      const queryTime = queryReceiptEnd - queryReceiptStart;
      this.MetricsReporter.submit(
        `opensea.${chain}.event_queryTxReceipt.latency`,
        queryTime / eventsSlice.length
      );

      if (txReceipts.length !== eventsSlice.length) {
        LOGGER.debug(`Receipt to event ratio unbalanced, possible multi-sale`, {
          eventsSlice: eventsSlice.length,
          txReceipts: txReceipts.length,
        });
      }

      for (let j = 0; j < eventsSlice.length; j++) {
        const event = eventsSlice[j];
        const receipt = txReceipts[promiseMap[event.transactionHash]];
        if (!(receipt.transactionHash in receipts)) {
          receipts[receipt.transactionHash] = {
            receipt,
            meta: [this.getEventMetadata(event, receipt, chain)],
          };
        } else {
          LOGGER.debug(`Multi-sale TX`, {
            event,
            receipt,
          });
          receipts[event.transactionHash].meta.push(
            this.getEventMetadata(event, receipt, chain)
          );
        }
        this.incrMetric(
          `opensea.${chain}.event_txReceiptProcess.numEventsPerSecond`
        );
      }
    }
    return receipts;
  }

  private async getEventReceipt(
    event: Event,
    chain: Blockchain,
    retryCount = 0
  ): Promise<TransactionReceipt> {
    if (
      !("getTransactionReceipt" in event) ||
      !(typeof event.getTransactionReceipt === "function")
    ) {
      this.restoreEventWrap(event, chain);
    }

    try {
      return await event.getTransactionReceipt();
    } catch (e) {
      if (retryCount > 3) {
        LOGGER.error(`Failed to get event receipt`, {
          error: e,
          event,
        });
        e.message = `Unabled to get event receipt`;
        throw e;
      }
      retryCount++;
      return await this.getEventReceipt(event, chain, retryCount);
    }
  }

  private restoreEventWrap(event: Event, chain: Blockchain) {
    event.getTransactionReceipt = async (): Promise<TransactionReceipt> => {
      return await this.chains[chain].provider.getTransactionReceipt(
        event.transactionHash
      );
    };
  }

  public getEventMetadata(
    event: Event,
    receipt: TransactionReceipt,
    chain = Blockchain.Ethereum
  ): EventMetadata {
    const { logs } = receipt;
    const { price: originalPrice } = event.args;
    let eventMetadata: EventMetadata = {
      contractAddress: null,
      eventSignatures: [],
      buyer: null,
      seller: null,
      tokenID: null,
      price: originalPrice,
      data: null,
      payment: {
        address: DEFAULT_TOKEN_ADDRESSES[chain],
        amount: BigNumber.from(0),
      },
    };

    if (!originalPrice) {
      eventMetadata.price = event.args[4];
    }

    let eventSigs,
      isERC721,
      isERC1155,
      hasERC20,
      ERC20Logs,
      ERC721Logs,
      ERC1155Logs;

    let relevantLogs;

    try {
      const eventIndex = this.getEventIndex(event, logs);
      const parsedLogs: EventLogType[] = logs
        .slice(0, eventIndex + 1)
        .map((l) => this.parseLog(l, chain));
      const eventLog = parsedLogs[parsedLogs.length - 1];
      relevantLogs = this.findEventRelevantLogs(parsedLogs);
      ({
        eventSigs,
        isERC721,
        isERC1155,
        hasERC20,
        ERC20Logs,
        ERC721Logs,
        ERC1155Logs,
      } = this.reduceParsedLogs(relevantLogs));

      eventMetadata.payment = this.getPaymentInfo(
        hasERC20,
        event,
        eventLog,
        ERC20Logs,
        chain
      );
      eventMetadata.eventSignatures = eventSigs;

      LOGGER.debug(`Found event index from ${parsedLogs.length} receipt logs`, {
        idx: eventIndex,
        tx: receipt.transactionHash,
        event: event.event,
        type: eventLog.type.toString(),
        nRelevantLogs: relevantLogs.length,
        isERC721,
        isERC1155,
        hasERC20,
      });

      if (isERC721) {
        const ERC721Transfer = (ERC721Logs as EventLogType[]).find(
          (l) => l.log.name === "Transfer"
        );

        if (ERC721Transfer) {
          const [, seller, buyer, tokenID] = ERC721Transfer.topics;
          eventMetadata = {
            ...eventMetadata,
            seller: ethers.utils.hexStripZeros(seller),
            buyer: ethers.utils.hexStripZeros(buyer),
            tokenID,
            contractAddress: ERC721Transfer.contract,
            data: ERC721Transfer.decodedData,
          };
          LOGGER.debug(`ERC721Transfer`, {
            ...eventMetadata,
            tx: receipt.transactionHash,
          });
          return eventMetadata;
        }
      } else if (isERC1155) {
        const ERC1155TransferSingle = (ERC1155Logs as EventLogType[]).find(
          (l) => l.log.name === "TransferSingle"
        );
        const ERC1155TransferBatch = (ERC1155Logs as EventLogType[]).find(
          (l) => l.log.name === "TransferBatch"
        );
        if (ERC1155TransferSingle) {
          const [, seller, buyer] = ERC1155TransferSingle.decodedData;
          eventMetadata = {
            ...eventMetadata,
            seller: ethers.utils.hexStripZeros(seller),
            buyer: ethers.utils.hexStripZeros(buyer),
            tokenID: null,
            data: ERC1155TransferSingle.decodedData,
          };
          LOGGER.debug(`ERC1155TransferSingle`, {
            ...eventMetadata,
            tx: receipt.transactionHash,
          });
          return eventMetadata;
        } else if (ERC1155TransferBatch) {
          // TODO
          LOGGER.warn(`TODO: ERC1155TransferBatch`, {
            ...eventMetadata,
            tx: receipt.transactionHash,
          });
          return eventMetadata;
        }
      }

      this.warnNonStandardEventLogs(eventIndex, event, receipt);
      return eventMetadata;
    } catch (e) {
      LOGGER.error(`Retrieving event metadata failed`, {
        eventMetadata,
        event,
        receipt,
        ERCRelevantLogs: isERC721 ? ERC721Logs : ERC1155Logs,
        ERC20: hasERC20 ? ERC20Logs : [null],
        relevantLogs,
      });
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      return eventMetadata;
    }
  }

  public getPaymentInfo(
    hasERC20: boolean,
    event: Event,
    eventLog: EventLogType,
    ERC20Logs: EventLogType[],
    chain: Blockchain
  ): { address: string; amount: BigNumber } {
    let address = DEFAULT_TOKEN_ADDRESSES[chain];
    const amount = restoreBigNumber(eventLog.log.args[4]);

    if (hasERC20) {
      address = ERC20Logs[0].contract;
      LOGGER.info(`Payment Info`, {
        payment: { address, amount },
        hasERC20: hasERC20 ? "true" : "false",
        event,
        eventLog,
        ERC20Logs,
      });
    }

    return { address, amount };
  }

  public warnNonStandardEventLogs(
    eventIndex: number,
    event: Event,
    receipt: TransactionReceipt
  ) {
    LOGGER.warn(`Event is NON_STANDARD`, {
      eventIndex,
      tx: event.transactionHash,
    });
  }

  public reduceParsedLogs(parsedRelevantLogs: EventLogType[]) {
    return parsedRelevantLogs.reduce(
      (c, l) => {
        c.eventNames.push(l.log.name);
        c.eventSigs.push(l.log.signature);

        if (l.type === LogType.ERC721) {
          c.isERC721 = true;
          c.ERC721Logs.push(l);
        } else if (l.type === LogType.ERC1155) {
          c.isERC1155 = true;
          c.ERC1155Logs.push(l);
        }

        if (l.type === LogType.ERC20) {
          c.hasERC20 = true;
          c.ERC20Logs.push(l);
        }

        return c;
      },
      {
        eventNames: [],
        eventSigs: [],
        ERC20Logs: [],
        ERC721Logs: [],
        ERC1155Logs: [],
        isERC721: false,
        isERC1155: false,
        hasERC20: false,
      } as {
        eventNames: Array<string>;
        eventSigs: Array<string>;
        ERC20Logs: Array<EventLogType>;
        ERC721Logs: Array<EventLogType>;
        ERC1155Logs: Array<EventLogType>;
        isERC721: boolean;
        isERC1155: boolean;
        hasERC20: boolean;
      }
    );
  }

  public getEventIndex(event: Event, logs: Log[]): number {
    for (let i = logs.length - 1; i >= 0; i--) {
      if (event.logIndex === logs[i].logIndex) {
        return i;
      }
    }
    return null;
  }

  public findEventRelevantLogs(parsedLogs: EventLogType[]) {
    const relevantLogs: EventLogType[] = [];

    if (parsedLogs.length === 1) {
      return relevantLogs;
    }

    for (let i = parsedLogs.length - 2; i >= 0; i--) {
      const parsedEvtLog = parsedLogs[i];

      switch (parsedEvtLog.type) {
        case LogType.ERC1155:
        case LogType.ERC721:
        case LogType.ERC20:
          relevantLogs.unshift(parsedEvtLog);
          break;
        case Marketplace.Opensea:
        default:
          return relevantLogs;
      }
    }

    return relevantLogs;
  }
}
