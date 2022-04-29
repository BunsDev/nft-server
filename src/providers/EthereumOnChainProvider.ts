import { IOnChainProvider } from "../interfaces/IOnChainProvider";
import { Provider } from "@ethersproject/abstract-provider";
import { BaseOnChainProvider } from "./BaseOnChainProvider";

export class EthereumOnChainProvider extends BaseOnChainProvider {
  constructor(chainProvider: Provider) {
    super(chainProvider);
  }
}
