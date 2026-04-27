/**
 * Session Management
 *
 * All interactions (tool calls, user choices, uploads) are tracked as Sessions.
 * Provides lifecycle management, status tracking, and cleanup.
 * SQLite-backed for durability across restarts.
 */

import { initDb, getDb, isDbAvailable } from './db.js';

export type SessionStatus =
  | 'pending'
  | 'waiting_user'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'error'
  | 'timeout';

export type ErrorCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'PLATFORM_UNSUPPORTED'
  | 'POLICY_DENIED'
  | 'SESSION_EXPIRED'
  | 'UNKNOWN';

export interface CliSession {
  id: string;
  tool: string;
  status: SessionStatus;
  createdAt: number;
  resolvedAt?: number;
  payload: unknown;
  result?: unknown;
  error?: { code: ErrorCode; message: string };
  abortController?: AbortController;
  choiceId?: string;
}

const sessions = new Map<string, CliSession>();

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function safeJson(v: unknown): string | undefined {
  try {
    return v === undefined ? undefined : JSON.stringify(v);
  } catch {
    return undefined;
  }
}

function parseJson<T>(s: string | null | undefined): T | undefined {
  if (!s) return undefined;
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}

function dbInsert(session: CliSession): void {
  const db = getDb();
  if (!db) return;
  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, tool, status, created_at, resolved_at, payload, result, error, choice_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.tool,
    session.status,
    session.createdAt,
    session.resolvedAt ?? null,
    safeJson(session.payload) ?? null,
    safeJson(session.result) ?? null,
    safeJson(session.error) ?? null,
    session.choiceId ?? null
  );
}

function dbDelete(id: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

// Load sessions from SQLite on module init
try {
  initDb();
  const db = getDb();
  if (db) {
    const rows = db.prepare('SELECT * FROM sessions').all() as Array<{
      id: string; tool: string; status: SessionStatus; created_at: number; resolved_at: number | null;
      payload: string | null; result: string | null; error: string | null; choice_id: string | null;
    }>;
    for (const row of rows) {
      sessions.set(row.id, {
        id: row.id,
        tool: row.tool,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at ?? undefined,
        payload: parseJson(row.payload),
        result: parseJson(row.result),
        error: parseJson(row.error),
        choiceId: row.choice_id ?? undefined,
      });
    }
  }
} catch {
  // SQLite unavailable — memory-only mode
}

export function createSession(tool: string, payload: unknown): CliSession {
  const session: CliSession = {
    id: generateId(),
    tool,
    status: 'pending',
    createdAt: Date.now(),
    payload,
  };
  sessions.set(session.id, session);
  dbInsert(session);
  return session;
}

export function getSession(id: string): CliSession | undefined {
  return sessions.get(id);
}

export function updateSession(id: string, updates: Partial<CliSession>): CliSession | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  Object.assign(s, updates);
  dbInsert(s);
  return s;
}

export function listSessions(): CliSession[] {
  return Array.from(sessions.values());
}

export function listActiveSessions(): CliSession[] {
  return Array.from(sessions.values()).filter(
    (s) => s.status === 'pending' || s.status === 'waiting_user' || s.status === 'running'
  );
}

export function deleteSession(id: string): boolean {
  const ok = sessions.delete(id);
  if (ok) dbDelete(id);
  return ok;
}

export function cleanupSessions(maxAgeMs = 3600000): number {
  const cutoff = Date.now() - maxAgeMs;
  let count = 0;
  const db = getDb();
  const toDelete: string[] = [];
  for (const [id, s] of sessions) {
    if (
      s.createdAt < cutoff &&
      s.status !== 'pending' &&
      s.status !== 'waiting_user' &&
      s.status !== 'running'
    ) {
      sessions.delete(id);
      toDelete.push(id);
      count++;
    }
  }
  if (db && toDelete.length) {
    const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
    for (const id of toDelete) stmt.run(id);
  }
  return count;
}
