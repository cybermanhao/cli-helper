/**
 * SQLite Persistence — Agent state durability across restarts
 *
 * Uses Node.js 22+ experimental `node:sqlite` module.
 * Callers must catch initDb() failures and fall back to memory-only mode.
 */

import { DatabaseSync } from 'node:sqlite';
import * as path from 'path';
import * as os from 'os';
import { existsSync, mkdirSync } from 'fs';

let db: DatabaseSync | null = null;

function getConfigDir(): string {
  return process.env.CLI_HELPER_CONFIG_DIR ?? path.join(os.homedir(), '.cli-helper');
}

function getDbPath(): string {
  return path.join(getConfigDir(), 'cli-helper.db');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function initDb(): DatabaseSync {
  if (db) return db;

  const configDir = getConfigDir();
  const dbPath = getDbPath();
  ensureDir(configDir);
  try {
    db = new DatabaseSync(dbPath);
  } catch (err) {
    console.error('[db] Failed to open SQLite database, falling back to memory-only:', err);
    throw err;
  }

  // Sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      payload TEXT,
      result TEXT,
      error TEXT,
      choice_id TEXT
    )
  `);

  // Choices
  db.exec(`
    CREATE TABLE IF NOT EXISTS choices (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      result TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    )
  `);

  // Delays
  db.exec(`
    CREATE TABLE IF NOT EXISTS delays (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      target TEXT NOT NULL,
      delay_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    )
  `);

  // File changes
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_changes (
      session_id TEXT PRIMARY KEY,
      added TEXT,
      modified TEXT,
      removed TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // Audit entries
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_entries (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      session_id TEXT,
      tool TEXT NOT NULL,
      scope TEXT,
      target TEXT,
      policy_id TEXT,
      policy_action TEXT,
      result TEXT NOT NULL,
      blocked INTEGER NOT NULL DEFAULT 0,
      details TEXT
    )
  `);

  return db;
}

export function getDb(): DatabaseSync | null {
  return db;
}

export function isDbAvailable(): boolean {
  return db !== null;
}

/** Close and reset the DB connection. Used for testing. */
export function closeDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}
