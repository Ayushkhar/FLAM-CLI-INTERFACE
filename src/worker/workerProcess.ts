

import { randomUUID } from 'crypto';
import { openDb } from '../core/db';
import { getConfigNum } from '../core/config';
import { claimJob, completeJob, failJob } from '../core/jobRepository';
import { executeCommand } from '../core/executor';
import { reapStaleJobs } from './reaper';
import type Database from 'better-sqlite3';
import type { Job } from '../types';

let stopping = false;
let currentlyExecuting = false;
const workerId = `worker-${randomUUID().slice(0, 8)}`;

const dbPath = process.env.QUEUECTL_DB_PATH || undefined;
const pollIntervalOverride = process.env.QUEUECTL_POLL_INTERVAL
 ? Number(process.env.QUEUECTL_POLL_INTERVAL)
 : undefined;

process.on('message', (msg: { type: string }) => {
 if (msg.type === 'stop') {
 stopping = true;
 if (!currentlyExecuting) {
 shutdown(db);
 }
 
 } else if (msg.type === 'stop-force') {
 shutdownImmediate(db);
 }
});

process.on('SIGTERM', () => {
 stopping = true;
 if (!currentlyExecuting) {
 shutdown(db);
 }
});

process.on('SIGINT', () => {
 stopping = true;
 if (!currentlyExecuting) {
 shutdown(db);
 }
});

const db = openDb(dbPath);

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
 
 }
 process.exit(0);
}

async function processJob(db: Database.Database, job: Job): Promise<void> {
 currentlyExecuting = true;
 setWorkerBusy(db, job.id);

 const defaultTimeoutS = getConfigNum(db, 'default-timeout-s');
 const backoffBase = getConfigNum(db, 'backoff-base');
 const timeoutSeconds = job.timeout_seconds ?? defaultTimeoutS;

 try {
 const result = await executeCommand(job.command, timeoutSeconds);

 if (result.timedOut) {
 
 failJob(db, job.id, `timeout after ${timeoutSeconds}s`, result.stdout, result.stderr, null, backoffBase);
 } else if (result.exitCode === 0) {
 
 completeJob(db, job.id, result.stdout, result.stderr, 0);
 } else {
 
 const errorMsg = result.error || `exit code ${result.exitCode}`;
 failJob(db, job.id, errorMsg, result.stdout, result.stderr, result.exitCode, backoffBase);
 }
 } catch (err) {
 
 const errorMsg = err instanceof Error ? err.message : String(err);
 failJob(db, job.id, errorMsg, '', '', null, backoffBase);
 }

 currentlyExecuting = false;
 setWorkerIdle(db);
}

async function mainLoop(): Promise<void> {
 registerWorker(db);

 if (process.send) {
 process.send({ type: 'started', workerId, pid: process.pid });
 }

 const pollIntervalMs = pollIntervalOverride ?? getConfigNum(db, 'poll-interval-ms');
 let reapCounter = 0;

 while (!stopping) {
 try {
 
 updateHeartbeat(db);

 reapCounter++;
 if (reapCounter >= 10) {
 reapStaleJobs(db, workerId);
 reapCounter = 0;
 }

 const job = claimJob(db, workerId);

 if (job) {
 await processJob(db, job);

 if (stopping) {
 break;
 }
 } else {
 
 await sleep(pollIntervalMs);
 }
 } catch (err) {
 
 const errorMsg = err instanceof Error ? err.message : String(err);
 if (process.send) {
 process.send({ type: 'error', workerId, error: errorMsg });
 }
 
 await sleep(1000);
 }
 }

 shutdown(db);
}

function sleep(ms: number): Promise<void> {
 return new Promise((resolve) => setTimeout(resolve, ms));
}

mainLoop().catch((err) => {
 console.error(`Worker ${workerId} fatal error:`, err);
 try {
 setWorkerStopped(db);
 db.close();
 } catch {
 
 }
 process.exit(1);
});
