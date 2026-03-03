import pino from 'pino'
import { env } from './env'

// All logs go to stderr — stdout is reserved for the MCP stdio wire protocol.
// pino-pretty is used when the process is attached to a TTY (interactive dev),
// otherwise emit newline-delimited JSON for structured log ingestion.
export const logger = pino(
  {
    level: env.LOG_LEVEL,
    name: 'cog',
  },
  pino.transport({
    targets: [
      process.stderr.isTTY
        ? {
            target: 'pino-pretty',
            level: env.LOG_LEVEL,
            options: { destination: 2, colorize: true, sync: true },
          }
        : {
            target: 'pino/file',
            level: env.LOG_LEVEL,
            options: { destination: 2 },
          },
    ],
  }),
)

export type Logger = typeof logger
