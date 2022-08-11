import "dotenv/config";
import { Collection } from "../../models";
import { Blockchain, Marketplace, RecordState } from "../../types";
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

  const collections = [];
  let collectionCursor: AWS.DynamoDB.DocumentClient.Key = null;

  do {
    const { Items: data, LastEvaluatedKey: cursor } = await ddbClient.query({
      KeyConditionExpression: "PK = :badTxs",
      ExpressionAttributeValues: {
        ":badTxs": "badTxs",
      },
      ...(collectionCursor && { ExclusiveStartKey: collectionCursor }),
    });
    collectionCursor = cursor;
    collections.push(...data);
  } while (collectionCursor);

  for (const collection of collections) {
    const { SK, badTxs } = collection;
    const contractAddress = SK.split(/#/)[1];

    const updates = [];
    for (const badTx of badTxs) {
      const { PK, SK, hash } = badTx;
      const badSK = `${SK.split(/#/)[0]}#${hash}`;
      let replaceBadSK = false;
      let sale = (
        await ddbClient.get({
          Key: { PK, SK },
        })
      ).Item;
      if (!sale) {
        replaceBadSK = true;
        sale = (
          await ddbClient.get({
            Key: { PK, SK: badSK },
          })
        ).Item;
      }

      const newSK = `${sale.SK.split(/#/)[0]}#txnHash#${hash}`;
      const txHash = sale.metadata?.data[0]?.event?.transactionHash;
      if (!newSK.includes(txHash)) {
        LOGGER.alert(`Still mismatched TX`, { sale, PK, SK, newSK, txHash });
        continue;
      }
      updates.push(
        Promise.resolve({
          Key: { PK, SK: replaceBadSK ? badSK : SK, newSK },
        }),
        ddbClient.delete({
          Key: { PK, SK: replaceBadSK ? badSK : SK },
        }),
        ddbClient.put({
          ...sale,
          SK: newSK,
        })
      );
      LOGGER.debug(`Replace Sale`, {
        Key: { PK, SK: replaceBadSK ? badSK : SK, newSK },
      });
    }
  }
  return 0;
}
