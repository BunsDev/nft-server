import { HistoricalStatistics } from "../models";
import { APIGatewayProxyEvent } from "aws-lambda";

import {
  successResponse,
  errorResponse,
  IResponse,
} from "../utils/lambda-response";
import { StatType } from "../types";

const handler = async (event: APIGatewayProxyEvent): Promise<IResponse> => {
  try {
    const { chain, marketplace, slug } = event?.pathParameters || {};
    // const { statType } = event?.queryStringParameters ?? {};
    const chart = await HistoricalStatistics.getChart({
      chain,
      marketplace,
      slug,
      statType: StatType.DAILY_GLOBAL,
    });
    return successResponse(chart, 10 * 60);
  } catch (e) {
    console.log(e);
    return errorResponse({ message: "Error" });
  }
};

export default handler;
