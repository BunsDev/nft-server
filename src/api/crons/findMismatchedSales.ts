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
  let collectionCursor: string = null;

  do {
    const { data, cursor } = await Collection.getSorted({
      marketplace: Marketplace.Opensea,
      cursor: collectionCursor,
    });
    collectionCursor = JSON.stringify(cursor);
    collections.push(...data);
  } while (collectionCursor);

  let cont = false;

  for (const collection of collections) {
    const badTxs = [];
    const contractAddress = collection.PK.split(/#/)[1];
    if (
      !cont &&
      contractAddress === "0xECCAE88FF31e9f823f25bEb404cbF2110e81F1FA"
    ) {
      cont = true;
    }

    if (!cont) {
      continue;
    }

    while (!closing) {
      LOGGER.debug(`Getting from cursor`, { cursor });
      try {
        currentQuery = await ddbClient.query({
          KeyConditionExpression: `PK = :PK AND SK > :SK`,
          ExpressionAttributeValues: {
            ":PK": `sales#${contractAddress}#marketplace#opensea`,
            ":SK": "1654967960000",
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
          if (
            item.metadata?.data[0]?.event?.transactionHash &&
            !item.SK.includes(item.metadata?.data[0]?.event?.transactionHash)
          ) {
            LOGGER.alert(`Bad Tx`, { PK: item.PK, SK: item.SK });
            badTxs.push({
              PK: item.PK,
              SK: item.SK,
              hash: item.metadata?.data[0]?.event?.transactionHash,
            });
          }
        }

        // const results = await Promise.allSettled(updates);
        // LOGGER.debug(`Update Results`, { results });
      } catch (e) {
        LOGGER.error(`Collection Discovery Error`, { error: e });
        return 1;
      }
    }
    for (let i = 0; i < badTxs.length; i += 1000) {
      const slice = badTxs.slice(i, i + 1000);
      if (!slice.length) {
        break;
      }
      await ddbClient.put({
        PK: "badTxs-3",
        SK: `collection#${contractAddress}#${i / 1000}`,
        count: slice.length,
        slice,
      });
    }
    closing = false;
  }
  return 0;
}
