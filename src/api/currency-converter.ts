import axios from "axios";
import { getLogger } from "../utils/logger";
import { Coingecko } from "../api/coingecko";
import { DEFAULT_TOKEN_ADDRESSES, COINGECKO_IDS } from "../constants";
import { Blockchain, SaleData } from "../types";
import { handleError, getPriceAtDate, roundUSD } from "../utils";
import { LlamaFi, CoinResponse, PRICE_CACHE } from "./llamafi";

const LOGGER = getLogger("CURRENCY_CONVERTER", {
  datadog: !!process.env.DATADOG_API_KEY,
});

export class CurrencyConverter {
  private static BASE_TOKENS = Object.values(Blockchain).map((chain) => ({
    address: DEFAULT_TOKEN_ADDRESSES[chain].toString(),
    fetch: () =>
      Coingecko.getHistoricalPricesById(COINGECKO_IDS[chain].geckoId, "usd"),
  }));

  private static BASE_TOKENS_ADDRESSES = CurrencyConverter.BASE_TOKENS.map(
    (token) => token.address.toString()
  );

  private static lastCachedTime: Date = new Date();
  private static tokenAddressPrices: Record<string, number[][]> = {};

  public static async getHistoricalPricesByChainAndAddress(
    chain: Blockchain,
    address: string
  ): Promise<number[][]> {
    try {
      const data = await Coingecko.getHistoricalPricesByAddress(
        COINGECKO_IDS[chain].platform,
        address,
        COINGECKO_IDS[chain].symbol
      );

      if (!data.length) {
        throw "Error";
      }

      return data;
    } catch (e) {
      // If the vs_currency is not supported, get values versus USD
      // and calculate price array versus base token manually
      const data = await Coingecko.getHistoricalPricesByAddress(
        COINGECKO_IDS[chain].platform,
        address,
        "usd"
      );
      const baseData = await Coingecko.getHistoricalPricesById(
        COINGECKO_IDS[chain].geckoId,
        "usd"
      );

      if (!data.length || !baseData.length) {
        return [];
      }

      return data.map((elem) => {
        const timestamp = elem[0];
        const matchingBaseData = baseData.find(
          (baseElem) => baseElem[0] === timestamp
        );

        if (matchingBaseData) {
          return [elem[0], elem[1] / matchingBaseData[1]];
        }

        return elem;
      });
    }
  }

  public static async fetchTokenAddressPrices(
    sales: SaleData[]
  ): Promise<Record<string, number[][]>> {
    // Check if prices need to be fetched again (every hour)
    const hoursSinceCached =
      Math.abs(
        new Date().valueOf() - CurrencyConverter.lastCachedTime.valueOf()
      ) / 36e5;
    const updateCache = hoursSinceCached >= 1;

    // Get unique token addresses from sales, excluding native tokens
    const tokenAddressPrices: Record<string, number[][]> = {};
    const tokenAddresses = sales.reduce(
      (tokenAddresses: Record<string, string>[], sale: SaleData) => {
        const flattenedTokenAddresses = tokenAddresses.map(
          (address) => address.address
        );
        const unique = !flattenedTokenAddresses.includes(
          sale.paymentTokenAddress
        );
        const notBaseToken = !CurrencyConverter.BASE_TOKENS_ADDRESSES.includes(
          sale.paymentTokenAddress
        );
        if (unique && notBaseToken) {
          tokenAddresses.push({
            address: sale.paymentTokenAddress,
            chain: sale.chain,
          });
          return tokenAddresses;
        }
        return tokenAddresses;
      },
      []
    );

    // Get prices for native/base tokens
    for (const baseToken of CurrencyConverter.BASE_TOKENS) {
      if (
        !(baseToken.address in CurrencyConverter.tokenAddressPrices) ||
        updateCache
      ) {
        tokenAddressPrices[baseToken.address.toString()] =
          await baseToken.fetch();
      }
    }

    // Get prices for non-native/non-base tokens
    for (const tokenAddress of tokenAddresses) {
      try {
        if (
          !(tokenAddress.address in CurrencyConverter.tokenAddressPrices) ||
          updateCache
        ) {
          tokenAddressPrices[tokenAddress.address.toString()] =
            await CurrencyConverter.getHistoricalPricesByChainAndAddress(
              tokenAddress.chain as any,
              tokenAddress.address
            );
        }
      } catch (e) {
        await handleError(
          e,
          "currency-converter-adapter:fetchTokenAddressPrices"
        );
      }
    }

    // Update lastCachedTime if prices are refreshed
    if (updateCache) {
      CurrencyConverter.lastCachedTime = new Date();
    }

    CurrencyConverter.tokenAddressPrices = {
      ...CurrencyConverter.tokenAddressPrices,
      ...tokenAddressPrices,
    };

    return CurrencyConverter.tokenAddressPrices;
  }

