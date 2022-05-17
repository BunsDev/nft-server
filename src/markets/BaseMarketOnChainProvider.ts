import {
  OnChainProviderFactory,
  ChainProviders,
} from "../providers/OnChainProviderFactory";
import { IOnChainProvider, MarketChainProviders } from "../interfaces";
import { Blockchain, Marketplace } from "../types";
import { BigNumber, Contract, ethers } from "ethers";
import { MarketConfig, MarketChainsConfig } from "../markets";
import { Interface, LogDescription } from "@ethersproject/abi";
import { TransactionReceipt, Provider } from "@ethersproject/abstract-provider";
import { EventFragment, Result } from "ethers/lib/utils";
import { Event } from "ethers";

export enum LogType {
  ERC721 = "erc721",
  ERC1155 = "erc1155",
  ERC20 = "erc20",
  UNKNOWN = "unknown",
}
export type EventLogType = {
  log: LogDescription;
  type: LogType | Marketplace;
  contract?: string;
  decodedData?: Result;
  topics?: Array<string>;
  errors?: Array<Error>;
};
export type EventMetadata = {
  contractAddress: string;
  buyer: string;
  seller: string;
  price: BigNumber;
  eventSignatures: string[];
  tokenID: string;
  data: Result;
};
export type TxReceiptsWithMetadata = Record<
  string,
  {
    receipt: TransactionReceipt;
    meta: EventMetadata[];
  }
>;
export type ChainEvents = {
  chain: Blockchain;
  blockRange: {
    startBlock: number;
    endBlock: number;
  };
  events: Array<Event>;
  receipts?: TxReceiptsWithMetadata;
};
export type SaleEvents = Partial<Record<Blockchain, Array<ChainEvents>>>;
export type SaleEventFragments = Partial<Record<Blockchain, EventFragment>>;
export type ContractInstances = Partial<Record<Blockchain, Contract>>;
export type AbiInterfaces = Partial<Record<Blockchain, Interface>>;
export type ChainTopics = Partial<
  Record<Blockchain, Array<string | Array<string>>>
>;
export type MarketProviders = {
  chains: ChainProviders;
  contracts: ContractInstances;
  interfaces: AbiInterfaces;
  topics: ChainTopics;
};
export type Collection = {
  PK: string;
  SK: string;
  category: string;
  totalVolumeUSD: number;
  address: string;
  logo: string;
  name: string;
  marketplaces: Marketplace[];
  chains: Blockchain[];
  slug: string;
  lastBlock?: number;
};
export type CollectionSet = Collection[];

export class BaseMarketOnChainProviderFactory {
  public static createMarketProviders(config: MarketConfig): MarketProviders {
    const chains = self().createChainProviders(
      Object.keys(config.chains) as Blockchain[]
    );
    const contracts = self().getContracts(config.chains, chains);
    const interfaces = self().getInterfaces(config.chains);
    const topics = self().getEncodedEventTopics(config.chains, interfaces);
    return {
      chains,
      contracts,
      interfaces,
      topics,
    };
  }

  static getEncodedEventTopics(
    chains: MarketChainsConfig,
    interfaces: AbiInterfaces
  ) {
    return (Object.keys(chains) as Blockchain[]).reduce((carry, chain) => {
      carry[chain] = interfaces[chain].encodeFilterTopics(
        interfaces[chain].getEvent(chains[chain].saleEventName),
        []
      );
      return carry;
    }, {} as ChainTopics);
  }

  static getInterfaces(chains: MarketChainsConfig) {
    return (Object.keys(chains) as Blockchain[]).reduce((carry, chain) => {
      carry[chain] = new ethers.utils.Interface(chains[chain].abi);
      return carry;
    }, {} as AbiInterfaces);
  }

  public static createChainProviders(
    chains: MarketChainProviders
  ): ChainProviders {
    return chains.reduce((carry, chain) => {
      carry[chain] = self().instantiateChainProvider(chain);
      return carry;
    }, {} as ChainProviders);
  }

  public static getContracts(
    chains: MarketChainsConfig,
    providers: ChainProviders
  ): ContractInstances {
    return (Object.keys(chains) as Blockchain[]).reduce((carry, chain) => {
      carry[chain] = new ethers.Contract(
        chains[chain].contractAddress,
        chains[chain].abi,
        providers[chain].provider
      );
      return carry;
    }, {} as ContractInstances);
  }

  public static instantiateChainProvider<T>(
    chain: Blockchain
  ): IOnChainProvider<T> {
    return OnChainProviderFactory.getOnChainProvider<T>(chain);
  }
}

function self() {
  return BaseMarketOnChainProviderFactory;
}
