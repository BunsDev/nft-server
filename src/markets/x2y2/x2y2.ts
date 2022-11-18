import { BigNumber, Event } from "ethers";
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
import {
  MetricsReporter as DefaultMetricsReporter,
  customMetricsReporter
} from "../../utils/metrics";
import { ClusterWorker, IClusterProvider } from "../../utils/cluster";
import dynamodb from "../../utils/dynamodb";
import BaseProvider from "../BaseProvider";

const GET_BLOCK_PARALLELISM: number = process.env.GET_BLOCK_PARALLELISM
  ? parseInt(process.env.GET_BLOCK_PARALLELISM)
  : 5;
const MATURE_BLOCK_AGE = process.env.MATURE_BLOCK_AGE
  ? parseInt(process.env.MATURE_BLOCK_AGE)
  : 250;
const BLOCK_RANGE = 50;

// const LOGGER = getLogger("X2Y2_PROVIDER", {
//   datadog: !!process.env.DATADOG_API_KEY
// });
export type MatchData = {
  transactionHash: string;
  buyer: string;
  contractAddress: string;
  tokenIDs: string[];
  quantity: number;
};
function addTradeToDatas(
  transfer: Log,
  payment: Payment,
  datas: MatchData[],
  quantity: number
): void {
  let newEntry: MatchData = undefined;
  if (transfer.topics[0] == consts.transferTopic)
    newEntry = {
      transactionHash: transfer.transactionHash,
      buyer: `0x${transfer.topics[2].substring(26, 66)}`,
      contractAddress: transfer.address,
      tokenIDs: [parseInt(transfer.topics[3], 16).toString()],
      quantity
    };
  if (transfer.topics[0] == consts.transferSingleTopic)
    newEntry = {
      transactionHash: transfer.transactionHash,
      buyer: `0x${transfer.topics[3].substring(26, 66)}`,
      contractAddress: transfer.address,
      tokenIDs: [parseInt(transfer.data.substring(2, 66), 16).toString()],
      quantity
    };

  const swapsInThisBundle = datas.find(
    (d) => d.transactionHash == newEntry.transactionHash
  );
  if (swapsInThisBundle == null) {
    datas.push(newEntry);
  } else if (!swapsInThisBundle.tokenIDs.includes(newEntry.tokenIDs[0])) {
    swapsInThisBundle.tokenIDs.push(...newEntry.tokenIDs);
  }
}
type TokenEventMetadataMap = Record<string, EventMetadata>;

