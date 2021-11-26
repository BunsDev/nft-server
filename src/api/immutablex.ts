/* eslint-disable camelcase */
import axios from "axios";
import { getSlug, roundUSD, weiToETH, isSameDay } from "../utils";
import { ETHEREUM_DEFAULT_TOKEN_ADDRESS } from "../constants";
import { CollectionData, StatisticData, SaleData } from "../types";
import { Collection } from "../models/collection";

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
    const url = `https://api.x.immutable.com/v1/collections`;
    const response = await axios.get(url);
    const { result } = response.data;

    return result;
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

    const activeOrders = await this.getAllOrders(
      collection.address,
      ImmutableXOrderStatus.ACTIVE
    );
    const filledOrders = await this.getAllOrders(
      collection.address,
      ImmutableXOrderStatus.FILLED
    );

    // TODO optimize
    const dailyVolume = filledOrders.reduce((a, b) => {
      if (isSameDay(new Date(b.timestamp), new Date())) {
        return a + weiToETH(parseFloat(b?.buy?.data?.quantity));
      }
      return a + 0;
    }, 0);
    const activeOrderPrices = activeOrders.map((order) =>
      weiToETH(parseFloat(order?.buy?.data?.quantity))
    );
    const floor = activeOrderPrices.length && Math.min(...activeOrderPrices);
    const totalVolume = filledOrders.reduce(
      (a, b) => a + weiToETH(parseFloat(b?.buy?.data?.quantity)),
      0
    );
    const marketCap =
      activeOrderPrices.length && activeOrderPrices.length * floor; // TODO replace with total token number

    return {
      dailyVolume,
      dailyVolumeUSD: BigInt(roundUSD(dailyVolume * ethInUSD)),
      owners: 0, //TODO get owners
      floor,
      floorUSD: roundUSD(floor * ethInUSD),
      totalVolume,
      totalVolumeUSD: BigInt(roundUSD(totalVolume * ethInUSD)),
      marketCap,
      marketCapUSD: BigInt(roundUSD(marketCap * ethInUSD)),
    };
  }

  public static async getSales(
    collection: Collection,
    occurredAfter: number,
    ethInUSD: number
  ): Promise<(SaleData | undefined)[]> {
    const filledOrders = await this.getAllOrders(
      collection.address,
      ImmutableXOrderStatus.FILLED
    );

    if (!filledOrders) {
      return [];
    }

    return filledOrders.map((sale: ImmutableXOrderData) => {
      if (new Date(sale.timestamp).getTime() < occurredAfter) {
        return undefined;
      }

      const paymentTokenAddress = ETHEREUM_DEFAULT_TOKEN_ADDRESS;

      const {
        timestamp,
        user: seller_address,
        sell: { data: sellData },
        buy: { data: buyData },
      } = sale;
      const { id: txnHash } = sellData as ImmutableXERC721Data;
      const { quantity } = buyData as ImmutableXERC20Data;
      const total_price = weiToETH(parseFloat(quantity));

      return {
        collection: null,
        marketplace: null,
        txnHash: txnHash.toLowerCase(),
        timestamp,
        paymentTokenAddress,
        price: total_price,
        priceUSD: BigInt(roundUSD(total_price * ethInUSD)),
        buyerAddress: "",
        sellerAddress: seller_address || "",
      };
    });
  }
}