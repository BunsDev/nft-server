import "dotenv/config";
import { HistoricalStatistics } from "../../models";
import {
  Blockchain,
  DailyVolumeRecord,
  DateTruncate,
  Marketplace,
  SaleData,
  StatType,
  VolumeRecord,
} from "../../types";
import { configureLoggerDefaults, getLogger } from "../../utils/logger";
import { ChildProcess, fork, spawn } from "child_process";
import cluster, { Worker } from "cluster";
import { cpus } from "os";
import dynamodb from "../../utils/dynamodb";
import { createClient } from "redis";
import { Key } from "aws-sdk/clients/dynamodb";
import {
  extendDate,
  fillMissingVolumeRecord,
  getDateTruncateForStatType,
  mergeDailyVolumeRecords,
  truncateDate,
} from "../../utils";
import { CronConfig } from "./types";
import { getDeferred } from "../../utils/cluster";

type GlobalVolumeStats = {
  [x: string | number]: {
    recorded: boolean;
    chains: Partial<Record<Blockchain, VolumeRecord>>;
    marketplaces: Partial<Record<Marketplace, VolumeRecord>>;
    globals: VolumeRecord;
  };
};

configureLoggerDefaults({
  debugTo: {
    console: false,
    datadog: false,
  },
});

const LOGGER = getLogger("GLOBAL_STATS", {
  datadog: !!process.env.DATADOG_API_KEY,
});

const client = createClient({
  url: process.env.REDIS_URL,
});
client.connect();

main.autostart = true;

