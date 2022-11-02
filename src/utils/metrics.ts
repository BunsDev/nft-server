import { client, v1 } from "@datadog/datadog-api-client";
import { getLogger } from "./logger";

const configuration = client.createConfiguration();
const apiInstance = new v1.MetricsApi(configuration);
const LOGGER = getLogger("DEFILLAMA_DD_METRICS_REPORT", {
  datadog: !!process.env.DATADOG_API_KEY,
});

export interface MetricData {
  value: number;
  metric: string;
  time?: number;
  type?: string;
}

export function customMetricsReporter(
  prefix: string,
  suffix = "",
  reporterTags: Array<string> = []
) {
  class DefaultMetricsReporter {
    static metricPrefix: string = null;
    static metricSuffix: string = null;

    public static submit(
      metric: string,
      value: number,
      type = "gauge",
      time: number = null,
      tags: Array<string> = [],
      retryCount = 0
    ): Promise<v1.IntakePayloadAccepted> {
      const res = apiInstance.submitMetrics({
        body: {
          series: [
            {
              metric: `defillama.${self().metricPrefix}${metric}${
                self().metricSuffix
              }`,
              type,
              points: [[time ?? new Date().getTime() / 1000, value]],
              tags: [...reporterTags, ...tags],
            },
          ],
        },
      } as v1.MetricsApiSubmitMetricsRequest);

      res.catch((error: unknown) => {
        LOGGER.info("Failed to submit metric", {
          metric,
          value,
          type,
          time,
          error,
        });
        retryCount++;
        if (retryCount < 3) {
          setTimeout(
            () => self().submit(metric, value, type, time, tags, retryCount),
            0
          );
        }
      });

      return res;
    }
  }

  const Reporter = class extends DefaultMetricsReporter {
    static metricPrefix: string = prefix;
    static metricSuffix: string = suffix;
  };

  function self() {
    return Reporter;
  }

  return self();
}

export const MetricsReporter = customMetricsReporter("", "");
