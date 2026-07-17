/**
 * Stale-lock reaper — recovers jobs stuck in 'processing' state.
 *
 * When a worker process is killed (kill -9, OOM, power loss) while
 * processing a job, that job would be stuck forever. The reaper scans
 * for such jobs and reclaims them using the same fail/retry/dead logic.
 *
 * It also cleans up stale worker records whose heartbeats have stopped.
 */

import type Database from 'better-sqlite3';
import { getStaleJobs, reclaimStaleJob } from '../core/jobRepository';
import { getConfigNum } from '../core/config';


/**
 * Reaps stale jobs and workers. Called periodically from the worker main loop.
 *
 * @param db - Database connection
 * @param currentWorkerId - The calling worker's ID (for logging context)
 * @returns Number of jobs reclaimed
 */
export function reapStaleJobs(db: Database.Database, currentWorkerId: string): number {
  const staleTimeoutS = getConfigNum(db, 'stale-timeout-s');
  const backoffBase = getConfigNum(db, 'backoff-base');

  const staleJobs = getStaleJobs(db, staleTimeoutS);
  let reclaimed = 0;

  for (const job of staleJobs) {
    // Don't reclaim our own jobs (we might still be running them)
    if (job.worker_id === currentWorkerId) continue;

    try {
      reclaimStaleJob(db, job, backoffBase);
      reclaimed++;
    } catch {
      // Another worker might have already reclaimed it — that's fine
    }
  }

  // Also clean up stale worker records
  cleanupStaleWorkers(db, staleTimeoutS);

  return reclaimed;
}

/**
 * Marks workers as 'stopped' if their heartbeat is too old.
 * This ensures `queuectl status` never shows a dead worker as active.
 */
function cleanupStaleWorkers(db: Database.Database, staleTimeoutS: number): void {
  // Use 2x the stale timeout for workers (give them more grace)
  const threshold = new Date(Date.now() - staleTimeoutS * 2 * 1000).toISOString();

  db.prepare(
    `UPDATE workers
     SET status = 'stopped', current_job_id = NULL
     WHERE status IN ('idle', 'busy')
       AND last_heartbeat < @threshold`,
  ).run({ threshold });
}
