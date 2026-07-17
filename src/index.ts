#!/usr/bin/env node

/**
 * QueueCTL — Production-grade CLI background job queue system.
 *
 * Manages background jobs with worker processes, automatic retries
 * with exponential backoff, Dead Letter Queue, and persistent SQLite storage.
 */

import { Command } from 'commander';
import { enqueueCommand } from './cli/enqueue';
import { workerCommand } from './cli/worker';
import { statusCommand } from './cli/status';
import { listCommand } from './cli/list';
import { dlqCommand } from './cli/dlq';
import { logsCommand } from './cli/logs';
import { configCommand } from './cli/configCmd';
import { dashboardCommand } from './cli/dashboard';

const program = new Command();

program
  .name('queuectl')
  .description(
    'Production-grade CLI background job queue with worker processes, retries, and DLQ',
  )
  .version('1.0.0');

// Register all commands
program.addCommand(enqueueCommand);
program.addCommand(workerCommand);
program.addCommand(statusCommand);
program.addCommand(listCommand);
program.addCommand(dlqCommand);
program.addCommand(logsCommand);
program.addCommand(configCommand);
program.addCommand(dashboardCommand);

program.parse(process.argv);
