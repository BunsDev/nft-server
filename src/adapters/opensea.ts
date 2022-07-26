import "../utils/tracer";
import axios from "axios";
import { DataAdapter } from ".";
import { Collection, Contract, Sale, HistoricalStatistics, AdapterState } from "../models";
import { Opensea } from "../api/opensea";
import { Coingecko } from "../api/coingecko";
import { CurrencyConverter } from "../api/currency-converter";
import { COINGECKO_IDS } from "../constants";
import { sleep, handleError, filterObject, restoreBigNumber } from "../utils";
import { Blockchain, CollectionData, LowVolumeError, Marketplace, SaleData } from "../types";
import { OpenSea as OpenSeaMarketConfig } from "../markets";
import { OpenSeaProvider } from "../markets/OpenSeaProvider";
import { BigNumber, ethers } from "ethers";
import { ChainEvents } from "../markets/BaseMarketOnChainProvider";
import { getLogger, configureLoggerDefaults } from "../utils/logger";
import { ClusterManager, ClusterWorker } from "../utils/cluster";
import cluster from "cluster";
import { IMarketOnChainProvider } from "../interfaces";

configureLoggerDefaults({
  error: false,
  info: false,
  debug: false,
});

const LOGGER = getLogger("OPENSEA_ADAPTER", {
  datadog: !!process.env.DATADOG_API_KEY,
});

const OSProviders = OpenSeaProvider.build(OpenSeaMarketConfig);

if (cluster.isWorker) {
  OSProviders.forEach((p) =>
    ClusterWorker.create(process.env.WORKER_UUID, "OPENSEA", p)
  );
} else {
  OSProviders.forEach((p) => ClusterManager.create("OPENSEA", p));
}

async function runCollections(): Promise<void> {
  const collections = await Contract.getAll(Blockchain.Ethereum);

  if (collections.length === 0) {
    LOGGER.info("No OpenSea collections to request...");
    return;
  }

  const { usd: ethInUSD } = await Coingecko.getPricesById(
    COINGECKO_IDS[Blockchain.Ethereum].geckoId
  );

  LOGGER.info("Fetching metadata for Opensea collections:", collections.length);

  for (const collection of collections) {
    try {
      LOGGER.info(
        "Fetching metadata for Opensea collection:",
        collection?.name || "No name"
      );
      await fetchCollection(
        collection.slug,
        collection.address,
        collection.defaultTokenId,
        ethInUSD
      );
    } catch (e) {
      if (e instanceof LowVolumeError) {
        await Contract.remove(Blockchain.Ethereum, collection.address);
      }
      await handleError(e, "opensea-adapter:runCollections");
    }
  }
}

async function runSales(provider: IMarketOnChainProvider): Promise<void> {
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
    } = (await nextSales).value as ChainEvents;
    LOGGER.info(`Got ${events.length} sales`);

    if (!events.length) {
      AdapterState.updateSalesLastSyncedBlockNumber(
        Marketplace.Opensea,
        blockRange.endBlock,
        chain,
        provider.CONTRACT_NAME,
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
        LOGGER.debug(
          `Sale of ${contractAddress} from ${
            receipt.transactionHash
          } for ${formattedPrice} ${chain}\n\t${eventSignatures.join("\n\t")}\n`,
          meta
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
      provider.CONTRACT_NAME,
    );
    nextSales = itSales.next();
  }
}

async function fetchCollection(
  slug: string,
  address: string,
  tokenId: string,
  ethInUSD: number
) {
  let fetchedSlug = "";
  if (!slug) {
    fetchedSlug = (await Opensea.getContract(address, tokenId)).slug;
  }
  const { metadata, statistics } = await Opensea.getCollection(
    address,
    slug || fetchedSlug,
    ethInUSD
  );
  const filteredMetadata = filterObject(metadata) as CollectionData;

  await Collection.upsert({
    slug: slug || fetchedSlug,
    metadata: filteredMetadata,
    statistics,
    chain: Blockchain.Ethereum,
    marketplace: Marketplace.Opensea,
  });
}

async function fetchSales(collection: Collection): Promise<void> {
  let offset = 0;
  const limit = 300;
  const slug = collection.slug;
  const lastSaleTime = await Sale.getLastSaleTime({
    slug,
    marketplace: Marketplace.Opensea,
  });

  while (offset <= 10000) {
    try {
      const sales = await Opensea.getSales(
        collection.address,
        lastSaleTime,
        offset,
        limit
      );
      const filteredSales = sales.filter((sale) => sale);

      if (filteredSales.length === 0) {
        sleep(3);
        return;
      }

      const convertedSales = await CurrencyConverter.convertSales(
        filteredSales
      );

      const salesInserted = await Sale.insert({
        slug,
        marketplace: Marketplace.Opensea,
        sales: convertedSales,
      });

      if (salesInserted) {
        await HistoricalStatistics.updateStatistics({
          slug,
          chain: Blockchain.Ethereum,
          marketplace: Marketplace.Opensea,
          sales: convertedSales,
        });
      }
      offset += limit;
      await sleep(1);
    } catch (e) {
      if (axios.isAxiosError(e)) {
        if (e.response.status === 500) {
          console.error(
            "Error [opensea-adapter:fetchSales]: offset not valid or server error"
          );
          break;
        }
      }
      await handleError(e, "opensea-adapter:fetchSales");
      continue;
    }
  }
}

async function run(provider: IMarketOnChainProvider): Promise<void> {
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

if (cluster.isPrimary) {
  OSProviders.forEach(p => OpenseaAdapter.run(p));
}

export default OpenseaAdapter;
