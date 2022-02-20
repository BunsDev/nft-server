import { DataAdapter } from ".";
import { Coingecko } from "../api/coingecko";
import { CurrencyConverter } from "../api/currency-converter";
import { PancakeSwap, PancakeSwapCollectionData } from "../api/pancakeswap";
import { Collection, Sale, HistoricalStatistics } from "../models";
import { sleep, handleError, filterObject } from "../utils";
import { COINGECKO_IDS } from "../constants";
import { Blockchain, CollectionData, Marketplace } from "../types";

async function runCollections(): Promise<void> {
  const collections = await PancakeSwap.getAllCollections();

  const { usd: bnbInUSD } = await Coingecko.getPricesById(
    COINGECKO_IDS[Blockchain.BSC].geckoId
  );

  console.log(
    "Fetching metadata for PancakeSwap collections:",
    collections.length
  );

  for (const collection of collections) {
    try {
      console.log(
        "Fetching metadata for PancakeSwap collection:",
        collection.name
      );
      await fetchCollection(collection, bnbInUSD);
    } catch (e) {
      await handleError(e, "pancakeswap-adapter:runCollections");
    }
  }
}

async function runSales(): Promise<void> {
  const { data: collections } = await Collection.getSorted({
    marketplace: Marketplace.PancakeSwap,
  });
  console.log(
    "Fetching sales for PancakeSwap collections:",
    collections.length
  );
  for (const collection of collections) {
    console.log("Fetching sales for PancakeSwap collection:", collection.name);
    await fetchSales(collection);
  }
}

async function fetchCollection(
  collection: PancakeSwapCollectionData,
  bnbInUsd: number
): Promise<void> {
  const { metadata, statistics } = await PancakeSwap.getCollection(
    collection,
    bnbInUsd
  );

  const filteredMetadata = filterObject(metadata) as CollectionData;
  const slug = filteredMetadata.slug as string;

  if (!slug) {
    return;
  }

  await Collection.upsert({
    slug,
    metadata: filteredMetadata,
    statistics,
    chain: Blockchain.BSC,
    marketplace: Marketplace.PancakeSwap,
  });
}

async function fetchSales(collection: Collection): Promise<void> {
  const slug = collection.slug;
  const lastSaleTime = await Sale.getLastSaleTime({
    slug,
    marketplace: Marketplace.PancakeSwap,
  });

  try {
    const sales = await PancakeSwap.getSales(collection.address, lastSaleTime);
    const filteredSales = sales.filter((sale) => sale);

    if (filteredSales.length === 0) {
      return;
    }

    const convertedSales = await CurrencyConverter.convertSales(filteredSales);

    const salesInserted = await Sale.insert({
      slug,
      marketplace: Marketplace.PancakeSwap,
      sales: convertedSales,
    });

    if (salesInserted) {
      await HistoricalStatistics.updateStatistics({
        slug,
        chain: Blockchain.BSC,
        marketplace: Marketplace.PancakeSwap,
        sales: convertedSales,
      });
    }
  } catch (e) {
    await handleError(e, "pancakeswap-adapter:fetchSales");
  }
}

async function run(): Promise<void> {
  try {
    while (true) {
      await Promise.all([runCollections(), runSales()]);
      await sleep(60 * 60);
    }
  } catch (e) {
    await handleError(e, "pancakeswap-adapter");
  }
}

const PancakeSwapAdapter: DataAdapter = { run };

PancakeSwapAdapter.run();

export default PancakeSwapAdapter;
