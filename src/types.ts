import { TransactWriteItemsOutput } from "aws-sdk/clients/dynamodb";

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
