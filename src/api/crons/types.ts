import { DynamoTableClient } from "../../utils/dynamodb";

export type CronConfig = {
  promise: Promise<any>;
  ddbClient: DynamoTableClient;
};
