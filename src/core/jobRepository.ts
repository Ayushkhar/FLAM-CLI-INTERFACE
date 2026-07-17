

import type Database from 'better-sqlite3';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { Job, JobCounts, JobState } from '../types';
import { computeNextAttemptAt } from './backoff';
import { getConfigValue } from './db';
import { ValidationError } from '../errors';

export const EnqueuePayloadSchema = z.object({
 id: z.string().min(1).optional(),
 command: z.string().min(1, 'command is required'),
 max_retries: z.number().int().min(1).optional(),
 priority: z.number().int().optional(),
 run_at: z.string().datetime({ offset: true }).optional(),
 timeout_seconds: z.number().int().min(1).optional(),
});

export type EnqueuePayload = z.infer<typeof EnqueuePayloadSchema>;

export function insertJob(db: Database.Database, payload: EnqueuePayload): Job {
 const parsed = EnqueuePayloadSchema.safeParse(payload);
 if (!parsed.success) {
 const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
 throw new ValidationError(`Invalid job payload: ${issues.join('; ')}`, issues);
 }

 const data = parsed.data;
 const now = new Date().toISOString();
 const defaultMaxRetries = Number(getConfigValue(db, 'max-retries'));

 const job: Job = {
 id: data.id || randomUUID(),
 command: data.command,
 state: 'pending',
 attempts: 0,
 max_retries: data.max_retries ?? defaultMaxRetries,
 priority: data.priority ?? 0,
 run_at: data.run_at ?? null,
 next_attempt_at: null,
 timeout_seconds: data.timeout_seconds ?? null,
 worker_id: null,
 locked_at: null,
 last_error: null,
 stdout: null,
 stderr: null,
 exit_code: null,
 created_at: now,
 updated_at: now,
 };

 db.prepare(
 `INSERT INTO jobs (
 id, command, state, attempts, max_retries, priority,
 run_at, next_attempt_at, timeout_seconds,
 worker_id, locked_at, last_error, stdout, stderr, exit_code,
 created_at, updated_at
 ) VALUES (
 @id, @command, @state, @attempts, @max_retries, @priority,
 @run_at, @next_attempt_at, @timeout_seconds,
 @worker_id, @locked_at, @last_error, @stdout, @stderr, @exit_code,
 @created_at, @updated_at
 )`,
 ).run(job);

 return job;
}

export function insertJobs(db: Database.Database, payloads: EnqueuePayload[]): Job[] {
 const jobs: Job[] = [];

 const batchInsert = db.transaction(() => {
 for (const payload of payloads) {
 jobs.push(insertJob(db, payload));
 }
 });

 batchInsert();
 return jobs;
}

export function claimJob(db: Database.Database, workerId: string): Job | null {
 const now = new Date().toISOString();

 const result = db.prepare(
 `UPDATE jobs
 SET state = 'processing',
 worker_id = @workerId,
 locked_at = @now,
 updated_at = @now
 WHERE id = (
 SELECT id FROM jobs
 WHERE state IN ('pending', 'failed')
 AND (run_at IS NULL OR run_at <= @now)
 AND (next_attempt_at IS NULL OR next_attempt_at <= @now)
 ORDER BY priority DESC, created_at ASC
 LIMIT 1
 )
 AND state IN ('pending', 'failed')`,
 ).run({ workerId, now });

 if (result.changes === 0) {
 return null;
 }

 const job = db.prepare(
 `SELECT * FROM jobs WHERE worker_id = @workerId AND state = 'processing' AND locked_at = @now`,
 ).get({ workerId, now }) as Job | undefined;

 return job ?? null;
}

export function completeJob(
 db: Database.Database,
 id: string,
 stdout: string,
 stderr: string,
 exitCode: number,
): void {
 const now = new Date().toISOString();

 db.prepare(
 `UPDATE jobs
 SET state = 'completed',
 stdout = @stdout,
 stderr = @stderr,
 exit_code = @exitCode,
 worker_id = NULL,
 locked_at = NULL,
 updated_at = @now
 WHERE id = @id`,
 ).run({ id, stdout, stderr, exitCode, now });
}