export default async function main(config: CronConfig) {
  const { ddbClient } = config;

  const STAT_TYPE = (process.env.STAT_TYPE ||
    StatType.DAILY_GLOBAL) as StatType;
  const DATE_STEP: DateTruncate = getDateTruncateForStatType(STAT_TYPE);

  let STAT_TIME_START = parseInt(process.env.STAT_TIME_START);
  let STAT_TIME_END = parseInt(process.env.STAT_TIME_END);
  let PK: string;
  let COLLECT_STAT: StatType;
  let err: string;

  if (!STAT_TIME_START) {
    const startOfDate = truncateDate(Date.now(), DATE_STEP * 4);
    const { Items } = await dynamodb.query({
      ScanIndexForward: false,
      IndexName: "collectionStats",
      KeyConditionExpression: "statType = :st AND SK < :startOfDate",
      ExpressionAttributeValues: {
        ":st": STAT_TYPE,
        ":startOfDate": startOfDate.toString(),
      },
      ProjectionExpression: "SK",
      Limit: 1,
    });

    if (!Items.length) {
      throw new Error("Implement first sale stat timestamp");
    }

    STAT_TIME_START = parseInt(Items[0].SK);

    if (!STAT_TIME_START) {
      LOGGER.error(`Invlaid STAT_TIME_START`, { STAT_TIME_START });
      throw new Error(`Invalid STAT_TIME_START`);
    }
  }

  if (!STAT_TIME_END) {
    STAT_TIME_END = extendDate(Date.now(), DATE_STEP);
  }

  switch (STAT_TYPE) {
    case StatType.WEEKLY_GLOBAL:
      PK = `weeklyGlobalStatistics`;
      COLLECT_STAT = StatType.WEEKLY_COLLECTION;
      if (new Date(STAT_TIME_START).getUTCDay() !== 0) {
        err = `STAT_TIME_START should be first of week for weekly global`;
      }
      break;
    case StatType.DAILY_GLOBAL:
      PK = `dailyGlobalStatistics`;
      COLLECT_STAT = StatType.DAILY_COLLECTION;
      if (STAT_TIME_START % DateTruncate.DAY !== 0) {
        STAT_TIME_START = truncateDate(STAT_TIME_START, DATE_STEP);
      }
      break;
    case StatType.HOURLY_GLOBAL:
      PK = `hourlyGlobalStatistics`;
      COLLECT_STAT = StatType.HOURLY_COLLECTION;
      if (STAT_TIME_START % DateTruncate.HOUR !== 0) {
        STAT_TIME_START = truncateDate(STAT_TIME_START, DATE_STEP);
      }
      break;
  }

  LOGGER.info(`Global Stats`, {
    STAT_TIME_START,
    STAT_TIME_END,
    STAT_TYPE,
    DATE_STEP,
    COLLECT_STAT,
    PK,
  });

  if (err) {
    LOGGER.error(err, {
      STAT_TYPE,
      STAT_TIME_START,
      STAT_TIME_END,
    });
    throw new Error(err);
  }

  const volumes: GlobalVolumeStats = {};
  const recordInterval = setInterval(recordStats, 5 * 1e3);
  let cursor: Key = null;
  let lastSK: string = null;
  let keysReadyToRecord: Array<string> = [];
  let recordInProgress = false;
  const deferredCountStats = getDeferred();
  const deferredRecordStats = getDeferred();

  do {
    const { Items: data, LastEvaluatedKey } = await ddbClient.query({
      IndexName: "collectionStats",
      ScanIndexForward: true,
      KeyConditionExpression: `statType = :statType AND (SK BETWEEN :start AND :end)`,
      ExpressionAttributeValues: {
        ":statType": COLLECT_STAT,
        ":start": `${STAT_TIME_START}`,
        ":end": `${STAT_TIME_END}`,
      },
      ...(cursor && { ExclusiveStartKey: cursor }),
    });
    cursor = LastEvaluatedKey;

    if (!data.length) {
      continue;
    }

    if (!lastSK) {
      lastSK = data[0].SK;
    }

    let prevVol = 0;
    for (const record of data) {
      const { SK, statType, ...keys } = record;
      volumes[SK] ??= {
        recorded: false,
        chains: {},
        marketplaces: {},
        globals: {
          volume: 0,
          volumeUSD: 0,
        },
      };
      for (const [k, v] of Object.entries(keys)) {
        let chain, marketplace, volType;
        switch (true) {
          case /^chain/.test(k):
            [, chain, volType] = k.split(/_/);
            volumes[SK].chains[<Blockchain>chain] ??= {};
            volumes[SK].chains[<Blockchain>chain][
              volType as keyof VolumeRecord
            ] ??= 0;
            volumes[SK].chains[<Blockchain>chain][
              volType as keyof VolumeRecord
            ] += v;
            // We calculate globals from chain volumes
            volumes[SK].globals[volType as keyof VolumeRecord] += v;
            break;
          case /^marketplace/.test(k):
            [, marketplace, volType] = k.split(/_/);
            volumes[SK].marketplaces[<Marketplace>marketplace] ??= {};
            volumes[SK].marketplaces[<Marketplace>marketplace][
              volType as keyof VolumeRecord
            ] ??= 0;
            volumes[SK].marketplaces[<Marketplace>marketplace][
              volType as keyof VolumeRecord
            ] += v;
            break;
        }
      }
      if (!cursor || SK !== lastSK) {
        if (!keysReadyToRecord.includes(lastSK)) {
          keysReadyToRecord.push(lastSK);
        }
        lastSK = SK;
      } else {
        const change =
          (volumes[SK].chains[Blockchain.Ethereum].volume - prevVol) / prevVol;
        if (change * 100 > 300) {
          LOGGER.debug(`Volume change for SK ${change * 100}`, {
            change: change * 100,
            record,
            prevVol,
            skVol: volumes[SK],
          });
        }
        prevVol = volumes[SK].chains[Blockchain.Ethereum].volume;
      }
    }

    // await client.set(`GLOBAL_STATS_CURSOR#${STAT_TYPE}`, );
  } while (cursor);

  deferredCountStats.resolve(0);

  async function recordStats() {
    if (recordInProgress) return;
    recordInProgress = true;
    if (!cursor) {
      LOGGER.info(
        `Recording stats, cursor empty, waiting for count stats to resolve`
      );
      await deferredCountStats.promise;
      LOGGER.info(`Count stats resolved`, {
        keysReadyToRecord,
        willExit: !keysReadyToRecord.length,
      });
      if (!keysReadyToRecord.length) {
        deferredRecordStats.resolve(0);
        return;
      }
    }
    const keys = keysReadyToRecord.slice(0);
    keysReadyToRecord = [];
    for (const SK of keys) {
      const { chains, globals, marketplaces, recorded } = volumes[SK];
      if (recorded) {
        LOGGER.error(`Recording stat that's marked recorded`, {
          SK,
          stat: volumes[SK],
        });
        continue;
      }
      const stats: Record<string, any> = {
        PK,
        SK,
        statType: STAT_TYPE,
        volume: globals.volume,
        volumeUSD: globals.volumeUSD,
      };
      Object.entries(chains).forEach(([chain, volume]) => {
        stats[`chain_${chain}_volume`] = volume.volume;
        stats[`chain_${chain}_volumeUSD`] = volume.volumeUSD;
      });
      Object.entries(marketplaces).forEach(([marketplace, volume]) => {
        stats[`marketplace_${marketplace}_volume`] = volume.volume;
        stats[`marketplace_${marketplace}_volumeUSD`] = volume.volumeUSD;
      });
      await ddbClient.put(stats);
    }
    recordInProgress = false;
  }

  await Promise.all([deferredCountStats.promise, deferredRecordStats.promise]);
  return 0;
}
