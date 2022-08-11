import "dotenv/config";
import { Marketplace, RecordState } from "../../types";
import { getLogger } from "../../utils/logger";
import { CronConfig } from "./types";

const LOGGER = getLogger("CRON_SET_RECORD_STATE", {
  datadog: !!process.env.DATADOG_API_KEY,
});

export default async function main(config: CronConfig) {
  const { promise, ddbClient } = config;
  let cursor: AWS.DynamoDB.DocumentClient.Key = null;
  let currentQuery = null;
  let closing = false;

  promise.then(() => {
    closing = true;
  });

  process.on("disconnect", () => {
    closing = true;
  });

  // eslint-disable-next-line no-unmodified-loop-condition, no-unreachable-loop
  while (!closing) {
    LOGGER.debug(`Getting from cursor`, { cursor });
    try {
      currentQuery = await ddbClient.query({
        KeyConditionExpression: `PK = :PK`,
        ExpressionAttributeValues: {
          ":PK": `sales#[object Object]#marketplace#opensea`,
        },
        ...(cursor && { ExclusiveStartKey: cursor }),
      });
      LOGGER.debug(`Query result`, {
        cursor,
        len: currentQuery.Items.length,
      });
      cursor = currentQuery.LastEvaluatedKey;
      if (!cursor || (!cursor && !currentQuery.Items.length)) {
        closing = true;
      }

      const updates = [];
      for (const item of currentQuery.Items) {
        updates.push(
          Promise.resolve({
            Key: {
              PK: item.PK,
              SK: item.SK,
              newPK: `sales#${item.contractAddress}#marketplace#opensea`,
            },
          }),
          ddbClient.delete({
            Key: {
              PK: item.PK,
              SK: item.SK,
            },
          }),
          ddbClient.put({
            ...item,
            PK: `sales#${item.contractAddress}#marketplace#opensea`,
          })
        );
        LOGGER.debug(`Replace Sale`, {
          Key: {
            PK: item.PK,
            SK: item.SK,
            newPK: `sales#${item.contractAddress}#marketplace#opensea`,
          },
        });
      }

      const results = await Promise.allSettled(updates);
      if (cursor) {
        await ddbClient.update({
          Key: {
            PK: `cronState`,
            SK: `setRecordState`,
          },
          ExpressionAttributeValues: {
            ":cursor": cursor,
          },
          UpdateExpression: `SET cronCursor = :cursor`,
        });
      }
      LOGGER.debug(`Update Results`, { results });
    } catch (e) {
      LOGGER.error(`Collection Discovery Error`, { error: e });
      return 1;
    }
  }

  return 0;
}
