import { Provider } from "@ethersproject/abstract-provider";
import { Blockchain } from "../types";

export interface IOnChainProvider {
  provider: Provider;
  getSales(): void;
}

export type ChainProviders = {
  [index in Blockchain]: IOnChainProvider;
};
