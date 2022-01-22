import { DataAdapter } from ".";
import { Coingecko } from "../api/coingecko";
import { Treasure } from "../api/treasure";
import { CurrencyConverter } from "../api/currency-converter";
import { HistoricalStatistics } from "../models/historical-statistics";
import { Collection, Sale } from "../models";
import { sleep, handleError, filterObject } from "../utils";
import { Blockchain, Marketplace } from "../types";

async function runCollections(): Promise<void> {
  const { data: collections } = await Collection.getSorted({
    marketplace: Marketplace.Treasure,
  });

  const { usd: magicInUsd, eth: magicInEth } = await Coingecko.getPricesById(
    "magic"
  );

  console.log(
    "Fetching metadata for Treasure collections:",
    collections.length
  );

  for (const collection of collections) {
    try {
      console.log(
        "Fetching metadata for Treasure collection:",
        collection.name
      );
      await fetchCollection(collection, magicInUsd, magicInEth);
    } catch (e) {
      await handleError(e, "treasure-adapter:runCollections");
    }
  }
}

async function runSales(): Promise<void> {
  const { data: collections } = await Collection.getSorted({
    marketplace: Marketplace.Treasure,
  });

  console.log("Fetching sales for Treasure collections:", collections.length);
  for (const collection of collections) {
    console.log("Fetching sales for Treasure collection:", collection.name);
    await fetchSales(collection);
  }
}

async function fetchCollection(
  collection: any,
  magicInUsd: number,
  magicInEth: number
): Promise<void> {
  const { metadata, statistics } = await Treasure.getCollection(
    collection,
    magicInUsd,
    magicInEth
  );

  const filteredMetadata = filterObject(metadata);
  const slug = filteredMetadata.slug as string;

  if (!slug) {
    return;
  }

  await Collection.upsert({
    slug,
    metadata: filteredMetadata,
    statistics,
    chain: Blockchain.Arbitrum,
    marketplace: Marketplace.Treasure,
  });
}

async function fetchSales(collection: any): Promise<void> {
  const slug = collection.slug;
  const lastSaleTime = await Sale.getLastSaleTime({
    slug,
    marketplace: Marketplace.Treasure,
  });

  try {
    const sales = await Treasure.getSales(collection.address, lastSaleTime);
    const filteredSales = sales.filter((sale) => sale);

    if (filteredSales.length === 0) {
      return;
    }

    const convertedSales = await CurrencyConverter.convertSales(filteredSales);

    const salesInserted = await Sale.insert({
      slug,
      marketplace: Marketplace.Treasure,
      sales: convertedSales,
    });

    if (salesInserted) {
      await HistoricalStatistics.updateStatistics({
        slug,
        chain: Blockchain.Arbitrum,
        marketplace: Marketplace.Treasure,
        sales: convertedSales,
      });
    }
  } catch (e) {
    await handleError(e, "treasure-adapter:fetchSales");
  }
}

async function run(): Promise<void> {
  try {
    while (true) {
      await Promise.all([runCollections(), runSales()]);
      await sleep(60 * 60);
    }
  } catch (e) {
    await handleError(e, "treasure-adapter");
  }
}

const TreasureAdapter: DataAdapter = { run };

TreasureAdapter.run();

export default TreasureAdapter;
