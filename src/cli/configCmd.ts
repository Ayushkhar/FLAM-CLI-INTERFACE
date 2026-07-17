

import { Command } from 'commander';
import { getDb } from '../core/db';
import { getConfig, setConfig, listConfig } from '../core/config';

const configCommand = new Command('config').description('Manage configuration values');

configCommand
 .command('set')
 .description('Set a configuration value')
 .argument('<key>', 'Configuration key')
 .argument('<value>', 'Configuration value')
 .addHelpText(
 'after',
 `
Valid keys:
 max-retries Default max retries for new jobs (default: 3)
 backoff-base Base for exponential backoff formula (default: 2)
 poll-interval-ms Worker poll interval in milliseconds (default: 500)
 stale-timeout-s Stale lock timeout in seconds (default: 60)
 default-timeout-s Default job timeout in seconds (default: 30)

Examples:
 $ queuectl config set max-retries 5
 $ queuectl config set backoff-base 3
 $ queuectl config set poll-interval-ms 1000
`,
 )
 .action((key: string, value: string) => {
 const db = getDb();

 try {
 setConfig(db, key, value);
 console.log(`Set "${key}" = "${value}"`);
 } catch (err) {
 console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
 process.exit(1);
 }
 });

configCommand
 .command('get')
 .description('Get a configuration value')
 .argument('<key>', 'Configuration key')
 .addHelpText(
 'after',
 `
Example:
 $ queuectl config get max-retries
 max-retries = 3
`,
 )
 .action((key: string) => {
 const db = getDb();

 try {
 const value = getConfig(db, key);
 console.log(`${key} = ${value}`);
 } catch (err) {
 console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
 process.exit(1);
 }
 });

configCommand
 .command('list')
 .description('List all configuration values')
 .option('--json', 'Output as JSON', false)
 .addHelpText(
 'after',
 `
Example:
 $ queuectl config list
 KEY VALUE
 max-retries 3
 backoff-base 2
 poll-interval-ms 500
 stale-timeout-s 60
 default-timeout-s 30
`,
 )
 .action((options) => {
 const db = getDb();
 const config = listConfig(db);

 if (options.json) {
 console.log(JSON.stringify(config, null, 2));
 return;
 }

 const header = `${'KEY'.padEnd(22)} ${'VALUE'}`;
 console.log(header);
 console.log('-'.repeat(40));

 for (const [key, value] of Object.entries(config)) {
 console.log(`${key.padEnd(22)} ${value}`);
 }
 });

export { configCommand };
