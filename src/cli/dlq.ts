

import { Command } from 'commander';
import { getDb } from '../core/db';
import { listDlq, retryDlqJob, retryAllDlq, getJob } from '../core/jobRepository';

const dlqCommand = new Command('dlq').description('View or retry Dead Letter Queue jobs');

dlqCommand
  .command('list')
  .description('List all jobs in the Dead Letter Queue')
  .option('--json', 'Output as JSON', false)
  .option('-l, --limit <n>', 'Maximum number of jobs to show', (val) => parseInt(val, 10))
  .addHelpText(
    'after',
    `
Example:
  $ queuectl dlq list
  ID       COMMAND                     ATTEMPTS  LAST ERROR
  job-17   curl badhost.example.com    3         exit code 6
  job-31   nonexistent-cmd             3         command not found
`,
  )
  .action((options) => {
    const db = getDb();
    const jobs = listDlq(db, options.limit);

    if (options.json) {
      console.log(JSON.stringify(jobs, null, 2));
      return;
    }

    if (jobs.length === 0) {
      console.log('DLQ is empty. No permanently failed jobs.');
      return;
    }

    const header = `${'ID'.padEnd(38)} ${'COMMAND'.padEnd(30)} ${'ATTEMPTS'.padEnd(10)} ${'LAST ERROR'}`;
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const job of jobs) {
      const cmd = job.command.length > 28 ? job.command.slice(0, 25) + '...' : job.command;
      const error = job.last_error || 'unknown';
      const errorDisplay = error.length > 40 ? error.slice(0, 37) + '...' : error;
      console.log(
        `${job.id.padEnd(38)} ${cmd.padEnd(30)} ${String(job.attempts).padEnd(10)} ${errorDisplay}`,
      );
    }

    console.log(`\nTotal: ${jobs.length} dead job(s)`);
  });

dlqCommand
  .command('retry [job-id]')
  .description('Retry a DLQ job (or all with --all)')
  .option('--all', 'Retry all DLQ jobs', false)
  .addHelpText(
    'after',
    `
Examples:
  $ queuectl dlq retry job-17
  $ queuectl dlq retry --all
`,
  )
  .action((jobId: string | undefined, options) => {
    const db = getDb();

    if (options.all) {
      const count = retryAllDlq(db);
      if (count === 0) {
        console.log('ℹ️  No DLQ jobs to retry.');
      } else {
        console.log(`✅ Retried ${count} DLQ job(s). They are now in "pending" state.`);
      }
      return;
    }

    if (!jobId) {
      console.error('Error: Provide a job ID or use --all');
      process.exit(1);
    }

    const job = getJob(db, jobId);
    if (!job) {
      console.error(`Error: Job "${jobId}" not found.`);
      process.exit(1);
    }

    if (job.state !== 'dead') {
      console.error(`Error: Job "${jobId}" is in "${job.state}" state, not in DLQ.`);
      process.exit(1);
    }

    const success = retryDlqJob(db, jobId);
    if (success) {
      console.log(`✅ Job "${jobId}" moved from DLQ back to "pending". It will be retried.`);
    } else {
      console.error(`Error: Failed to retry job "${jobId}".`);
      process.exit(1);
    }
  });

export { dlqCommand };
