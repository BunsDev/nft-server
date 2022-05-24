import winston, { Logger } from "winston";

type LogOptions = {
  console?: boolean;
  error?: boolean;
  info?: boolean;
  debug?: boolean;
  datadog?: boolean;
  format?: winston.Logform.Format;
  levels?: winston.config.AbstractConfigSetLevels;
  transports?: winston.transport[];
  path?: string;
};

export type TLogger = {
  [key: string]: (
    message: string,
    meta?: unknown,
    ...winston: Array<unknown>
  ) => void;
};

export function getLogger(name: string, options?: LogOptions): TLogger {
  const {
    console: _console = true,
    error = true,
    info = true,
    debug = true,
    datadog = false,
    format = null,
    levels = null,
    transports = null,
    path = "./",
  } = options || {};
  const _logger: Logger = winston.createLogger({
    levels: levels ?? winston.config.npm.levels,
    format: format ?? winston.format.json(),
    transports:
      transports ??
      [
        _console && new winston.transports.Console(),
        error &&
          new winston.transports.File({
            filename: `${path}${name}.error.log`,
            level: "error",
          }),
        info &&
          new winston.transports.File({
            filename: `${path}${name}.info.log`,
            level: "info",
          }),
        debug &&
          new winston.transports.File({
            filename: `${path}${name}.debug.log`,
            level: "debug",
          }),
        datadog &&
          new winston.transports.Http({
            host: `http-intake.logs.datadoghq.com`,
            path: `/api/v2/logs?dd-api-key=${process.env.DATADOG_API_KEY}&ddsource=nodejs&service=defillama-${name}`,
            ssl: true,
          }),
      ].filter(Boolean),
  });

  const LOGGER: TLogger = {};
  const _levels = Object.keys(levels ?? winston.config.npm.levels) as Array<
    keyof typeof _logger
  >;

  for (const _level of _levels) {
    LOGGER[_level as string] = function (
      message: string,
      meta?: unknown,
      ...winston: Array<unknown>
    ) {
      const timestamp = Date.now();
      _logger[_level]({ timestamp, message, meta }, ...winston);
    };
  }

  return LOGGER;
}
