import { Blockchain, Marketplace } from "../types";
import dynamodb from "../utils/dynamodb";

// really no point is scanning before this block (punks)
export const EARLIEST_BLOCK = 4797962;

export class AdapterState {
  name: string;
  lastSyncedBlockNumber: bigint;

  static async createMoralisAdapterState(chain: Blockchain) {
    await dynamodb.put({
      PK: `adapterState`,
      SK: `moralis#${chain}`,
      lastSyncedBlockNumber: EARLIEST_BLOCK,
    });

    return {
      lastSyncedBlockNumber: EARLIEST_BLOCK,
    };
  }

  static async getMoralisAdapterState(chain: Blockchain) {
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk and SK = :sk",
        ExpressionAttributeValues: {
          ":pk": "adapterState",
          ":sk": `moralis#${chain}`,
        },
      })
      .then((result) => {
        const results = result.Items;
        if (results.length) {
          return results[0];
        }
      });
  }

  static async updateMoralisLastSyncedBlockNumber(
    chain: Blockchain,
    blockNumber: number
  ) {
    return dynamodb.update({
      Key: {
        PK: `adapterState`,
        SK: `moralis#${chain}`,
      },
      UpdateExpression: "SET lastSyncedBlockNumber = :blockNumber",
      ExpressionAttributeValues: {
        ":blockNumber": blockNumber,
      },
    });
  }

  static async createSalesAdapterState(
    marketplace: Marketplace,
    chain: Blockchain = Blockchain.Ethereum,
    startBlock = EARLIEST_BLOCK
  ) {
    if (!startBlock) {
      startBlock = EARLIEST_BLOCK;
    }

    await dynamodb.put({
      PK: `adapterState`,
      SK: `sales#chain#${chain}#marketplace#${marketplace}`,
      lastSyncedBlockNumber: startBlock,
    });

    return {
      lastSyncedBlockNumber: startBlock,
    };
  }

  static async getSalesAdapterState(
    marketplace: Marketplace,
    chain: Blockchain = Blockchain.Ethereum,
    createIfMissing = false,
    defaultBlock?: number
  ) {
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk and SK = :sk",
        ExpressionAttributeValues: {
          ":pk": "adapterState",
          ":sk": `sales#chain#${chain}#marketplace#${marketplace}`,
        },
      })
      .then((result) => {
        const results = result.Items;
        if (results.length) {
          return results[0];
        } else if (createIfMissing) {
          return AdapterState.createSalesAdapterState(
            marketplace,
            chain,
            defaultBlock
          );
        }
      });
  }

  static async updateSalesLastSyncedBlockNumber(
    marketplace: Marketplace,
    blockNumber: number,
    chain: Blockchain = Blockchain.Ethereum
  ) {
    return dynamodb.update({
      Key: {
        PK: `adapterState`,
        SK: `sales#chain#${chain}#marketplace#${marketplace}`,
      },
      UpdateExpression: "SET lastSyncedBlockNumber = :blockNumber",
      ExpressionAttributeValues: {
        ":blockNumber": blockNumber,
      },
    });
  }
}
