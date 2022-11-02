import axios from "axios";
import { handleError } from "../utils";

export class Coingecko {
  private static PRICE_ENDPOINT = "https://api.coingecko.com/api/v3/coins";
  private static HISTORICAL_PRICE_PARAMS = (base: string) =>
    `market_chart?vs_currency=${base}&days=max&interval=daily`;

  public static async getPricesById(coingeckoId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${Coingecko.PRICE_ENDPOINT}/${coingeckoId}`
      );
      return response.data.market_data.current_price;
    } catch (e) {
      await handleError(e, "coingecko:getPricesById");
      return {};
    }
  }

  public static async getHistoricalPriceByDate(
    coingeckoId: string,
    date: number | string,
    base = "usd"
  ): Promise<number> {

    if (typeof date === "number") {
      const d = new Date(date * 1000);
      date = `${d.getUTCDate()}-${d.getUTCMonth()}-${d.getUTCFullYear()}`;
    }

    try {
      const response = await axios.get(
        `${Coingecko.PRICE_ENDPOINT}/${coingeckoId}/history?date=${date}`
      );
      return parseFloat(response.data.market_data.current_price[base]);
    } catch (e) {
      await handleError(e, "coingecko:getPricesById");
      return 0;
    }
  }

  public static async getHistoricalPricesById(
    coingeckoId: string,
    base: string
  ): Promise<number[][]> {
    try {
      const response = await axios.get(
        `${
          Coingecko.PRICE_ENDPOINT
        }/${coingeckoId}/${Coingecko.HISTORICAL_PRICE_PARAMS(base)}`
      );
      const { prices } = response.data;
      return prices;
    } catch (e) {
      await handleError(e, "coingecko:getHistoricalPricesById");
      return [];
    }
  }

  public static async getHistoricalPricesByAddress(
    platform: string,
    address: string,
    base: string
  ): Promise<number[][]> {
    try {
      const response = await axios.get(
        `${
          Coingecko.PRICE_ENDPOINT
        }/${platform}/contract/${address}/${Coingecko.HISTORICAL_PRICE_PARAMS(
          base
        )}`
      );
      const { prices } = response.data;
      return prices;
    } catch (e) {
      await handleError(e, "coingecko:getHistoricalPricesByAddress");
      return [];
    }
  }
}
