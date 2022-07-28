import { Interface } from "@ethersproject/abi";
import winston, { Logger } from "winston";

interface ILevels {
  alert: number;
  error: number;
  warn: number;
  info: number;
  debug: number;
}

interface LoggerConfigOptions {
  console?: boolean;
  error?: boolean;
  info?: boolean;
  debug?: boolean;
  datadog?: boolean;
  debugTo?: Record<string, boolean>;
  format?: winston.Logform.Format;
  transports?: winston.transport[];
  path?: string;
  [x: string]: any;
}

export const _defaults: LoggerConfigOptions = {
  console: true,
  error: false,
  info: false,
  debug: false,
  datadog: false,
  debugTo: {
    console: true,
    datadog: true,
  },
  format: null,
  transports: null,
  path: "./",
};

export const Levels: ILevels = {
  alert: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

type SerializedError = {
  message: string;
  stack: string;
};

type LogMethod = (
  message: string,
  meta?: unknown,
  ...winston: Array<unknown>
) => void;

export interface LevelLogger {
  alert: LogMethod;
  error: LogMethod;
  warn: LogMethod;
  info: LogMethod;
  debug: LogMethod;
  _logger: winston.Logger;
  _e(error: Error): SerializedError;
}

export function configureLoggerDefaults(
  newDefaults: Partial<LoggerConfigOptions>
) {
  for (const key of Object.keys(newDefaults) as Array<
    keyof LoggerConfigOptions
  >) {
    if (key in _defaults) {
      _defaults[key] = newDefaults[key];
    }
  }
}

export function getLogger(
  name: string,
  options?: LoggerConfigOptions
): LevelLogger {
  if (process.argv[3]) {
    name = `${name}_${process.argv[3]}`;
  }
  const {
    console: _console = _defaults.console,
    error = _defaults.error,
    info = _defaults.info,
    debug = _defaults.debug,
    datadog = _defaults.datadog,
    debugTo = _defaults.debugTo,
    format = _defaults.format,
    levels = _defaults.levels,
    transports = _defaults.transports,
    path = _defaults.path,
  } = options || {};
  const datadogTransport =
    datadog &&
    new winston.transports.Http({
      host: `http-intake.logs.datadoghq.com`,
      path: `/api/v2/logs?dd-api-key=${process.env.DATADOG_API_KEY}&ddsource=defillama-${process.env.NODE_ENV ?? "development"}&service=defillama-${name}`,
      ssl: true,
      level: debugTo.datadog ? "debug" : "info",
    });
  const _logger: Logger = winston.createLogger({
    levels: levels ?? winston.config.npm.levels,
    format: format ?? winston.format.json(),
    transports:
      transports ??
      [
        _console &&
          new winston.transports.Console({
            level: debugTo.console ? "debug" : "info",
          }),
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
        datadogTransport,
      ].filter(Boolean),
    exceptionHandlers: [datadogTransport].filter(Boolean),
    rejectionHandlers: [datadogTransport].filter(Boolean),
  });

  const getLogLevelFunction = (level: keyof typeof _logger) => {
    return function (
      message: string,
      meta?: unknown,
      ...winston: Array<unknown>
    ) {
      const timestamp = Date.now();
      if (meta && typeof meta === "object") {
        try {
          for (const [k, v] of Object.entries(meta)) {
            if (typeof k === "string" && v instanceof Error) {
              (<Record<string, any>>meta)[k] = LOGGER._e(v);
            }
          }
        } catch (e) {}
      }
      _logger[level](
        { timestamp, message, meta, pid: process.pid },
        ...winston
      );
    };
  };

  const LOGGER: LevelLogger = {
    alert: getLogLevelFunction("alert"),
    error: getLogLevelFunction("error"),
    warn: getLogLevelFunction("warn"),
    info: getLogLevelFunction("info"),
    debug: getLogLevelFunction("debug"),
    _logger,
    _e(error: Error) {
      return {
        message: error.toString(),
        stack: error.stack,
      };
    },
  };

  return LOGGER;
}
