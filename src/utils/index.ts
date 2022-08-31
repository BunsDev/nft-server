import axios from "axios";
import web3 from "web3";
import { Block } from "web3-eth";
import { Log } from "web3-core";
import {
  Blockchain,
  DailyVolumeRecord,
  DateTruncate,
  Marketplace,
  SaleData,
  SerializedBigNumber,
  StatType,
} from "../types";
import { getLogger } from "./logger";
import { BigNumber } from "ethers";
import { ONE_DAY_MILISECONDS } from "../constants";

const LOGGER = getLogger("ERROR_HANDLER", {
  datadog: !!process.env.DATADOG_API_KEY,
});

export const sleep = async (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export function timestamp(): number {
  return Math.round(Date.now() / 1000);
}

export function roundUSD(num: number): number {
  return Math.round(num ?? 0);
}

export function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getUTCDate() === d2.getUTCDate() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCFullYear() === d2.getUTCFullYear()
  );
}

export function getSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/[^\w-]+/g, "");
}

export function getSlugFromPK(PK: string): string {
  return PK.split("#")[1];
}

export function convertByDecimals(value: number, decimals: number): number {
  return value / Math.pow(10, decimals);
}

// TODO optimize
export function getPriceAtDate(
  date: number,
  historicalPrices: number[][] // [0] is a UNIX timestamp, [1] is the price
): number | null {
  const givenDate = new Date(date);

  const match = historicalPrices.find((priceArr) => {
    const historicalDate = new Date(priceArr[0]);
    return isSameDay(givenDate, historicalDate);
  });

  if (match) {
    return match[1];
  }

  return null;
}

export async function handleError(error: Error, context: string) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) {
      LOGGER.error(`Error [${context}] - not found: ${error.message}`, {
        error,
        stack: error.stack,
      });
    }
    if (error.response?.status === 429) {
      // Backoff for 1 minute if rate limited
      LOGGER.error(`Error [${context}] - too many requests: ${error.message}`, {
        error,
        stack: error.stack,
      });
      await sleep(60);
    }
    if (error.response?.status === 500 || error.response.status === 504) {
      LOGGER.error(`Error [${context}] - server error: ${error.message}`, {
        error,
        stack: error.stack,
      });
    }
  }
  LOGGER.error(`Error [${context}] - other error: ${error.message}`, {
    error,
    stack: error.stack,
  });
}

export function filterObject(object: Object) {
  return Object.fromEntries(
    Object.entries(object).filter(([_, v]) => v != null)
  );
}

export const getTimestampsInBlockSpread = async (
  oldestBlock: Block,
  newestBlock: Block,
  llamaId: string
) => {
  const oldestTimestamp = new Date(
    (oldestBlock.timestamp as number) * 1000
  ).setUTCHours(0, 0, 0, 0);
  const newestTimestamp = new Date(
    (newestBlock.timestamp as number) * 1000
  ).setUTCHours(0, 0, 0, 0);

  const timestamps: Record<string, number> = {};

  for (
    let timestamp = oldestTimestamp;
    timestamp <= newestTimestamp;
    timestamp += 86400 * 1000
  ) {
    if (timestamp) {
      const response = await axios.get(
        `https://coins.llama.fi/block/${llamaId}/${Math.floor(
          timestamp / 1000
        )}`
      );
      const { height } = response.data;
      timestamps[height] = timestamp;
    }
  }
  return timestamps;
};

export interface LogParserInput {
  logs: Log[];
  oldestBlock: Block;
  newestBlock: Block;
  chain: Blockchain;
  marketplace: Marketplace;
}

export interface LogParser {
  (input: LogParserInput): Promise<SaleData[]>;
}

export interface SalesFromLogs {
  sales: SaleData[];
  latestBlock: number;
}

export const getSalesFromLogs = async ({
  rpc,
  topic,
  contractAddress,
  adapterName,
  chain,
  marketplace,
  fromBlock,
  toBlock,
  parser,
}: {
  rpc: string;
  topic: string;
  contractAddress: string;
  chain: Blockchain;
  marketplace: Marketplace;
  adapterName?: string;
  fromBlock?: number;
  toBlock?: number;
  parser: LogParser;
}): Promise<SalesFromLogs> => {
  const provider = new web3(rpc);
  const latestBlock = await provider.eth.getBlockNumber();

  const params = {
    fromBlock: fromBlock || 0,
    toBlock: toBlock || latestBlock,
  };

  let logs: Log[] = [];
  let blockSpread = params.toBlock - params.fromBlock;
  let currentBlock = params.fromBlock;

  while (currentBlock < params.toBlock) {
    const nextBlock = Math.min(params.toBlock, currentBlock + blockSpread);
    try {
      const partLogs = await provider.eth.getPastLogs({
        fromBlock: currentBlock,
        toBlock: nextBlock,
        address: contractAddress,
        topics: [topic],
      });

      console.log(
        `Fetched sales for ${adapterName} from block number ${currentBlock} --> ${nextBlock}`
      );

      logs = logs.concat(partLogs);
      currentBlock = nextBlock;
    } catch (e) {
      if (blockSpread >= 1000) {
        // We got too many results
        // We could chop it up into 2K block spreads as that is guaranteed to always return but then we'll have to make a lot of queries (easily >1000), so instead we'll keep dividing the block spread by two until we make it
        blockSpread = Math.floor(blockSpread / 2);
      } else {
        // TODO: Retry
        console.log(e);
        continue
      }
    }
  }

  if (logs.length === 0) {
    return {
      sales: [],
      latestBlock: params.toBlock,
    };
  }

  const oldestBlock = await provider.eth.getBlock(logs[0].blockNumber);
  const newestBlock = await provider.eth.getBlock(
    logs.slice(-1)[0].blockNumber
  );

  if (!oldestBlock || !newestBlock) {
    return {
      sales: [],
      latestBlock: params.fromBlock,
    };
  }

  const sales = await parser({
    logs,
    oldestBlock,
    newestBlock,
    chain,
    marketplace,
  });

  return {
    sales,
    latestBlock: params.toBlock,
  };
};

