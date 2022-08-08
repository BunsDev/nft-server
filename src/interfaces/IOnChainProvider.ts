export interface IOnChainProvider<T> {
  provider: T;
  getCurrentBlockNumber(): Promise<number>;
  getBlock(block: unknown): Promise<any>;
  getTransactionReceipt?(transactionHash: string): Promise<any>;
  get firstRpcProvider(): T;
}
