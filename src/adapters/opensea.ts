import axios from "axios";
import { DataAdapter } from ".";
import { Collection, Contract, Sale, HistoricalStatistics, AdapterState } from "../models";
import { Opensea } from "../api/opensea";
import { Coingecko } from "../api/coingecko";
import { CurrencyConverter } from "../api/currency-converter";
import { COINGECKO_IDS } from "../constants";
import { sleep, handleError, filterObject } from "../utils";
import { Blockchain, CollectionData, LowVolumeError, Marketplace } from "../types";
import { OpenSea as OpenSeaMarketConfig } from "../markets";
import { OpenSeaProvider } from "../markets/OpenSeaProvider";
import { BigNumber, ethers } from "ethers";
import { ChainEvents } from "../markets/BaseMarketOnChainProvider";
import { getLogger } from "../utils/logger";
import { ClusterManager, ClusterWorker } from "../utils/cluster";
import cluster from "cluster";

const LOGGER = getLogger("OPENSEA_ADAPTER", {
  datadog: !!process.env.DATADOG_API_KEY,
});

const OSProvider = new OpenSeaProvider(OpenSeaMarketConfig);

if (cluster.isWorker) {
  ClusterWorker.create(process.env.WORKER_UUID, "OPENSEA", OSProvider);
} else {
  ClusterManager.create("OPENSEA", OSProvider);
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

async function runSales(): Promise<void> {
  const { data: collections } = await Collection.getSorted({
    marketplace: Marketplace.Opensea,
  });

  const collectionMap = collections.reduce((m, c) => {
    m[c.address] = c;
    return m;
  }, {});

  LOGGER.info("Fetching sales for OpenSea collections:", collections.length);

  const itSales = OSProvider.fetchSales();
  // eslint-disable-next-line prefer-const
  let nextSales = itSales.next();
  // eslint-disable-next-line no-unreachable-loop
  while (!(await nextSales).done) {
    const { chain, events, blockRange, receipts } = (await nextSales)
      .value as ChainEvents;
    LOGGER.info(`Got ${events.length} sales`);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const { meta: metas, receipt } = receipts[event.transactionHash];
      if (!metas.length) {
        LOGGER.info(`Skipping ${receipt.transactionHash}`);
        continue;
      }
      for (const meta of metas) {
        const { contractAddress, price, eventSignatures } = meta;
        const formattedPrice = ethers.utils.formatUnits(price, "ether");
        LOGGER.info(
          `Sale of ${contractAddress} from ${
            receipt.transactionHash
          } for ${formattedPrice} ${chain}\n\t${eventSignatures.join("\n\t")}\n`,
          meta
        );
        if (!contractAddress) continue;
        Sale.insert({
          slug: collectionMap[contractAddress]?.slug ?? contractAddress,
          marketplace: Marketplace.Opensea,
          sales: [
            {
              txnHash: receipt.transactionHash,
              timestamp: receipt.blockNumber.toString(),
              paymentTokenAddress: null,
              contractAddress,
              price: parseFloat(formattedPrice),
              priceBase: null,
              priceUSD: null,
              sellerAddress: meta.seller,
              buyerAddress: meta.buyer,
              marketplace: Marketplace.Opensea,
              chain,
            },
          ],
        });
      }
    }
    AdapterState.updateSalesLastSyncedBlockNumber(
      Marketplace.Opensea,
      blockRange.endBlock,
      chain
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

async function run(): Promise<void> {
  try {
    while (true) {
      await Promise.all([/* runCollections(), */ runSales()]);
      await sleep(60 * 60);
    }
  } catch (e) {
    await handleError(e, "opensea-adapter");
  }
}

const OpenseaAdapter: DataAdapter = { run };

if (cluster.isPrimary) {
  OpenseaAdapter.run();
}

export default OpenseaAdapter;
