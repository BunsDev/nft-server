import "dotenv/config";
import { HistoricalStatistics, Sale } from "../models";
import { Blockchain, Marketplace } from "../types";
import cluster, { Worker } from "cluster";
import path from "path";
import crons from "./crons";
import { getDeferred } from "../utils/cluster";
import dynamodb, { getClient, getTableClient } from "../utils/dynamodb";
import { CronConfig } from "./crons/types";
import { getLogger } from "../utils/logger";
import { ChildProcess, fork } from "child_process";

const LOGGER = getLogger("CRON_RUNNER", {
  datadog: !!process.env.DATADOG_API_KEY,
});
// const dynamoClient = getClient({
//   logger: {
//     log: (...messages: Array<any>) => {
//       LOGGER.debug(`DynamoClient Log`, { messages });
//     },
//   },
// });
// const ddbClient = getTableClient("nft-onchain-dev", dynamoClient);

const ddbClient = dynamodb;

const isPrimary = cluster.isPrimary || cluster.isMaster;

interface Cron {
  (config: CronConfig | string): Promise<any>;
  runtime?: number;
  fork?(): ChildProcess;
  autostart?: boolean;
}

(async () => {
  if (isPrimary && !process.env.RUN_CRON_NAME) {
    await main();
  } else if (process.env.RUN_CRON_NAME && process.env.RUN_CRON_NAME in crons) {
    const cronName = process.env.RUN_CRON_NAME;
    const cron: Cron = crons[cronName as keyof typeof crons];
    const runtime = cron.runtime;
    const promise = new Promise(
      (resolve) => runtime && setTimeout(() => resolve(0), runtime)
    );
    let result = null;
    try {
      result = await cron({
        promise,
        ddbClient,
      });
    } catch (e) {
      result = 1;
    }
    LOGGER.info(`Cron: ${cronName} Exited`, { cronName, result });
    // eslint-disable-next-line no-process-exit
    process.exit(result);
  }
})();

async function main() {
  const promises: Array<Promise<any>> = [];
  const forks: Array<Worker | ChildProcess> = [];
  for (const cron of Object.keys(crons)) {
    const cronFn: Cron = crons[cron as keyof typeof crons];
    const deferred = getDeferred<any>();
    promises.push(deferred.promise);
    if (cronFn.fork) {
      const fork = cronFn.fork();
      fork.on("exit", (worker: Worker, code: number, signal: string) =>
        deferred.resolve({ cron, code, signal })
      );
      forks.push(fork);
    } else if (cronFn.autostart) {
      const fork = cluster.fork({
        RUN_CRON_NAME: cron,
      });
      fork.on("exit", (worker: Worker, code: number, signal: string) =>
        deferred.resolve({ cron, code, signal })
      );
      forks.push(fork);
    }
  }
  process.on("SIGTERM", () => {
    forks.forEach((f) => f.disconnect());
  });
  const results = await Promise.allSettled(promises);
  console.log(results);
  // eslint-disable-next-line no-process-exit
  process.exit(0);
}
