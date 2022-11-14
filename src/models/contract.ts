import { Blockchain, Marketplace } from "../types";
import dynamodb from "../utils/dynamodb";

export class Contract {
  address: string;
  defaultTokenId: string;
  chain: Blockchain;

  static async insert(contracts: any, chain: Blockchain) {
    const batchWriteStep = 25;
    for (let i = 0; i < contracts.length; i += batchWriteStep) {
      const items = contracts
        .slice(i, i + batchWriteStep)
        .map((contract: any) => ({
          PK: `contracts#${chain}`,
          SK: contract.address,
          ...contract,
        }));
      await dynamodb.batchWrite(items);
    }
  }

  // TODO paginate
  static async getAll(chain: Blockchain) {
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `contracts#${chain}`,
        },
        ScanIndexForward: false,
      })
      .then((result) => result.Items);
  }

  static async remove(chain: Blockchain, address: string) {
    return dynamodb.delete({
      Key: {
        PK: `contracts#${chain}`,
        SK: address,
      },
    });
  }
}
