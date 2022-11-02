/* eslint-disable camelcase */

import axios from "axios";
import { roundUSD, convertByDecimals } from "../utils";
import { DEFAULT_TOKEN_ADDRESSES } from "../constants";
import {
  Blockchain,
  CollectionAndStatisticData,
  Marketplace,
  SaleData,
} from "../types";
import { HistoricalStatistics, Collection } from "../models";

interface JpgStoreTransactionData {
  id: number;
  tx_hash: string;
  policy_id: string;
  asset: string;
  datum_hash: string;
  action: string;
  price_lovelace: string;
  signer_address: string;
  script_address: string;
  created_at: string;
  seller_address: string;
  royalty_address: string;
  royalty_percentage_thousands: number;
  deleted_at?: string;
  asset_display_name: string;
  is_confirmed: boolean;
  asset_image: string;
  listing_id?: number;
  bundle_count?: number;
  asset_image_file_type: string;
}

export interface JpgStoreCollectionData {
  name: string; // slug
  policy_id: string;
  items: number;
  owners: number;
  floor_lovelace: string;
  volume_lovelace: string;
  display_name: string;
  description: string;
  twitter_link?: string;
  discord_link?: string;
  website_link?: string;
  telegram_link?: string;
  instagram_link?: string;
  medium_link?: string;
  last_updated: string;
  attributes_title?: string;
  royalty_address: string;
  royalty_percentage_thousands: number;
  hero_image_file_type: string;
  is_hidden: boolean;
  is_verified: boolean;
  created_at: string;
  hero_image?: string;
  is_scraped: boolean;
}

export class JpgStore {
  public static async getAllCollections(): Promise<JpgStoreCollectionData[]> {
    const url = `https://www.jpg.store/api/collection`;
    const response = await axios.get(url);
    let { collections, cursor } = response.data;
    let newCollections = collections;

    while (newCollections && newCollections.length >= 20) {
      newCollections = [];
      const response = await axios.get(`${url}?cursor=${cursor}`);

      const data = response.data;
      collections = [...collections, ...data.collections];
      cursor = data.cursor;
      newCollections = data.collections;
    }

    return collections;
  }

  public static async getCollection(
    collection: JpgStoreCollectionData,
    adaInUSD: number
  ): Promise<CollectionAndStatisticData> {
    const {
      display_name: name,
      name: slug,
      policy_id: address,
      items,
      owners,
      floor_lovelace: floor_price,
      volume_lovelace: total_volume,
      description,
      twitter_link,
      discord_link: discord_url,
      website_link: website,
      telegram_link: telegram_url,
      medium_link,
    } = collection;

    const { totalVolume, totalVolumeUSD } =
      await HistoricalStatistics.getCollectionTotalVolume({
        slug,
        marketplace: Marketplace.JpgStore,
      });
      
    const { dailyVolume, dailyVolumeUSD } =
      await HistoricalStatistics.getCollectionDailyVolume({
        slug,
        marketplace: Marketplace.JpgStore,
      });

    const logo = `https://d3exlhvlmmfsby.cloudfront.net/photos/hero-image/${slug}.webp`;
    const floor = convertByDecimals(parseInt(floor_price), 6) || 0;
    const marketCap = items * floor || 0;
    const twitter_username = twitter_link
      ? twitter_link.split("/").slice(-1)[0]
      : null;
    const medium_username = medium_link
      ? medium_link.split("/").slice(-1)[0]
      : null;

    return {
      metadata: {
        address,
        name,
        slug,
        description,
        logo,
        symbol: null,
        website,
        discord_url,
        telegram_url,
        twitter_username,
        medium_username,
        chains: [Blockchain.Cardano],
        marketplaces: [Marketplace.JpgStore],
      },
      statistics: {
        dailyVolume,
        dailyVolumeUSD,
        owners,
        floor,
        floorUSD: roundUSD(floor * adaInUSD),
        totalVolume,
        totalVolumeUSD,
        marketCap,
        marketCapUSD: roundUSD(marketCap * adaInUSD),
      },
    };
  }

  public static async getSales(
    collection: Collection,
    occurredAfter: number
  ): Promise<(SaleData | undefined)[]> {
    const url = `https://www.jpg.store/api/policy/${collection.address}/sales/total`;
    const response = await axios.get(url);
    const {
      _count: { policy_id },
    } = response.data;
    const pages = Math.ceil(policy_id / 100);
    let sales = [] as JpgStoreTransactionData[];

    for (let page = pages - 1; page >= 0; page--) {
      if (page >= 0) {
        const url = `https://www.jpg.store/api/policy/${collection.address}/sales/${page}`;
        const response = await axios.get(url);
        const results = response.data;

        if (!results) {
          continue;
        }

        const oldestResult = results.slice(-1)[0];
        const oldestTimestamp = new Date(oldestResult?.created_at).getTime();

        if (oldestTimestamp < occurredAfter) {
          break;
        }

        sales = [...sales, ...results];
      }
    }

    return sales.map((sale: JpgStoreTransactionData) => {
      const createdAt = new Date(sale?.created_at).getTime();

      if (sale.action !== "buy") {
        return undefined;
      }
      if (createdAt <= occurredAfter) {
        return undefined;
      }

      const paymentTokenAddress = DEFAULT_TOKEN_ADDRESSES[Blockchain.Cardano];
      const {
        tx_hash: txnHash,
        price_lovelace,
        signer_address: buyer_address,
        seller_address,
      } = sale;
      const price = convertByDecimals(parseInt(price_lovelace), 6);

      return {
        txnHash: txnHash.toLowerCase(),
        timestamp: createdAt.toString(),
        paymentTokenAddress,
        price,
        priceBase: 0,
        priceUSD: 0,
        buyerAddress: buyer_address || "",
        sellerAddress: seller_address || "",
        chain: Blockchain.Cardano,
        marketplace: Marketplace.JpgStore,
        contract: Marketplace.JpgStore as string,
        logIndex: sale.id,
        metadata: { sale },
      };
    });
  }
}
