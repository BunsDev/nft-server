import { Blockchain } from "../types";
import { ChainProviders, IOnChainProvider } from "./IOnChainProvider";

export type MarketChainProviders = ChainProviders | Blockchain[];

export interface IMarketOnChainProvider {
  createChainProviders(chains: MarketChainProviders): void;
  instantiateChainProvider(chain: Blockchain): IOnChainProvider;
}
