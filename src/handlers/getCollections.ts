import { APIGatewayProxyEvent } from "aws-lambda";

import { Collection } from "../models";
import { Blockchain, Marketplace } from "../types";
import {
  successResponse,
  errorResponse,
  IResponse,
} from "../utils/lambda-response";

const handler = async (event: APIGatewayProxyEvent): Promise<IResponse> => {
  try {
    const { chain, marketplace } = event?.pathParameters || {};
    const { limit, cursor } = event?.queryStringParameters || {};
    const collectionsData = await Collection.getSorted({
      chain: chain as Blockchain,
      marketplace: marketplace as Marketplace,
      limit: limit || "100",
      cursor,
      returnAll: true,
    });
    return successResponse(collectionsData, 10 * 60);
  } catch (e) {
    console.log(e);
    return errorResponse({ message: "Error" });
  }
};

export default handler;
