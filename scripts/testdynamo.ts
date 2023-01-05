import "./dotenv";
import dynamodb from "../src/utils/dynamodb";

main();

async function main() {
  const timestamp = Date.now();
  const chain = "ethereum";
  const marketplace = "opensea";
  const volume = 154.456156156156;
  const volumeUSD = 145678.65456151;
  // await dynamodb.transactWrite({
  //   putItems: [
  //     {
  //       Key: {
  //         PK: `globalStatistics`,
  //         SK: timestamp,
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

  await dynamodb.update({
    Key: {
      PK: `globalStatistics123456`,
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
  });

  // await dynamodb.put({
  //   PK: "globalStatistics",
  //   SK: timestamp,
  //   chainVolume: volume,
  //   chainvolumeUSD: volumeUSD,
  //   marketplacevolume: volume,
  //   marketplacevolumeUSD: volumeUSD,
  // });
}
