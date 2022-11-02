import "./loggerDisable";
import { DEFAULT_TOKEN_ADDRESSES } from "../constants";
import { LlamaFi, ContractPrices, PRICE_CACHE } from "../api/llamafi";
import { Blockchain } from "../types";

jest.setTimeout(50000);

describe(`LlamaFi`, () => {
  it(`should cache prices & throw missing coins`, async () => {
    const now = Math.floor(Date.now() / 1000);
    const threeDaysAgo = now - 86400 * 3;
    const expectedCoins = [
      Blockchain.Ethereum,
      Blockchain.Avalanche,
      Blockchain.BSC,
    ];

    const threeDaysPrice = await LlamaFi.getHistoricPriceByContract(
      `ethereum:${DEFAULT_TOKEN_ADDRESSES[Blockchain.Ethereum]}`,
      threeDaysAgo,
      Blockchain.Ethereum
    );

    expect(threeDaysPrice[threeDaysAgo]).toBeGreaterThan(0);

    for (const [chain, address] of Object.entries(DEFAULT_TOKEN_ADDRESSES)) {
      try {
        const coin = `${/:/.test(address) ? "" : chain + ":"}${address}`;
        const prices = <ContractPrices>(
          await LlamaFi.getHistoricPricesByContract(
            address,
            [0, threeDaysAgo, now],
            chain
          )
        );
        expect(prices[0]).toBe(PRICE_CACHE[coin].get(0));
        expect(prices[threeDaysAgo]).toBe(PRICE_CACHE[coin].get(threeDaysAgo));
        expect(prices[now]).toBe(PRICE_CACHE[coin].get(now));
        expect(threeDaysPrice[threeDaysAgo]).toBe(prices[threeDaysAgo]);
      } catch (e) {
        if (e.response?.status === 400) {
          expect(expectedCoins).not.toContain(chain);
        }
      }
    }
  });
});
