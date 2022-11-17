import { BigNumber, Event } from "ethers";
import { getLogger } from "../../utils/logger";
import { IMarketOnChainProvider } from "../../interfaces";
import {
  ChainEvents,
  EventMetadata,
  TxReceiptsWithMetadata,
  ReceiptLike
} from "../BaseMarketOnChainProvider";
import { Blockchain, Marketplace } from "../../types";
import { AdapterState } from "../../models";
import { Block } from "@ethersproject/providers";
import {
  MetricsReporter as DefaultMetricsReporter,
  customMetricsReporter
} from "../../utils/metrics";
import { ClusterWorker, IClusterProvider } from "../../utils/cluster";
import dynamodb from "../../utils/dynamodb";
import BaseProvider from "../BaseProvider";

// const LOGGER = getLogger("X2Y2_PROVIDER", {
//   datadog: !!process.env.DATADOG_API_KEY
// });

type TokenEventMetadataMap = Record<string, EventMetadata>;

export default class X2y2Provider
  extends BaseProvider
  implements IMarketOnChainProvider, IClusterProvider
{
  public CONTRACT_NAME = "x2y2";
  public market = Marketplace.X2y2;

  public withWorker(worker: ClusterWorker): void {
    super.withWorker(worker);
    this.MetricsReporter = customMetricsReporter("", "", [
      `worker:${worker.uuid}`
    ]);
  }

  public async dispatchWorkMethod(
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    return Promise.reject(new Error("Not implemented"));
  }

  public parseEvents(
    events: Array<Event>,
    chain: Blockchain
  ): Array<EventMetadata> {
    const { providerName } = this.config.chains[chain];
    const meta: Array<EventMetadata> = [];
    const transferTopics: Transfer[] = [];
    events = events.filter(
      (e) =>
        e.transactionHash ==
        "0x4684edf0c9a7b615a15bf8d57f10f3937cf7f6f699cbcb53f201fcaa955bcf17"
    );
    fetchTransferTopics(chain, events).then((r) => transferTopics.push(r));
    for (const event of events) {
      const parsed = this.parseLog(event, chain);
      const { currency, amount, to } = parsed.decodedData;
      const transferTopic = transferTopics.find(
        (t) => (t.transactionHash = event.transactionHash)
      );

      // LOGGER.debug(`X2y2 Event`, {
      //   saleEvent,
      //   buyer,
      //   seller,
      //   collection,
      //   currency,
      //   tokenId,
      //   amount,
      //   price,
      //   parsed,
      //   event
      // });

      // buyer, contract, price, tokenId, count, bundle,
      meta.push({
        buyer: transferTopic.buyer, // 0x33a34e27a81436ba9d79276406a285e89a8bd8a8
        seller: to,
        contractAddress: transferTopic.contractAddress, //collection, // 0xDA4c9FFB9a96ef44865114Be4af25004f0eE385d
        eventSignatures: [event.eventSignature],
        payment: {
          address: currency,
          amount
        },
        price: amount,
        tokenID: transferTopic.tokenId, //tokenId.toString(), // 6275
        count: transferTopic.count, // 1
        data: {
          parsed,
          event
        },
        hash: event.transactionHash,
        contract: providerName,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        bundleSale: false
      });
    }
    return meta;
  }
}
type Transfer = {
  transactionHash: string;
  buyer: string;
  contractAddress: string;
  tokenId: string;
  count: number;
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
const unknownPayment: Payment = { address: "0x", amount: BigNumber.from(0) };
const consts: any = {
  transferTopic:
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
};
async function fetchTransferTopics(
  chain: Blockchain,
  events: Array<Event>
): Promise<Transfer> {
  const provider = this.chains[chain].provider;
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
      console.log("bang");
    }
  });
  return {
    transactionHash: "",
    buyer: "",
    contractAddress: "",
    tokenId: "",
    count: 1
  };
}
