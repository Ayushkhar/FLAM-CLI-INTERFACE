/**
 * Configuration management for QueueCTL.
 *
 * All tunable parameters (retry count, backoff base, poll interval, timeouts)
 * live in the SQLite `config` table. No hardcoded values anywhere in the
 * system — everything flows through this module.
 */

import type Database from 'better-sqlite3';
import { z } from 'zod';
import { CONFIG_DEFAULTS, type ConfigKey } from '../types';
import { ConfigValidationError } from '../errors';

/** All valid config keys. */
const VALID_KEYS = new Set<string>(Object.keys(CONFIG_DEFAULTS));

/** Zod schema for validating config values by key. */
const configValueSchemas: Record<ConfigKey, z.ZodType> = {
  'max-retries': z.coerce.number().int().min(1).max(100),
  'backoff-base': z.coerce.number().min(1).max(60),
  'poll-interval-ms': z.coerce.number().int().min(100).max(60000),
  'stale-timeout-s': z.coerce.number().int().min(10).max(3600),
  'default-timeout-s': z.coerce.number().int().min(1).max(3600),
};

/** Validates that a key is a known config key. */
function validateKey(key: string): asserts key is ConfigKey {
  if (!VALID_KEYS.has(key)) {
    throw new ConfigValidationError(
      `Unknown config key "${key}". Valid keys: ${[...VALID_KEYS].join(', ')}`,
      key,
      '',
    );
  }
}

/** Get a single config value, falling back to compiled default. */
export function getConfig(db: Database.Database, key: string): string {
  validateKey(key);
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? CONFIG_DEFAULTS[key];
}

/** Get a config value parsed as a number. */
export function getConfigNum(db: Database.Database, key: ConfigKey): number {
  return Number(getConfig(db, key));
}

/** Set a config value, validating it against the key's schema. */
export function setConfig(db: Database.Database, key: string, value: string): void {
  validateKey(key);

  const schema = configValueSchemas[key];
  const result = schema.safeParse(value);

  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join('; ');
    throw new ConfigValidationError(
      `Invalid value "${value}" for config key "${key}": ${issues}`,
      key,
      value,
    );
  }

  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
}

/** List all config values, including defaults for unset keys. */
export function listConfig(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM config').all() as Array<{
    key: string;
    value: string;
  }>;

  const config: Record<string, string> = {};

  // Start with defaults
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    config[key] = value;
  }

  // Override with stored values
  for (const row of rows) {
    config[row.key] = row.value;
  }

  return config;
}