export function failJob(
 db: Database.Database,
 id: string,
 error: string,
 stdout: string,
 stderr: string,
 exitCode: number | null,
 backoffBase: number,
): void {
 const now = new Date().toISOString();

 const job = db.prepare('SELECT attempts, max_retries FROM jobs WHERE id = ?').get(id) as
 | Pick<Job, 'attempts' | 'max_retries'>
 | undefined;

 if (!job) return;

 const newAttempts = job.attempts + 1;

 if (newAttempts >= job.max_retries) {
 
 db.prepare(
 `UPDATE jobs
 SET state = 'dead',
 attempts = @newAttempts,
 last_error = @error,
 stdout = @stdout,
 stderr = @stderr,
 exit_code = @exitCode,
 worker_id = NULL,
 locked_at = NULL,
 next_attempt_at = NULL,
 updated_at = @now
 WHERE id = @id`,
 ).run({ id, newAttempts, error, stdout, stderr, exitCode, now });
 } else {
 
 const nextAttemptAt = computeNextAttemptAt(newAttempts, backoffBase);

 db.prepare(
 `UPDATE jobs
 SET state = 'failed',
 attempts = @newAttempts,
 last_error = @error,
 stdout = @stdout,
 stderr = @stderr,
 exit_code = @exitCode,
 worker_id = NULL,
 locked_at = NULL,
 next_attempt_at = @nextAttemptAt,
 updated_at = @now
 WHERE id = @id`,
 ).run({ id, newAttempts, error, stdout, stderr, exitCode, nextAttemptAt, now });
 }
}

export function getStaleJobs(db: Database.Database, staleTimeoutS: number): Job[] {
 const threshold = new Date(Date.now() - staleTimeoutS * 1000).toISOString();

 return db
 .prepare(
 `SELECT * FROM jobs
 WHERE state = 'processing'
 AND locked_at < @threshold`,
 )
 .all({ threshold }) as Job[];
}

export function reclaimStaleJob(db: Database.Database, job: Job, backoffBase: number): void {
 failJob(
 db,
 job.id,
 `Stale lock recovery: worker ${job.worker_id} did not complete within timeout`,
 job.stdout || '',
 job.stderr || '',
 null,
 backoffBase,
 );
}

export function getJob(db: Database.Database, id: string): Job | null {
 const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | undefined;
 return row ?? null;
}

export function listJobs(
 db: Database.Database,
 state?: JobState,
 limit?: number,
): Job[] {
 let sql = 'SELECT * FROM jobs';
 const params: Record<string, string | number> = {};

 if (state) {
 sql += ' WHERE state = @state';
 params.state = state;
 }

 sql += ' ORDER BY created_at DESC';

 if (limit) {
 sql += ' LIMIT @limit';
 params.limit = limit;
 }

 return db.prepare(sql).all(params) as Job[];
}

export function getJobCounts(db: Database.Database): JobCounts {
 const rows = db
 .prepare("SELECT state, COUNT(*) as count FROM jobs GROUP BY state")
 .all() as Array<{ state: string; count: number }>;

 const counts: JobCounts = {
 pending: 0,
 processing: 0,
 completed: 0,
 failed: 0,
 dead: 0,
 };

 for (const row of rows) {
 if (row.state in counts) {
 counts[row.state as JobState] = row.count;
 }
 }

 return counts;
}

export function getMetrics(db: Database.Database): {
 avgExecutionTimeMs: number | null;
 successRate: number | null;
 totalProcessed: number;
} {
 const completed = db
 .prepare("SELECT COUNT(*) as count FROM jobs WHERE state = 'completed'")
 .get() as { count: number };

 const dead = db
 .prepare("SELECT COUNT(*) as count FROM jobs WHERE state = 'dead'")
 .get() as { count: number };

 const totalProcessed = completed.count + dead.count;
 const successRate = totalProcessed > 0 ? completed.count / totalProcessed : null;

 const avgRow = db
 .prepare(
 `SELECT AVG(
 (julianday(updated_at) - julianday(created_at)) * 86400000
 ) as avg_ms
 FROM jobs WHERE state = 'completed'`,
 )
 .get() as { avg_ms: number | null };

 return {
 avgExecutionTimeMs: avgRow.avg_ms ? Math.round(avgRow.avg_ms) : null,
 successRate,
 totalProcessed,
 };
}

export function listDlq(db: Database.Database, limit?: number): Job[] {
 return listJobs(db, 'dead', limit);
}

export function retryDlqJob(db: Database.Database, id: string): boolean {
 const now = new Date().toISOString();

 const result = db.prepare(
 `UPDATE jobs
 SET state = 'pending',
 attempts = 0,
 last_error = NULL,
 next_attempt_at = NULL,
 worker_id = NULL,
 locked_at = NULL,
 stdout = NULL,
 stderr = NULL,
 exit_code = NULL,
 updated_at = @now
 WHERE id = @id AND state = 'dead'`,
 ).run({ id, now });

 return result.changes > 0;
}

export function retryAllDlq(db: Database.Database): number {
 const now = new Date().toISOString();

 const result = db.prepare(
 `UPDATE jobs
 SET state = 'pending',
 attempts = 0,
 last_error = NULL,
 next_attempt_at = NULL,
 worker_id = NULL,
 locked_at = NULL,
 stdout = NULL,
 stderr = NULL,
 exit_code = NULL,
 updated_at = @now
 WHERE state = 'dead'`,
 ).run({ now });

 return result.changes;
}
