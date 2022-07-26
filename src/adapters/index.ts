import { fork } from "child_process";
import { IMarketOnChainProvider } from "../interfaces";
import { getLogger } from "../utils/logger";
require("dotenv").config();

export interface DataAdapter {
  run: (provider?: IMarketOnChainProvider) => Promise<void>;
}

declare const __dirname: string;

const adapters: string[] = [
  "moralis",
  "pancakeswap",
  "opensea",
  "looksrare",
  "random-earth",
  "magic-eden",
  "immutablex",
  "treasure",
  "jpg-store",
  "nftrade",
  "paintswap",
  "defi-kingdoms",
  "nftkey",
];

const autoStartAdapters: Array<string> = [
  "opensea",
  "looksrare",
  // "moralis",
  // "pancakeswap",
  // "random-earth",
  // "magic-eden",
  // "immutablex",
  // "treasure",
  // "jpg-store",
  // "nftrade",
  // "paintswap",
  // "defi-kingdoms",
  // "nftkey",
];

const LOGGER = getLogger("OPENSEA_ADAPTER", {
  datadog: !!process.env.DATADOG_API_KEY,
});

const spawnChildProcess = (adapterName: string, attempt = 1) => {
  const child = fork(__dirname + "/" + adapterName);

  child.on("exit", (exitCode) => {
    if (attempt > 1) {
      LOGGER.error(
        `${adapterName}-adapter: returned with code ${exitCode}, stopping after too many attempts.`
      );
      return;
    }

    LOGGER.error(
      `${adapterName}-adapter: returned with code ${exitCode}, restarting with attempt no. ${attempt}.`
    );
    spawnChildProcess(adapterName, attempt + 1);
  });
};

if (
  process.env.DEFILLAMA_NFT_ADAPTER &&
  adapters.indexOf(process.env.DEFILLAMA_NFT_ADAPTER) > -1
) {
  spawnChildProcess(process.env.DEFILLAMA_NFT_ADAPTER);
} else {
  for (const adapter of autoStartAdapters) {
    spawnChildProcess(adapter);
  }
}

export { adapters };
