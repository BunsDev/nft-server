import { getLogger } from "../utils/logger";
import { Collection } from ".";
import { Blockchain, Marketplace, SaleData } from "../types";
import { handleError } from "../utils";
import dynamodb from "../utils/dynamodb";

const ONE_DAY_MILISECONDS = 86400 * 1000;

const LOGGER = getLogger("HISTORICAL_STATISTICS", {
  datadog: !!process.env.DATADOG_API_KEY,
});

export class HistoricalStatistics {
  static async getGlobalStatistics(sortAsc: boolean = true) {
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": "globalStatistics",
        },
        ScanIndexForward: sortAsc,
      })
      .then((result) => result.Items);
  }

  static async getCollectionStatistics(slug: string, sortAsc: boolean = true) {
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `statistics#${slug}`,
        },
        ScanIndexForward: sortAsc,
      })
      .then((result) => result.Items);
  }

  static async updateCollectionStatistics({
    slug,
    chain,
    marketplace,
    volumes,
    failureAttempt = 0,
  }: {
    slug: string;
    chain: Blockchain;
    marketplace: Marketplace;
    volumes: any;
    failureAttempt?: number;
  }) {
    const overviewStatistics = await Collection.getStatisticsByMarketplace(
      slug,
      marketplace
    );

    if (overviewStatistics) {
      LOGGER.debug(`updateCollectionStatistics(): overviewStatistics`, {
        overviewStatistics,
      });
      const { fromSales } = overviewStatistics;

      if (!fromSales) {
        const { totalVolume, totalVolumeUSD } =
          await HistoricalStatistics.getCollectionTotalVolume({
            slug,
            marketplace,
          });

        await dynamodb.transactWrite({
          updateItems: [
            {
              Key: {
                PK: `collection#${slug}`,
                SK: "overview",
              },
              UpdateExpression: `
                SET fromSales = :fromSales,
                    totalVolume = :totalVolume,
                    totalVolumeUSD = :totalVolumeUSD`,
              ExpressionAttributeValues: {
                ":fromSales": true,
                ":totalVolume": totalVolume,
                ":totalVolumeUSD": totalVolumeUSD,
              },
            },
            {
              Key: {
                PK: `collection#${slug}`,
                SK: `chain#${chain}`,
              },
              UpdateExpression: `
                SET fromSales = :fromSales,
                    totalVolume = :totalVolume,
                    totalVolumeUSD = :totalVolumeUSD`,
              ExpressionAttributeValues: {
                ":fromSales": true,
                ":totalVolume": totalVolume,
                ":totalVolumeUSD": totalVolumeUSD,
              },
            },
            {
              Key: {
                PK: `collection#${slug}`,
                SK: `marketplace#${marketplace}`,
              },
              UpdateExpression: `
                SET fromSales = :fromSales,
                    totalVolume = :totalVolume,
                    totalVolumeUSD = :totalVolumeUSD`,
              ExpressionAttributeValues: {
                ":fromSales": true,
                ":totalVolume": totalVolume,
                ":totalVolumeUSD": totalVolumeUSD,
              },
            },
          ],
        });
      }
    }

    for (const timestamp in volumes) {
      const { volume, volumeUSD } = volumes[timestamp];
      try {
        await dynamodb.transactWrite({
          updateItems: [
            {
              Key: {
                PK: `collection#${slug}`,
                SK: "overview",
              },
              UpdateExpression: `
                ADD totalVolume :volume,
                    totalVolumeUSD  :volumeUSD
              `,
              ExpressionAttributeValues: {
                ":volume": volume,
                ":volumeUSD": volumeUSD,
              },
            },
            {
              Key: {
                PK: `collection#${slug}`,
                SK: `chain#${chain}`,
              },
              UpdateExpression: `
                ADD totalVolume :volume,
                    totalVolumeUSD  :volumeUSD
              `,
              ExpressionAttributeValues: {
                ":volume": volume,
                ":volumeUSD": volumeUSD,
              },
            },
            {
              Key: {
                PK: `collection#${slug}`,
                SK: `marketplace#${marketplace}`,
              },
              UpdateExpression: `
                ADD totalVolume :volume,
                    totalVolumeUSD  :volumeUSD
              `,
              ExpressionAttributeValues: {
                ":volume": volume,
                ":volumeUSD": volumeUSD,
              },
            },
            {
              Key: {
                PK: `statistics#${slug}`,
                SK: `${timestamp}`,
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
                ":volume": volume,
                ":volumeUSD": volumeUSD,
              },
            },
            {
              Key: {
                PK: `globalStatistics`,
                SK: `${timestamp}`,
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
                ":volume": volume,
                ":volumeUSD": volumeUSD,
              },
            },
          ],
        });
      } catch (e) {
        LOGGER.error(`updateCollectionStatistics()`, {
          error: e,
          timestamp,
          volumes,
        });
        if (failureAttempt < 5) {
          failureAttempt++;
          HistoricalStatistics.updateCollectionStatistics({
            slug,
            chain,
            marketplace,
            volumes,
            failureAttempt,
          });
        } else {
          LOGGER.alert(`updateCollectionStatistics()`, {
            error: e,
            timestamp,
            volumes,
            slug,
            chain,
            marketplace,
            failureAttempt,
          });
        }
      }
    }
  }

  static async getDailyVolumesFromSales({ sales }: { sales: SaleData[] }) {
    const volumes: any = {};

    for (const sale of sales) {
      // Do not count if sale price is 0 or does not have a USD or base equivalent
      if (sale.price <= 0 || sale.priceBase <= 0 || sale.priceUSD <= 0) {
        continue;
      }
      const timestamp = parseInt(sale.timestamp);
      const startOfDay = timestamp - (timestamp % ONE_DAY_MILISECONDS);
      volumes[startOfDay] = {
        volume: (volumes[startOfDay]?.volume || 0) + sale.priceBase,
        volumeUSD: (volumes[startOfDay]?.volumeUSD || 0) + sale.priceUSD,
      };
    }

    return volumes;
  }

  static async updateStatistics({
    slug,
    chain,
    marketplace,
    sales,
  }: {
    slug: string;
    chain: Blockchain;
    marketplace: Marketplace;
    sales: SaleData[];
  }) {
    try {
      const volumes = await HistoricalStatistics.getDailyVolumesFromSales({
        sales,
      });
      LOGGER.debug(`updateStatistics()`, {
        slug,
        chain,
        marketplace,
        volumes,
      });
      await HistoricalStatistics.updateCollectionStatistics({
        slug,
        chain,
        marketplace,
        volumes,
      });
    } catch (e) {
      handleError(e, "historical-statistics-model:updateStatistics");
    }
  }

  static async getChart({
    chain,
    marketplace,
    slug,
  }: {
    chain?: string;
    marketplace?: string;
    slug?: string;
  }) {
    if (chain) {
      const globalStatistics = await HistoricalStatistics.getGlobalStatistics();
      return globalStatistics
        .map((statistic) => ({
          timestamp: Math.floor(statistic.SK / 1000),
          volume: statistic[`chain_${chain}_volume`],
          volumeUSD: statistic[`chain_${chain}_volumeUSD`],
        }))
        .filter((statistic) => statistic.volume && statistic.volumeUSD);
    }

    if (marketplace) {
      const globalStatistics = await HistoricalStatistics.getGlobalStatistics();
      return globalStatistics
        .map((statistic) => ({
          timestamp: Math.floor(statistic.SK / 1000),
          volume: statistic[`marketplace_${marketplace}_volume`],
          volumeUSD: statistic[`marketplace_${marketplace}_volumeUSD`],
        }))
        .filter((statistic) => statistic.volume && statistic.volumeUSD);
    }

    if (slug) {
      const statistics = await HistoricalStatistics.getCollectionStatistics(
        slug
      );
      // Sums the volumes and USD volumes from every chain for that collection for every timestamp
      return statistics
        .map((statistic) => {
          const chainKeys = Object.keys(statistic).filter((key) => {
            return key.startsWith("chain_");
          });
          const volume = chainKeys.reduce((volume, key) => {
            if (key.endsWith("volume")) {
              volume += statistic[key];
            }
            return volume;
          }, 0);
          const volumeUSD = chainKeys.reduce((volumeUSD, key) => {
            if (key.endsWith("volumeUSD")) {
              volumeUSD += statistic[key];
            }
            return volumeUSD;
          }, 0);

          return {
            timestamp: Math.floor(statistic.SK / 1000),
            volume,
            volumeUSD,
          };
        })
        .filter((statistic) => statistic.volume && statistic.volumeUSD);
    }

    const globalStatistics = await HistoricalStatistics.getGlobalStatistics();
    return globalStatistics.map((statistic) => ({
      timestamp: Math.floor(statistic.SK / 1000),
      volume: Object.entries(statistic).reduce((volume, entry) => {
        if (entry[0].startsWith("chain") && entry[0].endsWith("volume")) {
          return volume + entry[1];
        }
        return volume;
      }, 0),
      volumeUSD: Object.entries(statistic).reduce((volumeUSD, entry) => {
        if (entry[0].startsWith("chain") && entry[0].endsWith("volumeUSD")) {
          return volumeUSD + entry[1];
        }
        return volumeUSD;
      }, 0),
    }));
  }

  static async getCollectionTotalVolume({
    slug,
    marketplace,
  }: {
    slug: string;
    marketplace: Marketplace;
  }) {
    // If total volumes are already being calculated from real sales and not
    // from fetched from marketplace APIs, return total volumes
    const overviewStatistics = await Collection.getStatisticsByMarketplace(
      slug,
      marketplace
    );

    if (overviewStatistics) {
      const { totalVolume, totalVolumeUSD, fromSales } = overviewStatistics;

      if (fromSales) {
        return {
          totalVolume,
          totalVolumeUSD,
        };
      }
    }

    // Otherwise, calculate manually and return volumes
    const historicalStatistics =
      await HistoricalStatistics.getCollectionStatistics(slug);

    if (!historicalStatistics.length) {
      return {
        totalVolume: -1,
        totalVolumeUSD: -1,
      };
    }

    return historicalStatistics.reduce((totalVolumes, statistic) => {
      const marketplaceKeys = Object.keys(statistic).filter((key) => {
        return key.startsWith(`marketplace_${marketplace}`);
      });
      const volume = marketplaceKeys.reduce((volume, key) => {
        if (key.endsWith("volume")) {
          volume += statistic[key];
        }
        return volume;
      }, 0);
      const volumeUSD = marketplaceKeys.reduce((volumeUSD, key) => {
        if (key.endsWith("volumeUSD")) {
          volumeUSD += statistic[key];
        }
        return volumeUSD;
      }, 0);

      return {
        totalVolume: totalVolumes.totalVolume
          ? totalVolumes.totalVolume + volume
          : volume,
        totalVolumeUSD: totalVolumes.totalVolumeUSD
          ? totalVolumes.totalVolumeUSD + volumeUSD
          : volumeUSD,
      };
    }, {});
  }

  static async getCollectionDailyVolume({
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
          ":pk": `statistics#${slug}`,
        },
        ScanIndexForward: false,
        Limit: 1,
      })
      .then((result) => {
        const item = result.Items[0];

        if (item) {
          const dailyVolume = item[`marketplace_${marketplace}_volume`];
          const dailyVolumeUSD = item[`marketplace_${marketplace}_volumeUSD`];
          return {
            dailyVolume: dailyVolume ? parseInt(dailyVolume) : 0,
            dailyVolumeUSD: dailyVolumeUSD ? parseInt(dailyVolumeUSD) : 0,
          };
        }

        return {
          dailyVolume: -1,
          dailyVolumeUSD: -1,
        };
      });
  }

  static async delete({
    slug,
    chain,
    marketplace,
    volumes,
  }: {
    slug: string;
    chain: Blockchain;
    marketplace: Marketplace;
    volumes: any;
  }) {
    for (const timestamp in volumes) {
      const { volume, volumeUSD } = volumes[timestamp];
      await dynamodb.transactWrite({
        updateItems: [
          {
            Key: {
              PK: `collection#${slug}`,
              SK: "overview",
            },
            UpdateExpression: `
              SET totalVolume = :volume,
                  totalVolumeUSD = :volumeUSD
            `,
            ExpressionAttributeValues: {
              ":volume": 0,
              ":volumeUSD": 0,
            },
          },
          {
            Key: {
              PK: `collection#${slug}`,
              SK: `chain#${chain}`,
            },
            UpdateExpression: `
              SET totalVolume = :volume,
                  totalVolumeUSD = :volumeUSD
            `,
            ExpressionAttributeValues: {
              ":volume": 0,
              ":volumeUSD": 0,
            },
          },
          {
            Key: {
              PK: `collection#${slug}`,
              SK: `marketplace#${marketplace}`,
            },
            UpdateExpression: `
              SET totalVolume = :volume,
                  totalVolumeUSD = :volumeUSD
            `,
            ExpressionAttributeValues: {
              ":volume": 0,
              ":volumeUSD": 0,
            },
          },
          {
            Key: {
              PK: `statistics#${slug}`,
              SK: `${timestamp}`,
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
              ":volume": -volume,
              ":volumeUSD": -volumeUSD,
            },
          },
          {
            Key: {
              PK: `globalStatistics`,
              SK: `${timestamp}`,
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
              ":volume": -volume,
              ":volumeUSD": -volumeUSD,
            },
          },
        ],
      });
    }
  }
}
