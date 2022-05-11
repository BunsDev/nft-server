import { ethers, BigNumber, Event } from "ethers";
import { Interface, LogDescription } from "@ethersproject/abi/lib/interface";
// import OPENSEA_ABI from "./opensea.abi.json";
// import { EventFragment } from "ethers/lib/utils";
import { getLogger } from "../utils/logger";
import { IMarketOnChainProvider } from "../interfaces";
import {
  BaseMarketOnChainProviderFactory,
  ContractInstances,
  AbiInterfaces,
  MarketProviders,
  ChainTopics,
  SaleEvents,
  ChainEvents,
  EventMetadata,
  TxReceiptsWithMetadata,
  EventLogType,
  LogType,
} from "./BaseMarketOnChainProvider";
import { MarketConfig } from "../markets";
import { ChainProviders } from "../providers/OnChainProviderFactory";
import { Blockchain, Marketplace } from "../types";
import { AdapterState } from "../models";
import { TransactionReceipt, Log } from "@ethersproject/providers";
import {
  IERC1155Standard,
  IERC20Standard,
  IERC721Standard,
} from "../constants";
import { ParseErrors, UnparsableLogError } from "../utils/UnparsableLogError";

const LOGGER = getLogger("opensea");

const MATURE_BLOCK_AGE = 250;
const EARLIEST_BLOCK = 4797962;
const BLOCK_RANGE = 100;

/**
 * OS Market Chain Provider
 *
 * Not completely fleshed out just yet, and there is a lot of
 * work to be done to have this be more genric. Many of the EVM
 * based chain details have creeped in (i.e. parsing logs).
 *
 * General idea with a market provider is an extension of chain
 * providers (i.e. RpcJsonProvider), and are meant to be interfaces
 * for interpreting on-chain events for a specific market that is then
 * generalized for the adapter. Other market providers should also
 * implement IMarketOnChainProvider, but that is subject to change as
 * it may be possible to create a generic market provider that will work
 * for the majority of marketplaces, so long as they follow the same
 * general outline of OS for example.
 */

export class OpenSeaProvider implements IMarketOnChainProvider {
  public static ERC721ContractInterface = new ethers.utils.Interface(
    IERC721Standard
  );

  public static ERC1155ContractInterface = new ethers.utils.Interface(
    IERC1155Standard
  );

  public static ERC20ContractInterface = new ethers.utils.Interface(
    IERC20Standard
  );

  public chains: ChainProviders;
  public contracts: ContractInstances;
  public interfaces: AbiInterfaces;
  public topics: ChainTopics;
  public events: SaleEvents;
  public config: MarketConfig;

  constructor(config: MarketConfig) {
    const { chains, contracts, interfaces, topics }: MarketProviders =
      BaseMarketOnChainProviderFactory.createMarketProviders(config);
    this.config = config;
    this.chains = chains;
    this.contracts = contracts;
    this.interfaces = interfaces;
    this.topics = topics;
  }

  public async *fetchSales(): AsyncGenerator<ChainEvents> {
    // eslint-disable-next-line no-unreachable-loop
    for (const chain of Object.keys(this.chains) as Blockchain[]) {
      const { deployBlock, contractAddress } = this.config.chains[chain];
      const currentBlock: number = await this.chains[
        chain
      ].getCurrentBlockNumber();
      let { lastSyncedBlockNumber } = await AdapterState.getSalesAdapterState(
        Marketplace.Opensea,
        chain,
        true,
        deployBlock
      );
      if (deployBlock && Number.isInteger(deployBlock)) {
        if (lastSyncedBlockNumber < deployBlock) {
          AdapterState.updateSalesLastSyncedBlockNumber(
            Marketplace.Opensea,
            deployBlock
          );
        }
        lastSyncedBlockNumber = Math.max(deployBlock, lastSyncedBlockNumber);
      }
      const contract = this.contracts[chain];
      const filterTopics = this.contracts[chain].interface.encodeFilterTopics(
        this.contracts[chain].interface.getEvent(
          this.config.chains[chain].saleEventName
        ),
        []
      );
      // eslint-disable-next-line no-unreachable-loop
      for (
        let i = -1;
        i < currentBlock - lastSyncedBlockNumber;
        i += BLOCK_RANGE
      ) {
        const fromBlock = lastSyncedBlockNumber + i + 1;
        const toBlock = fromBlock + BLOCK_RANGE - 1;
        const events: Array<Event> = (
          await contract.queryFilter(
            {
              address: contractAddress,
              topics: filterTopics,
            },
            fromBlock,
            toBlock
          )
        ).filter((e) => !e.removed);
        console.log(`Searching ${toBlock - fromBlock} blocks`);
        console.log(
          `Found ${events.length} events between ${fromBlock} to ${toBlock}`
        );
        if (events.length) {
          yield {
            chain,
            events,
            blockRange: {
              startBlock: fromBlock,
              endBlock: toBlock,
            },
            receipts: await this.getEventReceipts(events, chain),
          };
        }
      }
      break;
    }
  }

