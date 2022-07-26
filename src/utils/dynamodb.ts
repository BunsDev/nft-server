import AWS from "aws-sdk";
import { CredentialsOptions } from "aws-sdk/lib/credentials";

const MOCK_DYNAMODB_ENDPOINT = process.env.MOCK_DYNAMODB_ENDPOINT;
const DEFAULT_TABLE = process.env.TABLE_NAME ?? "defillama_nft_collections";

export function getClient(
  config: AWS.DynamoDB.DocumentClient.DocumentClientOptions &
    AWS.DynamoDB.Types.ClientConfiguration = null
) {
  if (!config) {
    config = MOCK_DYNAMODB_ENDPOINT
      ? {
          endpoint: MOCK_DYNAMODB_ENDPOINT,
          sslEnabled: false,
          region: "local",
        }
      : {
          region: process.env.AWS_REGION ?? "us-east-2", // For running the adapters locally but using the prod DB
        };
  }
  return new AWS.DynamoDB.DocumentClient(config);
}

const _client = getClient();

export function getTableClient(TableName: string, client = _client) {
  return {
    get(params: Omit<AWS.DynamoDB.DocumentClient.GetItemInput, "TableName">) {
      return client.get({ TableName, ...params }).promise();
    },

    put(
      item: AWS.DynamoDB.DocumentClient.PutItemInputAttributeMap,
      params?: Partial<AWS.DynamoDB.DocumentClient.PutItemInput>
    ) {
      return client.put({ TableName, ...params, Item: item }).promise();
    },

    query(params: Omit<AWS.DynamoDB.DocumentClient.QueryInput, "TableName">) {
      return client.query({ TableName, ...params }).promise();
    },

    update(
      params: Omit<AWS.DynamoDB.DocumentClient.UpdateItemInput, "TableName">
    ) {
      return client.update({ TableName, ...params }).promise();
    },

    delete(
      params: Omit<AWS.DynamoDB.DocumentClient.DeleteItemInput, "TableName">
    ) {
      return client.delete({ TableName, ...params }).promise();
    },

    batchWrite(items: AWS.DynamoDB.DocumentClient.PutItemInputAttributeMap[]) {
      return client
        .batchWrite({
          RequestItems: {
            [TableName]: items.map((item) => ({ PutRequest: { Item: item } })),
          },
        })
        .promise();
    },
    batchGet(keys: AWS.DynamoDB.DocumentClient.KeyList) {
      return client
        .batchGet({
          RequestItems: {
            [TableName]: {
              Keys: keys,
            },
          },
        })
        .promise();
    },
    transactWrite({
      putItems = [],
      updateItems = [],
      deleteItems = [],
    }: {
      putItems?: Omit<
        AWS.DynamoDB.DocumentClient.PutItemInputAttributeMap,
        "TableName"
      >[];
      updateItems?: Omit<
        AWS.DynamoDB.DocumentClient.UpdateItemInput,
        "TableName"
      >[];
      deleteItems?: Omit<
        AWS.DynamoDB.DocumentClient.DeleteItemInput,
        "TableName"
      >[];
    }) {
      return client
        .transactWrite({
          TransactItems: [
            ...putItems.map((item) => ({
              Put: {
                TableName,
                Item: item,
              },
            })),
            ...updateItems.map((item) => ({
              Update: {
                TableName,
                ...(item as any),
              },
            })),
            ...deleteItems.map((item) => ({
              Delete: {
                TableName,
                ...(item as any),
              },
            })),
          ],
        })
        .promise();
    },

    scan(
      params: Omit<AWS.DynamoDB.DocumentClient.ScanInput, "TableName">
    ): Promise<AWS.DynamoDB.DocumentClient.ScanOutput> {
      return client.scan({ ...params, TableName }).promise();
    },
  };
}

const dynamodb = getTableClient(DEFAULT_TABLE);
export default dynamodb;
