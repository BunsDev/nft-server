import { IMarketOnChainProvider } from "../interfaces";
import { IClusterProvider } from "../utils/cluster";
import { MarketChainConfig, MarketConfig, MultiMarketConfig } from "../markets";
import { Blockchain } from "../types";
import osproviders from "./opensea";

const providers = osproviders as Record<string, any>;

/**
 * OS Market Chain Provider
 *
 * Not completely fleshed out just yet, and there is a lot of
 * work to be done to have this be more genric. Many of the EVM
 * based chain details have creeped in (i.e. parsing logs).
 *
 * General idea with a market provider is an extension of chain
 * providers (i.e. RpcJsonProvider), and are meant to be interfaces
 * for interpreting on-chain events for a specific market that is then
 * generalized for the adapter. Other market providers should also
 * implement IMarketOnChainProvider, but that is subject to change as
 * it may be possible to create a generic market provider that will work
 * for the majority of marketplaces, so long as they follow the same
 * general outline of OS for example.
 */

export type MarketProvider = {
  chain: Blockchain;
  providerConfig: MarketConfig;
  chainConfig: MarketChainConfig;
  instantiate(): IMarketOnChainProvider & IClusterProvider;
};

export class OpenSeaProvider {
  static build(config: MultiMarketConfig) {
    const marketProviders: Array<MarketProvider> = [];
    const chains = Object.keys(config.chains) as Array<Blockchain>;

    for (const chain of chains) {
      const chainContracts: Array<MarketChainConfig> = config.chains[chain];

      for (const chainConfig of chainContracts) {
        if (!chainConfig.enabled) {
          continue;
        }
        const { providerName } = chainConfig;
        if (process.env.ADAPTER_REPROCESS) {
          if (providerName !== process.env.ADAPTER_REPROCESS) {
            continue;
          }
          chainConfig.deployBlock = parseInt(
            process.env.ADAPTER_REPROCESS_START_BLOCK
          );
          chainConfig.adapterRunName = `${chainConfig.providerName}-REPROCESS-${chainConfig.deployBlock}`;
        }
        const providerConfig: MarketConfig = {
          chains: {
            [chain]: chainConfig,
          },
        };
        marketProviders.push({
          chain,
          providerConfig,
          chainConfig,
          instantiate() {
            return new providers[providerName](
              this.providerConfig,
              providerName
            );
          },
        });
      }
    }
    return marketProviders;
  }
}
