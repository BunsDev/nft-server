import "../loggerDisable";
import { CurrencyConverter } from "../../api/currency-converter";
import { Marketplace, SaleData, Blockchain } from "../../types";

const ADDRESS = "0x0000000000000000000000000000000000000000";
const HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const GALA_ADDRESS = "0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA";

jest.setTimeout(50000);

describe(`CurrencyConverted`, () => {
  it(`should properly record non-base & wrapped tokens to base price`, async () => {
    const timestamp = 1647129600000;
    const priceUsdc = 51943;
    const priceGala = 3651;
    const expectedPriceBaseUsdc = 20.2;
    const expectedPriceBaseGala = 0.3035;
    const sales: Array<SaleData> = [
      {
        buyerAddress: ADDRESS,
        sellerAddress: ADDRESS,
        paymentTokenAddress: USDC_ADDRESS,
        price: priceUsdc,
        priceBase: null,
        priceUSD: null,
        chain: Blockchain.Ethereum,
        marketplace: Marketplace.Opensea,
        timestamp: timestamp.toString(),
        txnHash: HASH,
        contractAddress: ADDRESS,
        count: 1,
        metadata: {},
      },
      {
        buyerAddress: ADDRESS,
        sellerAddress: ADDRESS,
        paymentTokenAddress: GALA_ADDRESS,
        price: priceGala,
        priceBase: null,
        priceUSD: null,
        chain: Blockchain.Ethereum,
        marketplace: Marketplace.Opensea,
        timestamp: timestamp.toString(),
        txnHash: HASH,
        contractAddress: ADDRESS,
        count: 1,
        metadata: {},
      },
    ];

    await CurrencyConverter.matchSalesWithPrices(sales);

    expect(sales[0].price.toFixed(1)).toBe(expectedPriceBaseUsdc.toString());
    expect(sales[0].priceBase?.toFixed(1)).toBe(
      expectedPriceBaseUsdc.toString()
    );

    expect(sales[1].price.toFixed(4)).toBe(expectedPriceBaseGala.toString());
    expect(sales[1].priceBase?.toFixed(4)).toBe(
      expectedPriceBaseGala.toString()
    );
  });
});
