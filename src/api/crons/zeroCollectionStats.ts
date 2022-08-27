import "dotenv/config";
import { Collection, HistoricalStatistics } from "../../models";
import {
  Blockchain,
  CollectionData,
  DailyVolumeRecord,
  Marketplace,
  RecordState,
  SaleData,
} from "../../types";
import { configureLoggerDefaults, getLogger } from "../../utils/logger";
import { CronConfig } from "./types";
import { ChildProcess, fork, spawn } from "child_process";
import cluster, { Worker } from "cluster";
import { cpus } from "os";
import dynamodb from "../../utils/dynamodb";
import { getDeferred } from "../../utils/cluster";
import { createClient } from "redis";
import { Key } from "aws-sdk/clients/dynamodb";
import { EthereumOnChainProvider } from "../../providers/EthereumOnChainProvider";
import { BigNumber, ethers } from "ethers";
import { awaitSequence, restoreBigNumber } from "../../utils";
import { OpenSea, LooksRare } from "../../markets";

configureLoggerDefaults({
  debugTo: {
    console: false,
    datadog: false,
  },
});

enum CalcStatSalesState {
  UNPROCESSED = 0,
  INPROGRESS = 1,
  COMPLETED = 2,
  ERROR = 3,
}

interface SaleRecord extends SaleData {
  PK: string;
  SK: string;
}

type CollectionStats = {
  PK: string;
  status: CalcStatSalesState;
  chain: Blockchain;
  marketplace: Marketplace;
  contract: string;
  start: number;
  end: number;
  range: number;
  recorded: boolean;
  volumes: DailyVolumeRecord;
};

type VolumeStats = Partial<
  Record<
    Blockchain,
    Partial<Record<Marketplace, Record<string, DailyVolumeRecord>>>
  >
>;

const SALE_START_TIME = parseInt(process.env.SALE_START_TIME);
const SALE_TIME_RANGE = parseInt(process.env.SALE_TIME_RANGE);
const SALE_TIME_END = SALE_START_TIME + SALE_TIME_RANGE;

const client = createClient({
  url: process.env.REDIS_URL,
});
client.connect();

const LOGGER = getLogger("CALC_STATS", {
  datadog: !!process.env.DATADOG_API_KEY,
});

const forks: Array<Worker> = [];

main.fork = function (): ChildProcess {
  return fork(__filename, ["1"]);
};

(async () => {
  if (process.argv[2]) {
    if (cluster.isPrimary) {
      let collections = [];
      let collectionCursor: AWS.DynamoDB.DocumentClient.Key = null;

      do {
        const { Items: data, LastEvaluatedKey: cursor } = await dynamodb.scan({
          IndexName: "collectionsIndex",
          ProjectionExpression: "PK, SK, category",
          ...(collectionCursor && { ExclusiveStartKey: collectionCursor }),
        });
        collectionCursor = cursor;
        collections.push(...data);
      } while (collectionCursor);

      LOGGER.debug(`Got collections from DB`, {
        count: collections.length,
      });

      const saleCollections: Record<string, CalcStatSalesState> =
        JSON.parse(await client.get(`ZERO_COLLECTION_STATS`)) ?? {};
      for (const collection of collections) {
        const { PK, SK, category } = collection;
        const k = `${PK}___${SK}___${category}`;
        if (!(k in saleCollections)) {
          saleCollections[k] = CalcStatSalesState.UNPROCESSED;
        }
        if (saleCollections[k] === CalcStatSalesState.INPROGRESS) {
          saleCollections[k] = CalcStatSalesState.UNPROCESSED;
        }
      }

      collections = [];

      const getNextSaleCollections = () => {
        const collections = [];
        for (const [k, v] of Object.entries(saleCollections)) {
          if (v === CalcStatSalesState.UNPROCESSED) {
            saleCollections[k] = CalcStatSalesState.INPROGRESS;
            collections.push(k);
            if (collections.length > 100) {
              break;
            }
          }
        }
        return collections;
      };

      const updateSaleCollections = async () => {
        await client.set(
          `ZERO_COLLECTION_STATS`,
          JSON.stringify(saleCollections)
        );
      };

      updateSaleCollections();

      const childSetup = (fork: Worker) => {
        let currentCollection: Array<string> = null;
        fork.on("exit", (code) => {
          LOGGER.error(`Fork exit. Respawning.`, { code, currentCollection });
          for (let i = 0; i < forks.length; i++) {
            if (forks[i].id === fork.id) {
              forks.splice(i, 1);
              break;
            }
          }
          spawnClusterFork(forks, childSetup);
        });
        fork.on("error", () => {
          LOGGER.error(`Fork error. Killing.`, { currentCollection, fork });
          currentCollection.forEach(
            (c) => (saleCollections[c] = CalcStatSalesState.ERROR)
          );
          fork.kill();
        });
        fork.on("online", () => {
          currentCollection = getNextSaleCollections();
          fork.send(currentCollection);
          updateSaleCollections();
        });
        fork.on("message", (done) => {
          if (done) {
            currentCollection.forEach(
              (c) => (saleCollections[c] = CalcStatSalesState.COMPLETED)
            );
            if (~~(Math.random() * 10) % 6 !== 0) {
              currentCollection = getNextSaleCollections();
              fork.send(currentCollection);
            } else {
              fork.kill();
              updateSaleCollections();
            }
            LOGGER.debug(`Fork message`, {
              currentCollection,
              done,
            });
          } else {
            fork.kill();
          }
        });
      };

      for (let i = 0; i < cpus().length; i++) {
        spawnClusterFork(forks, childSetup);
      }
    } else {
      process.on("message", main);
    }
  }
})();

function spawnClusterFork(
  forks: Array<Worker>,
  childSetup: (child: Worker) => void
): void {
  const fork = cluster.fork();
  forks.push(fork);
  childSetup(fork);
}

export default async function main(collectionPK: Array<string>) {
  if (!collectionPK) {
    process.send(false);
    return 0;
  }

  for (const key of collectionPK) {
    const [PK, SK, category] = key.split(/___/);

    await dynamodb.update({
      Key: { PK, SK },
      UpdateExpression: `
        SET dailyVolume = :zero,
            dailyVolumeUSD = :zero,
            totalVolume = :zero,
            totalVolumeUSD = :zero
      `,
      ExpressionAttributeValues: {
        ":zero": 0,
      },
    });
  }

  process.send(true);
}
