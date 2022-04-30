import { Blockchain, Marketplace } from "./types";

export type MarketChainConfig = {
  contractAddress: string;
  abi: string[];
};

export type MarketConfig = {
  chains: Partial<Record<Blockchain, MarketChainConfig>>;
};

export type MarketChainsConfig = Partial<Record<Blockchain, MarketChainConfig>>;

const markets: Partial<Record<Marketplace, MarketConfig>> = {
  [Marketplace.Opensea]: {
    chains: {
      [Blockchain.Ethereum]: {
        contractAddress: "0x7f268357a8c2552623316e2562d90e642bb538e5",
        abi: [
          "event OrdersMatched (bytes32 buyHash, bytes32 sellHash, address indexed maker, address indexed taker, uint price, bytes32 indexed metadata)"
        ],
      },
    },
  },
};

export const OpenSea = markets[Marketplace.Opensea];

export default markets;
