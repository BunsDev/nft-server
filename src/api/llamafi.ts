import axios from "axios";
import { getLogger } from "../utils/logger";
import { LLAMA_FI_COIN_API } from "../constants";
import { Blockchain } from "../types";

const LOGGER = getLogger("LLAMAFI", {
  datadog: !!process.env.DATADOG_API_KEY,
});

type PostBody = Record<string, string | number | Array<unknown>>;
export type CoinResponse = {
  decimals: number;
  symbol: string;
  prices: Array<{
    price: number;
    timestamp: number;
  }>;
};

export type ContractPrices = Record<number, number>;

export const PRICE_CACHE: Record<string, Map<number, number>> = {};

function getCachedPrice(coin: string, timestamp: number) {
  if (!(coin in PRICE_CACHE)) return null;
  return PRICE_CACHE[coin].get(timestamp);
}

export class LlamaFi {
  public static async getHistoricPriceByContract(
    address: string,
    timestamp: number,
    blockchain: Blockchain | string = Blockchain.Ethereum
  ): Promise<ContractPrices> {
    return LlamaFi.getHistoricPricesByContract(
      address,
      [timestamp],
      blockchain
    );
  }

  public static async getHistoricPricesByContract(
    address: string,
    timestamps: Array<number>,
    blockchain: Blockchain | string = Blockchain.Ethereum
  ): Promise<ContractPrices> {
    const prices: ContractPrices = {};
    const coin = `${/:/.test(address) ? "" : blockchain + ":"}${address}`;
    const neededTimestamps = timestamps.flatMap((ts) => {
      if ((prices[ts] = getCachedPrice(coin, ts))) return [];
      return [ts];
    });
    if (neededTimestamps.length) {
      for (let i = 0; i < neededTimestamps.length; i += 200) {
        const postTimestamps = neededTimestamps.slice(i, i + 200);
        const response = await post({
          coin,
          timestamps: postTimestamps,
        });
        if (response.data.prices && response.data.prices) {
          postTimestamps.forEach((ts, i) => {
            if (response.data.prices[i]?.price) {
              prices[ts] = response.data.prices[i]?.price;
            }
          });
        }
      }

      if (neededTimestamps.length !== Object.keys(prices).length) {
        LOGGER.error(`getHistoricPricesByContract() timestamp length`, {
          coin,
          neededLen: neededTimestamps.length,
          priceLen: Object.keys(prices).length,
          min: Math.min(...neededTimestamps),
          max: Math.max(...neededTimestamps),
        });
      }
    }
    return prices;
  }
}

async function post(body: PostBody) {
  const req = await axios.post(LLAMA_FI_COIN_API, body, {
    transformResponse: (data) => cacheResponse(body, data),
  });
  return req;
}

function cacheResponse(request: PostBody, response: string) {
  const coinRes: CoinResponse = JSON.parse(response);
  if ("message" in coinRes) {
    return coinRes;
  }
  const reqTimestamps = <Array<number>>request.timestamps;
  for (let i = 0; i < reqTimestamps.length; i++) {
    const coin = <string>request.coin;
    if (!(coin in PRICE_CACHE)) {
      PRICE_CACHE[coin] = new Map<number, number>();
    }
    if (coinRes.prices[i]) {
      PRICE_CACHE[coin].set(reqTimestamps[i], coinRes.prices[i].price);
    }
  }
  return coinRes;
}
