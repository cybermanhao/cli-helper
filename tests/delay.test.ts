import { describe, it, expect, vi } from 'vitest';
import { initDb } from '../src/modules/db.js';

vi.mock('../src/modules/events.js', () => ({
  broadcastToAll: vi.fn(),
}));

import { createDelay, cancelDelay, getPendingDelays } from '../src/modules/delay.js';

describe('delay module', () => {
  it('creates a pending delay', () => {
    initDb();
    const { id, promise } = createDelay('command', 'echo hi', 5000);
    expect(id).toBeDefined();
    expect(typeof promise).toBe('object');

    const pending = getPendingDelays();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.some(d => d.id === id)).toBe(true);
  });

  it('cancels a delay', async () => {
    initDb();
    const { id, promise } = createDelay('command', 'echo hi', 5000);
    expect(cancelDelay(id)).toBe(true);

    const proceed = await promise;
    expect(proceed).toBe(false);

    const pending = getPendingDelays();
    expect(pending.some(d => d.id === id)).toBe(false);
  });

  it('returns false for unknown delay', () => {
    initDb();
    expect(cancelDelay('nonexistent')).toBe(false);
  });

  it('delay expires after timeout', async () => {
    initDb();
    const { promise } = createDelay('command', 'echo hi', 50);
    const proceed = await promise;
    expect(proceed).toBe(true);
  });
});
