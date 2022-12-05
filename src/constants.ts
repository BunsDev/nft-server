import { Blockchain, HumanABI, Marketplace, MoralisChain } from "./types";

require('dotenv').config()

export const ONE_HOUR = 1;

export const ONE_WEEK_MILISECONDS = 7 * 86400 * 1000;
export const ONE_DAY_MILISECONDS = 86400 * 1000;
export const ONE_HOUR_MILISECONDS = 3600 * 1000;

export const DEFAULT_TOKEN_ADDRESSES: Record<Blockchain, string> = {
  [Blockchain.Ethereum]: "0x0000000000000000000000000000000000000000",
  [Blockchain.Arbitrum]: "0x0000000000000000000000000000000000000000",
  [Blockchain.ImmutableX]: "0x0000000000000000000000000000000000000000",
  [Blockchain.Solana]: "11111111111111111111111111111111",
  [Blockchain.BSC]: "bsc:0x0000000000000000000000000000000000000000",
  [Blockchain.Terra]: "Terra1sk06e3dyexuq4shw77y3dsv480xv42mq73anxu",
  [Blockchain.Cardano]: "addr11111111111111111111111111111111",
  [Blockchain.Avalanche]: "avax:0x0000000000000000000000000000000000000000",
  [Blockchain.Fantom]: "ftm:0x0000000000000000000000000000000000000000",
  [Blockchain.Harmony]: "one:0x0000000000000000000000000000000000000000",
};

export const WRAPPED_BASE_TOKENS: Partial<Record<Blockchain, string>> = {
  [Blockchain.Ethereum]: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
};

export const MORALIS_CHAINS: Record<Blockchain, MoralisChain> = {
  [Blockchain.Solana]: MoralisChain.None,
  [Blockchain.ImmutableX]: MoralisChain.None,
  [Blockchain.Arbitrum]: MoralisChain.None,
  [Blockchain.Terra]: MoralisChain.None,
  [Blockchain.Cardano]: MoralisChain.None,
  [Blockchain.Fantom]: MoralisChain.None,
  [Blockchain.Harmony]: MoralisChain.None,
  [Blockchain.Avalanche]: MoralisChain.None,
  [Blockchain.Ethereum]: MoralisChain.Ethereum,
  [Blockchain.BSC]: MoralisChain.BSC,
};

export const MARKETPLACE_CHAINS: Record<Marketplace, Blockchain[]> = {
  [Marketplace.MagicEden]: [Blockchain.Solana],
  [Marketplace.ImmutableX]: [Blockchain.ImmutableX],
  [Marketplace.Treasure]: [Blockchain.Arbitrum],
  [Marketplace.RandomEarth]: [Blockchain.Terra],
  [Marketplace.JpgStore]: [Blockchain.Cardano],
  [Marketplace.PaintSwap]: [Blockchain.Fantom],
  [Marketplace.DefiKingdoms]: [Blockchain.Harmony],
  [Marketplace.NFTrade]: [Blockchain.Avalanche],
  [Marketplace.Opensea]: [Blockchain.Ethereum],
  [Marketplace.Blur]: [Blockchain.Ethereum],
  [Marketplace.LooksRare]: [Blockchain.Ethereum],
  [Marketplace.PancakeSwap]: [Blockchain.BSC],
  [Marketplace.NFTKEY]: [
    Blockchain.Fantom,
    Blockchain.BSC,
    Blockchain.Harmony,
    Blockchain.Avalanche,
    Blockchain.Ethereum,
  ],
  [Marketplace.Rarible]: [Blockchain.Ethereum]
};

