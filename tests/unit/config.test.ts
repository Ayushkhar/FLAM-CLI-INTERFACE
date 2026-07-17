/**
 * Unit tests for config management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { getConfig, setConfig, listConfig, getConfigNum } from '../../src/core/config';
import { CONFIG_DEFAULTS } from '../../src/types';

let db: Database.Database;
let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `queuectl-test-config-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create config table and seed defaults
  db.exec('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const insert = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    insert.run(key, value);
  }
});

afterEach(() => {
  db.close();
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch {}
});

describe('getConfig', () => {
  it('should return default values for all keys', () => {
    expect(getConfig(db, 'max-retries')).toBe('3');
    expect(getConfig(db, 'backoff-base')).toBe('2');
    expect(getConfig(db, 'poll-interval-ms')).toBe('500');
    expect(getConfig(db, 'stale-timeout-s')).toBe('60');
    expect(getConfig(db, 'default-timeout-s')).toBe('30');
  });

  it('should throw on invalid key', () => {
    expect(() => getConfig(db, 'nonexistent-key')).toThrow('Unknown config key');
  });
});

describe('setConfig', () => {
  it('should update a config value', () => {
    setConfig(db, 'max-retries', '5');
    expect(getConfig(db, 'max-retries')).toBe('5');
  });

  it('should reject invalid values', () => {
    expect(() => setConfig(db, 'max-retries', '-1')).toThrow();
    expect(() => setConfig(db, 'max-retries', 'abc')).toThrow();
    expect(() => setConfig(db, 'poll-interval-ms', '50')).toThrow(); // below min of 100
  });

  it('should throw on invalid key', () => {
    expect(() => setConfig(db, 'fake-key', '1')).toThrow('Unknown config key');
  });
});

describe('getConfigNum', () => {
  it('should return numeric value', () => {
    expect(getConfigNum(db, 'max-retries')).toBe(3);
    expect(getConfigNum(db, 'backoff-base')).toBe(2);
  });
});

describe('listConfig', () => {
  it('should return all config values including defaults', () => {
    const config = listConfig(db);
    expect(Object.keys(config).length).toBeGreaterThanOrEqual(5);
    expect(config['max-retries']).toBe('3');
    expect(config['backoff-base']).toBe('2');
  });

  it('should reflect updated values', () => {
    setConfig(db, 'max-retries', '10');
    const config = listConfig(db);
    expect(config['max-retries']).toBe('10');
  });
});
