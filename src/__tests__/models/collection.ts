import { configureLoggerDefaults, getLogger, Levels } from "../../utils/logger";
import { Collection } from "../../models/collection";

configureLoggerDefaults({
  console: false,
  error: false,
  datadog: false,
  debugTo: {
    console: false,
    datadog: false,
  },
});

describe(`collection model`, () => {
  it(`should return all collections or provide cursor`, async () => {
    const withCursor = await Collection.getSorted({ limit: "1" });

    expect(withCursor).toHaveProperty("cursor");
    expect(withCursor.cursor).toBeTruthy();

    const withoutCursor = await Collection.getSorted({ returnAll: true });

    expect(withoutCursor).toHaveProperty("cursor");
    expect(withoutCursor.cursor).toBeFalsy();
  });
});
