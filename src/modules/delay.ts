/**
 * Delay Engine — Human-on-the-Loop countdown with cancel
 *
 * When a policy action is "delay", the operation is deferred for N milliseconds.
 * During the countdown, a human can cancel it via the Dashboard.
 *
 * Persistence: runtime timeout + Promise stay in memory; metadata is persisted
 * to SQLite so history survives restarts. On restart, pending delays are marked
 * expired because their timeouts cannot be recovered.
 */

import { broadcastToAll } from './events.js';
import { getDb, initDb } from './db.js';

export interface PendingDelay {
  id: string;
  scope: string;
  target: string;
  delayMs: number;
  createdAt: number;
  resolve: (proceed: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface DelayRecord {
  id: string;
  scope: string;
  target: string;
  delayMs: number;
  createdAt: number;
  status: 'pending' | 'expired' | 'cancelled';
}

const delays = new Map<string, PendingDelay>();

function genId(): string {
  return `delay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function insertDelayRecord(rec: DelayRecord): void {
  const db = getDb();
  if (!db) return;
  try {
    db.prepare(`
      INSERT OR REPLACE INTO delays (id, scope, target, delay_ms, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(rec.id, rec.scope, rec.target, rec.delayMs, rec.createdAt, rec.status);
  } catch (e) {
    console.error('[delay] insert error', e);
  }
}

// On module load: mark any stale pending delays as expired since their timeouts are gone
function recoverDelays(): void {
  const db = getDb();
  if (!db) return;
  try {
    db.prepare(`UPDATE delays SET status = 'expired' WHERE status = 'pending'`).run();
  } catch { /* ignore */ }
}

export function createDelay(scope: string, target: string, delayMs: number): { id: string; promise: Promise<boolean> } {
  const id = genId();
  let resolve!: (proceed: boolean) => void;
  const promise = new Promise<boolean>((res) => { resolve = res; });

  const timeout = setTimeout(() => {
    resolve(true);
    delays.delete(id);
    broadcastToAll({ type: 'delay-expired', delayId: id, scope, target });
    insertDelayRecord({ id, scope, target, delayMs, createdAt, status: 'expired' });
  }, delayMs);

  const createdAt = Date.now();
  delays.set(id, { id, scope, target, delayMs, createdAt, resolve, timeout });

  insertDelayRecord({ id, scope, target, delayMs, createdAt, status: 'pending' });

  broadcastToAll({
    type: 'delay-countdown',
    delayId: id,
    scope,
    target,
    delayMs,
    createdAt,
  });

  return { id, promise };
}

export function cancelDelay(id: string): boolean {
  const d = delays.get(id);
  if (!d) return false;
  clearTimeout(d.timeout);
  d.resolve(false);
  delays.delete(id);
  broadcastToAll({ type: 'delay-cancelled', delayId: id, scope: d.scope, target: d.target });
  insertDelayRecord({ id, scope: d.scope, target: d.target, delayMs: d.delayMs, createdAt: d.createdAt, status: 'cancelled' });
  return true;
}

export function getPendingDelays(): Array<{
  id: string;
  scope: string;
  target: string;
  delayMs: number;
  createdAt: number;
  remainingMs: number;
}> {
  const now = Date.now();
  const db = getDb();
  if (db) {
    try {
      const rows = db.prepare(`SELECT * FROM delays WHERE status = 'pending' ORDER BY created_at DESC`).all() as Array<Record<string, any>>;
      return rows.map(r => ({
        id: r.id,
        scope: r.scope,
        target: r.target,
        delayMs: r.delay_ms,
        createdAt: r.created_at,
        remainingMs: Math.max(0, r.delay_ms - (now - r.created_at)),
      }));
    } catch (e) {
      console.error('[delay] query error', e);
    }
  }
  return Array.from(delays.values()).map(d => ({
    id: d.id,
    scope: d.scope,
    target: d.target,
    delayMs: d.delayMs,
    createdAt: d.createdAt,
    remainingMs: Math.max(0, d.delayMs - (now - d.createdAt)),
  }));
}

export function getDelayRecord(id: string): DelayRecord | undefined {
  const db = getDb();
  if (db) {
    try {
      const row = db.prepare(`SELECT * FROM delays WHERE id = ?`).get(id) as Record<string, any> | undefined;
      if (row) {
        return {
          id: row.id,
          scope: row.scope,
          target: row.target,
          delayMs: row.delay_ms,
          createdAt: row.created_at,
          status: row.status,
        };
      }
    } catch { /* ignore */ }
  }
  const d = delays.get(id);
  if (d) return { id: d.id, scope: d.scope, target: d.target, delayMs: d.delayMs, createdAt: d.createdAt, status: 'pending' };
  return undefined;
}

// Run recovery on module load
recoverDelays();
