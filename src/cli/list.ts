/**
 * CLI command: queuectl list
 *
 * Lists jobs filtered by state with optional limit.
 *
 * Usage:
 *   queuectl list --state pending [--limit 10] [--json]
 */

import { Command } from 'commander';
import { getDb } from '../core/db';
import { listJobs } from '../core/jobRepository';
import type { JobState } from '../types';

const VALID_STATES: JobState[] = ['pending', 'processing', 'completed', 'failed', 'dead'];

export const listCommand = new Command('list')
  .description('List jobs by state')
  .requiredOption('-s, --state <state>', `Job state to filter by (${VALID_STATES.join('|')})`)
  .option('-l, --limit <n>', 'Maximum number of jobs to show', (val) => parseInt(val, 10))
  .option('--json', 'Output as JSON', false)
  .addHelpText(
    'after',
    `
Examples:
  $ queuectl list --state pending
  $ queuectl list --state completed --limit 5
  $ queuectl list --state dead --json
`,
  )
  .action((options) => {
    const state = options.state as string;

    if (!VALID_STATES.includes(state as JobState)) {
      console.error(`Error: Invalid state "${state}". Must be one of: ${VALID_STATES.join(', ')}`);
      process.exit(1);
    }

    const db = getDb();
    const jobs = listJobs(db, state as JobState, options.limit);

    if (options.json) {
      console.log(JSON.stringify(jobs, null, 2));
      return;
    }

    if (jobs.length === 0) {
      console.log(`No jobs in "${state}" state.`);
      return;
    }

    // Table header
    const header = `${'ID'.padEnd(38)} ${'COMMAND'.padEnd(30)} ${'ATTEMPTS'.padEnd(10)} ${'CREATED'.padEnd(24)} ${'LAST ERROR'}`;
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const job of jobs) {
      const cmd = job.command.length > 28 ? job.command.slice(0, 25) + '...' : job.command;
      const attempts = `${job.attempts}/${job.max_retries}`;
      const error = job.last_error ? (job.last_error.length > 30 ? job.last_error.slice(0, 27) + '...' : job.last_error) : '';
      console.log(
        `${job.id.padEnd(38)} ${cmd.padEnd(30)} ${attempts.padEnd(10)} ${job.created_at.padEnd(24)} ${error}`,
      );
    }

    console.log(`\nTotal: ${jobs.length} job(s)`);
  });
