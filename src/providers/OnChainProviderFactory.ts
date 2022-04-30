import { IOnChainProvider } from "../interfaces";
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

export class OnChainProviderFactory {
  static getOnChainProvider(name: Blockchain): IOnChainProvider {
    if (name in providers && name in chains) {
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
  return new ethers.providers.FallbackProvider(
    addresses.map(
      (a) => new ethers.providers.StaticJsonRpcProvider(a, { name, chainId })
    )
  );
}

export const providers = {
  [Blockchain.Ethereum]: createProvider(Blockchain.Ethereum),
} as unknown as {
  [chain in Blockchain]: Provider;
};

interface IOnChainProviderConstructable {
  new (...args: any): IOnChainProvider;
}

export const chains = {
  [Blockchain.Ethereum]: EthereumOnChainProvider,
} as unknown as {
  [chain in Blockchain]: IOnChainProviderConstructable;
};
