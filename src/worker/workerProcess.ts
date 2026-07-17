/**
 * Worker Process — the forked child's main loop.
 *
 * This file is the entry point for each forked worker process.
 * It runs as a separate OS process (via child_process.fork),
 * connecting to the same SQLite file in WAL mode.
 *
 * Main loop:
 * 1. Check for stop signal
 * 2. Run stale-lock reaper
 * 3. Update heartbeat
 * 4. Attempt to claim a job (atomic UPDATE)
 * 5. If claimed: execute command, update job state
 * 6. If not claimed: sleep poll-interval-ms, repeat
 *
 * IPC protocol:
 * - Parent sends { type: 'stop' } → finish current job, exit cleanly
 * - Parent sends { type: 'stop-force' } → exit immediately
 * - Child sends { type: 'started', workerId, pid }
 * - Child sends { type: 'stopped', workerId }
 */

import { randomUUID } from 'crypto';
import { openDb } from '../core/db';
import { getConfigNum } from '../core/config';
import { claimJob, completeJob, failJob } from '../core/jobRepository';
import { executeCommand } from '../core/executor';
import { reapStaleJobs } from './reaper';
import type Database from 'better-sqlite3';
import type { Job } from '../types';

// ─── State ────────────────────────────────────────────────────────────────────

let stopping = false;
let currentlyExecuting = false;
const workerId = `worker-${randomUUID().slice(0, 8)}`;

// Get DB path and config overrides from the parent process
const dbPath = process.env.QUEUECTL_DB_PATH || undefined;
const pollIntervalOverride = process.env.QUEUECTL_POLL_INTERVAL
  ? Number(process.env.QUEUECTL_POLL_INTERVAL)
  : undefined;

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

process.on('message', (msg: { type: string }) => {
  if (msg.type === 'stop') {
    stopping = true;
    if (!currentlyExecuting) {
      shutdown(db);
    }
    // If currently executing, the main loop will exit after the job finishes
  } else if (msg.type === 'stop-force') {
    shutdownImmediate(db);
  }
});

// Handle SIGTERM for graceful shutdown
process.on('SIGTERM', () => {
  stopping = true;
  if (!currentlyExecuting) {
    shutdown(db);
  }
});

// Handle SIGINT
process.on('SIGINT', () => {
  stopping = true;
  if (!currentlyExecuting) {
    shutdown(db);
  }
});

// ─── Database Connection ──────────────────────────────────────────────────────

const db = openDb(dbPath);

// ─── Worker Registration ──────────────────────────────────────────────────────

function registerWorker(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO workers (worker_id, pid, status, current_job_id, started_at, last_heartbeat)
     VALUES (@workerId, @pid, 'idle', NULL, @now, @now)`,
  ).run({ workerId, pid: process.pid, now });
}

function updateHeartbeat(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE workers SET last_heartbeat = @now WHERE worker_id = @workerId`,
  ).run({ workerId, now });
}

function setWorkerBusy(db: Database.Database, jobId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE workers SET status = 'busy', current_job_id = @jobId, last_heartbeat = @now
     WHERE worker_id = @workerId`,
  ).run({ workerId, jobId, now });
}

function setWorkerIdle(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE workers SET status = 'idle', current_job_id = NULL, last_heartbeat = @now
     WHERE worker_id = @workerId`,
  ).run({ workerId, now });
}

function setWorkerStopped(db: Database.Database): void {
  db.prepare(
    `UPDATE workers SET status = 'stopped', current_job_id = NULL
     WHERE worker_id = @workerId`,
  ).run({ workerId });
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────

function shutdown(db: Database.Database): void {
  setWorkerStopped(db);
  if (process.send) {
    process.send({ type: 'stopped', workerId });
  }
  db.close();
  process.exit(0);
}

function shutdownImmediate(db: Database.Database): void {
  try {
    setWorkerStopped(db);
    db.close();
  } catch {
    // Best effort on force shutdown
  }
  process.exit(0);
}

// ─── Job Processing ───────────────────────────────────────────────────────────

async function processJob(db: Database.Database, job: Job): Promise<void> {
  currentlyExecuting = true;
  setWorkerBusy(db, job.id);

  const defaultTimeoutS = getConfigNum(db, 'default-timeout-s');
  const backoffBase = getConfigNum(db, 'backoff-base');
  const timeoutSeconds = job.timeout_seconds ?? defaultTimeoutS;

  try {
    const result = await executeCommand(job.command, timeoutSeconds);

    if (result.timedOut) {
      // Timeout → treat as failure
      failJob(db, job.id, `timeout after ${timeoutSeconds}s`, result.stdout, result.stderr, null, backoffBase);
    } else if (result.exitCode === 0) {
      // Success
      completeJob(db, job.id, result.stdout, result.stderr, 0);
    } else {
      // Non-zero exit code → failure
      const errorMsg = result.error || `exit code ${result.exitCode}`;
      failJob(db, job.id, errorMsg, result.stdout, result.stderr, result.exitCode, backoffBase);
    }
  } catch (err) {
    // Unexpected error during execution
    const errorMsg = err instanceof Error ? err.message : String(err);
    failJob(db, job.id, errorMsg, '', '', null, backoffBase);
  }

  currentlyExecuting = false;
  setWorkerIdle(db);
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function mainLoop(): Promise<void> {
  registerWorker(db);

  // Notify parent that we're started
  if (process.send) {
    process.send({ type: 'started', workerId, pid: process.pid });
  }

  const pollIntervalMs = pollIntervalOverride ?? getConfigNum(db, 'poll-interval-ms');
  let reapCounter = 0;

  while (!stopping) {
    try {
      // Update heartbeat
      updateHeartbeat(db);

      // Run reaper every 10 poll cycles (not every cycle, to reduce overhead)
      reapCounter++;
      if (reapCounter >= 10) {
        reapStaleJobs(db, workerId);
        reapCounter = 0;
      }

      // Try to claim a job
      const job = claimJob(db, workerId);

      if (job) {
        await processJob(db, job);

        // After processing, check if we should stop
        if (stopping) {
          break;
        }
      } else {
        // Nothing to claim — sleep and try again
        await sleep(pollIntervalMs);
      }
    } catch (err) {
      // Don't let any error crash the worker
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (process.send) {
        process.send({ type: 'error', workerId, error: errorMsg });
      }
      // Brief sleep before retrying to avoid tight error loops
      await sleep(1000);
    }
  }

  shutdown(db);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Start ────────────────────────────────────────────────────────────────────

mainLoop().catch((err) => {
  console.error(`Worker ${workerId} fatal error:`, err);
  try {
    setWorkerStopped(db);
    db.close();
  } catch {
    // Best effort
  }
  process.exit(1);
});
