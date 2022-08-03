import AWS from "aws-sdk";
import { getLogger } from "./logger";

const LOGGER = getLogger("DYNAMODB_DEBUG", {
  datadog: !!process.env.DATADOG_API_KEY,
  debugTo: {
    console: !!process.env.DYNAMODB_DD_DEBUG,
    datadog: !!process.env.DYNAMODB_DD_DEBUG,
  },
});

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
          ...(process.env.AWS_ACCESS_KEY && {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
          }),
        };
    config.logger = {
      log: (...messages: Array<any>) => {
        !!process.env.DYNAMODB_DD_DEBUG &&
          LOGGER.debug(`DDB Debug`, { messages });
      },
    };
  }
  return new AWS.DynamoDB.DocumentClient(config);
}

const _client = getClient();

export interface DynamoTableClient {
  get(
    params: Omit<AWS.DynamoDB.DocumentClient.GetItemInput, "TableName">
  ): Promise<AWS.DynamoDB.DocumentClient.GetItemOutput>;
  put(
    item: AWS.DynamoDB.DocumentClient.PutItemInputAttributeMap,
    params?: Partial<AWS.DynamoDB.DocumentClient.PutItemInput>
  ): Promise<AWS.DynamoDB.DocumentClient.PutItemOutput>;
  query(
    params: Omit<AWS.DynamoDB.DocumentClient.QueryInput, "TableName">
  ): Promise<AWS.DynamoDB.DocumentClient.QueryOutput>;
  update(
    params: Omit<AWS.DynamoDB.DocumentClient.UpdateItemInput, "TableName">
  ): Promise<AWS.DynamoDB.DocumentClient.UpdateItemOutput>;
  delete(
    params: Omit<AWS.DynamoDB.DocumentClient.DeleteItemInput, "TableName">
  ): Promise<AWS.DynamoDB.DocumentClient.DeleteItemOutput>;
  batchWrite(
    items: AWS.DynamoDB.DocumentClient.PutItemInputAttributeMap[]
  ): Promise<AWS.DynamoDB.DocumentClient.BatchWriteItemOutput>;
  batchGet(
    keys: AWS.DynamoDB.DocumentClient.KeyList
  ): Promise<AWS.DynamoDB.DocumentClient.BatchGetItemOutput>;
  transactWrite(items: {
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
  }): Promise<AWS.DynamoDB.DocumentClient.TransactWriteItemsOutput>;
  scan(
    params: Omit<AWS.DynamoDB.DocumentClient.ScanInput, "TableName">
  ): Promise<AWS.DynamoDB.DocumentClient.ScanOutput>;
}

export function getTableClient(
  TableName: string,
  client = _client
): DynamoTableClient {
  return {
    get(params) {
      return client.get({ TableName, ...params }).promise();
    },

    put(item, params?) {
      return client.put({ TableName, ...params, Item: item }).promise();
    },

    query(params) {
      return client.query({ TableName, ...params }).promise();
    },

    update(params) {
      return client.update({ TableName, ...params }).promise();
    },

    delete(params) {
      return client.delete({ TableName, ...params }).promise();
    },

    batchWrite(items) {
      return client
        .batchWrite({
          RequestItems: {
            [TableName]: items.map((item) => ({ PutRequest: { Item: item } })),
          },
        })
        .promise();
    },

    batchGet(keys) {
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

    transactWrite({ putItems = [], updateItems = [], deleteItems = [] }) {
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

    scan(params): Promise<AWS.DynamoDB.DocumentClient.ScanOutput> {
      return client.scan({ ...params, TableName }).promise();
    },
  };
}

const dynamodb = getTableClient(DEFAULT_TABLE);
export default dynamodb;
