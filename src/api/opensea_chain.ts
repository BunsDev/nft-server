import Web3 from "web3";
import Database from "better-sqlite3";
import { BlockTransactionObject, Transaction } from "web3-eth";
import { ethers, BigNumber, Event } from "ethers";
import {
  LogDescription,
  /* TransactionDescription, */
} from "@ethersproject/abi/lib/interface";
import winston from "winston";
import OPENSEA_ABI from "./opensea.abi.json";
import { EventFragment } from "ethers/lib/utils";

const LOGGER = winston.createLogger({
  levels: winston.config.syslog.levels,
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: "opensea.error.log",
      level: "error",
    }),
    new winston.transports.File({
      filename: "opensea.info.log",
      level: "info",
    }),
    new winston.transports.File({
      filename: "opensea.debug.log",
      level: "debug",
    }),
  ],
});

type Transactions = Transaction[];
type DecodedLog = LogDescription;
enum NFT_TYPE {
  ERC721 = "ERC721",
  ERC1155 = "ERC721",
}
interface DecodedTx {
  collectionAddress: string | null;
  // data: TransactionDescription;
  logs: DecodedLog[];
  ordersMatchedLog: LogDescription;
  nftType: NFT_TYPE;
}

const WEI = BigNumber.from("1000000000000000000");
const GWEI = BigNumber.from("1000000000");
const ETH_USD = 2800;

const DB = new Database("./opensea.db", { verbose: LOGGER.debug });

const web3 = new Web3("http://192.168.1.137:8545");
const ethProvider = new ethers.providers.StaticJsonRpcProvider("http://192.168.1.137:8545");

const OPENSEA_CONTRACT_ADDRESS = "0x7f268357a8c2552623316e2562d90e642bb538e5";
const OpenseaContractInterface = new ethers.utils.Interface(OPENSEA_ABI);
const OpenSeaContract = new ethers.Contract(
  OPENSEA_CONTRACT_ADDRESS,
  OPENSEA_ABI,
  ethProvider
);
const OpenSeaOrdersMatched = ethers.utils.id(
  "event OrdersMatched (bytes32 buyHash, bytes32 sellHash, address indexed maker, address indexed taker, uint price, bytes32 indexed metadata)"
);

const ERC721ContractInterface = new ethers.utils.Interface([
  "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
]);

const ERC1155ContractInterface = new ethers.utils.Interface([
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
  "event ApprovalForAll(address indexed account, address indexed operator, bool approved)",
  "event URI(string value, uint256 indexed id)"
]);

const lastBlockHeight = 14652292;



DB.exec(`
DROP TABLE "sales";
CREATE TABLE "sales" (
  "address"	TEXT UNIQUE,
  "count"	INTEGER NOT NULL DEFAULT 0,
  "eth_volume" DECIMAL NOT NULL DEFAULT 0,
  "usd_volume" DECIMAL NOT NULL DEFAULT 0,
  PRIMARY KEY("address")
);`);

const saleInsertStmt = DB.prepare(`
  INSERT INTO sales (address, count, eth_volume, usd_volume) VALUES (?,?,?,?) 
  ON CONFLICT(address) 
  DO UPDATE SET 
    count = count + 1,
    eth_volume = eth_volume + ?,
    usd_volume = usd_volume + ?
`);

async function main() {
  const currentBlockNumber: number = await web3.eth.getBlockNumber();

  // for (let i: number = lastBlockHeight; i < currentBlockNumber; i++) {
  //   const block: BlockTransactionObject = await web3.eth.getBlock(i, true);
  //   console.log(`Info about block ${block.hash}(${block.number}):`);
  //   console.log(`txCount: ${block.transactions.length}`);
  //   OpenseaContractInterface.getEvent
  //   await processTxes(block.transactions);
  // }

  for (let i = 0; i <= currentBlockNumber - lastBlockHeight; i += 100) {
    const fromBlock = lastBlockHeight + i;
    const toBlock = fromBlock + 100;
    LOGGER.debug(
      `Filter logs between block ${fromBlock} to ${toBlock} diff ${
        toBlock - fromBlock
      }`
    );
    const events: Array<Event> = await OpenSeaContract.queryFilter(
      {
        address: OPENSEA_CONTRACT_ADDRESS,
        topics: OpenseaContractInterface.encodeFilterTopics(
          OpenseaContractInterface.getEvent("OrdersMatched"),
          []
        ),
      },
      fromBlock,
      toBlock
    );
    console.log(events);
  }
}

