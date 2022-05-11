import { Log } from "@ethersproject/abstract-provider";
import { LogType } from "../markets/BaseMarketOnChainProvider";
import { Marketplace } from "../types";

export type ParseErrors = Partial<Record<LogType | Marketplace, Error>>;

export class UnparsableLogError extends Error {
  name = "UnparsableLogError";
  message = "Failed to parse event log.";
  constructor(public log: Log, public errors: ParseErrors) {
    super();
    console.log(`Failed to parse logs from ${log.transactionHash}`);
    console.error(
      `Failed to parse any standardized contract interfaces (ERC721, ERC1155, ERC20).`
    );
  }
}
