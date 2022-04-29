import {
  ChainProviders,
  IMarketOnChainProvider,
  IOnChainProvider,
  MarketChainProviders,
} from "../interfaces";
import { Blockchain } from "../types";

export abstract class BaseMarketOnChainProvider
  implements IMarketOnChainProvider
{
  private chains: ChainProviders;

  public createChainProviders(chains: MarketChainProviders): void {
    if (Array.isArray(chains)) {
      for (const chain of chains) {
        if (chain in Blockchain) {
          this.chains[chain] = this.instantiateChainProvider(chain);
        }
      }
    } else {
      this.chains = chains;
    }
  }

  private instantiateChainProvider(chain: Blockchain): IOnChainProvider {
    
  }

}

