import { IOnChainProvider } from "src/interfaces";
import { Provider } from "@ethersproject/abstract-provider";
import { Blockchain } from "../types";
import { EthereumOnChainProvider } from "./EthereumOnChainProvider";
import { ethers } from "ethers";
import rpcAddresses from "../rpcAddresses.json";

type Rpc = {
  address: Blockchain;
  chainId: number;
};

type Rpcs = {
  [chain in Blockchain]: Rpc;
};

export const Addresses = rpcAddresses as unknown as Rpcs;

export abstract class BaseOnChainProvider implements IOnChainProvider {
  private chainProvider: Provider;

  constructor(chainProvider: Provider) {
    this.chainProvider = chainProvider;
  }

  static getOnChainProvider(name: Blockchain): IOnChainProvider {
    if (name in providers && name in ) {
      return new chains[name](providers[name]);
    }
    return null;
  }
}

function getRpcAddress(chain: Blockchain, defaultAddress: string) {
  return process.env[`${chain.toUpperCase()}_RPC`] ?? defaultAddress;
}

function createProvider(name: Blockchain) {
  const { address, chainId } = Addresses[name];
  const addresses = getRpcAddress(name, address).split(/,/);
  return new ethers.providers.FallbackProvider(addresses.map(a => 
    new ethers.providers.StaticJsonRpcProvider(a, { name, chainId })
  ));
}

export const providers = {
  [Blockchain.Ethereum]: createProvider(Blockchain.Ethereum),
} as unknown as {
  [chain in Blockchain]: Provider;
};

export const chains = {
  [Blockchain.Ethereum]: EthereumOnChainProvider,
} as {
  [chain in Blockchain]: IOnChainProvider;
};