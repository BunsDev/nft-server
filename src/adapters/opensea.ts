import { DataAdapter } from ".";
import { Collection, Sale, AdapterState } from "../models";
import { CurrencyConverter } from "../api/currency-converter";
import { sleep, handleError, restoreBigNumber, awaitSequence } from "../utils";
import { Marketplace, SaleData } from "../types";
import {
  MarketChainConfig,
  MarketConfig,
  OpenSea as OpenSeaMarketConfig,
} from "../markets";
import { OpenSeaProvider } from "../markets/OpenSeaProvider";
import { ethers } from "ethers";
import { ChainEvents } from "../markets/BaseMarketOnChainProvider";
import { getLogger, configureLoggerDefaults } from "../utils/logger";
import {
  ClusterManager,
  ClusterWorker,
  IClusterProvider,
  isPrimary
} from "../utils/cluster";
import cluster from "cluster";
import { IMarketOnChainProvider } from "../interfaces";
import { fork } from "child_process";
import dynamodb from "../utils/dynamodb";

type AdapterProvider = IMarketOnChainProvider & IClusterProvider;
type AdapterProviderConfig = {
  providerConfig: MarketConfig;
  chainConfig: MarketChainConfig;
};

configureLoggerDefaults({
  error: false,
  info: false,
  debug: false,
});

const LOGGER = getLogger("OPENSEA_ADAPTER", {
  datadog: !!process.env.DATADOG_API_KEY,
});

async function runSales(provider: AdapterProvider): Promise<void> {
  const { data: collections } = await Collection.getSorted({
    marketplace: Marketplace.Opensea,
    returnAll: true,
  });

  // const collections = [];
  // const collectionMap: Record<string, any> = {};

  const collectionMap: Record<string, any> = collections.reduce((m, c) => {
    m[c.address] = c;
    return m;
  }, {});

  LOGGER.info("Fetching sales for OpenSea collections:", collections.length);

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
      adapterRunName,
    } = (await nextSales).value as ChainEvents;
    LOGGER.info(`Got ${events.length} sales`);

    if (!events.length) {
      blockRange?.endBlock &&
        AdapterState.updateSalesLastSyncedBlockNumber(
          Marketplace.Opensea,
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
      for (const meta of metas) {
        if (!meta) {
          LOGGER.warn(`Skipping meta`, { tx: receipt.transactionHash });
          continue;
        }
        const { contractAddress, price, eventSignatures, data, payment } = meta;
        const formattedPrice = ethers.utils.formatUnits(
          restoreBigNumber(payment.amount),
          "ether"
        );
        if (!contractAddress) {
          LOGGER.debug(`Missing contract address. Skipping sale.`, {
            hash,
            metas,
          });
          continue;
        }
        sales.push({
          txnHash: receipt.transactionHash,
          timestamp: (
            blockMap[receipt.blockNumber].timestamp * 1000
          ).toString(),
          paymentTokenAddress: payment.address,
          contractAddress,
          price: parseFloat(formattedPrice),
          priceBase: null,
          priceUSD: null,
          sellerAddress: meta.seller,
          buyerAddress: meta.buyer,
          marketplace: Marketplace.Opensea,
          chain,
          metadata: { payment, data },
          count: meta.count,
          contract: meta.contract,
          logIndex: meta.logIndex,
          bundleSale: meta.bundleSale,
          hasCollection: !!collectionMap[contractAddress],
          tokenID: (meta.tokenID ?? "").toString(),
          blockNumber: meta.blockNumber,
        });
      }
    }

    try {
      await awaitSequence(
        () => CurrencyConverter.matchSalesWithPrices(sales),
        () =>
          Sale.insert({
            slug: collectionMap,
            marketplace: Marketplace.Opensea,
            sales,
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
        emptySales: !sales.length ? "true" : "false",
      });
      dynamodb.put({
        PK: "failedSales",
        SK: `${providerName}#${Date.now()}`,
        blockRange,
      });
    }

    blockRange?.endBlock &&
      AdapterState.updateSalesLastSyncedBlockNumber(
        Marketplace.Opensea,
        blockRange.endBlock,
        chain,
        adapterRunName ?? providerName
      );
    nextSales = itSales.next();
  }
}

async function run(provider: AdapterProvider): Promise<void> {
  try {
    while (true) {
      await runSales(provider);
      await sleep(parseInt(process.env.ADAPTER_SLEEP_PERIOD) || 3.6e3);
    }
  } catch (e) {
    await handleError(e, "opensea-adapter");
  }
}

const OpenseaAdapter: DataAdapter = { run };

function spawnProviderChild(p: AdapterProviderConfig, run = 0) {
  LOGGER.info(`Spawn Provider Child`, { provider: p, run });
  const providerChild = fork(__filename, [
    "provider-child",
    p.chainConfig.providerName,
  ]);
  providerChild.on("exit", (code) => {
    LOGGER.alert(`Provider Child Exit`, { provider: p, code, run });
    if (run < 3) {
      spawnProviderChild(p, run + 1);
    }
  });
}

if (!process.argv[2] && !process.env.RUN_CRON_NAME) {
  OpenSeaProvider.build(OpenSeaMarketConfig).forEach((p) =>
    spawnProviderChild(p)
  );
} else if (process.argv[2] === "provider-child") {
  const OSProviders = OpenSeaProvider.build(OpenSeaMarketConfig);
  const providerName = process.argv[3];
  const config = OSProviders.find(
    (p) => p.chainConfig.providerName === providerName
  );
  const provider = config.instantiate();
  if (cluster.isWorker && config.chainConfig.cluster) {
    ClusterWorker.create(process.env.WORKER_UUID, `OPENSEA`, provider);
  } else if (isPrimary()) {
    if (config.chainConfig.cluster) {
      ClusterManager.create(`OPENSEA`, provider);
    }
    OpenseaAdapter.run(provider);
  }
}

export default OpenseaAdapter;
