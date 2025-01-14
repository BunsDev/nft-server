import consts from "./constants.json";
import { Event, BigNumber } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";
require("dotenv").config();

const unknownPayment: Payment = { address: "0x", amount: BigNumber.from(0) };

export type MatchData = {
  transactionHash: string;
  buyer: string;
  seller: string;
  contractAddress: string;
  tokenIDs: string[];
  payment: Payment;
  quantity: number;
};
type Payment = {
  address: string;
  amount: BigNumber;
};
type Log = {
  address: string;
  blockHash: string;
  blockNumber: string;
  data: string;
  value?: any;
  topics: string[];
  transactionHash: string;
};
function filterTransfers(matches: Log[], transfers: Log[]): any[] {
  if (matches.length > 1)
    throw new Error("MATCHES DONT CORRESPOND TO TRANSFERS");
  let amount: BigNumber = BigNumber.from(0);
  let erc20Transfer: Log;

  transfers.map((t: Log) => {
    if (t.data == "0x") return;
    if (t.topics[0] != consts.transferTopic) return;
    const newValue: BigNumber = BigNumber.from(t.data);
    if (newValue.gt(amount)) {
      amount = newValue;
      erc20Transfer = t;
    }
  });

  if (erc20Transfer == null) return [transfers, unknownPayment];
  return [
    transfers.filter((t: Log) => t.address != erc20Transfer.address),
    { address: erc20Transfer.address, amount }
  ];
}
function addTradeToDatas(
  transfer: Log,
  payment: Payment,
  datas: MatchData[],
  quantity: number
): void {
  let newEntry: MatchData = undefined;
  if (transfer.topics[0] == consts.transferTopic)
    newEntry = {
      transactionHash: transfer.transactionHash,
      buyer: `0x${transfer.topics[2].substring(26, 66)}`,
      contractAddress: transfer.address,
      payment,
      seller: `0x${transfer.topics[1].substring(26, 66)}`,
      tokenIDs: [parseInt(transfer.topics[3], 16).toString()],
      quantity
    };
  if (transfer.topics[0] == consts.transferSingleTopic)
    newEntry = {
      transactionHash: transfer.transactionHash,
      buyer: `0x${transfer.topics[3].substring(26, 66)}`,
      contractAddress: transfer.address,
      payment,
      seller: `0x${transfer.topics[2].substring(26, 66)}`,
      tokenIDs: [parseInt(transfer.data.substring(2, 66), 16).toString()],
      quantity
    };

  const swapsInThisBundle = datas.find(
    (d) => d.transactionHash == newEntry.transactionHash
  );
  if (swapsInThisBundle == null) {
    datas.push(newEntry);
  } else if (!swapsInThisBundle.tokenIDs.includes(newEntry.tokenIDs[0])) {
    swapsInThisBundle.tokenIDs.push(...newEntry.tokenIDs);
  }
}
export async function fetchMatchData(
  events: Array<Event>,
  provider: Provider
): Promise<MatchData[]> {
  const datas: MatchData[] = [];
  const topics = await Promise.all(
    events.map((e: Event) => provider.getTransactionReceipt(e.transactionHash))
  );
  const transactions = await Promise.all(
    events.map((e: Event) => provider.getTransaction(e.transactionHash))
  );

  topics.map((topic: any, i: number) => {
    let payment: Payment = unknownPayment;
    let transfers: Log[] = [
      ...topic.logs.filter(
        (log: Log) =>
          consts.transferTopic == log.topics[0] &&
          log.topics[1] != consts.nullAddress
      ),
      ...topic.logs.filter(
        (log: Log) =>
          consts.transferSingleTopic == log.topics[0] &&
          log.topics[2] != consts.nullAddress
      )
    ];

    const matches: Log[] = topic.logs.filter((log: Log) =>
      [consts.matchTopic].includes(log.topics[0])
    );

    if (matches.length != transfers.length && transfers.length > 0) {
      [transfers, payment] = filterTransfers(matches, transfers);
    }

    transfers.map((transfer: Log) => {
      if (!transactions[i].value.eq(BigNumber.from(0))) {
        payment = {
          address: consts.gasToken,
          amount: transactions[i].value
        };
      } else if (payment.address == "0x") {
        console.error("PAYMENT HAS NOT RESOLVED");
        return;
      }
      addTradeToDatas(transfer, payment, datas, matches.length);
    });
  });

  return datas;
}
