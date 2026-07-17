/**
 * Pino logger configuration for QueueCTL.
 * - Pretty-printed to console for human readability
 * - Structured JSON to file for machine parsing
 * - Every log line for a job includes its job_id
 */

import pino from 'pino';
import path from 'path';

const logDir = process.env.QUEUECTL_LOG_DIR || '.';
const logFile = path.join(logDir, 'queuectl.log');

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
        level: 'info',
      },
      {
        target: 'pino/file',
        options: { destination: logFile, mkdir: true },
        level: 'debug',
      },
    ],
  },
});

/** Create a child logger bound to a specific job ID. */
export function jobLogger(jobId: string) {
  return logger.child({ job_id: jobId });
}

/** Create a child logger bound to a specific worker ID. */
export function workerLogger(workerId: string) {
  return logger.child({ worker_id: workerId });
}
