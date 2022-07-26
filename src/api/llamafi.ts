import axios from "axios";
import { LLAMA_FI_COIN_API } from "../constants";
import { Blockchain } from "../types";

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
      const response = await post({
        coin,
        timestamps: neededTimestamps,
      });
      if (response.data.prices && response.data.prices) {
        neededTimestamps.forEach((ts, i) => {
          prices[ts] = response.data.prices[i].price;
        });
      }
    }
    return prices;
  }
}

async function post(body: PostBody) {
  console.log(JSON.stringify(body));
  const req = axios.post(LLAMA_FI_COIN_API, body, {
    transformResponse: (data) => cacheResponse(body, data),
  });
  try {
    console.log(await req);
  } catch (e) {
    console.log(e);
  }
  console.log(req);
  return req;
}

function cacheResponse(request: PostBody, response: string) {
  const coinRes: CoinResponse = JSON.parse(response);
  console.log(response);
  if ("message" in coinRes) {
    return coinRes;
  }
  const reqTimestamps = <Array<number>>request.timestamps;
  for (let i = 0; i < reqTimestamps.length; i++) {
    const coin = <string>request.coin;
    if (!(coin in PRICE_CACHE)) {
      PRICE_CACHE[coin] = new Map<number, number>();
    }
    PRICE_CACHE[coin].set(reqTimestamps[i], coinRes.prices[i].price);
  }
  return coinRes;
}
