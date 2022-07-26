import "../utils/tracer";
import axios from "axios";
import { DataAdapter } from ".";
import { Collection, Contract, Sale, HistoricalStatistics, AdapterState } from "../models";
import { Opensea } from "../api/opensea";
import { Coingecko } from "../api/coingecko";
import { CurrencyConverter } from "../api/currency-converter";
import { COINGECKO_IDS } from "../constants";
import { sleep, handleError, filterObject, restoreBigNumber } from "../utils";
import {
  Blockchain,
  CollectionData,
  LowVolumeError,
  Marketplace,
  SaleData,
} from "../types";
import { MarketChainConfig, MarketConfig, OpenSea as OpenSeaMarketConfig } from "../markets";
import { OpenSeaProvider } from "../markets/OpenSeaProvider";
import { BigNumber, ethers } from "ethers";
import { ChainEvents } from "../markets/BaseMarketOnChainProvider";
import { getLogger, configureLoggerDefaults } from "../utils/logger";
import {
  ClusterManager,
  ClusterWorker,
  IClusterProvider,
} from "../utils/cluster";
import cluster from "cluster";
import { IMarketOnChainProvider } from "../interfaces";
import { fork } from "child_process";

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
  });

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
    } = (await nextSales).value as ChainEvents;
    LOGGER.info(`Got ${events.length} sales`);

    if (!events.length) {
      AdapterState.updateSalesLastSyncedBlockNumber(
        Marketplace.Opensea,
        blockRange.endBlock,
        chain,
        providerName
      );
      nextSales = itSales.next();
      continue;
    }

    const sales: Array<SaleData> = [];

    for (const [hash, receiptWithMeta] of Object.entries(receipts)) {
      const { meta: metas, receipt } = receiptWithMeta;
      if (!metas.length) {
        LOGGER.info(`Skipping ${receipt.transactionHash}`);
        continue;
      }
      for (const meta of metas) {
        if (!meta) {
          LOGGER.error(`Skipping meta`, { tx: receipt.transactionHash });
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
        });
      }
    }

    try {
      await CurrencyConverter.matchSalesWithPrices(sales);

      const salesInserted = await Sale.insert({
        slug: collectionMap,
        marketplace: Marketplace.Opensea,
        sales,
      });

      if (salesInserted) {
        const slugMap = sales.reduce((slugs, sale) => {
          const slug =
            collectionMap[sale.contractAddress]?.slug ?? sale.contractAddress;
          if (!(slug in slugs)) {
            slugs[slug] = [];
          }

          slugs[slug].push(sale);

          return slugs;
        }, {} as Record<string, Array<SaleData>>);

        for (const [slug, sales] of Object.entries(slugMap)) {
          await HistoricalStatistics.updateStatistics({
            slug,
            chain: Blockchain.Ethereum,
            marketplace: Marketplace.Opensea,
            sales,
          });
        }
      }
    } catch (e) {
      const hashes = sales.reduce((hashes, sale) => {
        if (!(sale.paymentTokenAddress in hashes)) {
          hashes[sale.paymentTokenAddress] = [];
        }
        hashes[sale.paymentTokenAddress].push(sale.txnHash);
        return hashes;
      }, {} as Record<string, Array<string>>);
      LOGGER.error(`Sale error`, { error: e, sales, hashes });
    }

    AdapterState.updateSalesLastSyncedBlockNumber(
      Marketplace.Opensea,
      blockRange.endBlock,
      chain,
      providerName
    );
    nextSales = itSales.next();
  }
}

async function run(provider: AdapterProvider): Promise<void> {
  try {
    while (true) {
      await Promise.all([/* runCollections(), */ runSales(provider)]);
      await sleep(60 * 60);
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

if (!process.argv[2]) {
  OpenSeaProvider.build(OpenSeaMarketConfig).forEach((p) =>
    spawnProviderChild(p)
  );
} else if (process.argv[2] === "provider-child") {
  const OSProviders = OpenSeaProvider.build(OpenSeaMarketConfig);
  const providerName = process.argv[3];
  const provider = OSProviders.find(
    (p) => p.chainConfig.providerName === providerName
  ).instantiate();
  if (cluster.isWorker) {
    ClusterWorker.create(
      process.env.WORKER_UUID,
      `OPENSEA_${providerName}`,
      provider
    );
  } else {
    ClusterManager.create(`OPENSEA_${providerName}`, provider);
    OpenseaAdapter.run(provider);
  }
}

export default OpenseaAdapter;
