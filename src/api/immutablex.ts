/* eslint-disable camelcase */

import axios from "axios";
import { getSlug, roundUSD, isSameDay, convertByDecimals } from "../utils";
import { DEFAULT_TOKEN_ADDRESSES } from "../constants";
import {
  CollectionData,
  StatisticData,
  SaleData,
  Blockchain,
  Marketplace,
} from "../types";
import { Collection, HistoricalStatistics } from "../models";
import { readlink } from "fs";

export interface ImmutableXCollectionData {
  address: string;
  collection_image_url: string;
  description: string;
  icon_url: string;
  metadata_api_url: string;
  name: string;
  project_id: number;
}

enum ImmutableXOrderStatus {
  FILLED = "filled",
  ACTIVE = "active",
  CANCELLED = "cancelled",
}

interface ImmutableXERC721Data {
  id: string;
  token_address: string;
  token_id: string;
  quantity: string;
  properties: Object;
}

interface ImmutableXERC20Data {
  token_address: string;
  quantity: string;
  decimals: number;
}

interface ImmutableXBuySellData {
  type: string;
  data: ImmutableXERC721Data | ImmutableXERC20Data;
}

interface ImmutableXOrderData {
  order_id: number;
  amount_sold: string | null;
  status: ImmutableXOrderStatus;
  timestamp: string;
  updated_timestamp: string;
  expiration_timestamp: string;
  user: string; // user address
  buy: ImmutableXBuySellData;
  sell: ImmutableXBuySellData;
}

export class ImmutableX {
  public static async getAllCollections(): Promise<ImmutableXCollectionData[]> {
    const collections: ImmutableXCollectionData[] = [];
    const url = `https://api.x.immutable.com/v1/collections`;
    let cursor = "";
    try {
      while (true) {
        const response = await axios.get(url, {
          params: { cursor },
        });
        ({ cursor } = response.data);
        const { result, remaining } = response.data;

        collections.push(...result);

        if (remaining === 0) {
          break;
        }
      }
    } catch (e) {
      return collections;
    }

    return collections;
  }

  public static async getCollectionMetadata(
    collection: ImmutableXCollectionData
  ): Promise<CollectionData> {
    const {
      name,
      collection_image_url: logo,
      description,
      address,
    } = collection;
    const slug = getSlug(name);

    return {
      address,
      name,
      slug,
      description,
      logo,
      symbol: null,
      website: null,
      discord_url: null,
      telegram_url: null,
      twitter_username: null,
      medium_username: null,
      chains: [Blockchain.ImmutableX],
      marketplaces: [Marketplace.ImmutableX],
    };
  }

  public static async getAllOrders(
    address: string,
    status: ImmutableXOrderStatus
  ): Promise<ImmutableXOrderData[]> {
    const url = `https://api.x.immutable.com/v1/orders?direction=desc&include_fees=true&order_by=timestamp&sell_token_address=${address}&sell_token_type=ERC721&status=${status}`;
    const response = await axios.get(url);
    let { cursor, result, remaining } = response.data;

    if (!remaining) {
      return result;
    }

    while (remaining) {
      const response = await axios.get(`${url}&cursor=${cursor}`);
      const data = response.data;

      cursor = data.cursor;
      remaining = data.remaining;
      result = [...result, ...data.result];
    }

    return result;
  }

  public static async getCollectionStatistics(
    collection: ImmutableXCollectionData,
    ethInUSD: number
  ): Promise<StatisticData> {
    console.log("Fetching statistics for IMX collection:", collection.name);
    const slug = getSlug(collection.name);

    const { totalVolume, totalVolumeUSD } =
      await HistoricalStatistics.getCollectionTotalVolume({
        slug,
        marketplace: Marketplace.ImmutableX,
      });
      
    const { dailyVolume, dailyVolumeUSD } =
      await HistoricalStatistics.getCollectionDailyVolume({
        slug,
        marketplace: Marketplace.ImmutableX,
      });

    const activeOrders = await this.getAllOrders(
      collection.address,
      ImmutableXOrderStatus.ACTIVE
    );
    const activeOrderPrices = activeOrders.map((order) =>
      convertByDecimals(parseFloat(order?.buy?.data?.quantity), 18)
    );
    const floor = activeOrderPrices.length && Math.min(...activeOrderPrices);
    const marketCap =
      activeOrderPrices.length && activeOrderPrices.length * floor; // TODO replace with total token number

    return {
      dailyVolume,
      dailyVolumeUSD,
      owners: 0, //TODO get owners
      floor,
      floorUSD: roundUSD(floor * ethInUSD),
      totalVolume,
      totalVolumeUSD,
      marketCap,
      marketCapUSD: roundUSD(marketCap * ethInUSD),
    };
  }

  public static async getSales(
    collection: Collection,
    occurredAfter: number
  ): Promise<(SaleData | undefined)[]> {
    const filledOrders = await this.getAllOrders(
      collection.address,
      ImmutableXOrderStatus.FILLED
    );

    if (!filledOrders) {
      return [];
    }

    return filledOrders.map((sale: ImmutableXOrderData) => {
      const createdAt = new Date(sale.timestamp).getTime();

      if (createdAt <= occurredAfter) {
        return undefined;
      }

      const paymentTokenAddress =
        DEFAULT_TOKEN_ADDRESSES[Blockchain.ImmutableX];
      const {
        timestamp,
        user: seller_address,
        sell: { data: sellData },
        buy: { data: buyData },
      } = sale;
      const { id: txnHash } = sellData as ImmutableXERC721Data;
      const { quantity } = buyData as ImmutableXERC20Data;
      const price = convertByDecimals(parseFloat(quantity), 18);

      return {
        collection: null,
        txnHash: txnHash.toLowerCase(),
        timestamp: createdAt.toString(),
        paymentTokenAddress,
        price,
        priceBase: 0,
        priceUSD: 0,
        buyerAddress: "",
        sellerAddress: seller_address || "",
        chain: Blockchain.ImmutableX,
        marketplace: Marketplace.ImmutableX,
        contract: Marketplace.ImmutableX as string,
        logIndex: sale.order_id,
        metadata: { sale },
      };
    });
  }
}