export const CHAIN_MARKETPLACES: Record<Blockchain, Marketplace[]> = {
  [Blockchain.Solana]: [Marketplace.MagicEden],
  [Blockchain.ImmutableX]: [Marketplace.ImmutableX],
  [Blockchain.Arbitrum]: [Marketplace.Treasure],
  [Blockchain.Terra]: [Marketplace.RandomEarth],
  [Blockchain.Cardano]: [Marketplace.JpgStore],
  [Blockchain.Fantom]: [Marketplace.PaintSwap, Marketplace.NFTKEY],
  [Blockchain.Harmony]: [Marketplace.DefiKingdoms, Marketplace.NFTKEY],
  [Blockchain.Avalanche]: [Marketplace.NFTrade, Marketplace.NFTKEY],
  [Blockchain.Ethereum]: [
    Marketplace.Opensea,
    Marketplace.NFTKEY,
    Marketplace.LooksRare,
    Marketplace.Blur,
  ],
  [Blockchain.BSC]: [Marketplace.PancakeSwap, Marketplace.NFTKEY],
};

export const CHAIN_IDS: Record<number, Blockchain> = {
  1: Blockchain.Ethereum,
  56: Blockchain.BSC,
  43114: Blockchain.Avalanche,
  250: Blockchain.Fantom,
  1666600000: Blockchain.Harmony,
};

export const CHAIN_RPCS: Partial<Record<Blockchain, string>> = {
  [Blockchain.Avalanche]: process.env.AVALANCHE_RPC,
  [Blockchain.Harmony]: process.env.HARMONY_RPC,
  [Blockchain.Fantom]: process.env.FANTOM_RPC,
  [Blockchain.BSC]: process.env.BSC_RPC,
};

export const COINGECKO_IDS: Record<Blockchain, any> = {
  [Blockchain.Ethereum]: {
    geckoId: "ethereum",
    llamaId: "ethereum",
    platform: "ethereum",
    symbol: "eth",
  },
  [Blockchain.ImmutableX]: {
    geckoId: "ethereum",
    llamaId: "",
    platform: "ethereum",
    symbol: "eth",
  },
  [Blockchain.Arbitrum]: {
    geckoId: "ethereum",
    llamaId: "",
    platform: "arbitrum-one",
    symbol: "eth",
  },
  [Blockchain.Solana]: {
    geckoId: "solana",
    llamaId: "",
    platform: "solana",
    symbol: "sol",
  },
  [Blockchain.BSC]: {
    geckoId: "binancecoin",
    llamaId: "bsc",
    platform: "binance-smart-chain",
    symbol: "bnb",
  },
  [Blockchain.Terra]: {
    geckoId: "terra-luna",
    llamaId: "",
    platform: "terra",
    symbol: "luna",
  },
  [Blockchain.Cardano]: {
    geckoId: "cardano",
    llamaId: "",
    platform: "cardano",
    symbol: "ada",
  },
  [Blockchain.Avalanche]: {
    geckoId: "avalanche-2",
    llamaId: "avax",
    platform: "avalanche",
    symbol: "avax",
  },
  [Blockchain.Fantom]: {
    geckoId: "fantom",
    llamaId: "fantom",
    platform: "fantom",
    symbol: "ftm",
  },
  [Blockchain.Harmony]: {
    geckoId: "harmony",
    llamaId: "harmony",
    platform: "harmony-shard-0",
    symbol: "one",
  },
};

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC721/IERC721.sol
export const IERC721Standard: HumanABI = [
  "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
];

export const IERC721Events: Map<string, string> = IERC721Standard.reduce(
  reduceToEvents,
  new Map()
);

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC1155/IERC1155.sol
export const IERC1155Standard: HumanABI = [
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
  "event ApprovalForAll(address indexed account, address indexed operator, bool approved)",
  "event URI(string value, uint256 indexed id)",
];

export const IERC1155Events: Map<string, string> = IERC1155Standard.reduce(
  reduceToEvents,
  new Map()
);

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol
export const OwnableStandard: HumanABI = [
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
];

export const IERC20Standard: HumanABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
];

function reduceToEvents(record: Map<string, string>, abi: string) {
  record.set(abi.match(/^event\s(.[^()]+)/)[1], abi);
  return record;
}

export const LLAMA_FI_COIN_API = "https://coins.llama.fi/coin/timestamps";
