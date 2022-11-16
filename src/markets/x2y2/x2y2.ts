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

const LOGGER = getLogger("LOOKSRARE_PROVIDER", {
  datadog: !!process.env.DATADOG_API_KEY
});

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
    for (const event of events) {
      const parsed = this.parseLog(event, chain);
      const { currency, tokenId, amount, price, collection } =
        parsed.decodedData;

      const saleEvent = event.event;
      const { buyer, seller } =
        saleEvent === "TakerBid"
          ? { buyer: event.args[2], seller: event.args[3] }
          : { buyer: event.args[3], seller: event.args[2] };

      LOGGER.debug(`X2y2 Event`, {
        saleEvent,
        buyer,
        seller,
        collection,
        currency,
        tokenId,
        amount,
        price,
        parsed,
        event
      });

      meta.push({
        buyer,
        seller,
        contractAddress: collection,
        eventSignatures: [event.eventSignature],
        payment: {
          address: currency,
          amount: price
        },
        price: price,
        tokenID: tokenId.toString(),
        count: amount.toString(),
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
