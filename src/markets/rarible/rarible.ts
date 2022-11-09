import { Event, ethers } from "ethers";
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
import { customMetricsReporter } from "../../utils/metrics";
import { ClusterWorker, IClusterProvider } from "../../utils/cluster";
import dynamodb from "../../utils/dynamodb";
import BaseProvider from "../BaseProvider";
import { Result } from "ethers/lib/utils";

const LOGGER = getLogger("RARIBLE_PROVIDER", {
  datadog: !!process.env.DATADOG_API_KEY
});
type MatchData = {
  transactionHash: string;
  buyer: string;
  seller: string;
  contractAddress: string;
  paymentAddress: string;
  tokenID: string;
};

let matchDatas: MatchData[];
const MATURE_BLOCK_AGE = process.env.MATURE_BLOCK_AGE
  ? parseInt(process.env.MATURE_BLOCK_AGE)
  : 250;
const BLOCK_RANGE = process.env.EVENT_BLOCK_RANGE
  ? parseInt(process.env.EVENT_BLOCK_RANGE)
  : 250;

function resultToObject(result?: Result) {
  return (
    result &&
    Object.entries(result).reduce((o, [k, v]) => {
      if (Number.isInteger(parseInt(k))) return o;
      if (Array.isArray(v)) {
        v = resultToObject(v);
      }
      o[k] = v;
      return o;
    }, {} as Record<string, any>)
  );
}

