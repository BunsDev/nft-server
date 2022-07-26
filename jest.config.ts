module.exports = {
  clearMocks: true,
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  moduleFileExtensions: ["js", "json", "ts"],
  testMatch: ["**/__tests__/**/*.[jt]s?(x)?"],
  transform: {
    "^.+\\.js$": "babel-jest",
    "^.+\\.ts$": "ts-jest",
  },
  preset: "ts-jest/presets/js-with-babel",
};
