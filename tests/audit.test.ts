import { describe, it, expect } from 'vitest';
import { initDb } from '../src/modules/db.js';
import { logAudit, queryAudit, getAuditStats } from '../src/modules/audit.js';

describe('audit module', () => {
  it('logs an audit entry', () => {
    initDb();
    const entry = logAudit({ tool: 'run_command', result: 'allowed' });
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.tool).toBe('run_command');
    expect(entry.result).toBe('allowed');
  });

  it('queries audit entries', () => {
    initDb();
    logAudit({ tool: 'run_command', result: 'allowed' });
    logAudit({ tool: 'run_command', result: 'denied', blocked: true });
    logAudit({ tool: 'open_path', result: 'allowed' });

    const { entries, total } = queryAudit({ limit: 10 });
    expect(total).toBe(3);
    expect(entries.length).toBe(3);
  });

  it('filters by tool', () => {
    initDb();
    logAudit({ tool: 'run_command', result: 'allowed' });
    logAudit({ tool: 'open_path', result: 'allowed' });

    const { entries } = queryAudit({ tool: 'run_command' });
    expect(entries.length).toBe(1);
    expect(entries[0].tool).toBe('run_command');
  });

  it('filters by blocked', () => {
    initDb();
    logAudit({ tool: 'run_command', result: 'allowed', blocked: false });
    logAudit({ tool: 'run_command', result: 'denied', blocked: true });

    const { entries } = queryAudit({ blocked: true });
    expect(entries.length).toBe(1);
    expect(entries[0].blocked).toBe(true);
  });

  it('getAuditStats returns aggregates', () => {
    initDb();
    logAudit({ tool: 'run_command', result: 'allowed' });
    logAudit({ tool: 'run_command', result: 'denied', blocked: true });

    const stats = getAuditStats();
    expect(stats.total).toBe(2);
    expect(stats.blocked).toBe(1);
    expect(stats.allowed).toBe(1);
  });
});
