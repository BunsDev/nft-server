import { ethers } from "ethers";
import { IOnChainProvider } from "../interfaces/IOnChainProvider";
import {
  Provider,
  BlockTag,
  Block,
  TransactionReceipt,
} from "@ethersproject/abstract-provider";
import { RedisChainProvider } from "./RedisChainProvider";
import { Blockchain } from "../types";

const CHAIN = Blockchain.Ethereum;

export class EthereumOnChainProvider implements IOnChainProvider<Provider> {
  private redisProvider: RedisChainProvider;

  constructor(public provider: Provider) {
    this.redisProvider = new RedisChainProvider();
  }

  public async getBlock(blockTag: BlockTag): Promise<Block> {
    const redisBlock = await this.redisProvider.getBlock<Block>(
      blockTag,
      CHAIN
    );
    if (redisBlock) {
      return redisBlock;
    }
    const block = await this.firstRpcProvider.getBlock(blockTag);
    this.redisProvider.putBlock(blockTag, CHAIN, block);
    return block;
  }

  public async getTransactionReceipt(
    transactionHash: string
  ): Promise<TransactionReceipt> {
    const redisReceipt =
      await this.redisProvider.getReceipt<TransactionReceipt>(transactionHash);
    if (redisReceipt) {
      return redisReceipt;
    }
    const receipt = await this.firstRpcProvider.getTransactionReceipt(
      transactionHash
    );
    this.redisProvider.putReceipt(transactionHash, receipt);
    return receipt;
  }

  public async getCurrentBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  get firstRpcProvider(): Provider {
    if (this.provider instanceof ethers.providers.FallbackProvider) {
      return this.provider.providerConfigs[0].provider;
    }
    return this.provider;
  }
}
