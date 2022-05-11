import winston from "winston";

type LogOptions = {
  console?: boolean;
  error?: boolean;
  info?: boolean;
  debug?: boolean;
  format?: winston.Logform.Format;
  levels?: winston.config.AbstractConfigSetLevels;
  transports?: winston.transport[];
  path: string;
};

export function getLogger(name: string, options?: LogOptions): winston.Logger {
  const {
    console: _console = true,
    error = true,
    info = true,
    debug = true,
    format = null,
    levels = null,
    transports = null,
    path = "./",
  } = options || {};
  return winston.createLogger({
    levels: levels ?? winston.config.syslog.levels,
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
      ].filter(Boolean),
  });
}
