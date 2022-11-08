import { getLogger } from "../utils/logger";
import { Collection } from ".";
import {
  Blockchain,
  DailyVolumeRecord,
  DateTruncate,
  Marketplace,
  SaleData,
  SaleRecord,
  StatType,
  UpdateCollectionStatisticsResult,
  VolumeRecord,
} from "../types";
import { fillMissingVolumeRecord, handleError, timestamp, truncateDate } from "../utils";
import dynamodb from "../utils/dynamodb";

const ONE_DAY_MILISECONDS = 86400 * 1000;

const LOGGER = getLogger("HISTORICAL_STATISTICS", {
  datadog: !!process.env.DATADOG_API_KEY,
});

export class HistoricalStatistics {
  static async getGlobalStatistics(
    sortAsc = true,
    statType = StatType.DAILY_GLOBAL
  ) {
    return dynamodb
      .query({
        IndexName: "collectionStats",
        KeyConditionExpression: "statType = :stat",
        ExpressionAttributeValues: {
          ":stat": statType,
        },
        ScanIndexForward: sortAsc,
      })
      .then((result) => result.Items);
  }

  static async getCollectionStatistics(
    slug: string,
    sortAsc = true,
    statType = StatType.DAILY_COLLECTION
  ) {
    let prefix = "dailyStatistics";
    switch (statType) {
      case StatType.HOURLY_COLLECTION:
        prefix = "hourlyStatistics";
        break;
      case StatType.WEEKLY_COLLECTION:
        prefix = "weeklyStatistics";
        break;
    }
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `${prefix}#${slug}`,
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
    negate = false,
  }: {
    slug: string;
    chain: Blockchain;
    marketplace: Marketplace;
    volumes: any;
    failureAttempt?: number;
    negate?: boolean;
  }): Promise<UpdateCollectionStatisticsResult> {
    const result: UpdateCollectionStatisticsResult = {
      fromSales: {
        didEnter: false,
        result: false,
        output: {},
      },
      ranOverview: false,
      slug,
      chain,
      marketplace,
      volumesResult: {},
      negate,
    };
    const overviewStatistics = await Collection.getStatisticsByMarketplace(
      slug,
      marketplace
    );

    if (overviewStatistics && !negate) {
      result.ranOverview = true;
      const { fromSales } = overviewStatistics;

      if (!fromSales) {
        result.fromSales.didEnter = true;
        const { totalVolume, totalVolumeUSD } =
          await HistoricalStatistics.getCollectionTotalVolume({
            slug,
            marketplace,
          });

        // result.fromSales.output = await dynamodb.transactWrite({
        //   updateItems: [
        //     {
        //       Key: {
        //         PK: `collection#${slug}`,
        //         SK: "overview"
        //       },
        //       UpdateExpression: `
        //         SET fromSales = :fromSales,
        //             totalVolume = :totalVolume,
        //             totalVolumeUSD = :totalVolumeUSD`,
        //       ExpressionAttributeValues: {
        //         ":fromSales": true,
        //         ":totalVolume": totalVolume,
        //         ":totalVolumeUSD": totalVolumeUSD
        //       }
        //     },
        //     {
        //       Key: {
        //         PK: `collection#${slug}`,
        //         SK: `chain#${chain}`
        //       },
        //       UpdateExpression: `
        //         SET fromSales = :fromSales,
        //             totalVolume = :totalVolume,
        //             totalVolumeUSD = :totalVolumeUSD`,
        //       ExpressionAttributeValues: {
        //         ":fromSales": true,
        //         ":totalVolume": totalVolume,
        //         ":totalVolumeUSD": totalVolumeUSD
        //       }
        //     },
        //     {
        //       Key: {
        //         PK: `collection#${slug}`,
        //         SK: `marketplace#${marketplace}`
        //       },
        //       UpdateExpression: `
        //         SET fromSales = :fromSales,
        //             totalVolume = :totalVolume,
        //             totalVolumeUSD = :totalVolumeUSD`,
        //       ExpressionAttributeValues: {
        //         ":fromSales": true,
        //         ":totalVolume": totalVolume,
        //         ":totalVolumeUSD": totalVolumeUSD
        //       }
        //     }
        //   ]
        // });

        result.fromSales.result = true;
      }
    }

    for (const timestamp in volumes) {
      try {
        result.volumesResult[timestamp] = {
          result: false,
          output: null,
        };

        let { volume, volumeUSD } = volumes[timestamp];
        if (negate) {
          volume = -volume;
          volumeUSD = -volumeUSD;
        }

        // result.volumesResult[timestamp].output = await dynamodb.transactWrite({
        //   updateItems: [
        //     {
        //       Key: {
        //         PK: `collection#${slug}`,
        //         SK: "overview",
        //       },
        //       UpdateExpression: `
        //         ADD totalVolume :volume,
        //             totalVolumeUSD  :volumeUSD
        //       `,
        //       ExpressionAttributeValues: {
        //         ":volume": volume,
        //         ":volumeUSD": volumeUSD,
        //       },
        //     },
        //     {
        //       Key: {
        //         PK: `collection#${slug}`,
        //         SK: `chain#${chain}`,
        //       },
        //       UpdateExpression: `
        //         ADD totalVolume :volume,
        //             totalVolumeUSD  :volumeUSD
        //       `,
        //       ExpressionAttributeValues: {
        //         ":volume": volume,
        //         ":volumeUSD": volumeUSD,
        //       },
        //     },
        //     {
        //       Key: {
        //         PK: `collection#${slug}`,
        //         SK: `marketplace#${marketplace}`,
        //       },
        //       UpdateExpression: `
        //         ADD totalVolume :volume,
        //             totalVolumeUSD  :volumeUSD
        //       `,
        //       ExpressionAttributeValues: {
        //         ":volume": volume,
        //         ":volumeUSD": volumeUSD,
        //       },
        //     },
        //     {
        //       Key: {
        //         PK: `statistics#${slug}`,
        //         SK: `${timestamp}`,
        //       },
        //       UpdateExpression: `
        //         ADD #chainvolume :volume,
        //             #chainvolumeUSD :volumeUSD,
        //             #marketplacevolume :volume,
        //             #marketplacevolumeUSD :volumeUSD
        //       `,
        //       ExpressionAttributeNames: {
        //         "#chainvolume": `chain_${chain}_volume`,
        //         "#chainvolumeUSD": `chain_${chain}_volumeUSD`,
        //         "#marketplacevolume": `marketplace_${marketplace}_volume`,
        //         "#marketplacevolumeUSD": `marketplace_${marketplace}_volumeUSD`,
        //       },
        //       ExpressionAttributeValues: {
        //         ":volume": volume,
        //         ":volumeUSD": volumeUSD,
        //       },
        //     },
        //     {
        //       Key: {
        //         PK: `globalStatistics`,
        //         SK: `${timestamp}`,
        //       },
        //       UpdateExpression: `
        //         ADD #chainvolume :volume,
        //             #chainvolumeUSD :volumeUSD,
        //             #marketplacevolume :volume,
        //             #marketplacevolumeUSD :volumeUSD
        //       `,
        //       ExpressionAttributeNames: {
        //         "#chainvolume": `chain_${chain}_volume`,
        //         "#chainvolumeUSD": `chain_${chain}_volumeUSD`,
        //         "#marketplacevolume": `marketplace_${marketplace}_volume`,
        //         "#marketplacevolumeUSD": `marketplace_${marketplace}_volumeUSD`,
        //       },
        //       ExpressionAttributeValues: {
        //         ":volume": volume,
        //         ":volumeUSD": volumeUSD,
        //       },
        //     },
        //   ],
        // });
        result.volumesResult[timestamp].result = true;
      } catch (e) {
        if (failureAttempt < 3) {
          failureAttempt++;
          LOGGER.error(`updateCollectionStatistics()`, {
            error: e,
            timestamp,
            slug,
            chain,
            marketplace,
            volumes,
            failureAttempt,
            result,
          });
          return HistoricalStatistics.updateCollectionStatistics({
            slug,
            chain,
            marketplace,
            volumes,
            failureAttempt,
            negate,
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
            result,
          });
        }
      }
    }

    LOGGER.debug(`updateCollectionStatistics()`, { result });

    return result;
  }

  static async getDailyVolumesFromSales({
    sales,
    volumes,
    fillMissingDates = false,
  }: {
    sales: (SaleRecord | SaleData)[];
    volumes?: DailyVolumeRecord;
    fillMissingDates?: boolean;
  }) {
    return HistoricalStatistics.getVolumesFromSales({
      sales,
      volumes,
      fillMissingDates,
      truncateDateTo: DateTruncate.DAY,
    });
  }

  static getVolumesFromSales({
    sales,
    volumes,
    fillMissingDates = false,
    truncateDateTo = DateTruncate.DAY,
  }: {
    sales: (SaleRecord | SaleData)[];
    volumes?: DailyVolumeRecord;
    fillMissingDates?: boolean;
    truncateDateTo?: DateTruncate;
  }) {
    volumes = volumes ?? {};

    for (const sale of sales) {
      // Do not count if sale price is 0 or does not have a USD or base equivalent
      if (sale.price <= 0 || sale.priceBase <= 0 || sale.priceUSD <= 0) {
        continue;
      }
      if ("SK" in sale) {
        sale.timestamp ??= sale.SK.split(/#/)[0];
      }
      const timestamp = parseInt(sale.timestamp);
      const truncated = truncateDate(timestamp, truncateDateTo);
      volumes[truncated] = {
        volume: (volumes[truncated]?.volume || 0) + sale.priceBase,
        volumeUSD: (volumes[truncated]?.volumeUSD || 0) + sale.priceUSD,
      };
    }

    if (fillMissingDates) {
      volumes = fillMissingVolumeRecord(volumes, [], truncateDateTo);
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
  }): Promise<UpdateCollectionStatisticsResult> {
    try {
      const volumes = await HistoricalStatistics.getDailyVolumesFromSales({
        sales,
      });
      return await HistoricalStatistics.updateCollectionStatistics({
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
    statType,
  }: {
    chain?: string;
    marketplace?: string;
    slug?: string;
    statType?: string;
  }) {
    if (chain) {
      const globalStatistics = await HistoricalStatistics.getGlobalStatistics(
        true,
        statType as StatType
      );
      return globalStatistics
        .map((statistic) => ({
          timestamp: Math.floor(statistic.SK / 1000),
          volume: statistic[`chain_${chain}_volume`],
          volumeUSD: statistic[`chain_${chain}_volumeUSD`],
        }))
        .filter((statistic) => statistic.volume && statistic.volumeUSD);
    }

    if (marketplace) {
      const globalStatistics = await HistoricalStatistics.getGlobalStatistics(
        true,
        statType as StatType
      );
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
        slug,
        true,
        statType as StatType
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

    const globalStatistics = await HistoricalStatistics.getGlobalStatistics(
      true,
      statType as StatType
    );
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
