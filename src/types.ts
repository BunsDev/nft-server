import { TransactWriteItemsOutput } from "aws-sdk/clients/dynamodb";
import { ONE_DAY_MILISECONDS, ONE_HOUR_MILISECONDS, ONE_WEEK_MILISECONDS } from "./constants";

export enum Blockchain {
  Ethereum = "ethereum",
  Solana = "solana",
  ImmutableX = "immutablex",
  BSC = "bsc",
  Arbitrum = "arbitrum",
  Terra = "terra",
  Cardano = "cardano",
  Avalanche = "avalanche",
  Fantom = "fantom",
  Harmony = "harmony"
}

export const BlockchainReverseLookup = new Map<
  Blockchain,
  keyof typeof Blockchain
>(
  Object.entries(Blockchain).map(
    ([key, value]: [keyof typeof Blockchain, Blockchain]) => [value, key]
  )
);

export enum AdapterType {
  Moralis = "moralis",
}

export enum Marketplace {
  Blur = "blur",
  LooksRare = "looksrare",
  Opensea = "opensea",
  MagicEden = "magiceden",
  ImmutableX = "immutablex",
  PancakeSwap = "pancakeswap",
  Treasure = "treasure",
  RandomEarth = "randomearth",
  JpgStore = "jpgstore",
  NFTrade = "nftrade",
  PaintSwap = "paintswap",
  DefiKingdoms = "defi-kingdoms",
  NFTKEY = "nftkey",
  Blur = "blur",
  Rarible = "rarible",
}

export const MarketplaceReverseLookup = new Map<
  Marketplace,
  keyof typeof Marketplace
>(
  Object.entries(Marketplace).map(
    ([key, value]: [keyof typeof Marketplace, Marketplace]) => [value, key]
  )
);

export enum MoralisChain {
  Ethereum = "eth",
  BSC = "bsc",
  None = "",
}

export class LowVolumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LowVolumeError";
  }
}

export interface CollectionData {
  address: string;
  name: string;
  slug: string;
  symbol: string;
  description: string;
  logo: string;
  website?: string;
  discord_url?: string;
  telegram_url?: string;
  twitter_username?: string;
  medium_username?: string;
  chains?: Blockchain[];
  marketplaces?: Marketplace[];
}

export interface StatisticData {
  dailyVolume?: number;
  dailyVolumeUSD?: number;
  owners: number;
  floor: number;
  floorUSD: number;
  totalVolume?: number;
  totalVolumeUSD?: number;
  marketCap: number;
  marketCapUSD: number;
  fromSales?: boolean;
}

export interface CollectionAndStatisticData {
  metadata: CollectionData;
  statistics: StatisticData;
}

export enum RecordState {
  UNPROCESSED = 0,
  COLLECTION_EXISTS = 1,
  VOLUME_RECORDED = 2,
}

export enum StatType {
  DAILY_COLLECTION = "0",
  DAILY_GLOBAL = "1",
  WEEKLY_COLLECTION = "2",
  WEEKLY_GLOBAL = "3",
  HOURLY_COLLECTION = "4",
  HOURLY_GLOBAL = "5",
}

export interface SaleData {
  txnHash: string;
  timestamp: string; // timestamp in milliseconds
  paymentTokenAddress: string;
  contractAddress?: string;
  price: number;
  priceBase: number | null;
  priceUSD: number | null;
  sellerAddress: string;
  buyerAddress: string;
  marketplace: Marketplace;
  chain: Blockchain;
  metadata?: Record<string, any>;
  count?: number;
  recordState?: RecordState;
  bundleSale?: boolean;
  contract: string;
  logIndex: number;
  hasCollection?: boolean;
  priceConfirmed?: boolean;
  tokenID?: string;
  blockNumber?: number;
}

export interface SaleRecord extends SaleData {
  PK: string;
  SK: string;
}

export type HumanABI = string[] | string;

export type ERCStandard = {
  abi: HumanABI;
};

export type SerializedBigNumber = {
  hex?: string;
  _hex?: string;
  type: string;
};

export type UpdateCollectionStatisticsResult = {
  negate: boolean;
  slug: string;
  chain: Blockchain;
  marketplace: Marketplace;
  fromSales: {
    didEnter: boolean;
    result: boolean;
    output: TransactWriteItemsOutput;
  };
  ranOverview: boolean;
  volumesResult: {
    [key: string]: {
      result: boolean;
      output: TransactWriteItemsOutput;
    };
  };
};

export type VolumeRecord = {
  volume?: number;
  volumeUSD?: number;
};

export type DailyVolumeRecord = {
  [key: number | string]: VolumeRecord;
};

export enum DateTruncate {
  HOUR = 3600 * 1000,
  DAY = 86400 * 1000,
  WEEK = 7 * 86400 * 1000,
}
