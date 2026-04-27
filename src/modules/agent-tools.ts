import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_ROOT } from './utils.js';

const WORKSPACE_DIR = path.join(PROJECT_ROOT, 'agent-workspace');
const INBOX_PATH    = path.join(WORKSPACE_DIR, 'inbox.json');
const LOG_PATH      = path.join(WORKSPACE_DIR, 'agent-log.jsonl');
const STATE_PATH    = path.join(WORKSPACE_DIR, 'state.json');

function ensureWorkspace() {
  if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

interface InboxMessage {
  id: string;
  timestamp: string;
  message: string;
  read: boolean;
  metadata?: Record<string, unknown>;
}

function readInboxFile(): InboxMessage[] {
  if (!fs.existsSync(INBOX_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(INBOX_PATH, 'utf8')); }
  catch { return []; }
}

function writeInboxFile(messages: InboxMessage[]) {
  ensureWorkspace();
  fs.writeFileSync(INBOX_PATH, JSON.stringify(messages, null, 2), 'utf8');
}

export function toolReadInbox(): object {
  const messages = readInboxFile();
  const unread = messages.filter(m => !m.read);

  if (unread.length === 0) return { messages: [], count: 0 };

  // Mark all as read
  const updated = messages.map(m => m.read ? m : { ...m, read: true });
  writeInboxFile(updated);

  return { messages: unread, count: unread.length };
}

export function toolWriteLog(args: {
  message: string;
  level?: 'info' | 'warn' | 'error' | 'debug';
  metadata?: Record<string, unknown>;
}): object {
  ensureWorkspace();
  const entry = {
    timestamp: new Date().toISOString(),
    level: args.level ?? 'info',
    message: args.message,
    ...(args.metadata ? { metadata: args.metadata } : {}),
  };
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
  return { written: true };
}

export function toolUpdateState(args: {
  phase: string;
  currentTask?: string;
  progress?: Record<string, unknown>;
  [key: string]: unknown;
}): object {
  ensureWorkspace();
  const state = {
    timestamp: new Date().toISOString(),
    ...args,
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  return { written: true };
}

export function toolSendToAgent(args: {
  message: string;
  metadata?: Record<string, unknown>;
}): object {
  const messages = readInboxFile();
  const entry: InboxMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    message: args.message,
    read: false,
    ...(args.metadata ? { metadata: args.metadata } : {}),
  };
  messages.push(entry);
  writeInboxFile(messages);
  return { sent: true, id: entry.id };
}
