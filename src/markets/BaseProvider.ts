import { ethers, Event } from "ethers";
import { Interface } from "@ethersproject/abi/lib/interface";
import { getLogger } from "../utils/logger";
import {
  BaseMarketOnChainProviderFactory,
  ContractInstances,
  AbiInterfaces,
  MarketProviders,
  ChainTopics,
  SaleEvents,
  EventMetadata,
  TxReceiptsWithMetadata,
  EventLogType,
  LogType,
  ChainEvents,
  ReceiptLike
} from "./BaseMarketOnChainProvider";
import { MarketConfig } from "../markets";
import { ChainProviders } from "../providers/OnChainProviderFactory";
import { Blockchain, Marketplace } from "../types";
import { TransactionReceipt, Log, Block } from "@ethersproject/providers";
import {
  IERC1155Standard,
  IERC20Standard,
  IERC721Standard
} from "../constants";
import { ParseErrors, UnparsableLogError } from "../utils/UnparsableLogError";
import {
  MetricsReporter as DefaultMetricsReporter,
  MetricData
} from "../utils/metrics";
import { ClusterManager, ClusterWorker } from "../utils/cluster";
import { AdapterState } from "../models";

const LOGGER = getLogger("BASE_PROVIDER", {
  datadog: !!process.env.DATADOG_API_KEY
});

const GET_BLOCK_PARALLELISM: number = process.env.GET_BLOCK_PARALLELISM
  ? parseInt(process.env.GET_BLOCK_PARALLELISM)
  : 5;
const MATURE_BLOCK_AGE = process.env.MATURE_BLOCK_AGE
  ? parseInt(process.env.MATURE_BLOCK_AGE)
  : 250;
const BLOCK_RANGE = process.env.EVENT_BLOCK_RANGE
  ? parseInt(process.env.EVENT_BLOCK_RANGE)
  : 250;

type BlockFn = () => Promise<Block>;
type BlockPromise = BlockFn | Promise<Block>;

export default abstract class BaseProvider {
  public static ERC721ContractInterface = new ethers.utils.Interface(
    IERC721Standard
  );

  public static ERC1155ContractInterface = new ethers.utils.Interface(
    IERC1155Standard
  );

  public static ERC20ContractInterface = new ethers.utils.Interface(
    IERC20Standard
  );

  public chains: ChainProviders;
  public contracts: ContractInstances;
  public interfaces: AbiInterfaces;
  public topics: ChainTopics;
  public events: SaleEvents;
  public config: MarketConfig;
  public market: Marketplace;

  public metrics: Map<number, Record<string, MetricData>>;
  public __metricsInterval: NodeJS.Timer;
  public cluster: ClusterManager;
  public worker: ClusterWorker;
  public blocks: Map<number, BlockPromise> = new Map();

  public CONTRACT_NAME = "base";
  public MetricsReporter = DefaultMetricsReporter;

  constructor(config: MarketConfig, name: string) {
    const { chains, contracts, interfaces, topics }: MarketProviders =
      BaseMarketOnChainProviderFactory.createMarketProviders(config);
    this.config = config;
    this.chains = chains;
    this.contracts = contracts;
    this.interfaces = interfaces;
    this.topics = topics;
    this.CONTRACT_NAME = name;

    this.initMetrics();
  }

  public withCluster(kluster: ClusterManager): void {
    this.cluster = kluster;
    this.cluster.start().sendPing();
  }

  public withWorker(worker: ClusterWorker): void {
    this.worker = worker;
  }

  protected initMetrics(force = false): void {
    if (this.__metricsInterval) {
      if (!force) return;
      clearInterval(this.__metricsInterval);
    }
    this.metrics = new Map();
    this.__metricsInterval = setInterval(() => this.reportMetrics(), 1e3);
  }

  private reportMetrics() {
    for (const time of this.metrics.keys()) {
      const metrics: Record<string, MetricData> = this.metrics.get(time);
      for (const metric of Object.keys(metrics)) {
        const value = metrics[metric];
        this.MetricsReporter.submit(
          value.metric,
          value.value,
          value.type || "gauge",
          time || null
        );
        this.setMetric(metric);
      }
      this.metrics.delete(time);
    }
  }

  public setMetric(metric: string, value = 0) {
    const time = Math.floor(Date.now() / 1000);
    const timeHash = this.metrics.has(time) ? this.metrics.get(time) : {};
    this.metrics.set(time, {
      ...timeHash,
      [metric]: { metric, value } as MetricData
    } as Record<string, MetricData>);
  }

  public ensureMetric(time: number, metric: string, initialValue = 0) {
    let timeHash = this.metrics.get(time);
    if (!timeHash) {
      timeHash = {};
    }
    if (!(metric in timeHash)) {
      timeHash[metric] = { metric, value: initialValue };
    }
    this.metrics.set(time, timeHash);
  }

