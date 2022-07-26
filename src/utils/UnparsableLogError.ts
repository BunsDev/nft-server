import { Log } from "@ethersproject/abstract-provider";
import { LogType } from "../markets/BaseMarketOnChainProvider";
import { Marketplace } from "../types";
import { getLogger } from "./logger";

const LOGGER = getLogger("PARSE_LOG_ERROR", {
  datadog: !!process.env.DATADOG_API_KEY,
});

export type ParseErrors = Partial<Record<LogType | Marketplace, Error>>;

export class UnparsableLogError extends Error {
  name = "UnparsableLogError";
  message = "Failed to parse event log.";
  constructor(public log: Log, public errors: ParseErrors) {
    super();
    LOGGER.error(
      `${log.transactionHash} => Failed to parse any standardized contract interfaces (ERC721, ERC1155, ERC20).`,
      log,
      errors
    );
  }
}
