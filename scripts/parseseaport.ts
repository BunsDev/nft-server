import { Blockchain } from "../src/types";
import {
  MarketProvider,
  OpenSeaProvider,
} from "../src/markets/OpenSeaProvider";
import { Provider } from "@ethersproject/abstract-provider";
import { providers } from "../src/providers/OnChainProviderFactory";
import markets, { MarketConfig, MultiMarketConfig } from "../src/markets";
import SeaportProvider from "../src/markets/opensea/seaport";
import { TransactionReceipt, Log, Block } from "@ethersproject/providers";
import { Event } from "ethers";

delete process.env.ADAPTER_REPROCESS;

const seaportConfig = OpenSeaProvider.build(
  markets.opensea as MultiMarketConfig
).find((p) => p.chainConfig.providerName === "seaport") as MarketProvider;
console.log(seaportConfig);
const seaport = new SeaportProvider(
  seaportConfig?.providerConfig as MarketConfig,
  seaportConfig?.chainConfig.providerName as string
);

const txHash = process.argv[2];
const logIndex = parseInt(process.argv[3]);
const parseLogOnly = !!parseInt(process.argv[4]);

const ethProvider = <Provider>providers[Blockchain.Ethereum];

seaport && main();

async function main() {
  const receipt = await ethProvider.getTransactionReceipt(txHash);
  const log = receipt.logs.find((l) => l.logIndex === logIndex) as Log;

  if (parseLogOnly) {
    const parsed = seaport.parseLog(log, Blockchain.Ethereum);
    console.log(parsed.log.args.offer.map((o: any) => o.amount.toString()));
  } else {
    const parsed = seaport.parseEvents(
      [log as unknown as Event],
      Blockchain.Ethereum
    )[0];
    console.log(parsed, parsed.data.raw);
  }

  process.exit(0);
}
