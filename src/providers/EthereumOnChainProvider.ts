import { ethers } from "ethers";
import { IOnChainProvider } from "../interfaces/IOnChainProvider";
import { Provider } from "@ethersproject/abstract-provider";

export class EthereumOnChainProvider implements IOnChainProvider<Provider> {
  // eslint-disable-next-line no-useless-constructor
  constructor(public provider: Provider) {}

  getSales(): void {
    throw new Error("Method not implemented.");
  }

  public async getCurrentBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  get firstRpcProvider(): Provider {
    if (this.provider instanceof ethers.providers.FallbackProvider) {
      return this.provider.providerConfigs[0].provider;
    }
    return this.provider;
  }
}
