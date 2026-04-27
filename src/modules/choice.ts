/**
 * Choice Framework — Human-in-the-Loop core
 *
 * When Agent needs human input, it creates a Choice.
 * The Choice is broadcast via SSE to all connected clients (Web UI).
 * When human responds via REST API, the Promise resolves/rejects.
 *
 * Persistence: runtime Promise state stays in memory; metadata is persisted
 * to SQLite so history survives restarts. On restart, pending choices become
 * historical records (cannot be resolved — their Promises are gone).
 */

import { randomUUID } from 'crypto';
import { broadcast } from './events.js';
import { getDb, initDb } from './db.js';

export interface PendingChoice<T = unknown> {
  id: string;
  sessionId: string;
  type: string;
  payload: unknown;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  createdAt: number;
}

export interface ChoiceRecord {
  id: string;
  sessionId: string;
  type: string;
  payload: unknown;
  createdAt: number;
  resolvedAt?: number;
  result?: unknown;
  status: 'pending' | 'resolved' | 'rejected' | 'expired';
}

const pendingChoices = new Map<string, PendingChoice<any>>();

const CHOICE_TIMEOUT_MS = 300_000; // 5 minutes

export interface ChoiceHandle<T = unknown> {
  id: string;
  promise: Promise<T>;
}

function safeJson(v: unknown): string | null {
  try { return JSON.stringify(v); } catch { return null; }
}
function parseJson<T>(s: string | null | undefined): T | undefined {
  if (!s) return undefined; try { return JSON.parse(s) as T; } catch { return undefined; }
}

function rowToChoiceRecord(row: Record<string, any>): ChoiceRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    payload: parseJson(row.payload),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
    result: parseJson(row.result),
    status: row.status,
  };
}

function insertChoiceRecord(rec: ChoiceRecord): void {
  const db = getDb();
  if (!db) return;
  try {
    db.prepare(`
      INSERT OR REPLACE INTO choices (id, session_id, type, payload, created_at, resolved_at, result, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rec.id, rec.sessionId, rec.type, safeJson(rec.payload), rec.createdAt,
      rec.resolvedAt ?? null, safeJson(rec.result) ?? null, rec.status
    );
  } catch (e) {
    console.error('[choice] insert error', e);
  }
}

export function createChoice<T>(
  sessionId: string,
  type: string,
  payload: unknown,
  timeoutMs = CHOICE_TIMEOUT_MS,
  choiceId?: string,
): ChoiceHandle<T> {
  const id = choiceId ?? randomUUID();
  let timeout: ReturnType<typeof setTimeout>;

  const promise = new Promise<T>((resolve, reject) => {
    timeout = setTimeout(() => {
      pendingChoices.delete(id);
      broadcast(sessionId, { type: 'choice-timeout', choiceId: id });
      insertChoiceRecord({ id, sessionId, type, payload, createdAt: Date.now(), status: 'expired' });
      reject(new Error(`Choice ${id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingChoices.set(id, {
      id,
      sessionId,
      type,
      payload,
      resolve,
      reject,
      timeout,
      createdAt: Date.now(),
    });

    // Persist metadata
    insertChoiceRecord({ id, sessionId, type, payload, createdAt: Date.now(), status: 'pending' });

    // Broadcast to all SSE clients
    broadcast(sessionId, {
      type: 'choice-request',
      choiceId: id,
      choiceType: type,
      payload,
    });
  });

  return { id, promise };
}

export function resolveChoice(choiceId: string, result: unknown): boolean {
  const choice = pendingChoices.get(choiceId);
  if (!choice) return false;
  clearTimeout(choice.timeout);
  pendingChoices.delete(choiceId);
  broadcast(choice.sessionId, {
    type: 'choice-resolved',
    choiceId,
    result,
  });
  insertChoiceRecord({
    id: choiceId, sessionId: choice.sessionId, type: choice.type,
    payload: choice.payload, createdAt: choice.createdAt,
    resolvedAt: Date.now(), result, status: 'resolved',
  });
  choice.resolve(result);
  return true;
}

export function rejectChoice(choiceId: string, reason: string): boolean {
  const choice = pendingChoices.get(choiceId);
  if (!choice) return false;
  clearTimeout(choice.timeout);
  pendingChoices.delete(choiceId);
  broadcast(choice.sessionId, {
    type: 'choice-rejected',
    choiceId,
    reason,
  });
  insertChoiceRecord({
    id: choiceId, sessionId: choice.sessionId, type: choice.type,
    payload: choice.payload, createdAt: choice.createdAt,
    resolvedAt: Date.now(), result: reason, status: 'rejected',
  });
  choice.reject(new Error(reason));
  return true;
}

export function getChoicesBySession(
  sessionId: string,
): Array<Pick<ChoiceRecord, 'id' | 'type' | 'payload' | 'createdAt' | 'status'>> {
  const db = getDb();
  if (db) {
    try {
      const rows = db.prepare(`SELECT * FROM choices WHERE session_id = ? ORDER BY created_at DESC`).all(sessionId) as Array<Record<string, any>>;
      return rows.map(r => {
        const rec = rowToChoiceRecord(r);
        return { id: rec.id, type: rec.type, payload: rec.payload, createdAt: rec.createdAt, status: rec.status };
      });
    } catch (e) {
      console.error('[choice] query error', e);
    }
  }
  // Fallback: in-memory
  return Array.from(pendingChoices.values())
    .filter((c) => c.sessionId === sessionId)
    .map((c) => ({ id: c.id, type: c.type, payload: c.payload, createdAt: c.createdAt, status: 'pending' as const }));
}

export function getChoice(choiceId: string): PendingChoice | undefined {
  return pendingChoices.get(choiceId);
}

export function listAllChoices(): Array<Pick<ChoiceRecord, 'id' | 'sessionId' | 'type' | 'createdAt' | 'status'>> {
  const db = getDb();
  if (db) {
    try {
      const rows = db.prepare(`SELECT * FROM choices ORDER BY created_at DESC`).all() as Array<Record<string, any>>;
      return rows.map(r => {
        const rec = rowToChoiceRecord(r);
        return { id: rec.id, sessionId: rec.sessionId, type: rec.type, createdAt: rec.createdAt, status: rec.status };
      });
    } catch (e) {
      console.error('[choice] list error', e);
    }
  }
  return Array.from(pendingChoices.values()).map((c) => ({
    id: c.id, sessionId: c.sessionId, type: c.type, createdAt: c.createdAt, status: 'pending' as const,
  }));
}
