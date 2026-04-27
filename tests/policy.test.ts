import { describe, it, expect, vi, afterAll } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(() => { throw new Error('not found'); }),
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/tmp'),
}));

import {
  evaluatePolicy,
  matchPolicy,
  listPolicies,
  DEFAULT_POLICIES,
} from '../src/modules/policy.js';

afterAll(() => {
  vi.unmock('fs');
  vi.unmock('os');
  vi.restoreAllMocks();
});

describe('policy engine', () => {
  it('default policies are loaded', () => {
    const policies = listPolicies();
    expect(policies.length).toBeGreaterThanOrEqual(DEFAULT_POLICIES.length);
    expect(policies.some(p => p.id === 'default-deny-rmrf')).toBe(true);
  });

  it('matches literal pattern', () => {
    const result = evaluatePolicy('command', 'rm -rf /');
    expect(result.action).toBe('deny');
    expect(result.policy?.id).toBe('default-deny-rmrf');
  });

  it('matches regex pattern', () => {
    const result = evaluatePolicy('command', 'git push origin main');
    expect(result.action).toBe('confirm');
    expect(result.policy?.id).toBe('default-confirm-git-push');
  });

  it('allows when no policy matches', () => {
    const result = evaluatePolicy('command', 'echo hello');
    expect(result.action).toBe('allow');
    expect(result.policy).toBeNull();
  });

  it('matches file scope pattern', () => {
    const result = evaluatePolicy('file', 'config/.env');
    expect(result.action).toBe('confirm');
  });

  it('matchPolicy finds the correct policy', () => {
    const policy = matchPolicy('command', 'rm -rf /');
    expect(policy).not.toBeUndefined();
    expect(policy?.action).toBe('deny');
  });

  it('notify action does not include delayMs', () => {
    const result = evaluatePolicy('tool', 'run_command');
    expect(result.action).toBe('notify');
    expect(result.delayMs).toBeUndefined();
  });
});
