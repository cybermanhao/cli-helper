/**
 * Audit Log — Agent Governance Oversight
 *
 * Records every tool invocation, policy evaluation, and human intervention.
 * Dual persistence: SQLite (primary) + JSON Lines (backup).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDb, getDb } from './db.js';

export interface AuditEntry {
  id: string;
  timestamp: number;
  sessionId?: string;
  tool: string;
  scope?: 'command' | 'file' | 'tool' | 'network';
  target?: string;
  policyId?: string;
  policyAction?: string;
  result: 'allowed' | 'denied' | 'confirmed' | 'notified' | 'delayed' | 'error';
  blocked: boolean;
  details?: Record<string, unknown>;
}

const CONFIG_DIR = process.env.CLI_HELPER_CONFIG_DIR ?? path.join(os.homedir(), '.cli-helper');
const AUDIT_PATH = path.join(CONFIG_DIR, 'audit.jsonl');
const MAX_MEMORY = 2000;

let memoryBuffer: AuditEntry[] = [];
let flushedAt = 0;

// Load recent entries from SQLite on init
try {
  initDb();
  const db = getDb();
  if (db) {
    const rows = db.prepare('SELECT * FROM audit_entries ORDER BY timestamp DESC LIMIT ?')
      .all(MAX_MEMORY) as Array<{
        id: string; timestamp: number; session_id: string | null; tool: string;
        scope: string | null; target: string | null; policy_id: string | null;
        policy_action: string | null; result: string; blocked: number; details: string | null;
      }>;
    for (const row of rows.reverse()) {
      memoryBuffer.push({
        id: row.id,
        timestamp: row.timestamp,
        sessionId: row.session_id ?? undefined,
        tool: row.tool,
        scope: (row.scope as any) ?? undefined,
        target: row.target ?? undefined,
        policyId: row.policy_id ?? undefined,
        policyAction: row.policy_action ?? undefined,
        result: row.result as AuditEntry['result'],
        blocked: !!row.blocked,
        details: row.details ? JSON.parse(row.details) : undefined,
      });
    }
    flushedAt = Date.now();
  }
} catch { /* SQLite unavailable */ }

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function genId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function logAudit(partial: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
  const entry: AuditEntry = {
    id: genId(),
    timestamp: Date.now(),
    ...partial,
  };
  memoryBuffer.push(entry);
  if (memoryBuffer.length > MAX_MEMORY) {
    memoryBuffer = memoryBuffer.slice(-MAX_MEMORY);
  }
  // Async append to disk — don't block the hot path
  ensureDir();
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(AUDIT_PATH, line, 'utf8');
    flushedAt = entry.timestamp;
  } catch {
    // Best-effort persistence
  }
  // SQLite insert
  try {
    const db = getDb();
    if (db) {
      db.prepare(`
        INSERT INTO audit_entries (id, timestamp, session_id, tool, scope, target, policy_id, policy_action, result, blocked, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.id,
        entry.timestamp,
        entry.sessionId ?? null,
        entry.tool,
        entry.scope ?? null,
        entry.target ?? null,
        entry.policyId ?? null,
        entry.policyAction ?? null,
        entry.result,
        entry.blocked ? 1 : 0,
        entry.details ? JSON.stringify(entry.details) : null
      );
    }
  } catch {
    // SQLite best-effort
  }
  return entry;
}

export interface AuditQuery {
  sessionId?: string;
  tool?: string;
  blocked?: boolean;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export function queryAudit(q: AuditQuery = {}): { entries: AuditEntry[]; total: number } {
  const limit = typeof q.limit === 'number' ? q.limit : 100;
  const offset = typeof q.offset === 'number' ? q.offset : 0;

  // Try SQLite first for efficient querying
  try {
    const db = getDb();
    if (db) {
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      if (q.sessionId) { conditions.push('session_id = ?'); params.push(q.sessionId); }
      if (q.tool) { conditions.push('tool = ?'); params.push(q.tool); }
      if (q.blocked !== undefined) { conditions.push('blocked = ?'); params.push(q.blocked ? 1 : 0); }
      if (q.since) { conditions.push('timestamp >= ?'); params.push(q.since); }
      if (q.until) { conditions.push('timestamp <= ?'); params.push(q.until); }

      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      const countRow = db.prepare(`SELECT COUNT(*) as total FROM audit_entries ${where}`).get(...params) as unknown as { total: number };

      const rows = db.prepare(`
        SELECT * FROM audit_entries ${where}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as unknown as Array<{
        id: string; timestamp: number; session_id: string | null; tool: string;
        scope: string | null; target: string | null; policy_id: string | null;
        policy_action: string | null; result: string; blocked: number; details: string | null;
      }>;

      const entries: AuditEntry[] = rows.map(row => ({
        id: row.id,
        timestamp: row.timestamp,
        sessionId: row.session_id ?? undefined,
        tool: row.tool,
        scope: (row.scope as any) ?? undefined,
        target: row.target ?? undefined,
        policyId: row.policy_id ?? undefined,
        policyAction: row.policy_action ?? undefined,
        result: row.result as AuditEntry['result'],
        blocked: !!row.blocked,
        details: row.details ? JSON.parse(row.details) : undefined,
      }));

      return { entries, total: countRow.total };
    }
  } catch {
    // Fallback to file + memory
  }

  // Legacy fallback: JSON Lines + memory buffer
  let entries = [...memoryBuffer];
  try {
    if (fs.existsSync(AUDIT_PATH)) {
      const lines = fs.readFileSync(AUDIT_PATH, 'utf8').split('\n').filter(Boolean);
      const diskEntries: AuditEntry[] = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as AuditEntry;
          if (!memoryBuffer.some(m => m.id === e.id)) diskEntries.push(e);
        } catch { /* ignore malformed line */ }
      }
      entries = diskEntries.concat(entries);
    }
  } catch { /* fallback */ }

  if (q.sessionId) entries = entries.filter(e => e.sessionId === q.sessionId);
  if (q.tool) entries = entries.filter(e => e.tool === q.tool);
  if (q.blocked !== undefined) entries = entries.filter(e => e.blocked === q.blocked);
  if (q.since) entries = entries.filter(e => e.timestamp >= q.since!);
  if (q.until) entries = entries.filter(e => e.timestamp <= q.until!);
  entries.sort((a, b) => b.timestamp - a.timestamp);

  return { entries: entries.slice(offset, offset + limit), total: entries.length };
}

export interface AuditStats {
  total: number;
  blocked: number;
  allowed: number;
  byTool: Record<string, number>;
  byResult: Record<string, number>;
  recentBlocked: AuditEntry[];
}

export function getAuditStats(): AuditStats {
  const all = queryAudit({ limit: Number.MAX_SAFE_INTEGER }).entries;
  const blocked = all.filter(e => e.blocked);
  const allowed = all.filter(e => !e.blocked);

  const byTool: Record<string, number> = {};
  const byResult: Record<string, number> = {};
  for (const e of all) {
    byTool[e.tool] = (byTool[e.tool] ?? 0) + 1;
    byResult[e.result] = (byResult[e.result] ?? 0) + 1;
  }

  return {
    total: all.length,
    blocked: blocked.length,
    allowed: allowed.length,
    byTool,
    byResult,
    recentBlocked: blocked.slice(0, 5),
  };
}
