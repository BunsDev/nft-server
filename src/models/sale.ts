import { getLogger } from "../utils/logger";
import { Marketplace, RecordState, SaleData } from "../types";
import { handleError } from "../utils";
import dynamodb from "../utils/dynamodb";

const ONE_DAY_MILISECONDS = 86400 * 1000;

const LOGGER = getLogger("SALE_MODEL", {
  datadog: !!process.env.DATADOG_API_KEY,
});

export class Sale {
  txnHash: string;
  sellerAddress: string;
  buyerAddress: string;
  contractAddress?: string;
  marketplace: Marketplace;
  price: number;
  priceBase: number;
  priceUSD: number;
  paymentTokenAddress: string;
  excluded: boolean;

  static async insert({
    slug,
    marketplace,
    sales,
  }: {
    slug: string | Record<string, any>;
    marketplace: Marketplace;
    sales: SaleData[];
  }) {
    try {
      const batchWriteStep = 25;
      for (let i = 0; i < sales.length; i += batchWriteStep) {
        const items = sales
          .slice(i, i + batchWriteStep)
          .reduce((sales: any, sale) => {
            const { timestamp, txnHash, ...data } = sale;
            const sortKeys = sales.map((sale: any) => sale.SK);
            const sortKey = `${timestamp}#txnHash#${txnHash}#${sale.logIndex}`;
            if (!sortKeys.includes(sortKey)) {
              sales.push({
                PK: `sales#${sale.contractAddress}#marketplace#${marketplace}`,
                SK: sortKey,
                recordState: RecordState.UNPROCESSED,
                ...data,
              });
            } else {
              LOGGER.alert(`Duplicate Sale Detected`, { sale });
            }
            return sales;
          }, []);
        await dynamodb.batchWrite(items);
      }
      return true;
    } catch (e) {
      handleError(e, "sale-model: insert");
      return false;
    }
  }

  // Removes the sale from the database and subtracts the prices from statistics
  static async delete({
    slug,
    chain,
    marketplace,
    timestamp,
    txnHash,
    priceUSD,
    priceBase,
  }: {
    slug: string;
    chain: string;
    marketplace: string;
    timestamp: string;
    txnHash: string;
    priceUSD: string;
    priceBase: string;
  }) {
    const startOfDay =
      parseInt(timestamp) - (parseInt(timestamp) % ONE_DAY_MILISECONDS);
    return dynamodb.transactWrite({
      deleteItems: [
        {
          Key: {
            PK: `sales#${slug}#marketplace#${marketplace}`,
            SK: `${timestamp}#txnHash#${txnHash}`,
          },
        },
      ],
      updateItems: [
        {
          Key: {
            PK: `statistics#${slug}`,
            SK: startOfDay.toString(),
          },
          UpdateExpression: `
              ADD #chainvolume :volume,
                  #chainvolumeUSD :volumeUSD,
                  #marketplacevolume :volume,
                  #marketplacevolumeUSD :volumeUSD
            `,
          ExpressionAttributeNames: {
            "#chainvolume": `chain_${chain}_volume`,
            "#chainvolumeUSD": `chain_${chain}_volumeUSD`,
            "#marketplacevolume": `marketplace_${marketplace}_volume`,
            "#marketplacevolumeUSD": `marketplace_${marketplace}_volumeUSD`,
          },
          ExpressionAttributeValues: {
            ":volume": -parseInt(priceBase),
            ":volumeUSD": -parseInt(priceUSD),
          },
        },
        {
          Key: {
            PK: `globalStatistics`,
            SK: startOfDay.toString(),
          },
          UpdateExpression: `
              ADD #chainvolume :volume,
                  #chainvolumeUSD :volumeUSD,
                  #marketplacevolume :volume,
                  #marketplacevolumeUSD :volumeUSD
            `,
          ExpressionAttributeNames: {
            "#chainvolume": `chain_${chain}_volume`,
            "#chainvolumeUSD": `chain_${chain}_volumeUSD`,
            "#marketplacevolume": `marketplace_${marketplace}_volume`,
            "#marketplacevolumeUSD": `marketplace_${marketplace}_volumeUSD`,
          },
          ExpressionAttributeValues: {
            ":volume": -parseInt(priceBase),
            ":volumeUSD": -parseInt(priceUSD),
          },
        },
      ],
    });
  }

  static async getAll({
    slug,
    marketplace,
    cursor = null,
  }: {
    slug: string;
    marketplace: Marketplace;
    cursor?: string;
  }) {
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `sales#${slug}#marketplace#${marketplace}`,
        },
        ...(cursor && { ExclusiveStartKey: JSON.parse(cursor) }),
      })
      .then((result) => {
        const { Items, LastEvaluatedKey } = result;
        return {
          data: Items.map((item) => ({
            ...item,
            timestamp: item.SK.split("#")[0],
            txnHash: item.SK.split("#")[2],
          })) as SaleData[],
          ...(LastEvaluatedKey && {
            cursor: LastEvaluatedKey as unknown as string,
          }),
        };
      });
  }

  static async getLastSaleTime({
    slug,
    marketplace,
  }: {
    slug: string;
    marketplace: Marketplace;
  }) {
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `sales#${slug}#marketplace#${marketplace}`,
        },
        Limit: 1,
        ScanIndexForward: false,
      })
      .then((result) => {
        const results = result.Items;
        if (results.length) {
          return parseInt(results[0]?.SK?.split("#")[0]);
        }
        return 0;
      });
  }
}
