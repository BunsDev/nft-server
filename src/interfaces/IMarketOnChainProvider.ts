import { Blockchain } from "../types";

export type MarketChainProviders = Blockchain[];

export interface IMarketOnChainProvider {
  fetchSales(): void;
}