async function processTxes(transactions: Transactions) {
  // eslint-disable-next-line no-labels
  txProcessFor: for (const tx of transactions) {
    const txTo = (tx.to ?? "").toLowerCase();

    if (txTo !== OPENSEA_CONTRACT_ADDRESS) {
      LOGGER.debug(`Skip tx: ${tx.hash} Missing data`);
      continue;
    }

    LOGGER.info(`Process OS tx: ${tx.hash}`);

    const { hash: txHash /* , input: txInput */ } = tx;
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    const { logs: txLogs } = receipt;
    const txDecoded: DecodedTx = {
      collectionAddress: null,
      logs: [] as DecodedLog[],
      ordersMatchedLog: null,
      nftType: null,
    };

    if (!txLogs.length) {
      LOGGER.debug([`Skip tx: ${txHash} No Logs: `, receipt]);
      continue;
    }

    // check first if the sale succeeded
    try {
      const lastLog = txLogs[txLogs.length - 1];
      const decoded: DecodedLog = OpenseaContractInterface.parseLog(lastLog);
      if (decoded.name !== "OrdersMatched") {
        LOGGER.debug(`Skip tx: ${txHash} LastLog: ${decoded.name}`);
        continue;
      } else {
        txDecoded.ordersMatchedLog = decoded;
      }
    } catch (e) {
      LOGGER.error([
        `Failed to parse last log(${txLogs.length - 1}): ${txHash} Error:`,
        e,
      ]);
      break;
    }

    let logN = 0;
    for (const log of txLogs) {
      try {
        let decodedLog = null;
        if (log.address.toLowerCase() === OPENSEA_CONTRACT_ADDRESS) {
          if (logN === txLogs.length - 1 && txDecoded.ordersMatchedLog) {
            decodedLog = txDecoded.ordersMatchedLog;
          } else {
            decodedLog = OpenseaContractInterface.parseLog({
              data: log.data,
              topics: log.topics,
            });
          }
        } else {
          if (!txDecoded.collectionAddress)
            txDecoded.collectionAddress = log.address.toLowerCase();
          try {
            decodedLog = ERC721ContractInterface.parseLog({
              data: log.data,
              topics: log.topics,
            });
            txDecoded.nftType = NFT_TYPE.ERC721;
          } catch (e) {
            LOGGER.debug([`Failed ERC721, trying ERC1155: ${txHash}`, e]);
            decodedLog = ERC1155ContractInterface.parseLog({
              data: log.data,
              topics: log.topics,
            });
            txDecoded.nftType = NFT_TYPE.ERC1155;
          }
        }

        LOGGER.debug([`Decode log(${logN}): ${txHash} Log: `, decodedLog]);

        if (decodedLog) {
          txDecoded.logs.push(decodedLog);
        }
      } catch (e) {
        LOGGER.error([`Failed to parse log(${logN}): ${txHash} Error:`, e]);
        break;
      }
      logN++;
    }

    const { price } = txDecoded.ordersMatchedLog.args;
    const priceGwei = price.div(GWEI);

    LOGGER.debug(`OrdersMatched price: ${price}`);

    saleInsertStmt.run(
      txDecoded.collectionAddress,
      1,
      priceGwei.toBigInt(),
      getUSDValue(priceGwei),
      priceGwei.toBigInt(),
      getUSDValue(priceGwei)
    );
  }
}

main();

function getUSDValue(gweiValue: BigNumber): BigInt {
  return gweiValue.div(GWEI).mul(ETH_USD).toBigInt();
}

// const txs: Transactions = [];
// let running = false;
// function processTxes() {
//   if (running) return;
//   running = true;
//   while (true) {
//     const batch = txs.splice(0, 100);
//     if (!batch.length) {
//       break;
//     }
//     for (const tx of batch) {
//       process.send(`add collection sale ${tx.hash}`);
//       try {
//         submitTx(tx);
//       } catch (e) {
//         console.log(`db update failed on tx: ${tx.hash}`);
//         txs.push(tx);
//       }
//     }
//   }
//   running = false;
// }
