import { IOnChainProvider } from "../interfaces/IOnChainProvider";
import { Provider } from "@ethersproject/abstract-provider";

export class EthereumOnChainProvider implements IOnChainProvider<Provider> {
  constructor(public provider: Provider) {
    console.log(this.provider);
  }

  getSales(): void {
    throw new Error("Method not implemented.");
  }

  public async getCurrentBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }
}
