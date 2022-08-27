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
  (config: CronConfig | string | Array<string>): Promise<any>;
  runtime?: number;
  fork?(): ChildProcess;
}

(async () => {
  if (
    isPrimary &&
    process.env.RUN_CRON_NAME &&
    process.env.RUN_CRON_NAME in crons
  ) {
    const cronName = process.env.RUN_CRON_NAME;
    const cron: Cron = crons[cronName as keyof typeof crons];
    const runtime = cron.runtime;
    const promise = new Promise(
      (resolve) => runtime && setTimeout(() => resolve(0), runtime)
    );
    let result = null;
    let error = null;
    if (cron.fork) {
      const deferred = getDeferred<any>();
      const f = cron.fork();
      f.on("exit", (worker: Worker, code: number, signal: string) =>
        deferred.resolve(code)
      );
      f.on("error", (e) => {
        deferred.reject(e);
      });
      try {
        result = await deferred.promise;
      } catch (e) {
        error = e;
        result = 1;
      }
    } else {
      try {
        result = await cron({
          promise,
          ddbClient,
        });
      } catch (e) {
        error = e;
        result = 1;
      }
    }
    LOGGER.info(`Cron: ${cronName} Exited`, { cronName, result, error });
    // eslint-disable-next-line no-process-exit
    process.exit(result);
  }
})();
