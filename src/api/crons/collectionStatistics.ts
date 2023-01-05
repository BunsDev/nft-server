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
import cluster, { Worker } from "cluster";
import { cpus } from "os";
import dynamodb from "../../utils/dynamodb";
import { createClient } from "redis";
import { Key } from "aws-sdk/clients/dynamodb";
import { DEFAULT_TOKEN_ADDRESSES } from "../../constants";
import {
  extendDate,
  fillMissingVolumeRecord,
  getDateTruncateForStatType,
  mergeDailyVolumeRecords,
  truncateDate,
} from "../../utils";
import { getDeferred } from "../../utils/cluster";

const UPDATE_INTERVAL = 60 * 1 * 1e3;

configureLoggerDefaults({
  debugTo: {
    console: true,
    datadog: true,
  },
});

enum CalcStatSalesState {
  UNPROCESSED = 0,
  INPROGRESS = 1,
  COMPLETED = 2,
  ERROR = 3,
  WRITING = 4,
}

interface SaleRecord extends SaleData {
  PK: string;
  SK: string;
}

type VolumeStats = Partial<
  Record<Marketplace, Partial<Record<Blockchain, DailyVolumeRecord>>>
>;

type CollectionStats = {
  PK: string;
  status: CalcStatSalesState;
  chains: Array<Blockchain>;
  marketplaces: Array<Marketplace>;
  contract: string;
};

const LOGGER = getLogger("CALC_STATS", {
  datadog: !!process.env.DATADOG_API_KEY,
});

const client = createClient({
  url: process.env.REDIS_URL,
});
client.connect();

const forks: Array<Worker> = [];

function spawnClusterFork(
  forks: Array<Worker>,
  childSetup: (child: Worker) => void,
): void {
  const fork = cluster.fork();
  forks.push(fork);
  childSetup(fork);
}

if (cluster.isWorker && process.env.RUN_CRON_NAME === "collectionStatistics") {
  main();
}

