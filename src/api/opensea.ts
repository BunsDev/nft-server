/* eslint-disable camelcase */

import axios from "axios";
import { URLSearchParams } from "url";

import { DEFAULT_TOKEN_ADDRESSES } from "../constants";
import { roundUSD, convertByDecimals, sleep } from "../utils";
import {
  Blockchain,
  CollectionAndStatisticData,
  CollectionData,
  SaleData,
  LowVolumeError,
  Marketplace,
} from "../types";
import { HistoricalStatistics } from "../models";
import { getLogger } from "../utils/logger";

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const SECONDARY_OPENSEA_API_KEY = process.env.SECONDARY_OPENSEA_API_KEY;
const VOLUME_THRESHOLD = 0.1; //ETH

const LOGGER = getLogger("OPENSEA_API", {
  datadog: !!process.env.DATADOG_API_KEY,
});

let REQS_PER_SEC = 0;
setInterval(() => (REQS_PER_SEC = 0), 1e3);

export class Opensea {
  public static async getCollection(
    address: string,
    slug: string,
    ethInUSD: number
  ): Promise<CollectionAndStatisticData> {
    const url = `https://api.opensea.io/api/v1/collection/${slug}/`;
    const response = await axios.get(url, {
      headers: { "X-API-KEY": OPENSEA_API_KEY },
    });
    const { collection } = response.data;
    const {
      description,
      name,
      discord_url,
      external_url,
      image_url,
      medium_username,
      telegram_url,
      twitter_username,
    } = collection;
    const { symbol } = collection.primary_asset_contracts[0] || {};
    const {
      num_owners,
      total_volume,
      floor_price,
      market_cap,
    } = collection.stats;

    if (total_volume < VOLUME_THRESHOLD) {
      throw new LowVolumeError(
        `Collection ${name} has volume ${total_volume} < ${VOLUME_THRESHOLD}`
      );
    }

    const { totalVolume, totalVolumeUSD } =
      await HistoricalStatistics.getCollectionTotalVolume({
        slug,
        marketplace: Marketplace.Opensea,
      });
      
    const { dailyVolume, dailyVolumeUSD } =
      await HistoricalStatistics.getCollectionDailyVolume({
        slug,
        marketplace: Marketplace.Opensea,
      });

    return {
      metadata: {
        address,
        name,
        slug,
        symbol,
        description,
        logo: image_url,
        website: external_url,
        discord_url,
        telegram_url,
        twitter_username,
        medium_username,
        chains: [Blockchain.Ethereum],
        marketplaces: [Marketplace.Opensea],
      },
      statistics: {
        dailyVolume,
        dailyVolumeUSD,
        owners: num_owners,
        floor: floor_price || 0,
        floorUSD: roundUSD(floor_price * ethInUSD),
        totalVolume,
        totalVolumeUSD,
        marketCap: market_cap,
        marketCapUSD: roundUSD(market_cap * ethInUSD),
      },
    };
  }

  public static async getContract(address: string): Promise<CollectionData> {
    const url = `https://api.opensea.io/api/v1/asset_contract/${address}`;
    if (REQS_PER_SEC >= 2) {
      LOGGER.alert(`OS Rate Limit Hit`, { REQS_PER_SEC });
      await sleep(10);
    }
    REQS_PER_SEC++;
    const response = await axios.get(url, {
      headers: { "X-API-KEY": OPENSEA_API_KEY },
    });
    const { collection, name, symbol, description, external_link, image_url } =
      response.data;

    const {
      discord_url,
      slug,
      telegram_url,
      twitter_username,
      medium_username,
      image_url: tokenUrl,
    } = collection;

    return {
      address,
      name,
      slug,
      symbol,
      description,
      logo: image_url || tokenUrl,
      website: external_link,
      discord_url,
      telegram_url,
      twitter_username,
      medium_username,
      chains: [Blockchain.Ethereum],
      marketplaces: [Marketplace.Opensea],
    };
  }

  public static async getSales(
    address: string,
    occurredAfter: number,
    offset: number,
    limit: number
  ): Promise<(SaleData | undefined)[]> {
    const params: Record<string, string> = {
      asset_contract_address: address,
      occurred_after: (occurredAfter + 1).toString(),
      offset: offset.toString(),
      limit: limit.toString(),
      event_type: "successful",
      only_opensea: "false",
    };
    const searchParams = new URLSearchParams(params);
    const url = `https://api.opensea.io/api/v1/events?${searchParams.toString()}`;
    const response = await axios.get(url, {
      headers: { "X-API-KEY": SECONDARY_OPENSEA_API_KEY },
    });
    return response.data.asset_events.map((sale: any) => {
      if (!sale.transaction) {
        return undefined;
      }
      const paymentToken = sale.payment_token || {
        address: DEFAULT_TOKEN_ADDRESSES[Blockchain.Ethereum],
        decimals: 18,
      };

      const { transaction_hash: txnHash, timestamp } = sale.transaction;
      const { address: paymentTokenAddress, decimals } = paymentToken;
      const { total_price, winner_account, seller, created_date } = sale;
      const price = convertByDecimals(parseFloat(total_price), decimals);

      return {
        txnHash: txnHash.toLowerCase(),
        timestamp:
          new Date(timestamp).getTime() || new Date(created_date).getTime(),
        paymentTokenAddress,
        price,
        priceBase: 0,
        priceUSD: 0,
        buyerAddress: winner_account?.address || "",
        sellerAddress: seller?.address || "",
        chain: Blockchain.Ethereum,
        marketplace: Marketplace.Opensea
      };
    });
  }
}
