import winston from 'winston';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const logsDir = resolve('logs');
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: 'sympla-monitor' },
  transports: [
    new winston.transports.File({
      filename: resolve(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.json(),
      ),
    }),
    new winston.transports.File({
      filename: resolve(logsDir, 'app.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.json(),
      ),
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const { service: _, ...rest } = meta as Record<string, unknown>;
          const metaStr =
            Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
          return `${String(timestamp)} [${level}]: ${String(message)}${metaStr}`;
        }),
      ),
    }),
  ],
});
