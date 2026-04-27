/**
 * Policy Engine — Agent Governance Layer
 *
 * Humans preset rules. Agent executes subject to those rules.
 * Supports: allow | deny | confirm | notify | delay
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type PolicyScope = 'tool' | 'command' | 'file' | 'network';
export type PolicyAction = 'allow' | 'deny' | 'confirm' | 'notify' | 'delay';

export interface Policy {
  id: string;
  name: string;
  scope: PolicyScope;
  pattern: string;
  isRegex: boolean;
  action: PolicyAction;
  delayMs?: number;
  notifyMessage?: string;
}

export interface PolicyResult {
  policy: Policy | null;
  action: PolicyAction;
  message?: string;
  delayMs?: number;
}

const CONFIG_DIR = process.env.CLI_HELPER_CONFIG_DIR ?? path.join(os.homedir(), '.cli-helper');
const POLICIES_PATH = path.join(CONFIG_DIR, 'policies.json');

export const DEFAULT_POLICIES: Policy[] = [
  { id: 'default-deny-rmrf', name: 'Deny rm -rf /', scope: 'command', pattern: 'rm -rf /', isRegex: false, action: 'deny' },
  { id: 'default-confirm-git-push', name: 'Confirm git push', scope: 'command', pattern: '^git\\s+push', isRegex: true, action: 'confirm' },
  { id: 'default-allow-npm-install', name: 'Allow npm install', scope: 'command', pattern: '^npm\\s+install', isRegex: true, action: 'allow' },
  { id: 'default-confirm-env', name: 'Confirm .env access', scope: 'file', pattern: '\\.env$', isRegex: true, action: 'confirm' },
  { id: 'default-notify-commands', name: 'Notify commands', scope: 'tool', pattern: 'run_command', isRegex: false, action: 'notify', delayMs: 5000, notifyMessage: 'Agent is about to run a command' },
];

let policies: Policy[] = [...DEFAULT_POLICIES];
let loadedAt = 0;

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadPolicies(): Policy[] {
  ensureConfigDir();
  try {
    const stat = fs.statSync(POLICIES_PATH);
    if (stat.mtimeMs <= loadedAt) return policies;

    const raw = fs.readFileSync(POLICIES_PATH, 'utf8');
    const userPolicies: Policy[] = JSON.parse(raw);
    // Merge: user policies override defaults by id
    const map = new Map<string, Policy>();
    for (const p of DEFAULT_POLICIES) map.set(p.id, p);
    for (const p of userPolicies) map.set(p.id, p);
    policies = Array.from(map.values());
    loadedAt = stat.mtimeMs;
  } catch {
    // File doesn't exist or invalid — use defaults
    policies = [...DEFAULT_POLICIES];
    loadedAt = Date.now();
  }
  return policies;
}

export function savePolicies(userPolicies: Policy[]): void {
  ensureConfigDir();
  fs.writeFileSync(POLICIES_PATH, JSON.stringify(userPolicies, null, 2), 'utf8');
  loadedAt = 0; // force reload
  loadPolicies();
}

export function listPolicies(): Policy[] {
  return loadPolicies();
}

export function getPolicy(id: string): Policy | undefined {
  return loadPolicies().find(p => p.id === id);
}

function matches(value: string, pattern: string, isRegex: boolean): boolean {
  if (isRegex) {
    try {
      return new RegExp(pattern, 'i').test(value);
    } catch {
      return false;
    }
  }
  return value.includes(pattern);
}

export function matchPolicy(scope: PolicyScope, value: string): Policy | undefined {
  const list = loadPolicies();
  // Return first matching policy (user-defined policies are loaded after defaults,
  // so they effectively override by being later in the array)
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (p.scope === scope && matches(value, p.pattern, p.isRegex)) {
      return p;
    }
  }
  return undefined;
}

export function evaluatePolicy(scope: PolicyScope, value: string): PolicyResult {
  const policy = matchPolicy(scope, value);
  if (!policy) {
    // Default: allow if no policy matches
    return { policy: null, action: 'allow' };
  }

  const result: PolicyResult = {
    policy,
    action: policy.action,
    message: policy.notifyMessage,
  };

  if (policy.action === 'delay') {
    result.delayMs = policy.delayMs ?? 5000;
  }

  return result;
}

export function addPolicy(policy: Policy): void {
  const userPolicies = loadPolicies().filter(p => !DEFAULT_POLICIES.some(d => d.id === p.id));
  userPolicies.push(policy);
  savePolicies(userPolicies);
}

export function removePolicy(id: string): boolean {
  if (DEFAULT_POLICIES.some(d => d.id === id)) return false; // Cannot remove defaults
  const userPolicies = loadPolicies().filter(p => !DEFAULT_POLICIES.some(d => d.id === p.id) && p.id !== id);
  savePolicies(userPolicies);
  return true;
}
