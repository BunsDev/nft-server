import { Blockchain } from "../types";
import { Provider } from "@ethersproject/abstract-provider";

export interface IOnChainProvider {
  provider: Provider;
  getSales(): void;
}

export type ChainProviders = Partial<Record<Blockchain, IOnChainProvider>>;
