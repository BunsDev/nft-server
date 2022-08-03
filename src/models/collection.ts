import { LooksRare } from "../api/looksrare";
import { Opensea } from "../api/opensea";
import { CHAIN_MARKETPLACES } from "../constants";
import {
  Blockchain,
  CollectionData,
  Marketplace,
  SaleData,
  StatisticData,
} from "../types";
import { getSlugFromPK, handleError } from "../utils";
import dynamodb from "../utils/dynamodb";

export class Collection {
  address: string;
  chain: Blockchain;
  slug: string;
  name: string;
  symbol: string;
  description: string;
  logo: string;
  website: string;
  discordUrl: string;
  telegramUrl: string;
  twitterUsername: string;
  mediumUsername: string;

  static async createCollectionsFromSales(
    sales: SaleData[],
    marketplace?: Marketplace
  ): Promise<Record<string, boolean>> {
    const collections: Record<string, boolean> = {};
    const contracts: Array<string> = [];
    for (const sale of sales) {
      if (!contracts.includes(sale.contractAddress)) {
        let collection;
        try {
          try {
            switch (marketplace) {
              case Marketplace.Opensea:
              // For LooksRare we will use info from OS
              // eslint-disable-next-line no-fallthrough
              case Marketplace.LooksRare:
                collection = await Opensea.getContract(sale.contractAddress);
                break;
              default:
            }
          } catch (e) {}

          collections[sale.contractAddress] = false;

          if (collection) {
            const upsert = await Collection.upsert({
              slug: sale.contractAddress,
              chain: sale.chain,
              marketplace: marketplace ?? sale.marketplace,
              metadata: collection,
              statistics: {
                floor: 0,
                floorUSD: 0,
                marketCap: 0,
                marketCapUSD: 0,
                owners: 0,
                dailyVolume: 0,
                dailyVolumeUSD: 0,
                fromSales: true,
                totalVolume: 0,
                totalVolumeUSD: 0,
              },
            });
            collections[sale.contractAddress] = upsert;
          }
          contracts.push(sale.contractAddress);
        } catch (e) {
          handleError(e, `Collection Upsert Failed`);
        }
      }
    }
    return collections;
  }

  static async insert({
    slug,
    chain,
    marketplace,
    metadata,
    statistics,
  }: {
    slug: string;
    chain: Blockchain;
    marketplace: Marketplace;
    metadata: CollectionData;
    statistics: StatisticData;
  }): Promise<boolean> {
    try {
      const currentTime = Date.now();

      const collectionData = {
        ...metadata,
        ...statistics,
        createdAt: currentTime,
        updatedAt: currentTime,
      };

      await dynamodb.transactWrite({
        updateItems: [
          {
            Key: {
              PK: `collectionCount`,
              SK: `chain#${chain}`,
            },
            UpdateExpression: "ADD collections :no",
            ExpressionAttributeValues: {
              ":no": 1,
            },
          },
          {
            Key: {
              PK: `collectionCount`,
              SK: `marketplace#${marketplace}`,
            },
            UpdateExpression: "ADD collections :no",
            ExpressionAttributeValues: {
              ":no": 1,
            },
          },
        ],
        putItems: [
          {
            PK: `collection#${slug}`,
            SK: "overview",
            category: "collections",
            ...collectionData,
          },
          {
            PK: `collection#${slug}`,
            SK: `chain#${chain}`,
            category: `collections#chain#${chain}`,
            ...collectionData,
          },
          {
            PK: `collection#${slug}`,
            SK: `marketplace#${marketplace}`,
            category: `collections#marketplace#${marketplace}`,
            ...collectionData,
          },
        ],
      });

      return true;
    } catch (e) {
      handleError(e, "collection-model:insert");
      return false;
    }
  }

