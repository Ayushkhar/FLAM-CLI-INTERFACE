

import Database from 'better-sqlite3';
import path from 'path';
import { CONFIG_DEFAULTS, type ConfigKey } from '../types';
import { DatabaseError } from '../errors';

let dbInstance: Database.Database | null = null;

export function getDbPath(): string {
  return process.env.QUEUECTL_DB_PATH || path.resolve(process.cwd(), 'queuectl.db');
}

export function getDb(dbPath?: string): Database.Database {
  if (dbInstance) return dbInstance;

  const resolvedPath = dbPath || getDbPath();

  try {
    dbInstance = new Database(resolvedPath);
  } catch (err) {
    throw new DatabaseError(
      `Failed to open database at ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`,
      'open',
    );
  }

  dbInstance.pragma('journal_mode = WAL');

  dbInstance.pragma('busy_timeout = 5000');

  dbInstance.pragma('foreign_keys = ON');

  runMigrations(dbInstance);
  seedDefaults(dbInstance);

  return dbInstance;
}

export function openDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath || getDbPath();

  let db: Database.Database;
  try {
    db = new Database(resolvedPath);
  } catch (err) {
    throw new DatabaseError(
      `Failed to open database at ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`,
      'open',
    );
  }

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  seedDefaults(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id                TEXT PRIMARY KEY,
      command           TEXT NOT NULL,
      state             TEXT NOT NULL DEFAULT 'pending',
      attempts          INTEGER NOT NULL DEFAULT 0,
      max_retries       INTEGER NOT NULL,
      priority          INTEGER NOT NULL DEFAULT 0,
      run_at            TEXT,
      next_attempt_at   TEXT,
      timeout_seconds   INTEGER,
      worker_id         TEXT,
      locked_at         TEXT,
      last_error        TEXT,
      stdout            TEXT,
      stderr            TEXT,
      exit_code         INTEGER,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workers (
      worker_id       TEXT PRIMARY KEY,
      pid             INTEGER NOT NULL,
      status          TEXT NOT NULL,
      current_job_id  TEXT,
      started_at      TEXT NOT NULL,
      last_heartbeat  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
    CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_jobs_next_attempt ON jobs(next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
  `);
}

function seedDefaults(db: Database.Database): void {
  const insert = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');

  const seedAll = db.transaction(() => {
    for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
      insert.run(key, value);
    }
  });

  seedAll();
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function resetDbInstance(): void {
  dbInstance = null;
}

export function getConfigValue(db: Database.Database, key: ConfigKey): string {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? CONFIG_DEFAULTS[key];
}