export default class X2y2Provider
  extends BaseProvider
  implements IMarketOnChainProvider, IClusterProvider
{
  public CONTRACT_NAME = "x2y2";
  public market = Marketplace.X2y2;

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

  private async fetchMatchData(
    chain: Blockchain,
    events: Array<Event>
  ): Promise<MatchData[]> {
    const datas: MatchData[] = [];
    const provider = this.chains[chain].provider;
    const topics = await Promise.all(
      events.map((e: Event) =>
        provider.getTransactionReceipt(e.transactionHash)
      )
    );
    const transactions = await Promise.all(
      events.map((e: Event) => provider.getTransaction(e.transactionHash))
    );
    topics.map((topic: any, i: number) => {
      let payment: Payment = unknownPayment;
      let transfers: Log[] = [
        ...topic.logs.filter(
          (log: Log) =>
            consts.transferTopic == log.topics[0] &&
            log.topics[1] != consts.nullAddress
        ),
        ...topic.logs.filter(
          (log: Log) =>
            consts.transferSingleTopic == log.topics[0] &&
            log.topics[2] != consts.nullAddress
        )
      ];

      const matches: Log[] = topic.logs.filter((log: Log) =>
        [consts.matchTopic].includes(log.topics[0])
      );

      if (matches.length != transfers.length && transfers.length > 0) {
        console.log("bang");
      }
      transfers.map((transfer: Log) => {
        if (!transactions[i].value.eq(BigNumber.from(0))) {
          payment = {
            address: consts.gasToken,
            amount: transactions[i].value
          };
        } else if (payment.address == "0x") {
          console.error("PAYMENT HAS NOT RESOLVED");
          return;
        }
        addTradeToDatas(transfer, payment, datas, matches.length);
      });
    });

    return datas;
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
        this.market,
        chain,
        true,
        deployBlock,
        adapterRunName ?? providerName
      );
      if (deployBlock && Number.isInteger(deployBlock)) {
        if (lastSyncedBlockNumber < deployBlock) {
          // AdapterState.updateSalesLastSyncedBlockNumber(
          //   this.market,
          //   deployBlock,
          //   chain,
          //   adapterRunName ?? providerName
          // );
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
        // LOGGER.error(`Not enough mature blocks to scan.`, {
        //   currentBlock,
        //   lastMatureBlock,
        //   lastSyncedBlockNumber
        // });
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

        // LOGGER.debug("Searching blocks: ", {
        //   fromBlock,
        //   toBlock,
        //   range: toBlock - fromBlock,
        // });

        // if (retryQuery) {
        //   LOGGER.warn(`Retrying query`, {
        //     fromBlock,
        //     toBlock,
        //     range: toBlock - fromBlock,
        //     retryCount,
        //   });
        // }

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
          // this.MetricsReporter.submit(
          //   `opensea_seaport.${chain}.contract_queryFilter.blockRange`,
          //   toBlock - fromBlock
          // );
          // this.MetricsReporter.submit(
          //   `opensea_seaport.${chain}.contract_queryFilter.latency`,
          //   queryFilterEnd - queryFilterStart
          // );

          // LOGGER.debug(
          //   `Found ${events.length} events between ${fromBlock} to ${toBlock}`
          // );

          // LOGGER.debug("Seaport Events", { fromBlock, toBlock, events });

          if (events.length) {
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
            const matchData: MatchData[] = await this.fetchMatchData(
              chain,
              events
            );
            const parsedEvents = this.parseEventsWithMatchData(
              events,
              chain,
              matchData
            );
            for (let i = 0; i < events.length; i++) {
              const event = events[i];
              const parsed = parsedEvents[i];
              if (!(event.transactionHash in receipts)) {
                receipts[event.transactionHash] = {
                  receipt: {
                    blockNumber: event.blockNumber,
                    transactionHash: event.transactionHash
                  } as ReceiptLike,
                  meta: [] as Array<EventMetadata>
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
          // LOGGER.error(`Query error`, {
          //   error: /quorum/.test(e.message) ? `Quorum error` : e.message,
          //   reason: e.reason,
          //   fromBlock,
          //   toBlock,
          //   stack: e.stack.substr(0, 500)
          // });
          if (retryCount < 3) {
            // try again
            retryCount++;
            i -= i - (BLOCK_RANGE + 1) < 0 ? i : BLOCK_RANGE + 1;
            retryQuery = true;
          } else if (retryCount > 3) {
            // LOGGER.error(`Not able to recover from query errors`);
            throw new Error(`Not able to recover from query errors`);
          }
        }
      }
    }
  }

  public parseEventsWithMatchData(
    events: Array<Event>,
    chain: Blockchain,
    matchDatas: MatchData[]
  ): Array<EventMetadata> {
    const { providerName } = this.config.chains[chain];
    const meta: Array<EventMetadata> = [];
    events = events.filter(
      (e) =>
        e.transactionHash ==
        "0x4684edf0c9a7b615a15bf8d57f10f3937cf7f6f699cbcb53f201fcaa955bcf17"
    );
    for (const event of events) {
      const parsed = this.parseLog(event, chain);
      const { currency, amount, to } = parsed.decodedData;
      const matchData = matchDatas.find(
        (t) => (t.transactionHash = event.transactionHash)
      );
      // LOGGER.debug(`X2y2 Event`, {
      //   saleEvent,
      //   buyer,
      //   seller,
      //   collection,
      //   currency,
      //   tokenId,
      //   amount,
      //   price,
      //   parsed,
      //   event
      // });

      meta.push({
        buyer: matchData.buyer,
        seller: to,
        contractAddress: matchData.contractAddress,
        eventSignatures: [event.eventSignature],
        payment: {
          address: currency,
          amount
        },
        price: amount,
        tokenID: matchData.quantity > 1 ? null : matchData.tokenIDs[0],
        count: matchData.quantity, // 1
        data: {
          parsed,
          event,
          tokenIDs: matchData.quantity > 1 ? matchData.tokenIDs : null
        },
        hash: event.transactionHash,
        contract: providerName,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        bundleSale: matchData.quantity > 1
      });
    }
    return meta;
  }
}
type Transfer = {
  transactionHash: string;
  buyer: string;
  contractAddress: string;
  tokenId: string;
  count: number;
};
type Payment = {
  address: string;
  amount: BigNumber;
};
type Log = {
  address: string;
  blockHash: string;
  blockNumber: string;
  data: string;
  value?: any;
  topics: string[];
  transactionHash: string;
};
const unknownPayment: Payment = { address: "0x", amount: BigNumber.from(0) };
const consts: any = {
  transferTopic:
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  matchTopic:
    "0xe2c49856b032c255ae7e325d18109bc4e22a2804e2e49a017ec0f59f19cd447b",
  gasToken: "0x0000000000000000000000000000000000000000",
  nullAddress:
    "0x0000000000000000000000000000000000000000000000000000000000000000"
}; // ts-node src/adapters/x2y2.ts
