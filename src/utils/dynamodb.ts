import AWS from "aws-sdk";

const MOCK_DYNAMODB_ENDPOINT = process.env.MOCK_DYNAMODB_ENDPOINT;
const TableName = "defillama_nft_collections";

const client = new AWS.DynamoDB.DocumentClient({
  ...(MOCK_DYNAMODB_ENDPOINT
    ? {
        endpoint: MOCK_DYNAMODB_ENDPOINT,
        sslEnabled: false,
        region: "local",
      }
    : {
        region: "us-east-2", // For running the adapters locally but using the prod DB
      }),
});

const dynamodb = {
  get: (params: Omit<AWS.DynamoDB.DocumentClient.GetItemInput, "TableName">) =>
    client.get({ TableName, ...params }).promise(),
  put: (
    item: AWS.DynamoDB.DocumentClient.PutItemInputAttributeMap,
    params?: Partial<AWS.DynamoDB.DocumentClient.PutItemInput>
  ) => client.put({ TableName, ...params, Item: item }).promise(),
  query: (params: Omit<AWS.DynamoDB.DocumentClient.QueryInput, "TableName">) =>
    client.query({ TableName, ...params }).promise(),
  update: (
    params: Omit<AWS.DynamoDB.DocumentClient.UpdateItemInput, "TableName">
  ) => client.update({ TableName, ...params }).promise(),
  delete: (
    params: Omit<AWS.DynamoDB.DocumentClient.DeleteItemInput, "TableName">
  ) => client.delete({ TableName, ...params }).promise(),
  batchWrite: (items: AWS.DynamoDB.DocumentClient.PutItemInputAttributeMap[]) =>
    client
      .batchWrite({
        RequestItems: {
          [TableName]: items.map((item) => ({ PutRequest: { Item: item } })),
        },
      })
      .promise(),
  batchGet: (keys: AWS.DynamoDB.DocumentClient.KeyList) =>
    client
      .batchGet({
        RequestItems: {
          [TableName]: {
            Keys: keys,
          },
        },
      })
      .promise(),
  transactWrite: ({
    putItems = [],
    updateItems = [],
    deleteItems = [],
  }: {
    putItems?: Omit<AWS.DynamoDB.DocumentClient.PutItemInputAttributeMap, "TableName">[];
    updateItems?: Omit<
      AWS.DynamoDB.DocumentClient.UpdateItemInput,
      "TableName"
    >[];
    deleteItems?: Omit<
      AWS.DynamoDB.DocumentClient.DeleteItemInput,
      "TableName"
    >[];
  }) =>
    client
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
      .promise(),
  scan: () => client.scan({ TableName }).promise(),
};
export default dynamodb;
