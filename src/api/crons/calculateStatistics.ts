import "dotenv/config";
import { HistoricalStatistics } from "../../models";
import {
  Blockchain,
  DailyVolumeRecord,
  DateTruncate,
  Marketplace,
  SaleData,
  StatType,
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
  start: number;
  end: number;
  range: number;
  recorded: boolean;
  volumes: VolumeStats;
};

enum WriteMethod {
  REPLACE = 1,
  UPDATE = 2,
}

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
  env: Record<string, any>
): void {
  const fork = cluster.fork(env ?? {});
  forks.push(fork);
  childSetup(fork);
}

if (cluster.isWorker) {
  main();
}

export default async function main() {
  const deferred = getDeferred();
  const STAT_TYPE = (process.env.STAT_TYPE ||
    StatType.DAILY_COLLECTION) as StatType;
  const DATE_TRUNCATE: DateTruncate = getDateTruncateForStatType(STAT_TYPE);
  let SALE_TIME_RANGE = parseInt(process.env.SALE_TIME_RANGE);
  let SALE_START_TIME = parseInt(process.env.SALE_START_TIME);
  let COLLECTION_STAT_KEY = `COLLECTION_STATS#START${SALE_START_TIME}#RANGE#${SALE_TIME_RANGE}#TYPE#${STAT_TYPE}`;
  let err = null;

  if (!SALE_START_TIME) {
    const { Items } = await dynamodb.query({
      ScanIndexForward: false,
      IndexName: "collectionStats",
      KeyConditionExpression: "statType = :st",
      ExpressionAttributeValues: {
        ":st": STAT_TYPE,
      },
      ProjectionExpression: "SK",
      Limit: 1,
    });

    if (!Items.length) {
      throw new Error("Implement first sale stat timestamp");
    }

    SALE_START_TIME = parseInt(Items[0].SK);
    SALE_TIME_RANGE =
      extendDate(Date.now(), DATE_TRUNCATE, false) - SALE_START_TIME;
    COLLECTION_STAT_KEY = `COLLECTION_STATS#latest#${STAT_TYPE}`;
  }

  if (!SALE_TIME_RANGE) {
    SALE_TIME_RANGE =
      extendDate(Date.now(), DATE_TRUNCATE, false) - SALE_START_TIME;
    COLLECTION_STAT_KEY = `COLLECTION_STATS#latest#${STAT_TYPE}`;
  }

  switch (STAT_TYPE) {
    case StatType.WEEKLY_COLLECTION:
      if (new Date(SALE_START_TIME).getUTCDay() !== 0) {
        err = `SALE_START_TIME should be first of week for weekly collection`;
      } else if (SALE_TIME_RANGE % 7 !== 0) {
        err = `SALE_TIME_RANGE must be multiple of 7 to do weekly collection`;
      }
      break;
    case StatType.HOURLY_COLLECTION:
      if (SALE_START_TIME % DateTruncate.HOUR !== 0) {
        err = `SALE_START_TIME must be multiple of an hour in milliseconds to do hourly collection`;
      }
      break;
    case StatType.DAILY_COLLECTION:
    default:
      if (SALE_TIME_RANGE % DateTruncate.DAY !== 0) {
        err = `SALE_TIME_RANGE must be multiple of a day in milliseconds to do daily collection`;
      }
      break;
  }

  const SALE_TIME_END = extendDate(
    SALE_START_TIME + SALE_TIME_RANGE,
    DATE_TRUNCATE,
    true
  );

  if (err) {
    LOGGER.error(err, {
      DATE_TRUNCATE,
      STAT_TYPE,
      SALE_START_TIME,
      SALE_TIME_RANGE,
      SALE_TIME_END,
    });
    throw new Error(err);
  }

  if (SALE_TIME_RANGE < DATE_TRUNCATE) {
    LOGGER.alert(`Time range too small for stat collection type`, {
      DATE_TRUNCATE,
      SALE_TIME_RANGE,
      STAT_TYPE,
    });
    throw new Error(`Time range too small for stat collection type`);
  }

  const childEnv = {
    SALE_START_TIME,
    SALE_TIME_RANGE,
    STAT_TYPE,
  };

  console.log({
    STAT_TYPE,
    SALE_TIME_RANGE,
    DATE_TRUNCATE,
    SALE_START_TIME,
    SALE_TIME_END,
  });

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
      newChains: Array<Blockchain>
    ) => {
      return Array.from(new Set<Blockchain>(chains.concat(newChains)));
    };

    const saleCollections: Record<string, CollectionStats> =
      JSON.parse(await client.get(COLLECTION_STAT_KEY)) ?? {};
    for (const collection of collections) {
      const { PK, SK, chains } = collection;
      const contract = PK.split(/#/)[1];
      const k = `sales#${contract}__${SALE_START_TIME}-${SALE_TIME_RANGE}-${STAT_TYPE}`;
      const marketplace = SK.split(/#/)[1];
      if (!(k in saleCollections)) {
        saleCollections[k] = {
          PK,
          chains: chains,
          marketplaces: [marketplace],
          contract,
          status: CalcStatSalesState.UNPROCESSED,
          start: SALE_START_TIME,
          end: SALE_TIME_END,
          range: SALE_TIME_RANGE,
          recorded: false,
          volumes: {},
        };
      } else {
        saleCollections[k].chains = getUniqueChains(
          saleCollections[k].chains,
          chains
        );
        if (!saleCollections[k].marketplaces.includes(marketplace)) {
          saleCollections[k].marketplaces.push(marketplace);
        }
      }
    }

    const getEmptyVolumeStats = (
      chains: Array<Blockchain>,
      marketplaces: Array<Marketplace>
    ): VolumeStats => {
      return marketplaces.reduce((stats, m) => {
        stats[m] = chains.reduce((cs, c) => {
          cs[c] = {};
          return cs;
        }, {} as Record<Blockchain, any>);
        return stats;
      }, {} as VolumeStats);
    };

    for (const [k, v] of Object.entries(saleCollections)) {
      if (
        [CalcStatSalesState.WRITING, CalcStatSalesState.INPROGRESS].includes(
          v.status
        )
      ) {
        v.status = CalcStatSalesState.UNPROCESSED;
        v.volumes = getEmptyVolumeStats(v.chains, v.marketplaces);
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
          `Update Sale Collections took ${performance.now() - start} ms`
        );
        updateInProgress = false;
      }
    };

    const saveVolumes = (salePK: string, volumes: DailyVolumeRecord) => {
      saleCollections[salePK].volumes = volumes;
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
          spawnClusterFork(forks, childSetup, childEnv);
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
        fork.send([
          currentCollection,
          ...(saleCollections[currentCollection]?.marketplaces ?? []),
        ]);
        await updateSaleCollections();
      });
      fork.on("message", async ([pk, volumes]) => {
        if (pk && pk in saleCollections) {
          saleCollections[pk].status = CalcStatSalesState.COMPLETED;
          saveVolumes(pk, volumes);
          LOGGER.info(`Fork message`, { pk });
          currentCollection = getNextSaleCollection();
          fork.send([
            currentCollection,
            ...(saleCollections[currentCollection]?.marketplaces ?? []),
          ]);
          await updateSaleCollections();
        } else {
          respawnAfterDeath = false;
          fork.kill();
        }
      });
    };

    for (let i = 0; i < cpus().length; i++) {
      spawnClusterFork(forks, childSetup, childEnv);
    }

    const updateStats = async () => {
      for (const [k, v] of Object.entries(saleCollections)) {
        if (v.recorded || v.status === CalcStatSalesState.WRITING) {
          continue;
        }
        v.status = CalcStatSalesState.WRITING;
        await updateSaleCollections();
        const deletedOnce: Record<string, boolean> = {};
        const marketVolumes: VolumeStats = v.volumes;
        const chainVolumes: Partial<Record<Blockchain, DailyVolumeRecord>> = {};
        let PK;
        switch (STAT_TYPE) {
          case StatType.DAILY_COLLECTION:
            PK = `dailyStatistics#${v.contract}`;
            break;
          case StatType.WEEKLY_COLLECTION:
            PK = `weeklyStatistics#${v.contract}`;
            break;
          case StatType.HOURLY_COLLECTION:
            PK = `hourlyStatistics#${v.contract}`;
            break;
        }
        LOGGER.info(`Record Volumes`, { k, volumes: marketVolumes });

        for (const [marketplace, chains] of Object.entries(marketVolumes)) {
          for (const [chain, dailyVolumes] of Object.entries(chains)) {
            chainVolumes[<Blockchain>chain] = mergeDailyVolumeRecords(
              chainVolumes[<Blockchain>chain] ?? {},
              dailyVolumes
            );
            for (const [timestamp, dailyVolume] of Object.entries(
              dailyVolumes
            )) {
              const kt = `${v.contract}#${timestamp}`;
              if (!deletedOnce[kt]) {
                await dynamodb.put({
                  PK,
                  SK: `${timestamp}`,
                  statType: STAT_TYPE,
                });
                deletedOnce[kt] = true;
              }
              await dynamodb.update({
                Key: {
                  PK,
                  SK: `${timestamp}`,
                },
                UpdateExpression: `
                  SET #marketplacevolume = :volume,
                      #marketplacevolumeUSD = :volumeUSD
                `,
                ExpressionAttributeNames: {
                  "#marketplacevolume": `marketplace_${marketplace}_volume`,
                  "#marketplacevolumeUSD": `marketplace_${marketplace}_volumeUSD`,
                },
                ExpressionAttributeValues: {
                  ":volume": dailyVolume.volume,
                  ":volumeUSD": dailyVolume.volumeUSD,
                },
              });
            }
          }
        }

        for (const [chain, dailyVolumes] of Object.entries(chainVolumes)) {
          for (const [timestamp, dailyVolume] of Object.entries(dailyVolumes)) {
            await dynamodb.update({
              Key: {
                PK,
                SK: `${timestamp}`,
              },
              UpdateExpression: `
                SET #chainVolume = :volume,
                    #chainVolumeUSD = :volumeUSD
              `,
              ExpressionAttributeNames: {
                "#chainVolume": `chain_${chain}_volume`,
                "#chainVolumeUSD": `chain_${chain}_volumeUSD`,
              },
              ExpressionAttributeValues: {
                ":volume": dailyVolume.volume,
                ":volumeUSD": dailyVolume.volumeUSD,
              },
            });
          }
        }

        v.status = CalcStatSalesState.COMPLETED;
        v.recorded = true;
      }
      await updateSaleCollections();
      maybeExit();
    };

    const updateInterval = setInterval(() => updateStats(), UPDATE_INTERVAL);
    await updateSaleCollections();

    let maybeExitCount = 0;
    async function maybeExit() {
      LOGGER.debug(`Maybe we can exit now ${maybeExitCount}`);
      maybeExitCount++;
      if (maybeExitCount > cpus().length) {
        LOGGER.warn(
          `Calc stats might could exit, but hasn't for ${maybeExitCount} tries`,
          { forks }
        );
      }
      const hasIncompleteWork = !!Object.keys(saleCollections).find(
        (k) =>
          ![CalcStatSalesState.COMPLETED, CalcStatSalesState.ERROR].includes(
            saleCollections[k].status
          )
      );
      if (!forks.length && !hasIncompleteWork) {
        clearInterval(updateInterval);
        await updateStats();
        await client.del(COLLECTION_STAT_KEY);
        // eslint-disable-next-line no-process-exit
        deferred.resolve(0);
      }
    }
  } else {
    process.on("message", worker);
  }

  async function worker([salePK, ...marketplaces]: Array<string>) {
    LOGGER.debug(`Got message from parent`, {
      salePK,
      marketplaces,
    });
    if (!salePK) {
      process.send([null]);
      return 0;
    }

    let earliestSaleDay: number = Number.MAX_SAFE_INTEGER;
    let latestSaleDay: number = Number.MIN_SAFE_INTEGER;
    const saleHashes: Array<string> = [];
    const marketVolumes: VolumeStats = {};

    for (const marketplace of marketplaces as Array<Marketplace>) {
      const PK = `${salePK.split(/__/)[0]}#marketplace#${marketplace}`;
      marketVolumes[marketplace] = {};

      let skipMarket = false;
      let invalidSaleCount = 0;
      let saleCursor: Key = null;

      let firstSale = JSON.parse(await client.get(`FIRST_SALE_${PK}`));
      if (!firstSale) {
        ({ Items: firstSale } = await dynamodb.query({
          KeyConditionExpression: `PK = :pk`,
          ExpressionAttributeValues: { ":pk": PK },
          Limit: 1,
          ScanIndexForward: true,
        }));
      }

      if (!firstSale.length) {
        skipMarket = true;
      } else {
        const ts = parseInt(firstSale[0].SK.split(/#/)[0]);
        if (ts > SALE_TIME_END) {
          skipMarket = true;
        }
        await client.set(`FIRST_SALE_${PK}`, JSON.stringify(firstSale));
      }

      if (skipMarket) {
        LOGGER.debug(`Skipping market`, {
          marketplace,
          PK,
          firstSale: firstSale[0]?.SK,
        });
        continue;
      }

      do {
        LOGGER.info(
          `Finding sales for ${PK} between ${SALE_START_TIME} and ${SALE_TIME_END}`,
          {
            marketplace,
            volumes: marketVolumes[marketplace],
          }
        );

        const { Items, LastEvaluatedKey: cursor } = await dynamodb.query({
          KeyConditionExpression: `PK = :pk AND (SK BETWEEN :start AND :end)`,
          ExpressionAttributeValues: {
            ":pk": PK,
            ":start": `${SALE_START_TIME}`,
            ":end": `${SALE_TIME_END}`,
          },
          ...(saleCursor && { ExclusiveStartKey: saleCursor }),
        });

        saleCursor = cursor;

        const sales = <Array<SaleRecord>>Items;
        const chains: Partial<Record<Blockchain, Array<SaleRecord>>> = {};

        LOGGER.info(`Got sales in range`, {
          length: sales.length,
        });

        for (const sale of sales) {
          const [timestampStr, , txHash, logIndex] = sale.SK.split(/#/);
          const timestamp = parseInt(timestampStr);

          if (saleHashes.includes(txHash) && !logIndex) {
            LOGGER.warn(`Skip sale as duplicate w/out logIndex`, { sale });
            continue;
          }

          saleHashes.push(txHash);

          if (timestamp < SALE_START_TIME || timestamp > SALE_TIME_END) {
            LOGGER.error(`Got invalid sale within time range`, {
              sale,
              timestamp,
              SALE_START_TIME,
              SALE_END_TIME: SALE_TIME_END,
              SALE_TIME_RANGE,
              salePK,
              invalidSaleCount,
            });
            invalidSaleCount++;
            if (invalidSaleCount > 2) {
              throw new Error(`Invalid sales from range`);
            }
            continue;
          }

          // Leave until everything can be re-processed
          // eslint-disable-next-line no-lone-blocks
          {
            try {
              if (
                sale.paymentTokenAddress ===
                  DEFAULT_TOKEN_ADDRESSES[sale.chain] &&
                sale.metadata?.payment?.amount
              ) {
                if (sale.price > 500 && !sale.priceConfirmed) {
                  await dynamodb.put({
                    PK: `suspectSale`,
                    SK: sale.SK,
                    chain: sale.chain,
                    collection: sale.PK,
                  });
                  continue;
                }
              }
            } catch (e) {
              LOGGER.alert(`Problematic sale`, { sale });
            }
          }

          earliestSaleDay = Math.min(earliestSaleDay, timestamp);
          latestSaleDay = Math.max(latestSaleDay, timestamp);

          if (!(sale.chain in chains)) {
            chains[sale.chain] = [];
          }
          chains[sale.chain].push(sale);
        }

        for (const [chain, chainSales] of Object.entries(chains)) {
          if (!(chain in marketVolumes[marketplace])) {
            marketVolumes[marketplace][<Blockchain>chain] = {};
          }
          marketVolumes[marketplace][<Blockchain>chain] =
            await HistoricalStatistics.getVolumesFromSales({
              sales: chainSales,
              volumes: marketVolumes[marketplace][<Blockchain>chain] ?? {},
              truncateDateTo: DATE_TRUNCATE,
            });
        }

        // LOGGER.debug(`Got sales for ${salePK}`, { salePK, saleCursor, sales });
      } while (saleCursor);

      LOGGER.info(`Calculated volumes for sales`, {
        salePK,
        PK,
        volumes: marketVolumes[marketplace],
        marketplace,
      });
    }

    for (const [, mVolumes] of Object.entries(marketVolumes)) {
      for (let [, dailyVolumes] of Object.entries(mVolumes)) {
        dailyVolumes = fillMissingVolumeRecord(
          dailyVolumes,
          [
            truncateDate(earliestSaleDay, DATE_TRUNCATE),
            truncateDate(latestSaleDay, DATE_TRUNCATE),
          ],
          DATE_TRUNCATE
        );
      }
    }

    process.send([salePK, marketVolumes]);
  }

  const retVal = await deferred.promise;
  return retVal;
}

async function redisArrayAppend(key: string, value: any) {
  const array = JSON.parse(await client.get(key)) ?? [];
  array.push(value);
  await client.set(key, JSON.stringify(array));
}
