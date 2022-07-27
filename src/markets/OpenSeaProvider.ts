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

export class OpenSeaProvider {
  static build(config: MultiMarketConfig) {
    const marketProviders = [];
    const chains = Object.keys(config.chains) as Array<Blockchain>;

    for (const chain of chains) {
      const chainContracts: Array<MarketChainConfig> = config.chains[chain];

      for (const chainConfig of chainContracts) {
        if (!chainConfig.enabled) {
          continue;
        }
        const providerConfig: MarketConfig = {
          chains: {
            [chain]: chainConfig,
          },
        };
        providerConfig.chains[chain] = chainConfig;
        marketProviders.push({
          chain,
          providerConfig,
          chainConfig,
          instantiate() {
            return new providers[this.chainConfig.providerName](
              this.providerConfig,
              this.chainConfig.providerName
            );
          },
        });
      }
    }
    return marketProviders;
  }
}
