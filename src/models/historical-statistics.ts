import { Collection } from ".";
import { Blockchain, Marketplace } from "../types";
import { handleError } from "../utils";
import dynamodb from "../utils/dynamodb";

const ONE_DAY_MILISECONDS = 86400 * 1000;

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
  }: {
    slug: string;
    chain: Blockchain;
    marketplace: Marketplace;
    volumes: any;
  }) {
    const overviewStatistics = await Collection.getStatisticsByMarketplace(
      slug,
      marketplace
    );

    if (overviewStatistics) {
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
        await dynamodb.update({
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
        });
      }
    }

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
              SK: timestamp,
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
              SK: timestamp,
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
    }
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
    sales: any[];
  }) {
    try {
      const volumes: any = {};
      for (const sale of sales) {
        // Do not count if sale has been marked excluded
        if (sale.excluded) {
          continue;
        }
        // Do not count if sale price is 0 or does not have a USD or base equivalent
        if (sale.price <= 0 || sale.priceBase <= 0 || sale.priceUSD <= 0) {
          continue;
        }
        const timestamp = sale.timestamp;
        const startOfDay = timestamp - (timestamp % ONE_DAY_MILISECONDS);
        volumes[startOfDay] = {
          volume: (volumes[startOfDay]?.volume || 0) + sale.priceBase,
          volumeUSD: (volumes[startOfDay]?.volumeUSD || 0) + sale.priceUSD,
        };
      }

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
}
