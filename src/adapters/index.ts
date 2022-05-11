import { fork } from "child_process";
require("dotenv").config();

export interface DataAdapter {
  run: () => Promise<void>;
}

declare const __dirname: string;

const adapters: string[] = [
  // "moralis",
  // "pancakeswap",
  "opensea",
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

const spawnChildProcess = (adapterName: string, attempt = 1) => {
  const child = fork(__dirname + "/" + adapterName);

  child.on("exit", (exitCode) => {
    if (attempt > 1) {
      console.log(
        `${adapterName}-adapter: returned with code ${exitCode}, stopping after too many attempts.`
      );
      return;
    }

    console.log(
      `${adapterName}-adapter: returned with code ${exitCode}, restarting with attempt no. ${attempt}.`
    );
    spawnChildProcess(adapterName, attempt + 1);
  });
};

for (const adapter of adapters) {
  spawnChildProcess(adapter);
}

export { adapters };
