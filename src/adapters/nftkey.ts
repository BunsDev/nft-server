import { DataAdapter } from ".";
import {
  Collection,
  Sale,
  HistoricalStatistics,
  AdapterState,
} from "../models";
import { Blockchain, CollectionData, Marketplace } from "../types";
import { NFTKEY, NFTKEYCollectionData } from "../api/nftkey";
import { Coingecko } from "../api/coingecko";
import { CurrencyConverter } from "../api/currency-converter";
import { sleep, handleError, filterObject, getSalesFromLogs } from "../utils";
import { CHAIN_IDS, CHAIN_RPCS, COINGECKO_IDS } from "../constants";

const adapterMarketplace = Marketplace.NFTKEY;

const adapterChains = [
  Blockchain.Avalanche,
  Blockchain.Fantom,
  Blockchain.BSC,
  Blockchain.Harmony,
  Blockchain.Ethereum,
];

interface AdapterContractAddress {
  address: string;
  blockCreated: number;
}

const adapterAddresses: Partial<Record<Blockchain, AdapterContractAddress>> = {
  [Blockchain.BSC]: {
    address: "0x55E53B5e38Decb925A26cA5F38BddE68F373Bba8",
    blockCreated: 12099839,
  },
  [Blockchain.Fantom]: {
    address: "0x1A7d6ed890b6C284271AD27E7AbE8Fb5211D0739",
    blockCreated: 20324850,
  },
  [Blockchain.Harmony]: {
    address: "0x42813a05ec9c7e17aF2d1499F9B0a591B7619aBF",
    blockCreated: 20758264,
  },
  [Blockchain.Avalanche]: {
    address: "0x1A7d6ed890b6C284271AD27E7AbE8Fb5211D0739",
    blockCreated: 6421617,
  },
};

async function runCollections(): Promise<void> {
  const collections = await NFTKEY.getAllCollections();
  const prices: Partial<Record<Blockchain, number>> = {};

  for (const chain of adapterChains) {
    const { usd } = await Coingecko.getPricesById(COINGECKO_IDS[chain].geckoId);
    prices[chain] = usd;
  }

  console.log("Fetching metadata for NFTKEY collections:", collections.length);
  for (const collection of collections) {
    try {
      console.log("Fetching metadata for NFTKEY collection:", collection.name);
      await fetchCollection(collection, prices);
    } catch (e) {
      await handleError(e, "nftkey-adapter:runCollections");
    }
  }
}

async function runSales(): Promise<void> {
  for (const chain of adapterChains) {
    if (chain === Blockchain.Ethereum) {
      continue;
    }

    const { data: collections } = await Collection.getSorted({
      marketplace: adapterMarketplace,
    });

    if (!collections.length) {
      return;
    }

    let adapterState = await AdapterState.getSalesAdapterState(
      adapterMarketplace,
      chain,
      true
    );

    if (!adapterState) {
      adapterState = await AdapterState.createSalesAdapterState(
        adapterMarketplace,
        chain,
        adapterAddresses[chain].blockCreated
      );
    }

    const { lastSyncedBlockNumber } = adapterState;

    console.log(
      `Fetching sales for ${chain} NFTKEY collections from block number`,
      lastSyncedBlockNumber
    );

    await fetchSales(chain, collections, parseInt(lastSyncedBlockNumber));
  }
}

async function fetchCollection(
  collection: NFTKEYCollectionData,
  prices: Partial<Record<Blockchain, number>>
): Promise<void> {
  const chain = CHAIN_IDS[collection.chain_id];
  const price = prices[chain];

  const { metadata, statistics } = await NFTKEY.getCollection(
    collection,
    price
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
    chain,
    marketplace: adapterMarketplace,
  });
}

async function fetchSales(
  chain: Blockchain,
  collections: Collection[],
  lastSyncedBlockNumber: number
): Promise<void> {
  try {
    const { sales, latestBlock } = await getSalesFromLogs({
      adapterName: `NFTKEY ${chain}`,
      rpc: CHAIN_RPCS[chain],
      topic:
        "0x50a3cf2b1df7bd2994e752563ce6f85769fb50da66bbb9a9912d2d6066a6b4da",
      contractAddress: adapterAddresses[chain].address,
      fromBlock: lastSyncedBlockNumber,
      marketplace: adapterMarketplace,
      chain,
      parser: NFTKEY.parseSalesFromLogs,
    });

    if (!sales.length) {
      console.log(`No new sales for NFTKEY ${chain} collections`);
      return;
    }

    console.log(
      `Matching sales to NFTKEY collections:`,
      collections.length
    );

    for (const collection of collections) {
      console.log(
        `Matching sales for NFTKEY collection:`,
        collection.name,
      );
      const salesByCollection = sales.filter(
        (sale) => sale.contractAddress === collection.address
      );

      if (!salesByCollection.length) {
        console.log(
          `No sales found for NFTKEY collection`,
          collection.name
        );
        continue;
      }

      const convertedSales = await CurrencyConverter.convertSales(
        salesByCollection
      );

      const slug = collection.slug;
      const salesInserted = await Sale.insert({
        slug,
        marketplace: adapterMarketplace,
        sales: convertedSales,
      });

      if (salesInserted) {
        await HistoricalStatistics.updateStatistics({
          slug,
          chain,
          marketplace: adapterMarketplace,
          sales: convertedSales,
        });
        await AdapterState.updateSalesLastSyncedBlockNumber(
          adapterMarketplace,
          latestBlock,
          chain
        );
      }
    }
  } catch (e) {
    await handleError(e, "nftkey-adapter:fetchSales");
  }
}

async function run(): Promise<void> {
  try {
    while (true) {
      await Promise.all([
        runCollections(),
        runSales(),
      ]);
      await sleep(60 * 60);
    }
  } catch (e) {
    await handleError(e, "nftkey-adapter");
  }
}

const NFTKEYAdapter: DataAdapter = { run };

NFTKEYAdapter.run();

export default NFTKEYAdapter;
