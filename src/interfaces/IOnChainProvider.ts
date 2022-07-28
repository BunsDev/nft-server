import { Blockchain } from "../types";

export interface IOnChainProvider<T> {
  provider: T;
  getSales(): void;
  getCurrentBlockNumber(): Promise<number>;
  get firstRpcProvider(): T;
}
