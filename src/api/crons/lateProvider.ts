import { LateWyvernProvider } from "../../markets/opensea/wyvern";
import { OpenSeaProvider } from "../../markets/OpenSeaProvider";
import OpenseaAdapter from "../../adapters/opensea";
import markets from "../../markets";

const providerBuild = OpenSeaProvider.build(markets.opensea).find(
  (p) => p.chainConfig.providerName === "wyvern_1"
);

main.autostart = true;

export default async function main() {
  const provider = new LateWyvernProvider(
    providerBuild.providerConfig,
    "late_wyvern"
  );
  await OpenseaAdapter.run(provider);
}
