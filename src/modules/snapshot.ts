/**
 * File Snapshot — Track file system changes across command execution
 *
 * Lightweight: records mtime + size only (no content hashing).
 * Ignores: node_modules, .git, dist
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FileSnapshot {
  relPath: string;
  mtimeMs: number;
  size: number;
}

export interface Snapshot {
  dir: string;
  timestamp: number;
  files: FileSnapshot[];
}

export interface SnapshotDiff {
  added: FileSnapshot[];
  modified: FileSnapshot[];
  removed: FileSnapshot[];
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__']);

export function createSnapshot(dir: string): Snapshot {
  const files: FileSnapshot[] = [];

  function scan(absPath: string, relPath: string = '') {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      const entryAbs = path.join(absPath, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        scan(entryAbs, entryRel);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(entryAbs);
          files.push({ relPath: entryRel, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch { /* ignore unreadable files */ }
      }
    }
  }

  scan(dir);
  return { dir, timestamp: Date.now(), files };
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const beforeMap = new Map(before.files.map(f => [f.relPath, f]));
  const afterMap = new Map(after.files.map(f => [f.relPath, f]));

  const added: FileSnapshot[] = [];
  const modified: FileSnapshot[] = [];
  const removed: FileSnapshot[] = [];

  for (const [relPath, afterFile] of afterMap) {
    const beforeFile = beforeMap.get(relPath);
    if (!beforeFile) {
      added.push(afterFile);
    } else if (beforeFile.mtimeMs !== afterFile.mtimeMs || beforeFile.size !== afterFile.size) {
      modified.push(afterFile);
    }
  }

  for (const [relPath, beforeFile] of beforeMap) {
    if (!afterMap.has(relPath)) {
      removed.push(beforeFile);
    }
  }

  return { added, modified, removed };
}

// Store changes per sessionId
const sessionChanges = new Map<string, SnapshotDiff>();

import { initDb, getDb } from './db.js';

function safeJson(v: unknown): string | undefined {
  try { return JSON.stringify(v); } catch { return undefined; }
}
function parseJson<T>(s: string | null | undefined): T | undefined {
  if (!s) return undefined; try { return JSON.parse(s) as T; } catch { return undefined; }
}

// Load file_changes from SQLite on init
try {
  initDb();
  const db = getDb();
  if (db) {
    const rows = db.prepare('SELECT * FROM file_changes').all() as Array<{
      session_id: string; added: string; modified: string; removed: string;
    }>;
    for (const row of rows) {
      sessionChanges.set(row.session_id, {
        added: parseJson(row.added) ?? [],
        modified: parseJson(row.modified) ?? [],
        removed: parseJson(row.removed) ?? [],
      });
    }
  }
} catch { /* SQLite unavailable */ }

export function storeSessionChanges(sessionId: string, diff: SnapshotDiff): void {
  if (diff.added.length || diff.modified.length || diff.removed.length) {
    sessionChanges.set(sessionId, diff);
    const db = getDb();
    if (db) {
      db.prepare(`
        INSERT OR REPLACE INTO file_changes (session_id, added, modified, removed, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(sessionId, safeJson(diff.added) ?? null, safeJson(diff.modified) ?? null, safeJson(diff.removed) ?? null, Date.now());
    }
  }
}

export function getSessionChanges(sessionId: string): SnapshotDiff | undefined {
  return sessionChanges.get(sessionId);
}

export function clearSessionChanges(sessionId: string): boolean {
  const db = getDb();
  if (db) db.prepare('DELETE FROM file_changes WHERE session_id = ?').run(sessionId);
  return sessionChanges.delete(sessionId);
}
