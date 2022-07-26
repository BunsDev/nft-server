// import "../src/__tests__/loggerDisable";
import "./dotenv";
import axios from "axios";
import { ethers, BigNumber, Event, utils } from "ethers";
import { IMarketOnChainProvider } from "../src/interfaces";
import { Blockchain, Marketplace, SaleData } from "../src/types";
import { OpenSea as OpenSeaMarketConfig } from "../src/markets";
import { OpenSeaProvider } from "../src/markets/OpenSeaProvider";
import { EventMetadata } from "../src/markets/BaseMarketOnChainProvider";
import { providers } from "../src/providers/OnChainProviderFactory";
import fs from "fs";
import { Block, Log, Provider } from "@ethersproject/abstract-provider";

import {
  IERC1155Standard,
  IERC1155Events,
  IERC20Standard,
  IERC721Standard,
  IERC721Events,
  DEFAULT_TOKEN_ADDRESSES,
} from "../src/constants";
import Database from "better-sqlite3";
import { Sale } from "../src/models";
import { CurrencyConverter } from "../src/api/currency-converter";
import dynamodb from "../src/utils/dynamodb";

const file = "../src/__tests__/transactions.json";

type EventInfo = {
  blockNumber: number;
  logIndex: Array<number>;
  transactionHash?: string;
};

const hashes: Record<string, EventInfo> = {
  "0x47f690f21377cef592ad4afb270713bb27c7cfcdd68897f37d082eded3aa2d32": {
    blockNumber: 14383523,
    logIndex: [283],
  },
};

const blockMap = new Map<number, Block>(
  JSON.parse(fs.readFileSync("./scripts/blocks.json").toString())
);
const ethProvider = <Provider>providers[Blockchain.Ethereum];

interface ScanItem extends SaleData {
  SK: string;
  PK: string;
}

