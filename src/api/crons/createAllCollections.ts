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
import { awaitSequence, restoreBigNumber, sleep } from "../../utils";
import { OpenSea, LooksRare } from "../../markets";
import axios from "axios";

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
          const { Items: data, LastEvaluatedKey: cursor } =
            await dynamodb.query({
              IndexName: "collectionsIndex",
              KeyConditionExpression: "category = :category",
              ExpressionAttributeValues: {
                ":category": "overview",
              },
              ProjectionExpression: "PK, chains, marketplaces",
              ...(collectionCursor && { ExclusiveStartKey: collectionCursor }),
            });
          collectionCursor = cursor;
          collections.push(...data);
        } while (collectionCursor);

        LOGGER.debug(`Got collections from DB`, {
          count: collections.length,
        });
        await client.set("NFT_COLLECTIONS", JSON.stringify(collections), {
          EX: 3600,
        });
      }

      async function* downloadOpenseaCollections(
        offset = 0
      ): AsyncGenerator<Array<any>> {
        // eslint-disable-next-line no-unreachable-loop
        do {
          if (offset >= 50000) {
            return [];
          }
          const { data } = await axios.get(
            "https://api.opensea.io/api/v1/collections",
            {
              params: { offset, limit: 300 },
            }
          );
          offset = (yield data.collections) as number;
        } while (true);
      }

      const OSCollections =
        JSON.parse(await client.get("OS_COLLECTIONS")) ?? [];

      if (!OSCollections.length) {
        let offset = 300;
        const gen = downloadOpenseaCollections();
        let collections = gen.next(offset);
        while (!(await collections).done) {
          OSCollections.push(
            ...(await collections).value.filter(
              (c: any) => c.primary_asset_contracts.length
            )
          );
          await sleep(5);
          console.log(OSCollections.map((c: any) => c.slug));
          offset += 300;
          if (offset > 50000) {
            offset = 50000;
          }
          collections = gen.next(offset);
          await client.set(
            "OS_COLLECTIONS_STATE",
            JSON.stringify({
              OSCollections,
              offset,
            })
          );
        }

        await client.set("OS_COLLECTIONS", JSON.stringify(OSCollections));
      }

      for (const collection of OSCollections) {
        // eslint-disable-next-line camelcase
        const { medium_username, discord_url, telegram_url, twitter_username } =
          collection;
        for (const contract of collection.primary_asset_contracts) {
          const {
            address,
            name,
            description,
            image_url: logo,
            symbol,
          } = contract;

          const metadata: CollectionData = {
            address,
            description,
            name,
            logo,
            slug: address,
            symbol,
            chains: [Blockchain.Ethereum],
            discord_url,
            marketplaces: [Marketplace.Opensea, Marketplace.LooksRare],
            medium_username,
            telegram_url,
            twitter_username,
          };

          const upsertData = {
            slug: address,
            chain: Blockchain.Ethereum,
            metadata,
            statistics: {
              floor: 0,
              floorUSD: 0,
              marketCap: 0,
              marketCapUSD: 0,
              owners: 0,
              dailyVolume: 0,
              dailyVolumeUSD: 0,
              fromSales: true,
              totalVolume: 0,
              totalVolumeUSD: 0,
            },
          };

          for (const marketplace of [
            Marketplace.Opensea,
            Marketplace.LooksRare,
          ]) {
            await Collection.upsert({
              ...upsertData,
              marketplace,
            });
          }
        }
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

  }

  process.send(true);
}
