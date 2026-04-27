import { describe, it, expect } from 'vitest';
import { initDb, closeDb } from '../src/modules/db.js';
import {
  createSession,
  getSession,
  listSessions,
  listActiveSessions,
  updateSession,
  deleteSession,
} from '../src/modules/session.js';

describe('session module', () => {
  it('creates a session with correct defaults', () => {
    initDb();
    const session = createSession('run_command', { command: 'echo hi' });
    expect(session.id).toBeDefined();
    expect(session.tool).toBe('run_command');
    expect(session.status).toBe('pending');
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.payload).toEqual({ command: 'echo hi' });
  });

  it('retrieves session by id', () => {
    initDb();
    const created = createSession('show_dialog', { title: 'Test' });
    const found = getSession(created.id);
    expect(found).not.toBeUndefined();
    expect(found?.tool).toBe('show_dialog');
  });

  it('returns undefined for unknown session', () => {
    initDb();
    const result = getSession('nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('lists all sessions', () => {
    initDb();
    const before = listSessions().length;
    createSession('tool1', {});
    createSession('tool2', {});
    const after = listSessions().length;
    expect(after - before).toBe(2);
  });

  it('lists only active (pending) sessions', () => {
    initDb();
    const before = listActiveSessions().length;
    const s1 = createSession('tool1', {});
    createSession('tool2', {});
    updateSession(s1.id, { status: 'completed', resolvedAt: Date.now() });
    const active = listActiveSessions();
    expect(active.length - before).toBe(1);
    expect(active[0].status).toBe('pending');
  });

  it('updates session fields', () => {
    initDb();
    const session = createSession('run_command', {});
    updateSession(session.id, { status: 'completed', result: { stdout: 'ok' } });
    const updated = getSession(session.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.result).toEqual({ stdout: 'ok' });
  });

  it('deletes session', () => {
    initDb();
    const session = createSession('temp', {});
    expect(getSession(session.id)).toBeDefined();
    deleteSession(session.id);
    expect(getSession(session.id)).toBeUndefined();
  });

  it('persists across db reconnection', () => {
    initDb();
    const session = createSession('persistent', { key: 'value' });
    const id = session.id;

    // Simulate reconnect by closing and reopening
    closeDb();
    initDb();

    const found = getSession(id);
    expect(found).toBeDefined();
    expect(found?.payload).toEqual({ key: 'value' });
  });
});