export default async function main() {
  const deferred = getDeferred();
  const COLLECTION_STAT_KEY = `COLLECTION_STATS#collections`;

  if (cluster.isPrimary) {
    const redisCollections = JSON.parse(await client.get("NFT_COLLECTIONS"));
    let collections = [];
    let collectionCursor: AWS.DynamoDB.DocumentClient.Key = null;

    if (redisCollections && redisCollections.length) {
      LOGGER.debug(`Got collections from redis`, {
        count: redisCollections.length,
      });
      collections = redisCollections;
    } else {
      do {
        const { Items: data, LastEvaluatedKey: cursor } = await dynamodb.scan({
          IndexName: "collectionsIndex",
          ProjectionExpression: "PK, SK, category, chains",
          ...(collectionCursor && {
            ExclusiveStartKey: collectionCursor,
          }),
        });
        collectionCursor = cursor;
        collections.push(...data.filter((c) => /^marketplace/.test(c.SK)));
        LOGGER.info(`Got collections`, { len: collections.length });
      } while (collectionCursor);

      LOGGER.debug(`Got collections from DB`, {
        count: collections.length,
      });
      await client.set("NFT_COLLECTIONS", JSON.stringify(collections), {
        EX: 3600,
      });
    }

    const getUniqueChains = (
      chains: Array<Blockchain>,
      newChains: Array<Blockchain>,
    ) => {
      return Array.from(new Set<Blockchain>(chains.concat(newChains)));
    };

    const saleCollections: Record<string, CollectionStats> =
      JSON.parse(await client.get(COLLECTION_STAT_KEY)) ?? {};
    for (const collection of collections) {
      const { PK, SK, chains } = collection;
      const contract = PK.split(/#/)[1];
      const k = contract;
      const marketplace = SK.split(/#/)[1];
      if (!(k in saleCollections)) {
        saleCollections[k] = {
          PK,
          chains: chains,
          marketplaces: [marketplace],
          contract,
          status: CalcStatSalesState.UNPROCESSED,
        };
      } else {
        saleCollections[k].chains = getUniqueChains(
          saleCollections[k].chains,
          chains,
        );
        if (!saleCollections[k].marketplaces.includes(marketplace)) {
          saleCollections[k].marketplaces.push(marketplace);
        }
      }
    }

    for (const [k, v] of Object.entries(saleCollections)) {
      if (
        [CalcStatSalesState.WRITING, CalcStatSalesState.INPROGRESS].includes(
          v.status,
        )
      ) {
        v.status = CalcStatSalesState.UNPROCESSED;
      }
    }

    const getNextSaleCollection = () => {
      for (const [k, v] of Object.entries(saleCollections)) {
        if (v.status === CalcStatSalesState.UNPROCESSED) {
          saleCollections[k].status = CalcStatSalesState.INPROGRESS;
          return k;
        }
      }
      return null;
    };

    let updateInProgress = false;
    const updateSaleCollections = async () => {
      const start = performance.now();
      if (updateInProgress) return;
      try {
        updateInProgress = true;
        await client.set(COLLECTION_STAT_KEY, JSON.stringify(saleCollections));
      } finally {
        LOGGER.info(
          `Update Sale Collections took ${performance.now() - start} ms`,
        );
        updateInProgress = false;
      }
    };

    const childSetup = (fork: Worker) => {
      let respawnAfterDeath = true;
      let currentCollection: string = null;
      fork.on("exit", (code, signal) => {
        LOGGER.error(`Fork exit. Respawning.`, {
          code,
          signal,
          currentCollection,
          respawnAfterDeath,
        });
        for (let i = 0; i < forks.length; i++) {
          if (forks[i].id === fork.id) {
            forks.splice(i, 1);
            maybeExit();
            break;
          }
        }
        if (respawnAfterDeath) {
          spawnClusterFork(forks, childSetup);
        }
      });
      fork.on("error", async () => {
        LOGGER.error(`Fork error. Killing.`, { currentCollection, fork });
        saleCollections[currentCollection].status = CalcStatSalesState.ERROR;
        await updateSaleCollections();
        fork.kill();
      });
      fork.on("online", async () => {
        currentCollection = getNextSaleCollection();
        if (!currentCollection) {
          respawnAfterDeath = false;
          fork.kill();
        }
        fork.send(currentCollection);
        await updateSaleCollections();
      });
      fork.on("message", async (pk) => {
        if (pk && pk in saleCollections) {
          saleCollections[pk].status = CalcStatSalesState.COMPLETED;
          LOGGER.info(`Fork message`, { pk });
          currentCollection = getNextSaleCollection();
          fork.send(currentCollection);
          await updateSaleCollections();
        } else {
          respawnAfterDeath = false;
          fork.kill();
        }
      });
    };

    for (let i = 0; i < cpus().length; i++) {
      spawnClusterFork(forks, childSetup);
    }

    await updateSaleCollections();

    let maybeExitCount = 0;
    async function maybeExit() {
      LOGGER.debug(`Maybe we can exit now ${maybeExitCount}`);
      maybeExitCount++;
      if (maybeExitCount > cpus().length) {
        LOGGER.warn(
          `Calc stats might could exit, but hasn't for ${maybeExitCount} tries`,
          { forks },
        );
      }
      const hasIncompleteWork = !!Object.keys(saleCollections).find(
        (k) =>
          ![CalcStatSalesState.COMPLETED, CalcStatSalesState.ERROR].includes(
            saleCollections[k].status,
          ),
      );
      if (!forks.length && !hasIncompleteWork) {
        await client.del(COLLECTION_STAT_KEY);
        // eslint-disable-next-line no-process-exit
        deferred.resolve(0);
      }
    }
  } else {
    process.on("message", worker);
  }

  async function worker(collectionSlug: string) {
    LOGGER.debug(`Got message from parent`, {
      collectionSlug,
    });
    if (!collectionSlug) {
      process.send(null);
      return 0;
    }

    const skipKeys = ["PK", "SK", "statType"];
    const { Items: collectionRecords } = await dynamodb.query({
      KeyConditionExpression: `PK = :pk`,
      ExpressionAttributeValues: {
        ":pk": `collection#${collectionSlug}`,
      },
    });

    let statCursor: Key = null;
    const summedStats: Record<string, number> = {};
    do {
      const { Items, LastEvaluatedKey } = await dynamodb.query({
        KeyConditionExpression: `PK = :pk`,
        ExpressionAttributeValues: {
          ":pk": `dailyStatistics#${collectionSlug}`,
        },
        ...(statCursor && { ExclusiveStartKey: statCursor }),
      });
      statCursor = LastEvaluatedKey;

      if (Items.length) {
        for (const item of Items) {
          const uKeys = Array.from(
            new Set<string>(Object.keys(item).concat(Object.keys(summedStats))),
          );

          for (const k of uKeys) {
            if (skipKeys.includes(k)) continue;
            if (!(k in summedStats)) {
              summedStats[k] = 0;
            }
            if (k in item && item[k]) {
              summedStats[k] += item[k];
            }
          }
        }
      }
    } while (statCursor);

    const { Items: dailyStats } = await dynamodb.query({
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `dailyStatistics#${collectionSlug}`,
      },
      ScanIndexForward: false,
      Limit: 1,
    });

    LOGGER.info(`Collection Records`, { collectionRecords });

    for (const record of collectionRecords) {
      const [dailyStat] = dailyStats;
      const { PK, SK } = record;
      const [type, value] = SK.split(/#/);
      const update: VolumeRecord = getVolumeForType(type, value, summedStats);
      const dailyUpdate = dailyStat
        ? ", dailyVolume = :dailyVolume, dailyVolumeUSD = :dailyVolumeUSD"
        : "";
      const updateItem: Omit<
        AWS.DynamoDB.DocumentClient.UpdateItemInput,
        "TableName"
      > = {
        Key: { PK, SK },
        UpdateExpression: `SET totalVolume = :totalVolume, totalVolumeUSD = :totalVolumeUSD${dailyUpdate}`,
        ExpressionAttributeValues: {
          ":totalVolume": update.volume,
          ":totalVolumeUSD": update.volumeUSD,
          ...(dailyStat && {
            ":dailyVolume": dailyStat[`${type}_${value}_volume`] ?? 0,
            ":dailyVolumeUSD": dailyStat[`${type}_${value}_volumeUSD`] ?? 0,
          }),
        },
      };
      LOGGER.info(`Update Collection Stats ${collectionSlug}`, {
        PK,
        SK,
        update,
        collectionSlug,
        summedStats,
        updateItem,
      });
      try {
        // await dynamodb.transactWrite({ updateItems: [updateItem] });
      } catch (e) {
        LOGGER.error(`Update failed`, {
          PK,
          SK,
          update,
          collectionSlug,
          summedStats,
          updateItem,
          type,
          value,
        });
      }
    }

    process.send(collectionSlug);
  }

  const retVal = await deferred.promise;
  return retVal;
}

function getVolumeForType(
  type: string,
  value: string,
  stats: Record<string, number>,
): VolumeRecord {
  if (type === "overview") {
    const volume: VolumeRecord = {
      volume: 0,
      volumeUSD: 0,
    };
    for (const [k, v] of Object.entries(stats)) {
      if (/^chain/.test(k)) {
        const [, , volK] = k.split(/_/);
        volume[volK as keyof VolumeRecord] += v;
      }
    }
    return volume;
  }
  return {
    volume: stats[`${type}_${value}_volume`] ?? 0,
    volumeUSD: stats[`${type}_${value}_volumeUSD`] ?? 0,
  };
}