  static async update({
    slug,
    collection,
    statistics,
    chain,
    marketplace,
  }: {
    slug: string;
    collection: any;
    statistics: StatisticData;
    chain: Blockchain;
    marketplace: Marketplace;
  }): Promise<boolean> {
    const currentTime = Date.now();

    const existingChains = collection
      .filter((item: any) => item.SK.startsWith("chain"))
      .map((item: any) => item.SK.split("#")[1]);

    const existingMarketplaces = collection
      .filter((item: any) => item.SK.startsWith("marketplace"))
      .map((item: any) => item.SK.split("#")[1]);

    // Set marketplace attribute values
    const marketplaceAttributeValues = {
      ":owners": statistics.owners,
      ":totalVolume": statistics.totalVolume,
      ":totalVolumeUSD": statistics.totalVolumeUSD,
      ":dailyVolume": statistics.dailyVolume || 0,
      ":dailyVolumeUSD": statistics.dailyVolumeUSD || 0,
      ":floor": statistics.floor,
      ":floorUSD": statistics.floorUSD,
      ":marketCap": statistics.marketCap,
      ":marketCapUSD": statistics.marketCapUSD,
      ":updatedAt": currentTime,
      ":chains": existingChains,
      ":marketplaces": existingMarketplaces,
      ":category": `collections#marketplace#${marketplace}`,
    };

    // Calculate chain data
    let chainAttributeValues = {};

    // If new chain, initialize chain attribute values with marketplace data
    if (!existingChains.includes(chain)) {
      chainAttributeValues = marketplaceAttributeValues;
    }

    // If chain already exists, add all marketplaces on that chain
    else {
      const marketplaces = CHAIN_MARKETPLACES[chain];
      const chainData = collection.reduce(
        (totals: any, item: any) => {
          if (
            marketplaces.includes(item.SK.split("#")[1]) &&
            item.SK !== `marketplace#${marketplace}`
          ) {
            const {
              ownersArr,
              totalVolume,
              totalVolumeUSD,
              dailyVolume,
              dailyVolumeUSD,
              floorArr,
              floorUSDArr,
              marketCapArr,
              marketCapUSDArr,
            } = totals;

            return {
              totalVolume: totalVolume + item.totalVolume,
              totalVolumeUSD: totalVolumeUSD + item.totalVolumeUSD,
              dailyVolume: dailyVolume + item.dailyVolume,
              dailyVolumeUSD: dailyVolumeUSD + item.dailyVolumeUSD,
              ownersArr: item.owners ? [...ownersArr, item.owners] : ownersArr,
              floorArr: item.floor ? [...floorArr, item.floor] : floorArr,
              floorUSDArr: item.floorUSD
                ? [...floorUSDArr, item.floorUSD]
                : floorUSDArr,
              marketCapArr: item.marketCap
                ? [...marketCapArr, item.marketCap]
                : marketCapArr,
              marketCapUSDArr: item.marketCapUSD
                ? [...marketCapUSDArr, item.marketCapUSD]
                : marketCapUSDArr,
            };
          }
          return totals;
        },
        {
          totalVolume: statistics.totalVolume,
          totalVolumeUSD: statistics.totalVolumeUSD,
          dailyVolume: statistics.dailyVolume || 0,
          dailyVolumeUSD: statistics.dailyVolumeUSD || 0,
          ownersArr: statistics.owners ? [statistics.owners] : [],
          floorArr: statistics.floor ? [statistics.floor] : [],
          floorUSDArr: statistics.floorUSD ? [statistics.floorUSD] : [],
          marketCapArr: statistics.marketCap ? [statistics.marketCap] : [],
          marketCapUSDArr: statistics.marketCapUSD
            ? [statistics.marketCapUSD]
            : [],
        }
      );

      // Set chain attribute values
      chainAttributeValues = {
        ":totalVolume": chainData.totalVolume,
        ":totalVolumeUSD": chainData.totalVolumeUSD,
        ":dailyVolume": chainData.dailyVolume || 0,
        ":dailyVolumeUSD": chainData.dailyVolumeUSD || 0,
        ":owners": chainData.ownersArr.length
          ? Math.max(...chainData.ownersArr)
          : 0,
        ":floor": chainData.floorArr.length
          ? Math.min(...chainData.floorArr)
          : 0,
        ":floorUSD": chainData.floorUSDArr.length
          ? Math.min(...chainData.floorUSDArr)
          : 0,
        ":marketCap": chainData.marketCapArr.length
          ? Math.min(...chainData.marketCapArr)
          : 0,
        ":marketCapUSD": chainData.marketCapUSDArr.length
          ? Math.min(...chainData.marketCapUSDArr)
          : 0,
        ":updatedAt": currentTime,
        ":chains": existingChains,
        ":marketplaces": existingMarketplaces,
        ":category": `collections#chain#${chain}`,
      };
    }

    // Calculate overview data
    const overviewData = collection.reduce(
      (totals: any, item: any) => {
        if (
          item.SK.startsWith("marketplace") &&
          item.SK !== `marketplace#${marketplace}`
        ) {
          const {
            ownersArr,
            totalVolume,
            totalVolumeUSD,
            dailyVolume,
            dailyVolumeUSD,
            floorArr,
            floorUSDArr,
            marketCapArr,
            marketCapUSDArr,
          } = totals;

          return {
            totalVolume: totalVolume + item.totalVolume,
            totalVolumeUSD: totalVolumeUSD + item.totalVolumeUSD,
            dailyVolume: dailyVolume + item.dailyVolume,
            dailyVolumeUSD: dailyVolumeUSD + item.dailyVolumeUSD,
            ownersArr: item.owners ? [...ownersArr, item.owners] : ownersArr,
            floorArr: item.floor ? [...floorArr, item.floor] : floorArr,
            floorUSDArr: item.floorUSD
              ? [...floorUSDArr, item.floorUSD]
              : floorUSDArr,
            marketCapArr: item.marketCap
              ? [...marketCapArr, item.marketCap]
              : marketCapArr,
            marketCapUSDArr: item.marketCapUSD
              ? [...marketCapUSDArr, item.marketCapUSD]
              : marketCapUSDArr,
          };
        }
        return totals;
      },
      {
        totalVolume: statistics.totalVolume,
        totalVolumeUSD: statistics.totalVolumeUSD,
        dailyVolume: statistics.dailyVolume || 0,
        dailyVolumeUSD: statistics.dailyVolumeUSD || 0,
        ownersArr: statistics.owners ? [statistics.owners] : [],
        floorArr: statistics.floor ? [statistics.floor] : [],
        floorUSDArr: statistics.floorUSD ? [statistics.floorUSD] : [],
        marketCapArr: statistics.marketCap ? [statistics.marketCap] : [],
        marketCapUSDArr: statistics.marketCap ? [statistics.marketCapUSD] : [],
      }
    );

    // Set overview attribute values
    const overviewAttributeValues = {
      ":totalVolume": overviewData.totalVolume,
      ":totalVolumeUSD": overviewData.totalVolumeUSD,
      ":dailyVolume": overviewData.dailyVolume || 0,
      ":dailyVolumeUSD": overviewData.dailyVolumeUSD || 0,
      ":owners": overviewData.ownersArr.length
        ? Math.max(...overviewData.ownersArr)
        : 0,
      ":floor": overviewData.floorArr.length
        ? Math.min(...overviewData.floorArr)
        : 0,
      ":floorUSD": overviewData.floorUSDArr.length
        ? Math.min(...overviewData.floorUSDArr)
        : 0,
      ":marketCap": overviewData.marketCapArr.length
        ? Math.min(...overviewData.marketCapArr)
        : 0,
      ":marketCapUSD": overviewData.marketCapUSDArr.length
        ? Math.min(...overviewData.marketCapUSDArr)
        : 0,
      ":updatedAt": currentTime,
      ":chains": existingChains,
      ":marketplaces": existingMarketplaces,
      ":category": `overview`,
    };

    // Update items
    const updateExpression = `
    SET owners = :owners,
        totalVolume = :totalVolume,
        totalVolumeUSD = :totalVolumeUSD,
        dailyVolume = :dailyVolume,
        dailyVolumeUSD = :dailyVolumeUSD,
        floor = :floor,
        floorUSD = :floorUSD,
        marketCap = :marketCap,
        marketCapUSD = :marketCapUSD,
        updatedAt = :updatedAt,
        chains = :chains,
        marketplaces = :marketplaces,
        category = :category`;

    await dynamodb.transactWrite({
      updateItems: [
        {
          Key: {
            PK: `collection#${slug}`,
            SK: "overview",
          },
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: overviewAttributeValues,
        },
        {
          Key: {
            PK: `collection#${slug}`,
            SK: `chain#${chain}`,
          },
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: chainAttributeValues,
        },
        {
          Key: {
            PK: `collection#${slug}`,
            SK: `marketplace#${marketplace}`,
          },
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: marketplaceAttributeValues,
        },
      ],
    });

    return true;
  }

