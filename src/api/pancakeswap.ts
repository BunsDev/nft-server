import axios from "axios";
import { request, gql } from "graphql-request";

import {
  Blockchain,
  Marketplace,
  CollectionAndStatisticData,
  SaleData,
} from "../types";
import { roundUSD, getSlug } from "../utils";
import { DEFAULT_TOKEN_ADDRESSES } from "../constants";
import { HistoricalStatistics } from "../models";

export interface PancakeSwapCollectionBanner {
  large: string;
  small: string;
}

export interface PancakeSwapCollectionData {
  address: string;
  avatar: string;
  banner: PancakeSwapCollectionBanner;
  createdAt: string;
  description: string;
  name: string;
  owner: string;
  symbol: string;
  totalSupply: string;
  updatedAt: string;
  verified: boolean;
}

const PANCAKESWAP_ENDPOINT =
  "https://api.thegraph.com/subgraphs/name/pancakeswap/nft-market";

const collectionQuery = gql`
  query getCollectionData($collectionAddress: String!) {
    collection(id: $collectionAddress) {
      totalVolumeBNB
      numberTokensListed
      dayData(orderBy: date, orderDirection: desc, first: 1) {
        dailyVolumeBNB
      }
    }
  }
`;

const floorQuery = gql`
  query getFloorData(
    $first: Int
    $skip: Int!
    $where: NFT_filter
    $orderBy: NFT_orderBy
    $orderDirection: OrderDirection
  ) {
    nfts(
      where: $where
      first: $first
      orderBy: $orderBy
      orderDirection: $orderDirection
      skip: $skip
    ) {
      currentAskPrice
    }
  }
`;

const salesQuery = gql`
  query getSalesData(
    $first: Int
    $skip: Int!
    $id: String
    $timestamp: String
  ) {
    transactions(
      first: $first
      skip: $skip
      where: { collection: $id, timestamp_gt: $timestamp }
      orderBy: timestamp
      orderDirection: asc
    ) {
      id
      timestamp
      askPrice
      buyer {
        id
      }
      seller {
        id
      }
    }
  }
`;

export class PancakeSwap {
  public static async getAllCollections(): Promise<
    PancakeSwapCollectionData[]
  > {
    const url = `https://nft.pancakeswap.com/api/v1/collections`;
    const response = await axios.get(url);
    const { data } = response.data;

    return data;
  }

  public static async getCollection(
    collection: PancakeSwapCollectionData,
    bnbInUsd: number
  ): Promise<CollectionAndStatisticData> {
    const address = collection.address.toLowerCase();

    const collectionData = await request(
      PANCAKESWAP_ENDPOINT,
      collectionQuery,
      {
        collectionAddress: address,
      }
    );

    const floorData = await request(PANCAKESWAP_ENDPOINT, floorQuery, {
      first: 1,
      orderBy: "currentAskPrice",
      orderDirection: "asc",
      skip: 0,
      where: {
        collection: address,
        isTradable: true,
      },
    });

    const { name, symbol, description, banner } = collection;
    const {
      collection: { numberTokensListed },
    } = collectionData;

    const { nfts } = floorData;
    const { currentAskPrice } = nfts[0];
    const floor = parseFloat(currentAskPrice);
    const marketCap = floor * parseInt(numberTokensListed);
    const slug = getSlug(name);
    const logo = banner.small;

    const { totalVolume, totalVolumeUSD } =
      await HistoricalStatistics.getCollectionTotalVolume({
        slug,
        marketplace: Marketplace.PancakeSwap,
      });

    const { dailyVolume, dailyVolumeUSD } =
      await HistoricalStatistics.getCollectionDailyVolume({
        slug,
        marketplace: Marketplace.PancakeSwap,
      });

    return {
      metadata: {
        address,
        name,
        slug,
        symbol,
        description,
        logo,
        website: `https://pancakeswap.finance/nfts/collections/${address}`,
        discord_url: "",
        telegram_url: "",
        twitter_username: "",
        medium_username: "",
        chains: [Blockchain.BSC],
        marketplaces: [Marketplace.PancakeSwap],
      },
      statistics: {
        dailyVolume,
        dailyVolumeUSD,
        owners: 0,
        floor,
        floorUSD: roundUSD(floor * bnbInUsd),
        totalVolume,
        totalVolumeUSD,
        marketCap,
        marketCapUSD: roundUSD(marketCap * bnbInUsd),
      },
    };
  }

  public static async getSales(
    address: string,
    occurredFrom: number
  ): Promise<(SaleData | undefined)[]> {
    const first = 1000; // Maximum value accepted by subgraph
    let skip = 0;
    let timestamp = occurredFrom.toString();
    let allTransactions = [] as any;
    let transactionCount = 0;

    const { transactions } = await request(PANCAKESWAP_ENDPOINT, salesQuery, {
      first,
      skip,
      timestamp,
      id: address,
    });

    transactionCount = transactions.length ?? 0;
    allTransactions = transactions ?? [];

    while (transactionCount) {
      skip += 1000;
      // Maximum value accepted by subgraph
      if (skip <= 5000) {
        const { transactions } = await request(
          PANCAKESWAP_ENDPOINT,
          salesQuery,
          {
            first,
            skip,
            id: address,
            timestamp,
          }
        );
        const newTransactions = transactions ?? [];
        transactionCount = newTransactions.length;
        allTransactions = [...allTransactions, ...newTransactions];
      } else {
        // Reset skip value and retrieve more sales
        const transactionLength = allTransactions.length;
        if (transactionLength) {
          const lastTimestamp =
            allTransactions[transactionLength - 1].timestamp;
          timestamp = lastTimestamp;
          skip = 0;
        }
      }
    }

    return allTransactions.map((sale: any) => {
      const { id: txnHash, askPrice: price, timestamp, buyer, seller } = sale;
      const { id: buyerAddress } = buyer;
      const { id: sellerAddress } = seller;
      const paymentTokenAddress = DEFAULT_TOKEN_ADDRESSES[Blockchain.BSC];

      return {
        txnHash: txnHash.toLowerCase(),
        timestamp: timestamp * 1000,
        paymentTokenAddress,
        price: parseFloat(price),
        priceBase: 0,
        priceUSD: 0,
        buyerAddress,
        sellerAddress,
        chain: Blockchain.BSC,
        marketplace: Marketplace.PancakeSwap,
      };
    });
  }
}
