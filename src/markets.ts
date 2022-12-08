import { OwnableStandard } from "./constants";
import { Blockchain, Marketplace, HumanABI } from "./types";

export type MarketChainConfig = {
  enabled: boolean;
  providerName: string;
  adapterRunName?: string;
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
  "0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA", // GALA
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
  "0x6B175474E89094C44Da98b954EedeAC495271d0F" // DAI
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
          saleTopic:
            "0xc4109843e0b7d514e4c093114b863f8e7d8d9a458c372cd51bfe526b588006c9",
          deploymentEventName: "OwnershipTransferred",
          abi: [
            ...OwnableStandard,
            "event OrdersMatched (bytes32 buyHash, bytes32 sellHash, address indexed maker, address indexed taker, uint price, bytes32 indexed metadata)"
          ],
          erc20Tokens: OS_WYVERN_TOKENS
        },
        {
          enabled: true,
          cluster: true,
          providerName: "wyvern_2",
          // deployBlock: 14190913,
          deployBlock: 14232083,
          contractAddress: "0x7f268357a8c2552623316e2562d90e642bb538e5",
          saleEventName: "OrdersMatched",
          saleTopic:
            "0xc4109843e0b7d514e4c093114b863f8e7d8d9a458c372cd51bfe526b588006c9",
          deploymentEventName: "OwnershipTransferred",
          abi: [
            ...OwnableStandard,
            "event OrdersMatched (bytes32 buyHash, bytes32 sellHash, address indexed maker, address indexed taker, uint price, bytes32 indexed metadata)"
          ],
          erc20Tokens: OS_WYVERN_TOKENS
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
          erc20Tokens: OS_WYVERN_TOKENS
        }
      ]
    }
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
            "event TakerBid(bytes32 orderHash, uint256 orderNonce, address indexed taker, address indexed maker, address indexed strategy, address currency, address collection, uint256 tokenId, uint256 amount, uint256 price)"
          ],
          erc20Tokens: []
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
            "event TakerAsk(bytes32 orderHash, uint256 orderNonce, address indexed taker, address indexed maker, address indexed strategy, address currency, address collection, uint256 tokenId, uint256 amount, uint256 price)"
          ],
          erc20Tokens: []
        }
      ]
    }
  },
  [Marketplace.Blur]: {
    chains: {
      [Blockchain.Ethereum]: [
        {
          enabled: true,
          cluster: false,
          providerName: "blur",
          deployBlock: 15779232,
          contractAddress: "0x000000000000Ad05Ccc4F10045630fb830B95127",
          saleEventName: "OrdersMatched",
          saleTopic:
            "0x61cbb2a3dee0b6064c2e681aadd61677fb4ef319f0b547508d495626f5a62f64",
          deploymentEventName: "OwnershipTransferred",
          abi: `[{"anonymous": false,"inputs":[{"indexed": true,"internalType": "address","name": "maker","type": "address"},{"indexed": true,"internalType": "address","name": "taker","type": "address"},{"components":[{"internalType": "address","name": "trader","type": "address"},{"internalType": "enum Side","name": "side","type": "uint8"},{"internalType": "address","name": "matchingPolicy","type": "address"},{"internalType": "address","name": "collection","type": "address"},{"internalType": "uint256","name": "tokenId","type": "uint256"},{"internalType": "uint256","name": "amount","type": "uint256"},{"internalType": "address","name": "paymentToken","type": "address"},{"internalType": "uint256","name": "price","type": "uint256"},{"internalType": "uint256","name": "listingTime","type": "uint256"},{"internalType": "uint256","name": "expirationTime","type": "uint256"},{"components":[{"internalType": "uint16","name": "rate","type": "uint16"},{"internalType": "address payable","name": "recipient","type": "address"}],"internalType": "struct Fee[]","name": "fees","type": "tuple[]"},{"internalType": "uint256","name": "salt","type": "uint256"},{"internalType": "bytes","name": "extraParams","type": "bytes"}],"indexed": false,"internalType": "struct Order","name": "sell","type": "tuple"},{"indexed": false,"internalType": "bytes32","name": "sellHash","type": "bytes32"},{"components":[{"internalType": "address","name": "trader","type": "address"},{"internalType": "enum Side","name": "side","type": "uint8"},{"internalType": "address","name": "matchingPolicy","type": "address"},{"internalType": "address","name": "collection","type": "address"},{"internalType": "uint256","name": "tokenId","type": "uint256"},{"internalType": "uint256","name": "amount","type": "uint256"},{"internalType": "address","name": "paymentToken","type": "address"},{"internalType": "uint256","name": "price","type": "uint256"},{"internalType": "uint256","name": "listingTime","type": "uint256"},{"internalType": "uint256","name": "expirationTime","type": "uint256"},{"components":[{"internalType": "uint16","name": "rate","type": "uint16"},{"internalType": "address payable","name": "recipient","type": "address"}],"internalType": "struct Fee[]","name": "fees","type": "tuple[]"},{"internalType": "uint256","name": "salt","type": "uint256"},{"internalType": "bytes","name": "extraParams","type": "bytes"}],"indexed": false,"internalType": "struct Order","name": "buy","type": "tuple"},{"indexed": false,"internalType": "bytes32","name": "buyHash","type": "bytes32"}],"name": "OrdersMatched","type": "event"}]`,
          erc20Tokens: []
        }
      ]
    }
  },
  [Marketplace.Rarible]: {
    chains: {
      [Blockchain.Ethereum]: [
        {
          enabled: true,
          cluster: false,
          providerName: "rarible",
          deployBlock: 12617828,
          contractAddress: "0x9757F2d2b135150BBeb65308D4a91804107cd8D6",
          saleEventName: "Match",
          saleTopic:
            "0x956cd63ee4cdcd81fda5f0ec7c6c36dceda99e1b412f4a650a5d26055dc3c450",
          deploymentEventName: "OwnershipTransferred",
          abi: `[{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"hash","type":"bytes32"}],"name":"Cancel","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"leftHash","type":"bytes32"},{"indexed":false,"internalType":"bytes32","name":"rightHash","type":"bytes32"},{"indexed":false,"internalType":"uint256","name":"newLeftFill","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"newRightFill","type":"uint256"}],"name":"Match","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes4","name":"assetType","type":"bytes4"},{"indexed":false,"internalType":"address","name":"matcher","type":"address"}],"name":"MatcherChange","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes4","name":"assetType","type":"bytes4"},{"indexed":false,"internalType":"address","name":"proxy","type":"address"}],"name":"ProxyChange","type":"event"}]`,
          erc20Tokens: []
        }
      ]
    }
  },
  [Marketplace.X2y2]: {
    chains: {
      [Blockchain.Ethereum]: [
        {
          enabled: true,
          cluster: false,
          providerName: "x2y2",
          deployBlock: 15979852,
          contractAddress: "0x74312363e45DCaBA76c59ec49a7Aa8A65a67EeD3",
          saleEventName: "EvProfit",
          saleTopic:
            "0xe2c49856b032c255ae7e325d18109bc4e22a2804e2e49a017ec0f59f19cd447b",
          deploymentEventName: "OwnershipTransferred",
          abi: `[{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"itemHash","type":"bytes32"},{"indexed":false,"internalType":"address","name":"currency","type":"address"},{"indexed":false,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"EvProfit","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"signer","type":"address"},{"indexed":false,"internalType":"bool","name":"isRemoval","type":"bool"}],"name":"EvSigner","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"}]`,
          erc20Tokens: []
        }
      ]
    }
  }
};

export const OpenSea = markets[Marketplace.Opensea];
export const LooksRare = markets[Marketplace.LooksRare];
export const Blur = markets[Marketplace.Blur];
export const Rarible = markets[Marketplace.Rarible];
export const X2y2 = markets[Marketplace.X2y2];

export default markets;
