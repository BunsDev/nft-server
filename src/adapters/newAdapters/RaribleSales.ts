import { LevelLogger } from "../../../src/utils/logger";
import { ethers } from "ethers";
import { restoreBigNumber } from "../../utils";
import { Marketplace, SaleData } from "../../types";
import wrapper from "./baseAdapter";

export default function main(
  metas: any,
  receipt: any,
  hash: any,
  sales: Array<SaleData>,
  blockMap: any,
  provider: any,
  chain: any,
  collectionMap: any,
  LOGGER: LevelLogger
): void {
  for (const meta of metas) {
    //HERE X2Y2 requires no loop here
    if (!meta) {
      LOGGER.warn(`Skipping meta`, { tx: receipt.transactionHash });
      continue;
    }
    const { contractAddress, price, eventSignatures, data, payment } = meta;
    const formattedPrice = ethers.utils.formatUnits(
      restoreBigNumber(payment.amount),
      "ether"
    );
    if (!contractAddress) {
      LOGGER.debug(`Missing contract address. Skipping sale.`, {
        hash,
        metas
      });
      continue;
    }
    sales.push({
      txnHash: receipt.transactionHash,
      timestamp: (blockMap[receipt.blockNumber].timestamp * 1000).toString(),
      paymentTokenAddress: payment.address,
      contractAddress,
      price: parseFloat(formattedPrice),
      priceBase: null,
      priceUSD: null,
      sellerAddress: meta.seller,
      buyerAddress: meta.buyer,
      marketplace: "market" in provider ? provider["market"] : undefined,
      chain,
      metadata: { payment, data },
      count: meta.count,
      contract: meta.contract,
      logIndex: meta.logIndex,
      bundleSale: meta.bundleSale,
      hasCollection: !!collectionMap[contractAddress],
      tokenID: meta.tokenID,
      blockNumber: meta.blockNumber
    });
  }
}

wrapper("rarible");
