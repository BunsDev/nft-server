import "dotenv/config";
import { HistoricalStatistics } from "../../models/historical-statistics";
import { Blockchain, Marketplace, RecordState, SaleData, UpdateCollectionStatisticsResult } from "../../types";
import { getLogger } from "../../utils/logger";
import { CronConfig } from "./types";

const LOGGER = getLogger("CRON_UPDATE_STATISTICS", {
  datadog: !!process.env.DATADOG_API_KEY,
});

interface SaleRecord extends SaleData {
  PK: string;
  SK: string;
}

type StatRecord = {
  slug: string;
  sales: Array<SaleRecord>;
};

type StatsRecords = Partial<
  Record<Blockchain, Partial<Record<Marketplace, StatRecord>>>
>;

type UpdateResult = {
  chain: Blockchain;
  market: Marketplace;
  stat: StatRecord;
  stats: UpdateCollectionStatisticsResult;
  updates: Promise<void>;
};

const NOW = Date.now();

let runtime = 0;
main.runtime = 60 * 60 * 1e3 * 4;
main.interval = setInterval(() => runtime++, 1e3);

export default async function main(config: CronConfig) {
  const { promise, ddbClient } = config;
  let cursor: AWS.DynamoDB.DocumentClient.Key = null;
  let currentQuery = null;
  let closing = false;

  const close = () => (closing = true);
  promise.then(() => close);
  process.on("disconnect", close);

  function updateSalesState(sales: Array<SaleRecord>): Promise<any> {
    const updates = [];
    for (const sale of sales) {
      updates.push(
        ddbClient.update({
          ExpressionAttributeValues: {
            ":value": RecordState.VOLUME_RECORDED,
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

  // eslint-disable-next-line no-unmodified-loop-condition, no-unreachable-loop
  while (!closing) {
    LOGGER.debug(`Getting from cursor`, { cursor });
    try {
      currentQuery = await ddbClient.query({
        IndexName: `saleStateIndex`,
        ScanIndexForward: false,
        KeyConditionExpression: "recordState = :COLLECTION_EXISTS",
        Limit: 1000,
        ProjectionExpression: `PK, SK, contractAddress, price, priceBase, priceUSD, chain, marketplace`,
        ExpressionAttributeValues: {
          ":COLLECTION_EXISTS": RecordState.COLLECTION_EXISTS,
        },
        ...(cursor && { ExclusiveStartKey: cursor }),
      });
      LOGGER.debug(`Query result`, {
        len: currentQuery.Items.length,
        cursor,
      });
      cursor = currentQuery.LastEvaluatedKey;
      if (!cursor) closing = true;

      if (!cursor && !currentQuery.Items.length) {
        break;
      }

      const updates: StatsRecords = {};
      for (const item of currentQuery.Items as Array<SaleRecord>) {
        if (!(item.chain in updates)) {
          updates[item.chain] = {};
        }

        if (!(item.marketplace in updates[item.chain])) {
          updates[item.chain][item.marketplace] = {
            sales: [],
            slug: item.contractAddress ?? item.PK.split(/#/)[1],
          };
        }

        item.timestamp = item.SK.split(/#/)[0];

        updates[item.chain][item.marketplace].sales.push(item);
      }

      const results: Array<UpdateResult> = [];
      for (const [chain, markets] of Object.entries(updates)) {
        for (const [market, stat] of Object.entries(markets)) {
          const stats: UpdateCollectionStatisticsResult =
            await HistoricalStatistics.updateStatistics({
              slug: stat.slug,
              chain: chain as Blockchain,
              marketplace: market as Marketplace,
              sales: stat.sales,
            });
          const updates = await updateSalesState(stat.sales);
          const result = {
            chain: chain as Blockchain,
            market: market as Marketplace,
            stat,
            stats,
            updates,
          };
          results.push(result);
          LOGGER.debug(`Update Statistics UpdateResult`, { result });
        }
      }

      ddbClient.put({
        PK: `cronResult`,
        SK: `updateStatistics#${NOW}`,
        status: 0,
        runtime,
        results,
      });
      LOGGER.debug(`Update Results`, { results });
    } catch (e) {
      LOGGER.error(`Update Statistics Error`, {
        error: e,
        SK: `updateStatistics#${NOW}`,
      });
      ddbClient.put({
        PK: `cronResult`,
        SK: `updateStatistics#${NOW}`,
        status: 1,
        runtime,
        results: [],
      });
      return 1;
    }
  }

  return 0;
}
