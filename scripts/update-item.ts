import dynamodb from "../src/utils/dynamodb";

const main = async (PK: string, SK: string, key: string, value: string) => {
  try {
    console.log("Updating item");
    await dynamodb.update({
      Key: {
        PK,
        SK,
      },
      UpdateExpression: `SET ${key} = :value`,
      ExpressionAttributeValues: {
        ":value": value,
      },
    });
    return "Successfully updated item";
  } catch (e) {
    console.log(e.message);
    return "Error updating item";
  }
};

main(
  "adapterState",
  "sales#paintswap",
  "lastSyncedBlockNumber",
  "23137237",
).then((result) => console.log(result));