  public async getEventReceipts(
    events: Array<Event>,
    chain: Blockchain
  ): Promise<TxReceiptsWithMetadata> {
    const receipts: TxReceiptsWithMetadata = {};
    // return receipts;
    for (const event of events) {
      if (!(event.transactionHash in receipts)) {
        const receipt: TransactionReceipt = await event.getTransactionReceipt();
        receipts[event.transactionHash] = {
          receipt,
          meta: this.getEventMetadata(event, receipt, chain),
        };
      }
    }
    return receipts;
  }

  public getEventMetadata(
    event: Event,
    receipt: TransactionReceipt,
    chain = Blockchain.Ethereum,
    skipStandard = false
  ): EventMetadata {
    const { logs } = receipt;
    const { maker, taker, price } = event.args;
    const eventMetadata: EventMetadata = {
      contractAddress: null,
      eventSignatures: [],
      maker,
      taker,
      price,
    };

    // Standard ETH OS NFT buy, we should have one
    // Approval and one Transfer log, unless we skipStandard
    // which means we uncovered something unconventional
    try {
      const parsedLogs: EventLogType[] = logs.map((l) =>
        this.parseLog(l, chain)
      );
      const { eventNames, eventSigs } = this.extractParsedLogs(parsedLogs);
      eventMetadata.eventSignatures = eventSigs;
      if (logs.length === 3 && !skipStandard) {
        // very simple and shallow test, and we can do better
        if (eventNames.join() !== this.getStandardSaleEvents(chain)) {
          console.log(
            "Skipping standard",
            receipt.transactionHash,
            eventNames,
            this.getStandardSaleEvents(chain)
          );
          return this.getEventMetadata(event, receipt, chain, true);
        }
        eventMetadata.contractAddress = logs[0].address;
      }
      // this could be OS storefront sale
      else if (logs.length === 2 && !skipStandard) {
        if (eventNames.join() !== this.getStandardOSStorefrontSale(chain)) {
          console.log(
            "Skipping standard OS storefront",
            receipt.transactionHash,
            eventNames,
            this.getStandardOSStorefrontSale(chain)
          );
          return this.getEventMetadata(event, receipt, chain, true);
        }
        eventMetadata.contractAddress = logs[0].address;
      } else {
        if (!maker || !taker || !price) return null;
      }
    } catch (e) {
      console.log(e);
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      return eventMetadata;
    }
  }

  public extractParsedLogs(parsedLogs: EventLogType[]) {
    return parsedLogs.reduce(
      (c, l) => {
        c.eventNames.push(l.log.name);
        c.eventSigs.push(l.log.signature);
        return c;
      },
      {
        eventNames: [],
        eventSigs: [],
      }
    );
  }

  public getStandardOSStorefrontSale(chain: Blockchain) {
    return ["TransferSingle", this.config.chains[chain].saleEventName].join();
  }

  public getStandardSaleEvents(chain: Blockchain) {
    return [
      "Approval",
      "Transfer",
      this.config.chains[chain].saleEventName,
    ].join();
  }

  public parseLog(log: Log, chain: Blockchain): EventLogType {
    const errors: ParseErrors = {};
    const parsers: Partial<Record<LogType | Marketplace, Interface>> = {
      [LogType.ERC721]: OpenSeaProvider.ERC721ContractInterface,
      [LogType.ERC1155]: OpenSeaProvider.ERC1155ContractInterface,
      [LogType.ERC20]: OpenSeaProvider.ERC20ContractInterface,
      [Marketplace.Opensea]: this.contracts[chain].interface,
    };

    const parsed: EventLogType = { log: null, type: null };
    for (const lType of Object.keys(parsers) as LogType[] | Marketplace[]) {
      try {
        parsed.log = parsers[lType].parseLog(log);
        parsed.type = lType;
        break;
      } catch (e) {
        errors[lType] = e;
      }
    }

    if (Object.keys(errors).length === Object.keys(parsers).length) {
      throw new UnparsableLogError(log, errors);
    }

    return parsed;
  }
}
