import axios from "axios";
import { APIGatewayProxyEvent } from "aws-lambda";

import {
  successResponse,
  errorResponse,
  IResponse,
} from "../utils/lambda-response";

const OPENSEARCH_DOMAIN = process.env.OPENSEARCH_DOMAIN;
const OPENSEARCH_USERNAME = process.env.OPENSEARCH_USERNAME;
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD;

const handler = async (event: APIGatewayProxyEvent): Promise<IResponse> => {
  try {
    const { query } = event?.queryStringParameters || {};

    const auth = Buffer.from(
      `${OPENSEARCH_USERNAME}:${OPENSEARCH_PASSWORD}`,
      "utf-8"
    ).toString("base64");

    const results = await axios.post(
      `${OPENSEARCH_DOMAIN}/collections/_search`,
      {
        query: {
          regexp: {
            name: {
              value: `^.*${query}.*$`,
              case_insensitive: true,
            }
          }
        },
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    const { hits } = results.data;

    return successResponse(hits, 10 * 60);
  } catch (e) {
    console.log(e);
    return errorResponse({ message: "Error" });
  }
};

export default handler;
