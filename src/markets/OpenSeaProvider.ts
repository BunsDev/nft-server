import Web3 from "web3";
import { BlockTransactionObject, Transaction } from "web3-eth";
import { ethers, BigNumber, Event } from "ethers";
import { LogDescription } from "@ethersproject/abi/lib/interface";
import OPENSEA_ABI from "./opensea.abi.json";
import { EventFragment } from "ethers/lib/utils";
import { getLogger } from "../utils/logger";
import {
  IOnChainProvider,
  ChainProviders,
  IMarketOnChainProvider,
  MarketChainProviders,
} from "../interfaces";
import { Blockchain } from "../types";
import { BaseProvider } from "./BaseProvider";

const LOGGER = getLogger("opensea");

export class OpenSeaProvider extends BaseProvider {

  constructor(...chains: MarketChainProviders) {
    this.createChainProviders(chains);
  }
}
