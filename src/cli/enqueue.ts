/**
 * CLI command: queuectl enqueue
 *
 * Enqueues a new job (or batch of jobs) into the queue.
 *
 * Usage:
 *   queuectl enqueue '{"command":"echo hello"}' [--priority N] [--run-at <iso>] [--timeout <s>]
 *   queuectl enqueue --file jobs.json
 */

import { Command } from 'commander';
import fs from 'fs';
import { getDb } from '../core/db';
import { insertJob, insertJobs, type EnqueuePayload } from '../core/jobRepository';

export const enqueueCommand = new Command('enqueue')
  .description('Add a new job to the queue')
  .argument('[job-json]', 'Job specification as JSON string')
  .option('-p, --priority <n>', 'Job priority (higher = runs first)', parseInt)
  .option('--run-at <iso>', 'Schedule job for a future time (ISO 8601 timestamp)')
  .option('--timeout <seconds>', 'Per-job timeout in seconds', parseInt)
  .option('-f, --file <path>', 'Batch enqueue from a JSON file containing an array of jobs')
  .addHelpText(
    'after',
    `
Examples:
  $ queuectl enqueue '{"command":"echo hello","max_retries":3}'
  $ queuectl enqueue '{"command":"sleep 5"}' --priority 10 --timeout 30
  $ queuectl enqueue '{"command":"curl https://api.example.com"}' --run-at 2025-12-01T10:00:00Z
  $ queuectl enqueue --file jobs.json
`,
  )
  .action((jobJson: string | undefined, options) => {
    const db = getDb();

    try {
      if (options.file) {
        // Batch enqueue from file
        const content = fs.readFileSync(options.file, 'utf-8');
        let payloads: EnqueuePayload[];

        try {
          payloads = JSON.parse(content);
        } catch {
          console.error(`Error: Failed to parse JSON from file "${options.file}"`);
          process.exit(1);
        }

        if (!Array.isArray(payloads)) {
          console.error('Error: File must contain a JSON array of job objects');
          process.exit(1);
        }

        const jobs = insertJobs(db, payloads);
        console.log(`✅ Enqueued ${jobs.length} jobs:`);
        for (const job of jobs) {
          console.log(`   ${job.id}  ${job.command}`);
        }
      } else if (jobJson) {
        // Single job enqueue
        let payload: EnqueuePayload;

        try {
          payload = JSON.parse(jobJson);
        } catch {
          console.error('Error: Invalid JSON. Provide a valid job JSON string.');
          console.error('Example: queuectl enqueue \'{"command":"echo hello"}\'');
          process.exit(1);
        }

        // CLI flags override JSON fields
        if (options.priority !== undefined) payload.priority = options.priority;
        if (options.runAt) payload.run_at = options.runAt;
        if (options.timeout !== undefined) payload.timeout_seconds = options.timeout;

        const job = insertJob(db, payload);
        console.log(`✅ Enqueued job:`);
        console.log(`   ID:          ${job.id}`);
        console.log(`   Command:     ${job.command}`);
        console.log(`   Max Retries: ${job.max_retries}`);
        console.log(`   Priority:    ${job.priority}`);
        if (job.run_at) console.log(`   Run At:      ${job.run_at}`);
        if (job.timeout_seconds) console.log(`   Timeout:     ${job.timeout_seconds}s`);
      } else {
        console.error('Error: Provide a job JSON string or use --file <path>');
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