export default class RaribleProvider
  extends BaseProvider
  implements IMarketOnChainProvider, IClusterProvider
{
  public CONTRACT_NAME = "rarible";
  public market = Marketplace.Rarible;

  private shapeCount: Record<string, number> = {};
  private shapeTx: Record<string, string> = {};

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

  public async *fetchSales(): AsyncGenerator<ChainEvents> {
    // eslint-disable-next-line no-unreachable-loop
    for (const chain of Object.keys(this.chains) as Blockchain[]) {
      const { deployBlock, contractAddress, providerName, adapterRunName } =
        this.config.chains[chain];
      const currentBlock: number = await this.chains[
        chain
      ].getCurrentBlockNumber();
      const lastMatureBlock = currentBlock - MATURE_BLOCK_AGE;
      let { lastSyncedBlockNumber } = await AdapterState.getSalesAdapterState(
        Marketplace.Rarible,
        chain,
        true,
        deployBlock,
        adapterRunName ?? providerName
      );
      if (deployBlock && Number.isInteger(deployBlock)) {
        if (lastSyncedBlockNumber < deployBlock) {
          AdapterState.updateSalesLastSyncedBlockNumber(
            Marketplace.Rarible,
            deployBlock,
            chain,
            adapterRunName ?? providerName
          );
        }
        lastSyncedBlockNumber = Math.max(deployBlock, lastSyncedBlockNumber);
      }
      const contract = this.contracts[chain];
      const filterTopics = this.config.chains[chain].saleTopic
        ? [this.config.chains[chain].saleTopic]
        : this.contracts[chain].interface.encodeFilterTopics(
            this.contracts[chain].interface.getEvent(
              this.config.chains[chain].saleEventName
            ),
            []
          );

      if (lastMatureBlock - lastSyncedBlockNumber <= MATURE_BLOCK_AGE) {
        LOGGER.error(`Not enough mature blocks to scan.`, {
          currentBlock,
          lastMatureBlock,
          lastSyncedBlockNumber
        });
        return;
      }

      let retryCount = 0;
      let retryQuery = false;

      for (
        let i = 0;
        i < lastMatureBlock - lastSyncedBlockNumber;
        i += BLOCK_RANGE + 1
      ) {
        const fromBlock = lastSyncedBlockNumber + i;
        const toBlock =
          fromBlock + BLOCK_RANGE > currentBlock
            ? currentBlock
            : fromBlock + BLOCK_RANGE;

        LOGGER.debug("Searching blocks: ", {
          fromBlock,
          toBlock,
          range: toBlock - fromBlock
        });

        if (retryQuery) {
          LOGGER.warn(`Retrying query`, {
            fromBlock,
            toBlock,
            range: toBlock - fromBlock,
            retryCount
          });
        }

        try {
          const queryFilterStart = performance.now();
          const events: Array<Event> = (
            await contract.queryFilter(
              {
                address: contractAddress,
                topics: filterTopics
              },
              fromBlock,
              toBlock
            )
          ).filter((e) => !e.removed);
          const queryFilterEnd = performance.now();
          this.MetricsReporter.submit(
            `rarible.${chain}.contract_queryFilter.blockRange`,
            toBlock - fromBlock
          );
          this.MetricsReporter.submit(
            `rarible.${chain}.contract_queryFilter.latency`,
            queryFilterEnd - queryFilterStart
          );

          LOGGER.debug(
            `Found ${events.length} events between ${fromBlock} to ${toBlock}`
          );

          LOGGER.debug("Rarible Events", { fromBlock, toBlock, events });

          if (events.length) {
            matchDatas = await this.fetchMatchData(events);
            this.retrieveBlocks(fromBlock, toBlock, chain);
            const blocks = (
              await Promise.all(this.getBlockList(fromBlock, toBlock))
            ).reduce(
              (m: Record<string, Block>, b: Block) => ({
                ...m,
                [b.number.toString()]: b
              }),
              {} as Record<string, Block>
            );

            const receipts: TxReceiptsWithMetadata = {};
            const parsedEvents = this.parseEvents(events, chain);
            for (let i = 0; i < events.length; i++) {
              const event = events[i];
              const parsed = parsedEvents.filter(
                (pe) =>
                  pe &&
                  pe.hash === event.transactionHash &&
                  pe.logIndex === event.logIndex
              );

              if (!(event.transactionHash in receipts)) {
                receipts[event.transactionHash] = {
                  receipt: {
                    blockNumber: event.blockNumber,
                    transactionHash: event.transactionHash
                  } as ReceiptLike,
                  meta: [] as Array<EventMetadata>
                };
              }

              receipts[event.transactionHash].meta.push(...parsed);
            }

            yield {
              blocks,
              chain,
              events,
              blockRange: {
                startBlock: fromBlock,
                endBlock: toBlock
              },
              receipts,
              providerName,
              adapterRunName
            };
          } else {
            yield {
              chain,
              events,
              blockRange: {
                startBlock: fromBlock,
                endBlock: toBlock
              },
              providerName,
              adapterRunName
            };
          }

          retryCount = 0;
          retryQuery = false;
        } catch (e) {
          LOGGER.error(`Query error`, {
            error: /quorum/.test(e.message) ? `Quorum error` : e.message,
            reason: e.reason,
            fromBlock,
            toBlock,
            stack: e.stack.substr(0, 500)
          });
          if (retryCount < 3) {
            // try again
            retryCount++;
            i -= i - (BLOCK_RANGE + 1) < 0 ? i : BLOCK_RANGE + 1;
            retryQuery = true;
          } else if (retryCount > 3) {
            LOGGER.error(`Not able to recover from query errors`);
            throw new Error(`Not able to recover from query errors`);
          }
        }
      }
    }
  }
  private async fetchMatchData(events: Array<Event>): Promise<MatchData[]> {
    const provider = new ethers.providers.StaticJsonRpcProvider(
      "https://eth-mainnet.alchemyapi.io/v2/mVgetx4X8OxVRjV0qTRw6QtJKHd0VWh8"
    );
    const ABI = `[{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"hash","type":"bytes32"}],"name":"Cancel","type":"event"},
      {"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"leftHash","type":"bytes32"},{"indexed":false,"internalType":"bytes32",
      "name":"rightHash","type":"bytes32"},{"indexed":false,"internalType":"uint256","name":"newLeftFill","type":"uint256"},{"indexed":false,"internalType":"uint256",
      "name":"newRightFill","type":"uint256"}],"name":"Match","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes4","name":"assetType",
      "type":"bytes4"},{"indexed":false,"internalType":"address","name":"matcher","type":"address"}],"name":"MatcherChange","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes4","name":"assetType","type":"bytes4"},{"indexed":false,"internalType":"address","name":"proxy","type":"address"}],"name":"ProxyChange","type":"event"},{"inputs":[{"internalType":"address","name":"_transferProxy","type":"address"},{"internalType":"address","name":"_erc20TransferProxy","type":"address"},{"internalType":"uint256","name":"newProtocolFee","type":"uint256"},{"internalType":"address","name":"newDefaultFeeReceiver","type":"address"},{"internalType":"contract IRoyaltiesProvider","name":"newRoyaltiesProvider","type":"address"}],"name":"__ExchangeV2_init","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"components":[{"internalType":"address","name":"maker","type":"address"},{"components":[{"components":[{"internalType":"bytes4","name":"assetClass","type":"bytes4"},{"internalType":"bytes","name":"data","type":"bytes"}],"internalType":"struct LibAsset.AssetType","name":"assetType","type":"tuple"},{"internalType":"uint256","name":"value","type":"uint256"}],"internalType":"struct LibAsset.Asset","name":"makeAsset","type":"tuple"},{"internalType":"address","name":"taker","type":"address"},{"components":[{"components":[{"internalType":"bytes4","name":"assetClass","type":"bytes4"},{"internalType":"bytes","name":"data","type":"bytes"}],"internalType":"struct LibAsset.AssetType","name":"assetType","type":"tuple"},{"internalType":"uint256","name":"value","type":"uint256"}],"internalType":"struct LibAsset.Asset","name":"takeAsset","type":"tuple"},{"internalType":"uint256","name":"salt","type":"uint256"},{"internalType":"uint256","name":"start","type":"uint256"},{"internalType":"uint256","name":"end","type":"uint256"},{"internalType":"bytes4","name":"dataType","type":"bytes4"},{"internalType":"bytes","name":"data","type":"bytes"}],"internalType":"struct LibOrder.Order","name":"order","type":"tuple"}],"name":"cancel","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"components":[{"internalType":"address","name":"bidMaker","type":"address"},{"internalType":"uint256","name":"bidNftAmount","type":"uint256"},{"internalType":"bytes4","name":"nftAssetClass","type":"bytes4"},{"internalType":"bytes","name":"nftData","type":"bytes"},{"internalType":"uint256","name":"bidPaymentAmount","type":"uint256"},{"internalType":"address","name":"paymentToken","type":"address"},{"internalType":"uint256","name":"bidSalt","type":"uint256"},{"internalType":"uint256","name":"bidStart","type":"uint256"},{"internalType":"uint256","name":"bidEnd","type":"uint256"},{"internalType":"bytes4","name":"bidDataType","type":"bytes4"},{"internalType":"bytes","name":"bidData","type":"bytes"},{"internalType":"bytes","name":"bidSignature","type":"bytes"},{"internalType":"uint256","name":"sellOrderPaymentAmount","type":"uint256"},{"internalType":"uint256","name":"sellOrderNftAmount","type":"uint256"},{"internalType":"bytes","name":"sellOrderData","type":"bytes"}],"internalType":"struct LibDirectTransfer.AcceptBid","name":"direct","type":"tuple"}],"name":"directAcceptBid","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"components":[{"internalType":"address","name":"sellOrderMaker","type":"address"},{"internalType":"uint256","name":"sellOrderNftAmount","type":"uint256"},{"internalType":"bytes4","name":"nftAssetClass","type":"bytes4"},{"internalType":"bytes","name":"nftData","type":"bytes"},{"internalType":"uint256","name":"sellOrderPaymentAmount","type":"uint256"},{"internalType":"address","name":"paymentToken","type":"address"},{"internalType":"uint256","name":"sellOrderSalt","type":"uint256"},{"internalType":"uint256","name":"sellOrderStart","type":"uint256"},{"internalType":"uint256","name":"sellOrderEnd","type":"uint256"},{"internalType":"bytes4","name":"sellOrderDataType","type":"bytes4"},{"internalType":"bytes","name":"sellOrderData","type":"bytes"},{"internalType":"bytes","name":"sellOrderSignature","type":"bytes"},{"internalType":"uint256","name":"buyOrderPaymentAmount","type":"uint256"},{"internalType":"uint256","name":"buyOrderNftAmount","type":"uint256"},{"internalType":"bytes","name":"buyOrderData","type":"bytes"}],"internalType":"struct LibDirectTransfer.Purchase","name":"direct","type":"tuple"}],"name":"directPurchase","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"fills","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"components":[{"internalType":"address","name":"maker","type":"address"},{"components":[{"components":[{"internalType":"bytes4","name":"assetClass","type":"bytes4"},{"internalType":"bytes","name":"data","type":"bytes"}],"internalType":"struct LibAsset.AssetType","name":"assetType","type":"tuple"},{"internalType":"uint256","name":"value","type":"uint256"}],"internalType":"struct LibAsset.Asset","name":"makeAsset","type":"tuple"},{"internalType":"address","name":"taker","type":"address"},{"components":[{"components":[{"internalType":"bytes4","name":"assetClass","type":"bytes4"},{"internalType":"bytes","name":"data","type":"bytes"}],"internalType":"struct LibAsset.AssetType","name":"assetType","type":"tuple"},{"internalType":"uint256","name":"value","type":"uint256"}],"internalType":"struct LibAsset.Asset","name":"takeAsset","type":"tuple"},{"internalType":"uint256","name":"salt","type":"uint256"},{"internalType":"uint256","name":"start","type":"uint256"},{"internalType":"uint256","name":"end","type":"uint256"},{"internalType":"bytes4","name":"dataType","type":"bytes4"},{"internalType":"bytes","name":"data","type":"bytes"}],"internalType":"struct LibOrder.Order","name":"orderLeft","type":"tuple"},{"internalType":"bytes","name":"signatureLeft","type":"bytes"},{"components":[{"internalType":"address","name":"maker","type":"address"},{"components":[{"components":[{"internalType":"bytes4","name":"assetClass","type":"bytes4"},{"internalType":"bytes","name":"data","type":"bytes"}],"internalType":"struct LibAsset.AssetType","name":"assetType","type":"tuple"},{"internalType":"uint256","name":"value","type":"uint256"}],"internalType":"struct LibAsset.Asset","name":"makeAsset","type":"tuple"},{"internalType":"address","name":"taker","type":"address"},{"components":[{"components":[{"internalType":"bytes4","name":"assetClass","type":"bytes4"},{"internalType":"bytes","name":"data","type":"bytes"}],"internalType":"struct LibAsset.AssetType","name":"assetType","type":"tuple"},{"internalType":"uint256","name":"value","type":"uint256"}],"internalType":"struct LibAsset.Asset","name":"takeAsset","type":"tuple"},{"internalType":"uint256","name":"salt","type":"uint256"},{"internalType":"uint256","name":"start","type":"uint256"},{"internalType":"uint256","name":"end","type":"uint256"},{"internalType":"bytes4","name":"dataType","type":"bytes4"},{"internalType":"bytes","name":"data","type":"bytes"}],"internalType":"struct LibOrder.Order","name":"orderRight","type":"tuple"},{"internalType":"bytes","name":"signatureRight","type":"bytes"}],"name":"matchOrders","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"royaltiesRegistry","outputs":[{"internalType":"contract IRoyaltiesProvider","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes4","name":"assetType","type":"bytes4"},{"internalType":"address","name":"matcher","type":"address"}],"name":"setAssetMatcher","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IRoyaltiesProvider","name":"newRoyaltiesRegistry","type":"address"}],"name":"setRoyaltiesRegistry","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"assetType","type":"bytes4"},{"internalType":"address","name":"proxy","type":"address"}],"name":"setTransferProxy","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"}]`;
    const iface = new ethers.utils.Interface(ABI);
    const transactions = await Promise.all(
      events.map((e: Event) => provider.getTransaction(e.transactionHash))
    );
    return transactions.map((t: any) => {
      const data = iface.parseTransaction(t);
      return {
        transactionHash: t.hash,
        buyer: t.from,
        contractAddress: `0x${data.args.direct.nftData.substring(26, 66)}`,
        paymentAddress: data.args.direct.paymentToken,
        seller: data.args.direct.sellOrderMaker,
        tokenID: parseInt(data.args.direct.nftData.substring(66), 16).toString()
      };
    });
  }

  public parseEvents(
    events: Array<Event>,
    chain: Blockchain
  ): Array<EventMetadata> {
    const meta: Array<EventMetadata> = [];
    for (const event of events) {
      const matchData = matchDatas.find(
        (d: MatchData) => d.transactionHash == event.transactionHash
      );

      const parsed = this.parseLog(event, chain);

      meta.push({
        buyer: matchData.buyer,
        contract: "rarible",
        contractAddress: matchData.contractAddress,
        eventSignatures: [event.eventSignature],
        hash: event.transactionHash,
        logIndex: event.logIndex,
        payment: {
          address: matchData.paymentAddress,
          amount: parsed.decodedData.newLeftFill
        },
        price: parsed.decodedData.newLeftFill,
        seller: matchData.seller,
        tokenID: matchData.tokenID,
        blockNumber: event.blockNumber,
        count: parsed.decodedData.newRightFill,
        data: resultToObject(parsed.decodedData)
      });
    }
    return meta;
  }
}
