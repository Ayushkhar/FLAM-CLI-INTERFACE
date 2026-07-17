/**
 * Unit tests for job repository — insert, claim, state transitions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  insertJob,
  insertJobs,
  claimJob,
  completeJob,
  failJob,
  getJob,
  listJobs,
  getJobCounts,
  retryDlqJob,
  retryAllDlq,
  getStaleJobs,
  reclaimStaleJob,
} from '../../src/core/jobRepository';
import { CONFIG_DEFAULTS } from '../../src/types';

let db: Database.Database;
let dbPath: string;

function setupDb(): Database.Database {
  dbPath = path.join(os.tmpdir(), `queuectl-test-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');

  database.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, command TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0, run_at TEXT, next_attempt_at TEXT,
      timeout_seconds INTEGER, worker_id TEXT, locked_at TEXT, last_error TEXT,
      stdout TEXT, stderr TEXT, exit_code INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  // Seed config defaults
  const insert = database.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    insert.run(key, value);
  }

  return database;
}

beforeEach(() => {
  db = setupDb();
});

afterEach(() => {
  db.close();
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch {}
});

describe('insertJob', () => {
  it('should insert a job with correct defaults', () => {
    const job = insertJob(db, { command: 'echo hello', id: 'j1' });
    expect(job.id).toBe('j1');
    expect(job.command).toBe('echo hello');
    expect(job.state).toBe('pending');
    expect(job.attempts).toBe(0);
    expect(job.max_retries).toBe(3); // default from config
    expect(job.priority).toBe(0);
  });

  it('should auto-generate UUID if id not provided', () => {
    const job = insertJob(db, { command: 'echo test' });
    expect(job.id).toBeTruthy();
    expect(job.id.length).toBeGreaterThan(0);
  });

  it('should respect provided max_retries', () => {
    const job = insertJob(db, { command: 'echo test', max_retries: 5 });
    expect(job.max_retries).toBe(5);
  });

  it('should reject invalid payloads', () => {
    expect(() => insertJob(db, { command: '' })).toThrow();
    // @ts-expect-error — testing runtime validation
    expect(() => insertJob(db, {})).toThrow();
  });
});

describe('insertJobs (batch)', () => {
  it('should insert multiple jobs in a transaction', () => {
    const jobs = insertJobs(db, [
      { command: 'echo 1', id: 'b1' },
      { command: 'echo 2', id: 'b2' },
      { command: 'echo 3', id: 'b3' },
    ]);
    expect(jobs.length).toBe(3);
    expect(getJobCounts(db).pending).toBe(3);
  });
});

describe('claimJob', () => {
  it('should claim a pending job and set state to processing', () => {
    insertJob(db, { command: 'echo hello', id: 'c1' });
    const claimed = claimJob(db, 'worker-1');
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe('c1');
    expect(claimed!.state).toBe('processing');
    expect(claimed!.worker_id).toBe('worker-1');
  });

  it('should return null when no jobs are available', () => {
    const claimed = claimJob(db, 'worker-1');
    expect(claimed).toBeNull();
  });

  it('should NOT allow double-claiming the same job', () => {
    insertJob(db, { command: 'echo hello', id: 'c2' });
    const first = claimJob(db, 'worker-1');
    const second = claimJob(db, 'worker-2');
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('should claim by priority (higher first)', () => {
    insertJob(db, { command: 'low', id: 'low', priority: 1 });
    insertJob(db, { command: 'high', id: 'high', priority: 10 });
    insertJob(db, { command: 'mid', id: 'mid', priority: 5 });

    const first = claimJob(db, 'w1');
    expect(first!.id).toBe('high');

    const second = claimJob(db, 'w2');
    expect(second!.id).toBe('mid');

    const third = claimJob(db, 'w3');
    expect(third!.id).toBe('low');
  });

  it('should respect run_at scheduling', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    insertJob(db, { command: 'future', id: 'fut', run_at: future });
    const claimed = claimJob(db, 'w1');
    expect(claimed).toBeNull(); // Not yet eligible
  });

  it('should claim failed jobs with elapsed next_attempt_at', () => {
    insertJob(db, { command: 'echo retry', id: 'r1' });

    // Claim and fail it
    claimJob(db, 'w1');
    failJob(db, 'r1', 'test error', '', '', 1, 2);

    // Manually set next_attempt_at to the past so it's eligible
    db.prepare("UPDATE jobs SET next_attempt_at = '2020-01-01T00:00:00Z' WHERE id = 'r1'").run();

    const reclaimed = claimJob(db, 'w2');
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.id).toBe('r1');
  });
});

describe('completeJob', () => {
  it('should set state to completed with output', () => {
    insertJob(db, { command: 'echo hello', id: 'comp1' });
    claimJob(db, 'w1');
    completeJob(db, 'comp1', 'hello\n', '', 0);

    const job = getJob(db, 'comp1');
    expect(job!.state).toBe('completed');
    expect(job!.stdout).toBe('hello\n');
    expect(job!.exit_code).toBe(0);
    expect(job!.worker_id).toBeNull();
    expect(job!.locked_at).toBeNull();
  });
});

describe('failJob', () => {
  it('should increment attempts and set state to failed when retries remain', () => {
    insertJob(db, { command: 'exit 1', id: 'f1', max_retries: 3 });
    claimJob(db, 'w1');
    failJob(db, 'f1', 'exit code 1', '', '', 1, 2);

    const job = getJob(db, 'f1');
    expect(job!.state).toBe('failed');
    expect(job!.attempts).toBe(1);
    expect(job!.next_attempt_at).not.toBeNull();
    expect(job!.worker_id).toBeNull();
  });

  it('should move to dead state when max_retries exhausted', () => {
    insertJob(db, { command: 'exit 1', id: 'f2', max_retries: 1 });
    claimJob(db, 'w1');
    failJob(db, 'f2', 'exit code 1', '', '', 1, 2);

    const job = getJob(db, 'f2');
    expect(job!.state).toBe('dead');
    expect(job!.attempts).toBe(1);
  });

  it('should move to dead after exactly max_retries attempts', () => {
    insertJob(db, { command: 'fail', id: 'f3', max_retries: 3 });

    // Attempt 1
    claimJob(db, 'w1');
    failJob(db, 'f3', 'error', '', '', 1, 2);
    expect(getJob(db, 'f3')!.state).toBe('failed');
    expect(getJob(db, 'f3')!.attempts).toBe(1);

    // Make eligible for reclaim
    db.prepare("UPDATE jobs SET next_attempt_at = '2020-01-01T00:00:00Z' WHERE id = 'f3'").run();

    // Attempt 2
    claimJob(db, 'w1');
    failJob(db, 'f3', 'error', '', '', 1, 2);
    expect(getJob(db, 'f3')!.state).toBe('failed');
    expect(getJob(db, 'f3')!.attempts).toBe(2);

    // Make eligible for reclaim
    db.prepare("UPDATE jobs SET next_attempt_at = '2020-01-01T00:00:00Z' WHERE id = 'f3'").run();

    // Attempt 3 — should move to dead
    claimJob(db, 'w1');
    failJob(db, 'f3', 'error', '', '', 1, 2);
    expect(getJob(db, 'f3')!.state).toBe('dead');
    expect(getJob(db, 'f3')!.attempts).toBe(3);
  });
});

describe('DLQ operations', () => {
  it('should retry a dead job back to pending', () => {
    insertJob(db, { command: 'fail', id: 'dlq1', max_retries: 1 });
    claimJob(db, 'w1');
    failJob(db, 'dlq1', 'error', '', '', 1, 2);
    expect(getJob(db, 'dlq1')!.state).toBe('dead');

    retryDlqJob(db, 'dlq1');
    const job = getJob(db, 'dlq1');
    expect(job!.state).toBe('pending');
    expect(job!.attempts).toBe(0);
  });

  it('should retry all dead jobs', () => {
    insertJob(db, { command: 'fail1', id: 'dlq2', max_retries: 1 });
    insertJob(db, { command: 'fail2', id: 'dlq3', max_retries: 1 });

    claimJob(db, 'w1');
    failJob(db, 'dlq2', 'err', '', '', 1, 2);

    claimJob(db, 'w1');
    failJob(db, 'dlq3', 'err', '', '', 1, 2);

    const count = retryAllDlq(db);
    expect(count).toBe(2);
    expect(getJob(db, 'dlq2')!.state).toBe('pending');
    expect(getJob(db, 'dlq3')!.state).toBe('pending');
  });
});

describe('stale job recovery', () => {
  it('should detect stale processing jobs', () => {
    insertJob(db, { command: 'echo stale', id: 'stale1' });
    claimJob(db, 'dead-worker');

    // Simulate stale lock — set locked_at to 120 seconds ago
    const oldTime = new Date(Date.now() - 120000).toISOString();
    db.prepare("UPDATE jobs SET locked_at = ? WHERE id = 'stale1'").run(oldTime);

    const stale = getStaleJobs(db, 60); // 60s timeout
    expect(stale.length).toBe(1);
    expect(stale[0].id).toBe('stale1');
  });

  it('should reclaim stale jobs using standard fail logic', () => {
    insertJob(db, { command: 'echo stale', id: 'stale2', max_retries: 3 });
    claimJob(db, 'dead-worker');

    const oldTime = new Date(Date.now() - 120000).toISOString();
    db.prepare("UPDATE jobs SET locked_at = ? WHERE id = 'stale2'").run(oldTime);

    const stale = getStaleJobs(db, 60);
    reclaimStaleJob(db, stale[0], 2);

    const job = getJob(db, 'stale2');
    expect(job!.state).toBe('failed'); // reclaimed, not dead (still has retries)
    expect(job!.attempts).toBe(1);
    expect(job!.worker_id).toBeNull();
    expect(job!.locked_at).toBeNull();
    expect(job!.last_error).toContain('Stale lock recovery');
  });
});
