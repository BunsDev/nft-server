import { Blockchain, Marketplace, CollectionData, StatisticData } from "../src/types";
import { Collection } from "../src/models";
import collectionData from '../collections.json';
import { getCollectionInfo } from "./collectionInfo";

type Address = string;
type Chain = string;

interface CollectionInsert {
  floorUSD?: number;
  totalVolumeUSD?: number;
  address?: Address;
  logo?: string;
  marketplaces?: string[];
  name?: string;
  chains?: string[];
  floor?: number;
  owners?: number;
  totalVolume?: number;
  category?: string;
  SK?: string;
  PK?: string;
  dailyVolumeUSD?: number;
  dailyVolume?: number;
  slug?: string;

  metadata?: CollectionData;
  statistics?: StatisticData;
}

interface SymbolList {
  [index: string]: string;
}

let collections: CollectionInsert[];

(async () => {
  const symbols: SymbolList = {};
  for (const c of collectionData as CollectionInsert[]) {
    if (c.chains.indexOf(Blockchain.Ethereum) > -1) {
      symbols[c.address] = (await getCollectionInfo(c.address)).symbol;
    }
  }
  
  collections = [...collectionData].map((c: CollectionInsert) => {
    const symbol = symbols[c.address];
    return {...c, 
      metadata: {
        address: c.address,
        name: c.name,
        slug: c.slug,
        symbol,
        description: c.name,
        logo: c.logo,
        chains: c.chains as Chain[],
        marketplaces: c.marketplaces as Marketplace[]
      } as CollectionData
    } as CollectionInsert;
  });

  main().then((result) => console.log(result));
})();

async function main() {
  try {
    console.log("Manually inserting", collections.length, "collections");
    for (const collection of collections) {
      console.log("Inserting collection", collection.name);
      const { slug, chains, marketplaces, totalVolumeUSD, metadata } = collection;
      await Collection.upsert({
        slug,
        metadata,
        chain: chains[0] as Blockchain,
        marketplace: marketplaces[0] as Marketplace,
        statistics: { totalVolumeUSD } as StatisticData,
      });
    }
    return "Successfully inserted collections";
  } catch (e) {
    console.log(e.message);
    return "Error inserting collections";
  }
}