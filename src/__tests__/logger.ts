import path from "path";
import fs from "fs";
import { configureLoggerDefaults, getLogger, Levels } from "../utils/logger";

configureLoggerDefaults({
  console: false,
  error: true,
  datadog: false,
  debugTo: {
    console: false,
    datadog: false,
  },
  path: path.dirname(__filename) + "/",
});

jest.setTimeout(5e4);

describe(`winston logger`, () => {
  const logName = "TEST_LOG";
  const logPaths: Record<string, string> = Object.keys(Levels).reduce(
    (p, l) => ({
      ...p,
      [l as string]: path.join(path.dirname(__filename), `${logName}.${l}.log`),
    }),
    {} as Record<string, string>
  );
  const logger = getLogger(logName);
  beforeEach(() => {
    for (const [l, p] of Object.entries(logPaths)) {
      fs.existsSync(p) && fs.rmSync(p);
    }
  });

  it(`should serialize errors properly`, async () => {
    const error = new Error("Test123");

    logger.error("Test Error", {
      someArray: [1, 2, 3],
      error,
    });

    await new Promise((resolve) => setTimeout(() => resolve(0), 500));

    const logResult = JSON.parse(
      fs.readFileSync(logPaths.error).toString().trim()
    );
    expect(logResult.meta.error.message).toBe("Error: Test123");
    expect(logResult.meta.error.stack).toMatch(__filename);
    expect(logResult.meta.someArray).toMatchObject([1, 2, 3]);
  });
});
