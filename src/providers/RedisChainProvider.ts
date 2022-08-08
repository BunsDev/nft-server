import { createClient } from "redis";
import { Provider, BlockTag, Block } from "@ethersproject/abstract-provider";
import { Blockchain } from "../types";
import { TransactionReceipt } from "@ethersproject/providers";
import { getLogger } from "../utils/logger";

const LOGGER = getLogger("REDIS", {
  datadog: !!process.env.DATADOG_API_KEY,
});

const EXPIRE_TIME = parseInt(process.env.REDIS_EXPIRY) || 3600;

export class RedisChainProvider {
  public client;

  constructor() {
    LOGGER.debug(`Redis construct()`, {
      url: process.env.REDIS_URL,
    });
    this.client = createClient({
      url: process.env.REDIS_URL,
    });
    this.client.on("error", (err) => {
      LOGGER.alert(`Redis Error`, { err });
    });
    this.client.connect();
  }

  public async getBlock<T>(blockTag: BlockTag, chain: Blockchain): Promise<T> {
    const serializedBlock = await this.client.get(`BLOCK_${chain}_${blockTag}`);

    if (serializedBlock) {
      return <T>JSON.parse(serializedBlock);
    }

    return null;
  }

  public async putBlock(
    blockTag: BlockTag,
    chain: Blockchain,
    block: Block
  ): Promise<void> {
    await this.client.set(`BLOCK_${chain}_${blockTag}`, JSON.stringify(block), {
      EX: EXPIRE_TIME,
    });
  }

  public async getReceipt<T>(transactionHash: string): Promise<T> {
    const serializedReceipt = await this.client.get(
      `TX_RECEIPT_${transactionHash}`
    );

    if (serializedReceipt) {
      return <T>JSON.parse(serializedReceipt);
    }

    return null;
  }

  public async putReceipt(
    transactionHash: string,
    receipt: TransactionReceipt
  ): Promise<void> {
    await this.client.set(
      `TX_RECEIPT_${transactionHash}`,
      JSON.stringify(receipt),
      {
        EX: EXPIRE_TIME,
      }
    );
  }
}
