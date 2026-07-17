/**
 * Job Repository — all SQL operations for the jobs table.
 *
 * This module contains the atomic job claim query, which is the single most
 * important piece of code for concurrency correctness. The claim uses a
 * single UPDATE...WHERE id = (SELECT...) statement so two workers can never
 * grab the same row, even if they execute at the exact same time.
 */

import type Database from 'better-sqlite3';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { Job, JobCounts, JobState } from '../types';
import { computeNextAttemptAt } from './backoff';
import { getConfigValue } from './db';
import { ValidationError } from '../errors';

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const EnqueuePayloadSchema = z.object({
  id: z.string().min(1).optional(),
  command: z.string().min(1, 'command is required'),
  max_retries: z.number().int().min(1).optional(),
  priority: z.number().int().optional(),
  run_at: z.string().datetime({ offset: true }).optional(),
  timeout_seconds: z.number().int().min(1).optional(),
});

export type EnqueuePayload = z.infer<typeof EnqueuePayloadSchema>;

// ─── Insert ───────────────────────────────────────────────────────────────────

/** Inserts a single job into the queue. */
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

/** Batch-inserts multiple jobs in a single transaction. */
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

// ─── Atomic Claim ─────────────────────────────────────────────────────────────

/**
 * Atomically claims the next eligible job for a worker.
 *
 * This is a single UPDATE statement with a subquery SELECT — NOT a
 * read-then-write pattern. This guarantees that even with multiple worker
 * processes executing simultaneously, no two workers can ever claim the
 * same job.
 *
 * After running, check `result.changes`:
 * - changes === 1 → this worker won the claim
 * - changes === 0 → nothing was claimable right now
 *
 * @returns The claimed Job, or null if nothing was available.
 */
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

  // Fetch the claimed job
  const job = db.prepare(
    `SELECT * FROM jobs WHERE worker_id = @workerId AND state = 'processing' AND locked_at = @now`,
  ).get({ workerId, now }) as Job | undefined;

  return job ?? null;
}

// ─── Job Completion ───────────────────────────────────────────────────────────

/** Marks a job as completed (exit code 0). */
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

// ─── Job Failure ──────────────────────────────────────────────────────────────

/**
 * Handles a job failure: increments attempts, then either retries with
 * backoff or moves to DLQ (dead state).
 *
 * Attempt-counting semantics:
 * - `attempts` = number of executions consumed so far
 * - On failure, we increment attempts by 1
 * - If `attempts >= max_retries` → state = 'dead' (DLQ)
 * - Else → state = 'failed', next_attempt_at set by backoff formula
 *
 * max_retries is interpreted as "maximum total attempts allowed" (not
 * "retries after the first try"). E.g., max_retries=3 means exactly
 * 3 total executions, then DLQ.
 */
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

  // Fetch current attempts and max_retries
  const job = db.prepare('SELECT attempts, max_retries FROM jobs WHERE id = ?').get(id) as
    | Pick<Job, 'attempts' | 'max_retries'>
    | undefined;

  if (!job) return;

  const newAttempts = job.attempts + 1;

  if (newAttempts >= job.max_retries) {
    // Exhausted all retries → move to DLQ
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
    // Still has retries left → schedule next attempt with backoff
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

// ─── Stale Job Recovery ───────────────────────────────────────────────────────

/** Finds jobs that are stuck in 'processing' beyond the stale timeout. */
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

/**
 * Reclaims a stale job — same logic as failJob but explicitly clears
 * the worker lock and uses "stale lock recovery" as the error reason.
 */
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

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Gets a single job by ID. */
export function getJob(db: Database.Database, id: string): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | undefined;
  return row ?? null;
}

/** Lists jobs filtered by state, with optional limit. */
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

/** Gets job counts grouped by state. */
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

/** Gets aggregate metrics: average execution time and success rate. */
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

  // Average execution time: difference between locked_at and updated_at for completed jobs
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

// ─── DLQ Operations ───────────────────────────────────────────────────────────

/** Lists all jobs in the Dead Letter Queue (state = 'dead'). */
export function listDlq(db: Database.Database, limit?: number): Job[] {
  return listJobs(db, 'dead', limit);
}

/** Retries a single DLQ job — resets it to pending with zero attempts. */
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

/** Retries all DLQ jobs — resets them all to pending. */
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
