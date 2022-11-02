import "dotenv/config";
import { Marketplace, RecordState } from "../../types";
import { getLogger } from "../../utils/logger";
import { CronConfig } from "./types";

const LOGGER = getLogger("CRON_SET_RECORD_STATE", {
  datadog: !!process.env.DATADOG_API_KEY,
});

export default async function main(config: CronConfig) {
  const { promise, ddbClient } = config;
  let cursor = null;
  let currentQuery = null;
  let closing = false;

  promise.then(() => {
    closing = true;
  });

  process.on("disconnect", () => {
    closing = true;
  });

  cursor = (
    await ddbClient.get({
      Key: {
        PK: `cronState`,
        SK: `setRecordState`,
      },
    })
  ).Item?.cronCursor;

  LOGGER.debug(`Saved cursor state`, { cursor });

  // eslint-disable-next-line no-unmodified-loop-condition, no-unreachable-loop
  while (!closing) {
    LOGGER.debug(`Getting from cursor`, { cursor });
    try {
      currentQuery = await ddbClient.scan({
        FilterExpression: `attribute_not_exists(recordState)`,
        ...(cursor && { ExclusiveStartKey: cursor }),
      });
      LOGGER.debug(`Query result`, {
        cursor,
        len: currentQuery.Items.length,
      });
      cursor = currentQuery.LastEvaluatedKey;
      if (!cursor) closing = true;

      if (!cursor && !currentQuery.Items.length) {
        closing = true;
      }

      const updates = [];
      for (const item of currentQuery.Items) {
        if (typeof item.recordState === "number") continue;
        if (!/^sale/.test(item.PK)) continue;
        updates.push(
          ddbClient.update({
            ExpressionAttributeValues: {
              ":value": RecordState.UNPROCESSED,
            },
            Key: {
              PK: item.PK,
              SK: item.SK,
            },
            UpdateExpression: "SET recordState = :value",
          })
        );
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
