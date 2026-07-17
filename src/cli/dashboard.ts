

import { Command } from 'commander';
import { getDb } from '../core/db';
import { startDashboard } from '../dashboard/server';

export const dashboardCommand = new Command('dashboard')
 .description('Start a read-only web dashboard for monitoring')
 .option('-p, --port <port>', 'Port to listen on', (val) => parseInt(val, 10), 3000)
 .addHelpText(
 'after',
 `
Example:
 $ queuectl dashboard
 Dashboard running at http://localhost:3000

 $ queuectl dashboard --port 8080
 Dashboard running at http://localhost:8080
`,
 )
 .action((options) => {
 const db = getDb();
 startDashboard(db, options.port);
 });
