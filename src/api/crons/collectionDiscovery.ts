import { Collection } from "../../models/collection";
import { HistoricalStatistics } from "../../models/historical-statistics";
import { Blockchain, Marketplace, RecordState, SaleData } from "../../types";
import { getLogger } from "../../utils/logger";
import { CronConfig } from "./types";

const LOGGER = getLogger("CRON_COLLECTION_DISCOVERY", {
  datadog: !!process.env.DATADOG_API_KEY,
  debugTo: {
    console: false,
  },
});

interface SaleRecord extends SaleData {
  PK: string;
  SK: string;
  collectionExists: boolean;
}

type CollectionSales = Array<SaleRecord>;
type CollectionRecords = {
  [slug: string]: Partial<Record<Marketplace, CollectionSales>>;
};

const NOW = Date.now();
const CRON_NAME = process.env.RUN_CRON_NAME;

let runtime = 0;
main.runtime = 60 * 60 * 1e3 * 4;
main.interval = setInterval(() => runtime++, 1e3);

export default async function main(config: CronConfig) {
  const { promise, ddbClient } = config;
  let cursor: AWS.DynamoDB.DocumentClient.Key = null;
  let currentQuery = null;
  let closing = false;

  function updateSalesState(sales: Array<SaleRecord>): Promise<any> {
    const updates = [];
    for (const sale of sales) {
      updates.push(
        ddbClient.update({
          ExpressionAttributeValues: {
            ":value": RecordState.COLLECTION_EXISTS,
          },
          Key: {
            PK: sale.PK,
            SK: sale.SK,
          },
          UpdateExpression: "SET recordState = :value",
        })
      );
    }
    return Promise.allSettled(updates);
  }

  const close = () => (closing = true);
  promise.then(() => close);
  process.on("disconnect", close);

  const existingCheck: Array<string> = [];

  // eslint-disable-next-line no-unmodified-loop-condition, no-unreachable-loop
  while (!closing) {
    LOGGER.debug(`Getting from cursor`, { cursor });
    try {
      currentQuery = await ddbClient.query({
        IndexName: `saleStateIndex`,
        ScanIndexForward: true,
        KeyConditionExpression: "recordState = :UNPROCESSED",
        Limit: 1000,
        ProjectionExpression: `PK, SK, contractAddress, price, priceBase, priceUSD, marketplace, chain`,
        ExpressionAttributeValues: {
          ":UNPROCESSED": RecordState.UNPROCESSED,
        },
        ...(cursor && { ExclusiveStartKey: cursor }),
      });
      LOGGER.info(`Query result`, {
        len: currentQuery.Items.length,
        cursor,
      });
      cursor = currentQuery.LastEvaluatedKey;
      if (!cursor) closing = true;

      if (!currentQuery.Items.length) {
        break;
      }

      const updates: CollectionRecords = {};
      for (const item of currentQuery.Items as Array<SaleRecord>) {
        if (!existingCheck.includes(item.contractAddress)) {
          const existing = await Collection.get(item.contractAddress);
          existingCheck.push(item.contractAddress);
          if (
            existing.length &&
            existing.every((c) => c.category) &&
            existing.some((c) => c.category.includes(item.marketplace)) &&
            existing.some((c) => c.category.includes(item.chain))
          ) {
            LOGGER.info(`Collection Exists w/ Category`, { existing });
            item.collectionExists = true;
          }
        }

        if (!(item.contractAddress in updates)) {
          updates[item.contractAddress] = {};
        }

        if (!(item.marketplace in updates[item.contractAddress])) {
          updates[item.contractAddress][item.marketplace] = [];
        }

        updates[item.contractAddress][item.marketplace].push(item);
      }

      const promises: Array<Promise<void | Array<void>>> = [];
      for (const [slug, markets] of Object.entries(updates)) {
        for (const [market, sales] of Object.entries(markets)) {
          const results = await Collection.createCollectionsFromSales(
            sales.filter((s) => !s.collectionExists),
            market as Marketplace
          );

          promises.push(
            updateSalesState(
              sales.filter(
                (s) =>
                  s.collectionExists ||
                  (s.contractAddress in results && results[s.contractAddress])
              )
            )
          );

          if (!Object.values(results).every((_) => _)) {
            LOGGER.error(`Failed to create some collections`, {
              results: Object.entries(results).flatMap(([k, v]) =>
                !v ? [[k, v]] : []
              ),
              sales: sales.filter(
                (s) =>
                  s.contractAddress in results && !results[s.contractAddress]
              ),
            });
          }
        }
      }

      const results = await Promise.allSettled(promises);
      ddbClient.put({
        PK: `cronResult`,
        SK: `${CRON_NAME}#${NOW}`,
        status: 0,
        runtime,
        results,
      });
      LOGGER.debug(`Update Results`, { results });
    } catch (e) {
      LOGGER.error(`Collection Discovery Error`, {
        error: e,
        SK: `${CRON_NAME}#${NOW}`,
      });
      ddbClient.put({
        PK: `cronResult`,
        SK: `${CRON_NAME}#${NOW}`,
        status: 1,
        runtime,
        results: [],
      });
      return 1;
    }
  }

  return 0;
}
