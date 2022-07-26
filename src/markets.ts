import { OwnableStandard } from "./constants";
import { Blockchain, Marketplace, HumanABI } from "./types";

export type MarketChainConfig = {
  enabled: boolean;
  provider: string;
  contractAddress: string;
  abi: HumanABI;
  saleEventName?: string;
  saleTopic?: string;
  deploymentEventName: string;
  deployBlock?: number;
};

export type MarketChainsConfig = Partial<Record<Blockchain, MarketChainConfig>>;
export type MarketMultiContractConfig = Partial<
  Record<Blockchain, Array<MarketChainConfig>>
>;

export type MultiMarketConfig = {
  chains: MarketMultiContractConfig;
};

export type MarketConfig = {
  chains: MarketChainsConfig;
};

const markets: Partial<Record<Marketplace, MultiMarketConfig>> = {
  [Marketplace.Opensea]: {
    chains: {
      [Blockchain.Ethereum]: [
        {
          enabled: false,
          provider: "wyvern",
          deployBlock: 5774644,
          contractAddress: "0x7Be8076f4EA4A4AD08075C2508e481d6C946D12b",
          saleEventName: "OrdersMatched",
          deploymentEventName: "OwnershipTransferred",
          abi: [
            ...OwnableStandard,
            "event OrdersMatched (bytes32 buyHash, bytes32 sellHash, address indexed maker, address indexed taker, uint price, bytes32 indexed metadata)",
          ],
        },
        {
          enabled: false,
          provider: "wyvern",
          // deployBlock: 14190913,
          deployBlock: 14232083,
          contractAddress: "0x7f268357a8c2552623316e2562d90e642bb538e5",
          saleEventName: "OrdersMatched",
          deploymentEventName: "OwnershipTransferred",
          abi: [
            ...OwnableStandard,
            "event OrdersMatched (bytes32 buyHash, bytes32 sellHash, address indexed maker, address indexed taker, uint price, bytes32 indexed metadata)",
          ],
        },
        {
          enabled: true,
          provider: "seaport",
          deployBlock: 14946474,
          contractAddress: "0x00000000006c3852cbEf3e08E8dF289169EdE581",
          saleEventName: "OrderFulfilled",
          saleTopic:
            "0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31",
          deploymentEventName: "OwnershipTransferred",
          abi: `[{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"orderHash","type":"bytes32"},{"indexed":true,"internalType":"address","name":"offerer","type":"address"},{"indexed":true,"internalType":"address","name":"zone","type":"address"},{"indexed":false,"internalType":"address","name":"recipient","type":"address"},{"components":[{"internalType":"enum ItemType","name":"itemType","type":"uint8"},{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"identifier","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"}],"indexed":false,"internalType":"struct SpentItem[]","name":"offer","type":"tuple[]"},{"components":[{"internalType":"enum ItemType","name":"itemType","type":"uint8"},{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"identifier","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"address payable","name":"recipient","type":"address"}],"indexed":false,"internalType":"struct ReceivedItem[]","name":"consideration","type":"tuple[]"}],"name":"OrderFulfilled","type":"event"}]`,
        },
      ],
    },
  },
};

export const OpenSea = markets[Marketplace.Opensea];

export default markets;
