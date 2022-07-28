import { OwnableStandard } from "./constants";
import { Blockchain, Marketplace, HumanABI } from "./types";

export type MarketChainConfig = {
  enabled: boolean;
  providerName: string;
  contractAddress: string;
  abi: HumanABI;
  saleEventName?: string;
  saleTopic?: string;
  deploymentEventName: string;
  deployBlock?: number;
  cluster: boolean;
  erc20Tokens: Array<string>;
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

const OS_WYVERN_TOKENS = [
  "0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA",
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
];

const markets: Partial<Record<Marketplace, MultiMarketConfig>> = {
  [Marketplace.Opensea]: {
    chains: {
      [Blockchain.Ethereum]: [
        {
          enabled: true,
          cluster: true,
          providerName: "wyvern_1",
          deployBlock: 5774644,
          contractAddress: "0x7Be8076f4EA4A4AD08075C2508e481d6C946D12b",
          saleEventName: "OrdersMatched",
          deploymentEventName: "OwnershipTransferred",
          abi: [
            ...OwnableStandard,
            "event OrdersMatched (bytes32 buyHash, bytes32 sellHash, address indexed maker, address indexed taker, uint price, bytes32 indexed metadata)",
          ],
          erc20Tokens: OS_WYVERN_TOKENS,
        },
        {
          enabled: true,
          cluster: true,
          providerName: "wyvern_2",
          // deployBlock: 14190913,
          deployBlock: 14232083,
          contractAddress: "0x7f268357a8c2552623316e2562d90e642bb538e5",
          saleEventName: "OrdersMatched",
          deploymentEventName: "OwnershipTransferred",
          abi: [
            ...OwnableStandard,
            "event OrdersMatched (bytes32 buyHash, bytes32 sellHash, address indexed maker, address indexed taker, uint price, bytes32 indexed metadata)",
          ],
          erc20Tokens: OS_WYVERN_TOKENS,
        },
        {
          enabled: true,
          cluster: false,
          providerName: "seaport",
          deployBlock: 14946474,
          contractAddress: "0x00000000006c3852cbEf3e08E8dF289169EdE581",
          saleEventName: "OrderFulfilled",
          saleTopic:
            "0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31",
          deploymentEventName: "OwnershipTransferred",
          abi: `[{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"orderHash","type":"bytes32"},{"indexed":true,"internalType":"address","name":"offerer","type":"address"},{"indexed":true,"internalType":"address","name":"zone","type":"address"},{"indexed":false,"internalType":"address","name":"recipient","type":"address"},{"components":[{"internalType":"enum ItemType","name":"itemType","type":"uint8"},{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"identifier","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"}],"indexed":false,"internalType":"struct SpentItem[]","name":"offer","type":"tuple[]"},{"components":[{"internalType":"enum ItemType","name":"itemType","type":"uint8"},{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"identifier","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"address payable","name":"recipient","type":"address"}],"indexed":false,"internalType":"struct ReceivedItem[]","name":"consideration","type":"tuple[]"}],"name":"OrderFulfilled","type":"event"}]`,
          erc20Tokens: OS_WYVERN_TOKENS,
        },
      ],
    },
  },
  [Marketplace.LooksRare]: {
    chains: {
      [Blockchain.Ethereum]: [
        {
          enabled: true,
          cluster: false,
          providerName: "looksrare_bid",
          deployBlock: 13885625,
          contractAddress: "0x59728544B08AB483533076417FbBB2fD0B17CE3a",
          saleEventName: "TakerBid",
          deploymentEventName: "OwnershipTransferred",
          abi: [
            "event TakerBid(bytes32 orderHash, uint256 orderNonce, address indexed taker, address indexed maker, address indexed strategy, address currency, address collection, uint256 tokenId, uint256 amount, uint256 price)",
          ],
          erc20Tokens: [],
        },
        {
          enabled: true,
          cluster: false,
          providerName: "looksrare_ask",
          deployBlock: 13885625,
          contractAddress: "0x59728544B08AB483533076417FbBB2fD0B17CE3a",
          saleEventName: "TakerAsk",
          deploymentEventName: "OwnershipTransferred",
          abi: [
            "event TakerAsk(bytes32 orderHash, uint256 orderNonce, address indexed taker, address indexed maker, address indexed strategy, address currency, address collection, uint256 tokenId, uint256 amount, uint256 price)",
          ],
          erc20Tokens: [],
        },
      ],
    },
  },
};

export const OpenSea = markets[Marketplace.Opensea];
export const LooksRare = markets[Marketplace.LooksRare];

export default markets;
