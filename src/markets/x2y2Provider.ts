import { MarketChainConfig, MarketConfig, MultiMarketConfig } from "../markets";
import { Blockchain } from "../types";
import lrproviders from "./x2y2";

const providers = lrproviders as Record<string, any>;

/**
 * X2Y2 Market Chain Provider
 */

export class X2y2Provider {
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
            [chain]: chainConfig
          }
        };
        providerConfig.chains[chain] = chainConfig;
        marketProviders.push({
          providerConfig,
          chainConfig,
          instantiate() {
            return new providers[this.chainConfig.providerName](
              this.providerConfig,
              this.chainConfig.providerName
            );
          }
        });
      }
    }
    return marketProviders;
  }
}