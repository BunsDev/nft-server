import { Collection, Sale, AdapterState } from "../../models";
import { CurrencyConverter } from "../../api/currency-converter";
import { restoreBigNumber, awaitSequence } from "../../utils";
import { Marketplace, SaleData } from "../../types";
import { ChainEvents } from "../../markets/BaseMarketOnChainProvider";
import dynamodb from "../../utils/dynamodb";
import salesFunction from "./RaribleSales";
import { IMarketOnChainProvider } from "../../interfaces";
import { DataAdapter } from "..";
import * as marketConfigs from "../../markets";
import { BaseProvider } from "./baseProvider";
import {
  ClusterManager,
  IClusterProvider,
  ClusterWorker,
  isPrimary
} from "../../utils/cluster";
import { MarketChainConfig, MarketConfig } from "../../markets";
import cluster from "cluster";
import { sleep, handleError } from "../../utils";
import {
  configureLoggerDefaults,
  getLogger,
  LevelLogger
} from "../../utils/logger";
import { fork } from "child_process";

type AdapterProviderConfig = {
  providerConfig: MarketConfig;
  chainConfig: MarketChainConfig;
};

type AdapterProvider = IMarketOnChainProvider & IClusterProvider;

const baseAdapter: DataAdapter = { run };

configureLoggerDefaults({
  error: false,
  info: false,
  debug: false
});

async function runSales(
  provider: AdapterProvider,
  LOGGER: LevelLogger
): Promise<void> {
  const { data: collections } = await Collection.getSorted({
    marketplace: Marketplace.Rarible,
    returnAll: true
  });

  const collectionMap: Record<string, any> = collections.reduce((m, c) => {
    m[c.address] = c;
    return m;
  }, {});

  LOGGER.info(
    `Fetching sales for ${provider.CONTRACT_NAME} collections:`,
    collections.length
  );

  const itSales = provider.fetchSales();
  // eslint-disable-next-line prefer-const
  let nextSales = itSales.next();
  // eslint-disable-next-line no-unreachable-loop
  while (!(await nextSales).done) {
    const {
      chain,
      events,
      blockRange,
      receipts,
      blocks: blockMap,
      providerName,
      adapterRunName
    } = (await nextSales).value as ChainEvents;
    LOGGER.info(`Got ${events.length} sales`);

    if (!events.length) {
      blockRange?.endBlock &&
        AdapterState.updateSalesLastSyncedBlockNumber(
          "market" in provider ? provider["market"] : undefined,
          blockRange.endBlock,
          chain,
          adapterRunName ?? providerName
        );
      nextSales = itSales.next();
      continue;
    }

    const sales: Array<SaleData> = [];

    for (const [hash, receiptWithMeta] of Object.entries(receipts)) {
      const { meta: metas, receipt } = receiptWithMeta;
      if (!metas.length) {
        LOGGER.warn(`Skipping TX empty metadata`, { receipt, metas });
        continue;
      }
      salesFunction(
        metas,
        receipt,
        hash,
        sales,
        blockMap,
        provider,
        chain,
        collectionMap,
        LOGGER
      );
    }

    try {
      await awaitSequence(
        () => CurrencyConverter.matchSalesWithPrices(sales),
        () =>
          Sale.insert({
            slug: collectionMap,
            marketplace: "market" in provider ? provider["market"] : undefined,
            sales
          })
      );
    } catch (e) {
      const hashes = sales.reduce((hashes, sale) => {
        if (!(sale.paymentTokenAddress in hashes)) {
          hashes[sale.paymentTokenAddress] = [];
        }
        hashes[sale.paymentTokenAddress].push(sale.txnHash);
        return hashes;
      }, {} as Record<string, Array<string>>);
      LOGGER.error(`Sale error`, {
        error: e,
        sales,
        hashes,
        emptySales: !sales.length ? "true" : "false"
      });
      dynamodb.put({
        PK: "failedSales",
        SK: `${providerName}#${Date.now()}`,
        blockRange
      });
    }

    blockRange?.endBlock &&
      AdapterState.updateSalesLastSyncedBlockNumber(
        "market" in provider ? provider["market"] : undefined,
        blockRange.endBlock,
        chain,
        adapterRunName ?? providerName
      );
    nextSales = itSales.next();
  }
}

async function run(
  provider: AdapterProvider,
  LOGGER: LevelLogger
): Promise<void> {
  try {
    while (true) {
      await runSales(provider, LOGGER);
      await sleep(parseInt(process.env.ADAPTER_SLEEP_PERIOD) || 3.6e3);
    }
  } catch (e) {
    await handleError(e, `${provider.CONTRACT_NAME}-adapter`);
  }
}

export default function main(platformName: string) {
  const LOGGER = getLogger(`${platformName}_ADAPTER`, {
    datadog: !!process.env.DATADOG_API_KEY
  });

  function spawnProviderChild(p: AdapterProviderConfig, run = 0) {
    LOGGER.info(`Spawn Provider Child`, { provider: p, run });
    const providerChild = fork(__filename, [
      "provider-child",
      p.chainConfig.providerName
    ]);
    providerChild.on("exit", (code) => {
      LOGGER.alert(`Provider Child Exit`, { provider: p, code, run });
      if (run < 3) {
        spawnProviderChild(p, run + 1);
      }
    });
  }

  const marketConfig =
    marketConfigs.default[platformName as keyof typeof marketConfigs.default];
  if (!process.argv[2] && !process.env.RUN_CRON_NAME) {
    BaseProvider.build(marketConfig, platformName).forEach((p) =>
      spawnProviderChild(p)
    );
  }
  if (process.argv[2] === "provider-child") {
    const providers = BaseProvider.build(marketConfig, platformName);
    const providerName = process.argv[3];
    const config = providers.find(
      (p) => p.chainConfig.providerName === providerName
    );
    const provider = config.instantiate();
    if (cluster.isWorker && config.chainConfig.cluster) {
      ClusterWorker.create(
        process.env.WORKER_UUID,
        `${platformName}`,
        provider
      );
    } else if (isPrimary()) {
      if (config.chainConfig.cluster) {
        ClusterManager.create(`${platformName}`, provider);
      }
      baseAdapter.run(provider, LOGGER);
    }
  }
}
