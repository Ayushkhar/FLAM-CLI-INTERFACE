

import { Command } from 'commander';
import { getDb } from '../core/db';
import { getJob } from '../core/jobRepository';

export const logsCommand = new Command('logs')
  .description('Show captured stdout/stderr for a job')
  .argument('<job-id>', 'The job ID to show logs for')
  .option('--json', 'Output as JSON', false)
  .addHelpText(
    'after',
    `
Example:
  $ queuectl logs job-42
  ╔══════════════════════════════════════════╗
  ║ Job: job-42                              ║
  ║ State: completed  Attempts: 1/3          ║
  ╚══════════════════════════════════════════╝

  ── stdout ──
  Hello World

  ── stderr ──
  (empty)
`,
  )
  .action((jobId: string, options) => {
    const db = getDb();
    const job = getJob(db, jobId);

    if (!job) {
      console.error(`Error: Job "${jobId}" not found.`);
      process.exit(1);
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            id: job.id,
            command: job.command,
            state: job.state,
            attempts: job.attempts,
            max_retries: job.max_retries,
            exit_code: job.exit_code,
            last_error: job.last_error,
            stdout: job.stdout,
            stderr: job.stderr,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(`╔${'═'.repeat(50)}╗`);
    console.log(`║ Job: ${job.id.padEnd(44)}║`);
    console.log(
      `║ State: ${job.state.padEnd(12)} Attempts: ${job.attempts}/${job.max_retries}`.padEnd(51) + '║',
    );
    if (job.last_error) {
      console.log(`║ Error: ${job.last_error.slice(0, 42).padEnd(43)}║`);
    }
    if (job.exit_code !== null) {
      console.log(`║ Exit Code: ${String(job.exit_code).padEnd(38)}║`);
    }
    console.log(`╚${'═'.repeat(50)}╝`);

    console.log('\n── stdout ──');
    console.log(job.stdout || '(empty)');

    console.log('\n── stderr ──');
    console.log(job.stderr || '(empty)');
  });
