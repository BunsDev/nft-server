import "../loggerDisable";
import { Event } from "ethers";
import { IMarketOnChainProvider } from "../../interfaces";
import { Blockchain } from "../../types";
import { OpenSea as OpenSeaMarketConfig } from "../../markets";
import { OpenSeaProvider } from "../../markets/OpenSeaProvider";
import { EventMetadata } from "../../markets/BaseMarketOnChainProvider";

type EventInfo = {
  blockNumber: number;
  logIndex: Array<number>;
  transactionHash?: string;
};

const hashes: Record<string, EventInfo> = {
  "0x47f690f21377cef592ad4afb270713bb27c7cfcdd68897f37d082eded3aa2d32": {
    blockNumber: 14383523,
    logIndex: [283],
  },
};

describe(`OpenSeaProvider`, () => {
  let OSProvider: IMarketOnChainProvider;
  let filterTopics: (string | string[])[];
  beforeEach(() => {
    OSProvider = new OpenSeaProvider(OpenSeaMarketConfig);
    filterTopics = OSProvider.contracts[
      Blockchain.Ethereum
    ].interface.encodeFilterTopics(
      OSProvider.contracts[Blockchain.Ethereum].interface.getEvent(
        OSProvider.config.chains[Blockchain.Ethereum].saleEventName
      ),
      []
    );
  });

  it(`should handle unparsable logs`, async () => {
    for (const hash of Object.keys(hashes)) {
      const eventInfo = hashes[hash];
      eventInfo.transactionHash = hash;
      const blockEvents: Array<Event> = await OSProvider.contracts[
        Blockchain.Ethereum
      ].queryFilter(
        {
          address:
            OpenSeaMarketConfig.chains[Blockchain.Ethereum].contractAddress,
          topics: filterTopics,
        },
        eventInfo.blockNumber,
        eventInfo.blockNumber
      );
      const receipts = await OSProvider.getEventReceipts(
        blockEvents,
        Blockchain.Ethereum
      );
      expect(Object.keys(receipts)).toContain(hash);
    }
  });
});
