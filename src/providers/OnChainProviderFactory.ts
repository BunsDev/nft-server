import { IOnChainProvider } from "../interfaces";
import { Provider } from "@ethersproject/abstract-provider";
import { Blockchain } from "../types";
import { EthereumOnChainProvider } from "./EthereumOnChainProvider";
import { ethers } from "ethers";
import rpcAddresses from "../rpcAddresses.json";

console.log(process.env.ETHEREUM_RPC);

type Rpc = {
  address: Blockchain;
  chainId: number;
};

type Rpcs = Partial<Record<Blockchain, Rpc>>;

export const Addresses = rpcAddresses as Rpcs;
export type ChainProviders = Partial<
  Record<Blockchain, IOnChainProvider<Provider>>
>;
export type Providers<T> = Partial<Record<Blockchain, T>>;
export interface ConstructableChainProvider<T> {
  new (arg: T): IOnChainProvider<T>;
}
export type ChainsRecord = Partial<Record<Blockchain, unknown>>;

export class OnChainProviderFactory {
  static getOnChainProvider<T>(name: Blockchain): IOnChainProvider<T> {
    if (name in providers && name in chains) {
      return new (chains[name] as unknown as ConstructableChainProvider<T>)(
        providers[name] as T
      );
    }
    return null;
  }
}

function getRpcAddress(chain: Blockchain, defaultAddress: string) {
  return process.env[`${chain.toUpperCase()}_RPC`] ?? defaultAddress;
}

function createProvider<T>(name: Blockchain, klass: unknown): T {
  const { address, chainId } = Addresses[name];
  const addresses = getRpcAddress(name, address).split(/,/);
  switch (true) {
    case Object.is(klass, Provider):
      return new ethers.providers.FallbackProvider(
        addresses.map(
          (a) =>
            new ethers.providers.StaticJsonRpcProvider(a, { name, chainId })
        )
      ) as unknown as T;
    default:
      throw new Error("unsupported chain provider");
  }
}

export const providers: Providers<unknown> = {
  [Blockchain.Ethereum]: createProvider<Provider>(
    Blockchain.Ethereum,
    Provider
  ) as Provider,
};

export const chains: ChainsRecord = {
  [Blockchain.Ethereum]: EthereumOnChainProvider,
};
