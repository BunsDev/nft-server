import axios from "axios";
import web3 from "web3";
import { Block } from "web3-eth";
import { Log } from "web3-core";
import { Blockchain, Marketplace, SaleData, SerializedBigNumber } from "../types";
import { getLogger } from "./logger";
import { BigNumber } from "ethers";

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
  return BigNumber.from(bigNum.hex);
}

export async function awaitSequence(
  ...promiseFns: Array<() => Promise<unknown>>
): Promise<unknown> {
  return promiseFns.reduce((p, fn) => p.then(fn), Promise.resolve(!0));
}
