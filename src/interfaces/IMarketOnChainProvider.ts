import { ClusterManager, ClusterWorker } from "../utils/cluster";
import { MarketConfig } from "../markets";
import {
  ContractInstances,
  AbiInterfaces,
  ChainTopics,
  SaleEvents,
  EventMetadata,
  TxReceiptsWithMetadata,
} from "../markets/BaseMarketOnChainProvider";
import { ChainProviders } from "../providers/OnChainProviderFactory";
import { Blockchain } from "../types";
import { TransactionReceipt } from "@ethersproject/abstract-provider";
import { Event } from "ethers";

export type MarketChainProviders = Blockchain[];

export interface IMarketOnChainProvider {
  // Public
  chains: ChainProviders;
  contracts: ContractInstances;
  interfaces: AbiInterfaces;
  topics: ChainTopics;
  events: SaleEvents;
  config: MarketConfig;

  // Methods
  fetchSales(): void;
  getEventReceipts(
    events: Array<Event>,
    chain: Blockchain
  ): Promise<TxReceiptsWithMetadata>;
  getEventMetadata(
    event: Event,
    receipt: TransactionReceipt,
    chain: Blockchain.Ethereum
  ): EventMetadata;
}
