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

const ERC721ContractInterface = new ethers.utils.Interface([
  "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
]);

const ERC1155ContractInterface = new ethers.utils.Interface([
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
  "event ApprovalForAll(address indexed account, address indexed operator, bool approved)",
  "event URI(string value, uint256 indexed id)"
]);

const OSProvider = new OpenSeaProvider(OpenSeaMarketConfig);

async function runCollections(): Promise<void> {
  const collections = await Contract.getAll(Blockchain.Ethereum);

  if (collections.length === 0) {
    console.log("No OpenSea collections to request...");
    return;
  }

  const { usd: ethInUSD } = await Coingecko.getPricesById(
    COINGECKO_IDS[Blockchain.Ethereum].geckoId
  );

  console.log("Fetching metadata for Opensea collections:", collections.length);

  for (const collection of collections) {
    try {
      console.log(
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

  console.log("Fetching sales for OpenSea collections:", collections.length);

  const itSales = OSProvider.fetchSales();
  // eslint-disable-next-line prefer-const
  let nextSales = itSales.next();
  // eslint-disable-next-line no-unreachable-loop
  while (!(await nextSales).done) {
    const { chain, events, blockRange, receipts } = (await nextSales)
      .value as ChainEvents;
    console.log(`Got ${events.length} sales`);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const { meta, receipt } = receipts[event.transactionHash];
      if (!meta) {
        console.log(`Skipping ${receipt.transactionHash}`);
        continue;
      }
      const { contractAddress, price, eventSignatures } = meta;
      const formattedPrice = ethers.utils.formatUnits(price, "ether");
      console.log(
        `Sale of ${contractAddress} from ${
          receipt.transactionHash
        } for ${formattedPrice} ${chain}\n\t${eventSignatures.join("\n\t")}\n`
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
            sellerAddress: meta.taker,
            buyerAddress: meta.maker,
            marketplace: Marketplace.Opensea,
            chain,
          },
        ]
      })
    }
    // AdapterState.updateSalesLastSyncedBlockNumber(
    //   Marketplace.Opensea,
    //   blockRange.endBlock,
    //   chain
    // );
    nextSales = itSales.next();
  }

  // const tx = await OSProvider.chains.ethereum.provider.getBlockWithTransactions(
  //   12287507
  // );

  // console.log(
  //   tx.transactions.find(
  //     (t) =>
  //       t.hash ===
  //       "0x22199329b0aa1aa68902a78e3b32ca327c872fab166c7a2838273de6ad383eba"
  //   )
  // );

  // const firstCollection = collections[1];
  // const collectionContract = new ethers.Contract(
  //   "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
  //   ERC721ContractInterface,
  //   OSProvider.chains.ethereum.provider
  // );
  // const events = await collectionContract.queryFilter(
  //   {
  //     address: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
  //     topics: collectionContract.interface.encodeFilterTopics(
  //       collectionContract.interface.getEvent("OwnershipTransferred"),
  //       []
  //     ),
  //   },
  //   12287507,
  //   12287507
  // );
  // console.log(events);
  // for (const collection of collections) {
  //   console.log("Fetching sales for OpenSea collection:", collection.name);
  //   await fetchSales(collection);
  // }
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

OpenseaAdapter.run();

export default OpenseaAdapter;
