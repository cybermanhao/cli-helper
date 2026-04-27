import * as path from 'path';

export const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();

export function resolveProjectPath(p: string): string {
  const resolved = path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
  const realRoot = path.resolve(PROJECT_ROOT);
  const realResolved = path.resolve(resolved);
  // Block path traversal outside PROJECT_ROOT
  const relativeToRoot = path.relative(realRoot, realResolved);
  if (relativeToRoot.startsWith('..') || relativeToRoot === '..') {
    throw new Error(`Path traversal blocked: ${p}`);
  }
  return realResolved;
}

/**
 * Parse a command string into [command, ...args] safely (no shell).
 * Supports single and double quotes.
 */
export function parseCommandString(input: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inSingle) {
      if (ch === "'") { inSingle = false; }
      else { current += ch; }
    } else if (inDouble) {
      if (ch === '"') { inDouble = false; }
      else { current += ch; }
    } else {
      if (ch === "'") { inSingle = true; }
      else if (ch === '"') { inDouble = true; }
      else if (/\s/.test(ch)) {
        if (current) { tokens.push(current); current = ''; }
      } else {
        current += ch;
      }
    }
  }
  if (current) tokens.push(current);
  if (tokens.length === 0) return { command: '', args: [] };
  return { command: tokens[0], args: tokens.slice(1) };
}

export function capOutput(s: string, max = 10000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... (truncated, total ${s.length} chars)`;
}
