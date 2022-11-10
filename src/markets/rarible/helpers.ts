import consts from "./constants.json";
import { Event, ethers, BigNumber } from "ethers";
require("dotenv").config();

export type MatchData = {
  transactionHash: string;
  buyer: string;
  seller: string;
  contractAddress: string;
  tokenID: string;
  payment: Payment;
};
type Payment = {
  address: string;
  amount: BigNumber;
};

function filterTransfers(
  matches: any,
  transfers: any,
  payment: Payment
): any[] {
  if (matches.length > 1) {
    console.log("MATCHES DONT CORRESPOND TO TRANSFERS");
    return;
  }
  let max = transfers[0].value;
  transfers.map((t: any) => (max = t.value > max ? t.value : max));
  const erc20Transfer = transfers.find((t: any) => t.value == max);
  payment = {
    address: erc20Transfer.address,
    amount: BigNumber.from(erc20Transfer.data)
  };
  const nonErc20Transfers = transfers.filter(
    (t: any) => t.address != payment.address
  );
  return [nonErc20Transfers, payment];
}

function addTradeToDatas(
  transfer: any,
  payment: Payment,
  datas: MatchData[]
): void {
  const newEntry = {
    transactionHash: transfer.transactionHash,
    buyer: `0x${transfer.topics[2].substring(26, 66)}`,
    contractAddress: transfer.address,
    payment,
    seller: `0x${transfer.topics[1].substring(26, 66)}`,
    tokenID: parseInt(transfer.topics[3], 16).toString()
  };
  if (
    datas.find(
      (d) =>
        d.transactionHash == newEntry.transactionHash &&
        d.tokenID == newEntry.tokenID &&
        d.contractAddress == newEntry.contractAddress
    ) == null
  )
    datas.push(newEntry);
}

export async function fetchMatchData(
  events: Array<Event>
): Promise<MatchData[]> {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    process.env.ETHEREUM_RPC
  );

  const datas: MatchData[] = [];
  const topics = await Promise.all(
    events.map((e: Event) => e.getTransactionReceipt())
  );
  const transactions = await Promise.all(
    events.map((e: Event) => provider.getTransaction(e.transactionHash))
  );

  topics.map((topic: any, i: number) => {
    let payment: Payment = { address: "0x", amount: BigNumber.from(0) };

    let transfers = topic.logs.filter(
      (log: any) =>
        log.topics[0] == consts.transferTopic &&
        log.topics[1] != consts.nullAddress
    );
    const matches = topic.logs.filter(
      (log: any) => log.topics[0] == consts.matchTopic
    );

    if (matches.length != transfers.length) {
      [transfers, payment] = filterTransfers(matches, transfers, payment);
    }

    transfers.map((transfer: any) => {
      if (transactions[i].value != BigNumber.from(0)) {
        payment = { address: consts.gasToken, amount: transactions[i].value };
      } else if ((payment.address = "0x")) {
        console.log("PAYMENT HAS NOT RESOLVED");
        return;
      }
      addTradeToDatas(transfer, payment, datas);
    });
  });

  return datas;
}