  public incrMetric(metric: string, incr = 1) {
    const time = Math.floor(Date.now() / 1000);
    this.ensureMetric(time, metric);
    const value = this.metrics.has(time)
      ? this.metrics.get(time)[metric].value
      : 0;
    this.setMetric(metric, value + incr);
  }

  public decrMetric(metric: string, decr = 1) {
    const time = Math.floor(Date.now() / 1000);
    this.ensureMetric(time, metric);
    const value = this.metrics.has(time)
      ? this.metrics.get(time)[metric].value
      : 0;
    this.setMetric(metric, value - decr);
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
          AdapterState.updateSalesLastSyncedBlockNumber(
            this.market,
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
                [b.number.toString()]: b
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

  protected getBlockList(
    fromBlock: number,
    toBlock: number
  ): Array<Promise<Block>> {
    const blockPromises: Array<Promise<Block>> = [];
    for (let i = fromBlock; i <= toBlock; i++) {
      let blockAt: BlockPromise = this.blocks.get(i);
      if (typeof blockAt === "function") {
        blockAt = blockAt();
      }
      blockPromises.push(blockAt);
    }
    return blockPromises;
  }

  protected retrieveBlocks(
    fromBlock: number,
    toBlock: number,
    chain: Blockchain
  ) {
    for (let i = fromBlock; i <= toBlock; i++) {
      let running = false;
      this.blocks.set(i, <BlockFn>(async () => {
        if (running) {
          LOGGER.warn(`Called once called getBlock ${i}`);
          if (typeof this.blocks.get(i) === "function") {
            return null;
          }
          return this.blocks.get(i);
        }
        running = true;
        let retryCount = 0;
        while (true) {
          try {
            this.blocks.set(i, this.chains[chain].getBlock(i));
            await this.blocks.get(i);

            for (let j = i + 1; j <= toBlock; j++) {
              const nextBlockFn = this.blocks.get(j);
              if (typeof nextBlockFn !== "function") {
                continue;
              }
              nextBlockFn();
              break;
            }
            break;
          } catch (e) {
            retryCount++;
            LOGGER.error(`We failed to get block ${i}`);
            if (retryCount > 5) {
              LOGGER.alert(`We failed to get block ${i} after retrying`, {
                fromBlock,
                toBlock,
                error: e
              });
            }
            continue;
          }
        }
        return this.blocks.get(i);
      }));
    }

    for (let i = fromBlock; i <= fromBlock + GET_BLOCK_PARALLELISM; i++) {
      const blockFn = this.blocks.get(i);
      if (typeof blockFn === "function") {
        blockFn();
      }
    }
  }

  public parseLog(log: Log, chain: Blockchain): EventLogType {
    const errors: ParseErrors = {};
    const parsers: Partial<Record<LogType | Marketplace, Interface>> = {
      [LogType.ERC721]: BaseProvider.ERC721ContractInterface,
      [LogType.ERC1155]: BaseProvider.ERC1155ContractInterface,
      [LogType.ERC20]: BaseProvider.ERC20ContractInterface,
      [this.market]: this.contracts[chain].interface
    };

    const parsed: EventLogType = {
      log: null,
      type: null,
      contract: log.address,
      topics: log.topics,
      errors: []
    };
    const parseLogStart = performance.now();
    for (const lType of Object.keys(parsers) as LogType[] | Marketplace[]) {
      try {
        parsed.log = parsers[lType].parseLog(log);
        parsed.type = lType;
        try {
          parsed.decodedData = parsers[lType].decodeEventLog(
            parsed.log.name,
            log.data,
            log.topics
          );
        } catch (evtLogErr) {
          LOGGER.error(`Failed to decode event log data`, {
            lType,
            evtLogErr,
            name: parsed.log.name,
            data: log.data,
            topics: log.topics
          });
        }
        break;
      } catch (e) {
        errors[lType] = e;
      }
    }

    if (Object.keys(errors).length === Object.keys(parsers).length) {
      parsed.log = null;
      parsed.type = LogType.UNKNOWN;
      parsed.errors.push(new UnparsableLogError(log, errors));
    }
    const parseLogEnd = performance.now();
    this.MetricsReporter.submit(
      `${this.market}.${chain}.receipt_parseLog.latency`,
      parseLogEnd - parseLogStart
    );

    return parsed;
  }

  public async getEventReceipts(
    events: Array<Event>,
    chain: Blockchain
  ): Promise<TxReceiptsWithMetadata> {
    return Promise.reject(new Error("Not implemented"));
  }

  public getEventMetadata(
    event: Event,
    receipt: TransactionReceipt,
    chain = Blockchain.Ethereum
  ): EventMetadata {
    return null;
  }

  public parseEvents(
    events: Array<Event>,
    chain: Blockchain
  ): Array<EventMetadata> {
    throw new Error("Method not implemented.");
  }
}
