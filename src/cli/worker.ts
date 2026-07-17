

import { Command } from 'commander';
import { fork, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getDb, getDbPath } from '../core/db';

const PIDFILE = path.resolve(process.cwd(), '.queuectl-workers.json');

interface WorkerRecord {
 pid: number;
 workerId: string;
}

function savePidfile(records: WorkerRecord[]): void {
 fs.writeFileSync(PIDFILE, JSON.stringify(records, null, 2));
}

function loadPidfile(): WorkerRecord[] {
 try {
 if (fs.existsSync(PIDFILE)) {
 return JSON.parse(fs.readFileSync(PIDFILE, 'utf-8'));
 }
 } catch {
 
 }
 return [];
}

function clearPidfile(): void {
 try {
 if (fs.existsSync(PIDFILE)) {
 fs.unlinkSync(PIDFILE);
 }
 } catch {
 
 }
}

function isProcessAlive(pid: number): boolean {
 try {
 process.kill(pid, 0);
 return true;
 } catch {
 return false;
 }
}

const workerCommand = new Command('worker').description('Manage worker processes');

workerCommand
 .command('start')
 .description('Start one or more worker processes')
 .requiredOption('-c, --count <n>', 'Number of worker processes to start', (val) => parseInt(val, 10))
 .option('--poll-interval <ms>', 'How often idle workers check for new jobs (ms)', (val) => parseInt(val, 10))
 .option('--stale-timeout <s>', 'Stale lock timeout in seconds', (val) => parseInt(val, 10))
 .addHelpText(
 'after',
 `
Examples:
 $ queuectl worker start --count 3
 $ queuectl worker start --count 1 --poll-interval 1000
 $ queuectl worker start --count 5 --stale-timeout 120
`,
 )
 .action((options) => {
 const count = options.count;
 if (!count || count < 1) {
 console.error('Error: --count must be a positive integer');
 process.exit(1);
 }

 getDb();

 const dbPath = getDbPath();
 const workerScript = path.resolve(__dirname, '..', 'worker', 'workerProcess.js');

 const existing = loadPidfile().filter((r) => isProcessAlive(r.pid));
 if (existing.length > 0) {
 console.log(`Warning: ${existing.length} worker(s) already running. Starting ${count} more.`);
 }

 const env: Record<string, string> = {
 ...process.env as Record<string, string>,
 QUEUECTL_DB_PATH: dbPath,
 };

 if (options.pollInterval) {
 env.QUEUECTL_POLL_INTERVAL = String(options.pollInterval);
 }
 if (options.staleTimeout) {
 env.QUEUECTL_STALE_TIMEOUT = String(options.staleTimeout);
 }

 const children: ChildProcess[] = [];
 const records: WorkerRecord[] = [...existing];
 let started = 0;

 console.log(`Starting ${count} worker process(es)...`);

 for (let i = 0; i < count; i++) {
 const child = fork(workerScript, [], {
 env,
 detached: true,
 stdio: 'ignore',
 });

 child.on('message', (msg: { type: string; workerId?: string; pid?: number }) => {
 if (msg.type === 'started' && msg.workerId && msg.pid) {
 started++;
 records.push({ pid: msg.pid, workerId: msg.workerId });
 console.log(` ${msg.workerId} started (pid=${msg.pid})`);

 if (started === count) {
 savePidfile(records);
 console.log(`\nAll ${count} workers started. They will run in the background.`);
 console.log(` Use "queuectl worker stop" to stop them.`);

 for (const c of children) {
 c.disconnect();
 c.unref();
 }
 }
 }
 });

 child.on('error', (err) => {
 console.error(` Error: Worker failed to start: ${err.message}`);
 });

 children.push(child);
 }

 setTimeout(() => {
 if (started < count) {
 console.warn(`\nWarning: Only ${started}/${count} workers sent start confirmation.`);
 savePidfile(records);
 for (const c of children) {
 try {
 c.disconnect();
 c.unref();
 } catch {
 
 }
 }
 }
 }, 10000);
 });

workerCommand
 .command('stop')
 .description('Stop running worker processes gracefully')
 .option('-t, --timeout <seconds>', 'Seconds to wait before force-killing', (val) => parseInt(val, 10), 30)
 .option('--force', 'Force-kill workers immediately', false)
 .addHelpText(
 'after',
 `
Examples:
 $ queuectl worker stop
 $ queuectl worker stop --timeout 60
 $ queuectl worker stop --force
`,
 )
 .action((options) => {
 const records = loadPidfile();
 const alive = records.filter((r) => isProcessAlive(r.pid));

 if (alive.length === 0) {
 console.log('No running workers found.');
 clearPidfile();
 return;
 }

 console.log(`Stopping ${alive.length} worker(s)...`);

 if (options.force) {
 
 for (const r of alive) {
 try {
 process.kill(r.pid, 'SIGKILL');
 console.log(` Force-killed ${r.workerId} (pid=${r.pid})`);
 } catch {
 console.log(` ⚪ ${r.workerId} (pid=${r.pid}) already exited`);
 }
 }
 clearPidfile();

 try {
 const db = getDb();
 for (const r of alive) {
 db.prepare(
 `UPDATE workers SET status = 'stopped', current_job_id = NULL WHERE worker_id = @workerId`,
 ).run({ workerId: r.workerId });
 }
 } catch {
 
 }

 console.log('All workers force-stopped.');
 return;
 }

 for (const r of alive) {
 try {
 process.kill(r.pid, 'SIGTERM');
 console.log(` 📤 Sent stop signal to ${r.workerId} (pid=${r.pid})`);
 } catch {
 console.log(` ⚪ ${r.workerId} (pid=${r.pid}) already exited`);
 }
 }

 const timeoutMs = (options.timeout || 30) * 1000;
 const startTime = Date.now();

 console.log(` Waiting up to ${options.timeout || 30}s for workers to finish...`);

 const checkInterval = setInterval(() => {
 const stillAlive = alive.filter((r) => isProcessAlive(r.pid));

 if (stillAlive.length === 0) {
 clearInterval(checkInterval);
 clearPidfile();
 console.log('All workers stopped gracefully.');
 process.exit(0);
 }

 if (Date.now() - startTime > timeoutMs) {
 clearInterval(checkInterval);
 console.warn(`Warning: Timeout reached. ${stillAlive.length} worker(s) still running.`);

 for (const r of stillAlive) {
 try {
 process.kill(r.pid, 'SIGKILL');
 console.log(` Force-killed ${r.workerId} (pid=${r.pid})`);
 } catch {
 
 }
 }

 clearPidfile();
 console.log('All workers stopped (some force-killed).');
 process.exit(0);
 }
 }, 500);
 });

export { workerCommand };
