import Web3 from "web3";
import { BlockTransactionObject, Transaction } from "web3-eth";
import { ethers, BigNumber, Event } from "ethers";
import { LogDescription } from "@ethersproject/abi/lib/interface";
// import OPENSEA_ABI from "./opensea.abi.json";
// import { EventFragment } from "ethers/lib/utils";
import { getLogger } from "../utils/logger";
import { ChainProviders, IMarketOnChainProvider } from "../interfaces";
import {
  BaseMarketOnChainProviderFactory,
  ContractInstances,
  AbiInterfaces,
  InstantiatedMarket,
} from "./BaseMarketOnChainProvider";
import { MarketConfig } from "../markets";

const LOGGER = getLogger("opensea");

export class OpenSeaProvider implements IMarketOnChainProvider {
  public chains: ChainProviders;
  public contracts: ContractInstances;
  public interfaces: AbiInterfaces;

  constructor(config: MarketConfig) {
    const { chains, contracts, interfaces }: InstantiatedMarket =
      BaseMarketOnChainProviderFactory.instantiateMarket(config);
    this.chains = chains;
    this.contracts = contracts;
    this.interfaces = interfaces;
  }
}
