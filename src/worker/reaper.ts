

import type Database from 'better-sqlite3';
import { getStaleJobs, reclaimStaleJob } from '../core/jobRepository';
import { getConfigNum } from '../core/config';

export function reapStaleJobs(db: Database.Database, currentWorkerId: string): number {
 const staleTimeoutS = getConfigNum(db, 'stale-timeout-s');
 const backoffBase = getConfigNum(db, 'backoff-base');

 const staleJobs = getStaleJobs(db, staleTimeoutS);
 let reclaimed = 0;

 for (const job of staleJobs) {
 
 if (job.worker_id === currentWorkerId) continue;

 try {
 reclaimStaleJob(db, job, backoffBase);
 reclaimed++;
 } catch {
 
 }
 }

 cleanupStaleWorkers(db, staleTimeoutS);

 return reclaimed;
}

function cleanupStaleWorkers(db: Database.Database, staleTimeoutS: number): void {
 
 const threshold = new Date(Date.now() - staleTimeoutS * 2 * 1000).toISOString();

 db.prepare(
 `UPDATE workers
 SET status = 'stopped', current_job_id = NULL
 WHERE status IN ('idle', 'busy')
 AND last_heartbeat < @threshold`,
 ).run({ threshold });
}