export function restoreBigNumber(
  bigNum: SerializedBigNumber | BigNumber
): BigNumber {
  if (bigNum instanceof BigNumber) {
    return bigNum;
  }
  return BigNumber.from(bigNum.hex || bigNum._hex);
}

export async function awaitSequence(
  ...promiseFns: Array<(val: any) => Promise<unknown>>
): Promise<unknown> {
  return promiseFns.reduce((p, fn) => p.then(fn), Promise.resolve(!0));
}

export function fillMissingVolumeRecord(
  volumes: DailyVolumeRecord,
  timestamps: Array<number> = [],
  step = ONE_DAY_MILISECONDS
): DailyVolumeRecord {
  if (!timestamps.length) {
    timestamps = Object.keys(volumes).map((_) => parseInt(_));
  }
  const [start, end] = [Math.min(...timestamps), Math.max(...timestamps)];
  for (let i = start; i <= end; i += step) {
    if (!(i in volumes)) {
      volumes[i] = {
        volume: 0,
        volumeUSD: 0,
      };
    }
  }

  return volumes;
}

export function mergeDailyVolumeRecords(
  ...dailyVolumeRecords: Array<DailyVolumeRecord>
): DailyVolumeRecord {
  const volumes: DailyVolumeRecord = {};
  for (const dailyVolume of dailyVolumeRecords) {
    for (const [timestamp, volumeRecord] of Object.entries(dailyVolume)) {
      if (!(timestamp in volumes)) {
        volumes[timestamp] = {
          volume: 0,
          volumeUSD: 0,
        };
      }

      volumes[timestamp].volume += volumeRecord.volume ?? 0;
      volumes[timestamp].volumeUSD += volumeRecord.volumeUSD ?? 0;
    }
  }
  return volumes;
}

export function truncateDate(
  timestamp: number,
  truncate: DateTruncate | number = DateTruncate.DAY
) {
  switch (truncate) {
    case DateTruncate.HOUR:
    case DateTruncate.DAY:
      return timestamp - (timestamp % truncate);
    case DateTruncate.WEEK:
      timestamp = truncateDate(timestamp);
      // eslint-disable-next-line no-case-declarations
      const day = new Date(timestamp).getUTCDay();
      return timestamp - day * DateTruncate.DAY;
    default:
      if (
        !Object.values(DateTruncate).some(
          (v: DateTruncate) => truncate % v === 0
        )
      ) {
        throw new Error(
          "Truncate should be a multiple of at least one DateTruncate"
        );
      }
      switch (0) {
        case truncate % DateTruncate.WEEK:
          timestamp = truncateDate(timestamp, DateTruncate.WEEK);
          return (
            timestamp -
            DateTruncate.DAY * 7 * (truncate / DateTruncate.WEEK - 1)
          );
        case truncate % DateTruncate.DAY:
          timestamp = truncateDate(timestamp, DateTruncate.DAY);
          return (
            timestamp - DateTruncate.DAY * (truncate / DateTruncate.DAY - 1)
          );
        case truncate % DateTruncate.HOUR:
          timestamp = truncateDate(timestamp, DateTruncate.HOUR);
          return (
            timestamp - DateTruncate.HOUR * (truncate / DateTruncate.HOUR - 1)
          );
      }
  }
}

export function extendDate(
  timestamp: number,
  extension = DateTruncate.DAY,
  toEndOf = true
) {
  switch (extension) {
    case DateTruncate.HOUR:
    case DateTruncate.DAY:
      return truncateDate(timestamp, extension) + extension - (toEndOf ? 1 : 0);
    case DateTruncate.WEEK:
      timestamp = truncateDate(timestamp);
      // eslint-disable-next-line no-case-declarations
      const day = new Date(timestamp).getUTCDay();
      return timestamp + (7 - day) * DateTruncate.DAY - (toEndOf ? 1 : 0);
  }
}

export function getDateTruncateForStatType(statType: StatType) {
  switch (statType) {
    case StatType.WEEKLY_COLLECTION:
      return DateTruncate.WEEK;
    case StatType.HOURLY_COLLECTION:
      return DateTruncate.HOUR;
    case StatType.DAILY_COLLECTION:
    default:
      return DateTruncate.DAY;
  }
}
