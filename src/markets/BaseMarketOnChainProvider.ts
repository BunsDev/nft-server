import { OnChainProviderFactory } from "../providers/OnChainProviderFactory";
import {
  ChainProviders,
  IMarketOnChainProvider,
  IOnChainProvider,
  MarketChainProviders,
} from "../interfaces";
import { Blockchain } from "../types";
import { Contract, ethers } from "ethers";
import { MarketConfig, MarketChainsConfig } from "../markets";
import { Interface } from "@ethersproject/abi";

export type ContractInstances = Partial<Record<Blockchain, Contract>>;
export type AbiInterfaces = Partial<Record<Blockchain, Interface>>;
export type InstantiatedMarket = {
  chains: ChainProviders;
  contracts: ContractInstances;
  interfaces: AbiInterfaces;
};

export class BaseMarketOnChainProviderFactory {
  public static instantiateMarket(config: MarketConfig): InstantiatedMarket {
    const chains = self().createChainProviders(
      Object.keys(config.chains) as Blockchain[]
    );
    const contracts = self().getContracts(config.chains, chains);
    const interfaces = self().getInterfaces(config.chains);
    return {
      chains,
      contracts,
      interfaces,
    };
  }

  static getInterfaces(chains: MarketChainsConfig) {
    return (Object.keys(chains) as Blockchain[]).reduce((carry, chain) => {
      carry[chain] = new ethers.utils.Interface(chains[chain].abi);
      return carry;
    }, {} as AbiInterfaces);
  }

  public static createChainProviders(
    chains: MarketChainProviders
  ): ChainProviders {
    return chains.reduce((carry, chain) => {
      carry[chain] = self().instantiateChainProvider(chain);
      return carry;
    }, {} as ChainProviders);
  }

  public static getContracts(
    chains: MarketChainsConfig,
    providers: ChainProviders
  ): ContractInstances {
    return (Object.keys(chains) as Blockchain[]).reduce((carry, chain) => {
      carry[chain] = new ethers.Contract(
        chains[chain].contractAddress,
        chains[chain].abi,
        providers[chain].provider
      );
      return carry;
    }, {} as ContractInstances);
  }

  public static instantiateChainProvider(chain: Blockchain): IOnChainProvider {
    return OnChainProviderFactory.getOnChainProvider(chain);
  }
}

function self() {
  return BaseMarketOnChainProviderFactory;
}