async function main(): Promise<void> {
  let lastEvalKey: AWS.DynamoDB.DocumentClient.Key | boolean = JSON.parse(
    fs.readFileSync("./scripts/lastEvalKey.json").toString()
  );
  while (lastEvalKey !== undefined) {
    const currentBlock = await ethProvider.getBlockNumber();
    const queryScan: AWS.DynamoDB.DocumentClient.ScanOutput =
      await dynamodb.scan({
        Limit: 50,
        ...(lastEvalKey &&
          lastEvalKey !== true && {
            ExclusiveStartKey: lastEvalKey,
          }),
      });

    const updates = [];

    for (const item of <Array<ScanItem>>queryScan.Items) {
      const _item = {
        Key: {
          PK: item.PK,
          SK: item.SK,
        },
      };

      console.log(`Processing PK=%s SK=%s`, item.PK, item.SK);

      if (!/^sales/.test(item.PK)) continue;

      if (!item.paymentTokenAddress) {
        item.paymentTokenAddress = DEFAULT_TOKEN_ADDRESSES[Blockchain.Ethereum];
      }

      const [blockHeight, , txHash] = item.SK.split(/#/);
      const date = new Date(parseInt(blockHeight));
      if (date.getFullYear() > 2014) continue;

      if (
        !blockMap.has(parseInt(blockHeight)) &&
        parseInt(blockHeight) < currentBlock
      ) {
        console.log(`Get block %s`, blockHeight);
        blockMap.set(
          parseInt(blockHeight),
          await ethProvider.getBlock(parseInt(blockHeight))
        );
      }

      const block = blockMap.get(parseInt(blockHeight));
      const timestamp = block ? block.timestamp : parseInt(blockHeight);
      const SK = `${timestamp * 1000}#txnHash#${txHash}`;

      item.SK = SK;

      console.log(`Update SK=%s`, SK);

      updates.push([item, _item]);
    }

    console.log(
      `Got %s items, %s to update`,
      queryScan.Items.length,
      updates.length
    );

    if (blockMap.size > 500) {
      blockMap.clear();
    }

    fs.writeFileSync(
      "./scripts/blocks.json",
      JSON.stringify(Array.from(blockMap.entries()))
    );

    lastEvalKey = undefined;
    if (queryScan.LastEvaluatedKey) {
      lastEvalKey = queryScan.LastEvaluatedKey;
      fs.writeFileSync(
        "./scripts/lastEvalKey.json",
        JSON.stringify(lastEvalKey)
      );
      console.log(`Write lastEvalKey`, lastEvalKey);
    }

    if (!updates.length) continue;

    for (let i = 0; i < updates.length; i += 12) {
      const [putItems, deleteItems] = updates.slice(i, i + 12).reduce(
        (c, i) => {
          c[0].push(i[0]);
          c[1].push(i[1]);
          return c;
        },
        [[], []]
      );
      await dynamodb.transactWrite({ putItems, deleteItems });
    }
  }

  // const sales = await Sale.getAll({
  //   slug: "0x5763127d8d7E1870A9BC5F7677c0739f5F90D859",
  //   marketplace: Marketplace.Opensea,
  // });

  // console.log(sales.data);

  // CurrencyConverter.matchSalesWithPrices(sales.data);

  // let OSProvider: IMarketOnChainProvider = new OpenSeaProvider(
  //   OpenSeaMarketConfig
  // );

  // const avg = (numbers: Array<number>): number => {
  //   return numbers.reduce((s, n) => s + n, 0) / numbers.length;
  // };

  // const provider = OSProvider.chains[Blockchain.Ethereum].provider;
  // const [fromBlock, toBlock] = [14468025, 14468525];
  // const blocks: Array<Block> = [];
  // const latencies: Array<number> = [];

  // // eslint-disable-next-line no-unreachable-loop
  // for (let i = fromBlock; i <= toBlock; i++) {
  //   const start = performance.now();
  //   const block = await provider.getBlock(i);
  //   const end = performance.now();
  //   // console.log(`Get block ${i} took ${end - start} ms`);
  //   latencies.push(end - start);
  //   console.log(block);
  //   break;
  //   blocks.push(block);
  // }

  // console.log(
  //   `Avg getBlock time: %s\nLongest: %s\nShortest: %s`,
  //   avg(latencies),
  //   Math.max(...latencies),
  //   Math.min(...latencies)
  // );

  // const start = performance.now();
  // const promises: Array<Promise<Array<Log>>> = [
  //   "0xc4109843e0b7d514e4c093114b863f8e7d8d9a458c372cd51bfe526b588006c9",
  //   "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62",
  //   "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb",
  //   "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31",
  //   "0x6bb7ff708619ba0610cba295a58592e0451dee2622938c8755667688daf3529b",
  //   "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
  //   "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  // ].map((topic) =>
  //   provider.getLogs({
  //     topics: [topic],
  //     fromBlock: 14468025,
  //     toBlock: 14468026,
  //     // toBlock: 14468525,
  //   })
  // );
  // const logs = await provider.getLogs({
  //   topics: [
  //     // "0xc4109843e0b7d514e4c093114b863f8e7d8d9a458c372cd51bfe526b588006c9",
  //     // "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62",
  //     // "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb",
  //     // "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31",
  //     // "0x6bb7ff708619ba0610cba295a58592e0451dee2622938c8755667688daf3529b",
  //     // "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
  //     // "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  //   ],
  //   fromBlock: 14468025,
  //   toBlock: 14468025,
  // });
  // const logs = (await Promise.all(promises)).flat();
  // const end = performance.now();

  // console.log(`Total time: ${(end - start) / 1000}`, { nLogs: logs.length });

  // let filterTopics: (string | string[])[] = OSProvider.contracts[
  //   Blockchain.Ethereum
  // ].interface.encodeFilterTopics(
  //   OSProvider.contracts[Blockchain.Ethereum].interface.getEvent(
  //     OSProvider.config.chains[Blockchain.Ethereum].saleEventName
  //   ),
  //   []
  // );

  // const topics: Record<string, (string | string[])[]>[] = [
  //   IERC1155Events,
  //   IERC721Events,
  // ].map((map) => {
  //   console.log(Array.from(map.entries()));
  //   return Array.from(map.entries()).reduce((record, entry) => {
  //     const _interface = new ethers.utils.Interface([entry[1]]);
  //     record[entry[0]] = _interface.encodeFilterTopics(
  //       _interface.getEvent(entry[0]),
  //       []
  //     );
  //     return record;
  //   }, {} as Record<string, (string | string[])[]>);
  // });

  // console.log(filterTopics, topics);

  // const transactions = JSON.parse(fs.readFileSync(file).toString());

  // for (const hash of Object.keys(hashes)) {
  //   const eventInfo = hashes[hash];
  //   eventInfo.transactionHash = hash;
  //   const events: Array<Event> = (
  //     await OSProvider.contracts[Blockchain.Ethereum].queryFilter(
  //       {
  //         address:
  //           OpenSeaMarketConfig.chains[Blockchain.Ethereum].contractAddress,
  //         topics: filterTopics,
  //       },
  //       14383523,
  //       14383523
  //     )
  //   ).filter((e) => e.transactionHash === hash);

  //   const receipt = await (<Provider>(
  //     providers[Blockchain.Ethereum]
  //   )).getTransactionReceipt(hash);

  //   transactions[hash] = {
  //     ...(transactions[hash] || {}),
  //     receipt,
  //     events,
  //   };
  // }

  // fs.writeFileSync(file, JSON.stringify(transactions, null, 4));
}

(async () => {
  await main();
  // eslint-disable-next-line no-process-exit
  process.exit(0);
})();