  static async upsert({
    slug,
    metadata,
    statistics,
    chain,
    marketplace,
  }: {
    slug: string;
    metadata: CollectionData;
    statistics: StatisticData;
    chain: Blockchain;
    marketplace: Marketplace;
  }): Promise<boolean> {
    const existingCollections = await Collection.get(slug);

    // If collection already exists, update statistics
    if (existingCollections.length) {
      try {
        return await Collection.update({
          slug,
          chain,
          marketplace,
          statistics,
          collection: existingCollections,
        });
      } catch (e) {
        handleError(e, "collection-model:update");
        return false;
      }
    }

    // If collection doesn't exist, increment collection counts
    // and insert metadata and statistics
    else {
      return await Collection.insert({
        slug,
        chain,
        marketplace,
        metadata,
        statistics,
      });
    }
  }

  static async get(slug: string) {
    try {
      return await dynamodb
        .query({
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: {
            ":pk": `collection#${slug}`,
          },
        })
        .then((result) => result.Items);
    } catch (e) {
      return [];
    }
  }

  static async getStatisticsByChain(slug: string, chain: Blockchain) {
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk and SK = :sk",
        ExpressionAttributeValues: {
          ":pk": `collection#${slug}`,
          ":sk": `chain#${chain}`,
        },
      })
      .then((result) => result.Items[0]);
  }

  static async getStatisticsByMarketplace(
    slug: string,
    marketplace: Marketplace
  ) {
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk and SK = :sk",
        ExpressionAttributeValues: {
          ":pk": `collection#${slug}`,
          ":sk": `marketplace#${marketplace}`,
        },
      })
      .then((result) => result.Items[0]);
  }

  // TODO Get all when getting sales
  static async getSorted({
    chain,
    marketplace,
    limit = null,
    cursor = null,
  }: {
    chain?: Blockchain;
    marketplace?: Marketplace;
    limit?: string;
    cursor?: string;
  }) {
    let category = "collections";

    if (chain) {
      category = `collections#chain#${chain}`;
    }
    if (marketplace) {
      category = `collections#marketplace#${marketplace}`;
    }

    if (category) {
      return dynamodb
        .query({
          IndexName: process.env.COLLECTION_INDEX ?? "collectionsIndex",
          KeyConditionExpression: "category = :category",
          ExpressionAttributeValues: {
            ":category": category,
          },
          ScanIndexForward: false,
          ...(limit && { Limit: parseInt(limit) }),
          ...(cursor && { ExclusiveStartKey: JSON.parse(cursor) }),
        })
        .then((result) => {
          const { Items, LastEvaluatedKey } = result;
          return {
            data: Items.map((item: any) => ({
              ...item,
              slug: getSlugFromPK(item.PK),
            })),
            ...(LastEvaluatedKey && { cursor: LastEvaluatedKey }),
          };
        });
    }
  }

  static async getCount() {
    return dynamodb
      .query({
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `collectionCount`,
        },
      })
      .then((result) => result.Items);
  }
}
