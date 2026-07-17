

import { Command } from 'commander';
import { getDb } from '../core/db';
import { getJobCounts, getMetrics } from '../core/jobRepository';
import type { WorkerInfo } from '../types';

export const statusCommand = new Command('status')
  .description('Show summary of all job states & active workers')
  .option('--json', 'Output as JSON', false)
  .addHelpText(
    'after',
    `
Example:
  $ queuectl status
  QUEUE STATUS
    pending:     4
    processing:  2
    completed:  118
    failed:      1
    dead:        3

  WORKERS
    worker-1  busy   job=job-42   pid=8213   uptime=3m12s
    worker-2  idle              pid=8214   uptime=3m12s
`,
  )
  .action((options) => {
    const db = getDb();

    const counts = getJobCounts(db);
    const metrics = getMetrics(db);
    const workers = db
      .prepare("SELECT * FROM workers WHERE status IN ('idle', 'busy')")
      .all() as WorkerInfo[];

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            queue: counts,
            metrics: {
              totalProcessed: metrics.totalProcessed,
              successRate: metrics.successRate !== null ? `${(metrics.successRate * 100).toFixed(1)}%` : 'N/A',
              avgExecutionTime: metrics.avgExecutionTimeMs !== null ? `${metrics.avgExecutionTimeMs}ms` : 'N/A',
            },
            workers: workers.map((w) => ({
              id: w.worker_id,
              status: w.status,
              pid: w.pid,
              currentJob: w.current_job_id,
              uptime: formatUptime(w.started_at),
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log('QUEUE STATUS');
    console.log(`  pending:     ${String(counts.pending).padStart(4)}`);
    console.log(`  processing:  ${String(counts.processing).padStart(4)}`);
    console.log(`  completed:   ${String(counts.completed).padStart(4)}`);
    console.log(`  failed:      ${String(counts.failed).padStart(4)}`);
    console.log(`  dead:        ${String(counts.dead).padStart(4)}`);

    if (metrics.totalProcessed > 0) {
      console.log('');
      console.log('METRICS');
      console.log(`  Total Processed: ${metrics.totalProcessed}`);
      console.log(
        `  Success Rate:    ${metrics.successRate !== null ? `${(metrics.successRate * 100).toFixed(1)}%` : 'N/A'}`,
      );
      console.log(
        `  Avg Exec Time:   ${metrics.avgExecutionTimeMs !== null ? `${metrics.avgExecutionTimeMs}ms` : 'N/A'}`,
      );
    }

    console.log('');
    if (workers.length === 0) {
      console.log('WORKERS');
      console.log('  (no active workers)');
    } else {
      console.log('WORKERS');
      for (const w of workers) {
        const jobInfo = w.current_job_id ? `job=${w.current_job_id}` : '';
        const uptime = formatUptime(w.started_at);
        console.log(
          `  ${w.worker_id.padEnd(16)} ${w.status.padEnd(8)} ${jobInfo.padEnd(20)} pid=${w.pid}   uptime=${uptime}`,
        );
      }
    }
  });

function formatUptime(startedAt: string): string {
  const diffMs = Date.now() - new Date(startedAt).getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}
