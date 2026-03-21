import winston from "winston";
import type { Writable } from "node:stream";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

function shouldUseStructuredFormat(): boolean {
  const explicit = process.env.LOG_FORMAT;
  if (explicit === "json") return true;
  if (explicit === "pretty") return false;
  return !process.stderr.isTTY;
}

const colorizedFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

const structuredFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
);

// All logs go to stderr (stdout reserved for machine-readable output)
export const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: {
    service: "echo-agent",
  },
  format: shouldUseStructuredFormat() ? structuredFormat : colorizedFormat,
  transports: [
    new winston.transports.Stream({
      stream: process.stderr as unknown as Writable,
    }),
  ],
});

/** Create a child logger with additional context (requestId, sessionId, etc.). */
export function createChildLogger(meta: Record<string, string | number | undefined>): winston.Logger {
  // Filter out undefined values
  const clean: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined) clean[k] = v;
  }
  return logger.child(clean);
}

export default logger;
