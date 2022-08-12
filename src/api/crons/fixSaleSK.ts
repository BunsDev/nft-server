import "dotenv/config";
import { Collection } from "../../models";
import {
  Blockchain,
  CollectionData,
  Marketplace,
  RecordState,
} from "../../types";
import { getLogger } from "../../utils/logger";
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


const client = createClient({
  url: process.env.REDIS_URL,
});
client.connect();

const LOGGER = getLogger("FIX_SALE_SK", {
  datadog: !!process.env.DATADOG_API_KEY,
});

main.fork = function (): ChildProcess {
  return fork(__filename, ["1"]);
};

(async () => {
  const forks: Array<Worker> = [];
  if (process.argv[2]) {
    if (cluster.isPrimary) {
      const redisCollections = JSON.parse(
        await client.get("FIX_SALE_SK_COLLECTIONS")
      );
      let collections = [];
      let collectionCursor: AWS.DynamoDB.DocumentClient.Key = null;

      if (redisCollections && redisCollections.length) {
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
        await client.set(
          "FIX_SALE_SK_COLLECTIONS",
          JSON.stringify(collections)
        );
      }

      const saleCollections: Record<string, number> =
        JSON.parse(await client.get("FIX_SALE_SK_COLLECTION_STATUS")) ?? {};
      for (const collection of collections) {
        const { PK, marketplaces } = collection;
        for (const marketplace of marketplaces) {
          const contract = PK.split(/#/)[1];
          const k = `sales#${contract}#marketplace#${marketplace}`;
          if (!(k in saleCollections) || saleCollections[k] === 1) {
            saleCollections[k] = 0;
          }
        }
      }

      const getNextSaleCollection = () => {
        for (const [k, v] of Object.entries(saleCollections)) {
          if (v === 0) {
            saleCollections[k] = 1;
            return k;
          }
        }
        return null;
      };

      const updateSaleCollections = async () =>
        await client.set(
          "FIX_SALE_SK_COLLECTION_STATUS",
          JSON.stringify(saleCollections)
        );

      updateSaleCollections();

      const childSetup = (fork: Worker) => {
        // fork.on("exit", () => {
        //   for (let i = 0; i < forks.length; i++) {
        //     if (forks[i].id === fork.id) {
        //       forks.splice(i, 1);
        //       break;
        //     }
        //   }
        //   spawnClusterFork(forks, childSetup);
        // });
        fork.on("error", () => forks.forEach((f) => f.kill()));
        fork.on("online", () => {
          fork.send(getNextSaleCollection());
          updateSaleCollections();
        });
        fork.on("message", (pk) => {
          if (pk && pk in saleCollections) {
            saleCollections[pk] = 2;
            fork.send(getNextSaleCollection());
            updateSaleCollections();
          } else {
            fork.disconnect();
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

const openseaInterfaces = OpenSea.chains.ethereum.map(
  (c) => new ethers.utils.Interface(c.abi)
);
const openseaTopics = OpenSea.chains.ethereum.map((c) => c.saleTopic);

export default async function main(salePK: string) {
  if (!salePK) {
    process.send(null);
    return;
  }

  const chainProvider = new EthereumOnChainProvider(
    new ethers.providers.StaticJsonRpcProvider(
      process.env.ETHEREUM_RPC.split(/,/)[0]
    )
  );
  let saleCursor: Key = null;
  try {
    saleCursor = JSON.parse(await client.get(`FIX_SALE_SK_${salePK}`));
  } catch (e) {}

  do {
    const { Items: sales, LastEvaluatedKey: cursor } = await dynamodb.query({
      KeyConditionExpression: `PK = :pk`,
      ExpressionAttributeValues: {
        ":pk": salePK,
      },
      ...(saleCursor && { ExclusiveStartKey: saleCursor }),
    });
    saleCursor = cursor;
    await client.set(
      `FIX_SALE_SK_${salePK}`,
      JSON.stringify(saleCursor) ?? "null"
    );

    for (const sale of sales) {
      if (/#\d+$/.test(sale.SK)) {
        continue;
      }
      const [timestamp, , txHash] = sale.SK.split(/#/);
      const getReceipt = async () =>
        await chainProvider.getTransactionReceipt(txHash);

      switch (sale.marketplace as Marketplace) {
        case Marketplace.Opensea: {
          const logIndex = sale.metadata?.data[0]?.event?.logIndex;
          if (logIndex) {
            await replaceSale(sale.PK, `${sale.SK}#${logIndex}`, sale.SK, sale);
          } else {
            const receipt = await getReceipt();
            findOpenseaLogIndex(receipt, sale).forEach(async (logIndex) => {
              await replaceSale(
                sale.PK,
                `${sale.SK}#${logIndex}`,
                sale.SK,
                sale
              );
            });
          }
          break;
        }
        case Marketplace.LooksRare: {
          const topics: Array<string> = sale.metadata?.data?.parsed?.topics;
          const receipt = await getReceipt();

          if (!topics) {
            LOGGER.error(`Missing looksrare topics`, {
              sale,
              topics,
              receipt,
            });
            break;
          }

          const logIndex = receipt.logs.find((log) =>
            topics.every((t) => log.topics.includes(t))
          )?.logIndex;

          if (logIndex) {
            await replaceSale(sale.PK, `${sale.SK}#${logIndex}`, sale.SK, sale);
          } else {
            LOGGER.error(`Couldn't locate Looksrare logindex `, {
              sale,
              topics,
              receipt,
              logIndex,
            });
          }

          break;
        }
      }
    }

    // LOGGER.debug(`Got sales for ${salePK}`, { salePK, saleCursor, sales });
  } while (saleCursor);

  process.send(salePK);
}

async function replaceSale(
  PK: string,
  newSK: string,
  oldSK: string,
  sale: any
) {
  LOGGER.debug(`Replace Sale`, {
    PK,
    newSK,
    oldSK,
  });
  const recordState = sale.recordState
    ? sale.recordState
    : RecordState.COLLECTION_EXISTS;
  return await awaitSequence(
    () => dynamodb.put({ ...sale, PK, SK: newSK, recordState }),
    () => dynamodb.delete({ Key: { PK, SK: oldSK } })
  );
}

function findOpenseaLogIndex(
  receipt: ethers.providers.TransactionReceipt,
  sale: any
) {
  const relevantLogs = receipt.logs.filter((l) =>
    openseaTopics.some((t) => l.topics.includes(t))
  );

  if (relevantLogs.length === 1) {
    return [relevantLogs[0].logIndex];
  }

  const parsed = relevantLogs.flatMap((log) => {
    for (const iface of openseaInterfaces) {
      try {
        const plog = iface.parseLog(log);
        return [{ log, plog, iface }];
      } catch (e) {}
    }
    return [];
  });

  const matches = parsed.filter(({ plog }) => {
    // if (plog.name !== "OrdersMatched") return false;
    const { maker, taker, price } = plog.args;
    const amount = restoreBigNumber(
      sale.metadata?.payment?.amount || BigNumber.from(0)
    );
    return (
      maker &&
      taker &&
      price instanceof BigNumber &&
      price.eq(amount) &&
      [maker.toLowerCase(), taker.toLowerCase()].some((a) =>
        [
          sale.buyerAddress.toLowerCase(),
          sale.sellerAddress.toLowerCase(),
        ].includes(a)
      )
    );
  });

  if (matches.length) {
    return matches.map(({ log }) => log.logIndex);
  }

  return [];
}
