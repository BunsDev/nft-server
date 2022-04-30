import { IOnChainProvider } from "../interfaces/IOnChainProvider";
import { Provider } from "@ethersproject/abstract-provider";

export class EthereumOnChainProvider implements IOnChainProvider {
  constructor(public provider: Provider) {
    console.log(this.provider);
  }

  getSales(): void {
    throw new Error("Method not implemented.");
  }
  
}
