import { ethers, Event } from "ethers";
import { Interface } from "@ethersproject/abi/lib/interface";
import { getLogger } from "../../utils/logger";
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
} from "../BaseMarketOnChainProvider";
import { MarketConfig } from "../../markets";
import { ChainProviders } from "../../providers/OnChainProviderFactory";
import { Blockchain, Marketplace } from "../../types";
import { TransactionReceipt, Log, Block } from "@ethersproject/providers";
import {
  IERC1155Standard,
  IERC20Standard,
  IERC721Standard,
} from "../../constants";
import {
  ParseErrors,
  UnparsableLogError,
} from "../../utils/UnparsableLogError";
import {
  MetricsReporter as DefaultMetricsReporter,
  MetricData,
} from "../../utils/metrics";
import { ClusterManager, ClusterWorker } from "../../utils/cluster";

const LOGGER = getLogger("OSBASE_PROVIDER", {
  datadog: !!process.env.DATADOG_API_KEY,
});

const GET_BLOCK_PARALLELISM: number = process.env.GET_BLOCK_PARALLELISM
  ? parseInt(process.env.GET_BLOCK_PARALLELISM)
  : 5;

type BlockFn = () => Promise<Block>;
type BlockPromise = BlockFn | Promise<Block>;

export default abstract class OpenSeaBaseProvider {
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

  public metrics: Map<number, Record<string, MetricData>>;
  public __metricsInterval: NodeJS.Timer;
  public cluster: ClusterManager;
  public worker: ClusterWorker;
  public blocks: Map<number, BlockPromise> = new Map();

  public CONTRACT_NAME = "os_base";
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
    this.__metricsInterval = setInterval(() => this.reportMetrics(), 1e4);
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
      [metric]: { metric, value } as MetricData,
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
                error: e,
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
      [LogType.ERC721]: OpenSeaBaseProvider.ERC721ContractInterface,
      [LogType.ERC1155]: OpenSeaBaseProvider.ERC1155ContractInterface,
      [LogType.ERC20]: OpenSeaBaseProvider.ERC20ContractInterface,
      [Marketplace.Opensea]: this.contracts[chain].interface,
    };

    const parsed: EventLogType = {
      log: null,
      type: null,
      contract: log.address,
      topics: log.topics,
      errors: [],
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
            topics: log.topics,
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
      `opensea.${chain}.receipt_parseLog.latency`,
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
}
