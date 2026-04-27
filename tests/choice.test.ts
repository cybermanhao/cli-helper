import { describe, it, expect, vi } from 'vitest';
import { initDb } from '../src/modules/db.js';

vi.mock('../src/modules/events.js', () => ({
  broadcast: vi.fn(),
}));

import { createChoice, resolveChoice, rejectChoice, getChoicesBySession, listAllChoices } from '../src/modules/choice.js';

describe('choice module', () => {
  it('creates a choice with pending status', () => {
    initDb();
    const handle = createChoice('sess-1', 'confirm', { message: 'OK?' });
    expect(handle.id).toBeDefined();
    expect(typeof handle.promise).toBe('object');

    const choices = getChoicesBySession('sess-1');
    expect(choices.length).toBe(1);
    expect(choices[0].status).toBe('pending');
  });

  it('resolves a choice', async () => {
    initDb();
    const handle = createChoice('sess-1', 'input', {});
    const resolved = resolveChoice(handle.id, 'user input');
    expect(resolved).toBe(true);

    const result = await handle.promise;
    expect(result).toBe('user input');

    const choices = getChoicesBySession('sess-1');
    expect(choices[0].status).toBe('resolved');
  });

  it('rejects a choice', async () => {
    initDb();
    const handle = createChoice('sess-1', 'confirm', {});
    const rejected = rejectChoice(handle.id, 'User said no');
    expect(rejected).toBe(true);

    await expect(handle.promise).rejects.toThrow('User said no');

    const choices = getChoicesBySession('sess-1');
    expect(choices[0].status).toBe('rejected');
  });

  it('returns false for unknown choice', () => {
    initDb();
    expect(resolveChoice('nonexistent', true)).toBe(false);
    expect(rejectChoice('nonexistent', 'reason')).toBe(false);
  });

  it('lists all choices across sessions', () => {
    initDb();
    createChoice('sess-1', 'confirm', {});
    createChoice('sess-2', 'input', {});

    const all = listAllChoices();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