  public static async convertSales(sales: SaleData[]) {
    console.log("Running currency conversions for", sales.length, "sales");
    const tokenAddressPrices = await CurrencyConverter.fetchTokenAddressPrices(
      sales
    );

    for (const sale of sales) {
      const tokenAddress = sale.paymentTokenAddress.toString();
      const timestamp = parseInt(sale.timestamp);
      const price = sale.price;
      const chain = sale.chain as Blockchain;

      // If the token's historical prices was not found
      if (!(tokenAddress in tokenAddressPrices)) {
        sale.priceBase = -1;
        sale.priceUSD = -1;
        continue;
      }

      // USD price for base tokens, base price for all other tokens
      const priceAtDate = getPriceAtDate(
        timestamp,
        tokenAddressPrices[tokenAddress]
      );

      // If the token's historical prices was found but not at the sale date
      if (!priceAtDate) {
        sale.priceBase = -1;
        sale.priceUSD = -1;
        continue;
      }

      // If the token is a base token
      if (CurrencyConverter.BASE_TOKENS_ADDRESSES.includes(tokenAddress)) {
        sale.priceBase = price;
        sale.priceUSD = roundUSD(price * priceAtDate);
        continue;
      }

      const baseAddress = DEFAULT_TOKEN_ADDRESSES[chain];
      sale.priceBase = price * priceAtDate;
      sale.priceUSD = roundUSD(
        price *
          priceAtDate *
          getPriceAtDate(timestamp, tokenAddressPrices[baseAddress])
      );
    }

    return sales;
  }

  public static async matchSalesWithPrices(sales: Array<SaleData>) {
    LOGGER.info(`matchSalesWithPrices`, { sales: sales.length });
    const prices: Record<string, Record<string, Record<number, number>>> = {};
    const uniqueAddressesTimestamps = sales.reduce(
      (c, sale) => {
        const t = parseInt(sale.timestamp);
        const address =
          sale.paymentTokenAddress ?? DEFAULT_TOKEN_ADDRESSES[sale.chain];
        if (!c.timestamps.includes(t)) c.timestamps.push(t);
        if (!(sale.chain in c.addresses)) c.addresses[sale.chain] = [];
        if (!c.addresses[sale.chain].includes(address)) c.addresses[sale.chain].push(address);
        return c;
      },
      { timestamps: [], addresses: {} } as {
        timestamps: number[];
        addresses: Record<string, string[]>;
      }
    );

    LOGGER.info(`UniqueAddresses`, { uniqueAddressesTimestamps });
    LOGGER.info(`Chains`, {
      chains: Object.keys(uniqueAddressesTimestamps.addresses),
    });

    for (const chain of Object.keys(uniqueAddressesTimestamps.addresses)) {
      for (const address of uniqueAddressesTimestamps.addresses[chain]) {
        LOGGER.info(`Chain address`, { address });
        try {
          const saleTokenPrices = await LlamaFi.getHistoricPricesByContract(
            address,
            uniqueAddressesTimestamps.timestamps,
            chain
          );
          LOGGER.info(`Sale token prices`, { chain, address, saleTokenPrices });
          if (!(chain in prices)) prices[chain] = {};
          prices[chain][address] = saleTokenPrices;
        } catch (e) {
          console.log(e);
          LOGGER.error(`LlamaFi error`, { e });
        }
      }
    }

    LOGGER.info(`LlamaFi Prices`, { prices });

    for (const sale of sales) {
      sale.priceUSD =
        sale.price *
        prices[sale.chain][sale.paymentTokenAddress][parseInt(sale.timestamp)];
      LOGGER.info(`Convert sale price`, {
        price: sale.price,
        USD: sale.priceUSD,
      });
    }
  }
}
