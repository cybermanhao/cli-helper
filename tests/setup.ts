import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { beforeEach, afterEach } from 'vitest';
import { closeDb, initDb } from '../src/modules/db.js';

let tempDir: string;

// Set a default config dir immediately so modules that compute paths at load time pick it up
process.env.CLI_HELPER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-helper-test-'));

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-helper-test-'));
  process.env.CLI_HELPER_CONFIG_DIR = tempDir;
  closeDb();
  const db = initDb();
  // Clear all tables for a fresh state
  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM choices").run();
  db.prepare("DELETE FROM delays").run();
  db.prepare("DELETE FROM file_changes").run();
  db.prepare("DELETE FROM audit_entries").run();
});

afterEach(() => {
  closeDb();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors on Windows
  }
});
