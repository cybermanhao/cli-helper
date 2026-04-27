/**
 * Express HTTP Server + SSE MCP Transport
 *
 * Serves:
 * - MCP SSE endpoint at /mcp/sse
 * - Picker / Upload pages and APIs
 * - Static files (picker.js, dashboard)
 * - REST API for sessions, choices, events
 */

import express, { type Request, type Response } from 'express';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT) || 7842;
const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();

const app = express();
app.use(express.json({ limit: '50mb' }));

// ─── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'http://localhost:7842',
  'http://127.0.0.1:7842',
]);

app.use((_req, res, next) => {
  const origin = _req.headers.origin ?? '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.use((_req, res, next) => {
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// ─── MCP SSE endpoint (only in SSE mode) ─────────────────────────────────────

let mcpTransport: SSEServerTransport | null = null;

function registerMcpSseRoutes() {
  app.get('/mcp/sse', async (_req: Request, res: Response) => {
    try {
      const { mcpServer } = await import('./index.js');
      try { await mcpServer.close(); } catch { /* ignore */ }
      mcpTransport = new SSEServerTransport('/mcp/message', res);
      await mcpServer.connect(mcpTransport);
    } catch (err) {
      console.error('[mcp/sse] error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/mcp/message', async (req: Request, res: Response) => {
    if (!mcpTransport) {
      res.status(400).json({ error: 'No active SSE connection' });
      return;
    }
    await mcpTransport.handlePostMessage(req, res, req.body);
  });
}

// ─── Static files ────────────────────────────────────────────────────────────

app.use('/picker.js', express.static(path.join(__dirname, '../dist/picker.js')));
app.use(express.static(path.join(__dirname, '../public')));

// ─── Health check ────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'sse', version: '2.1.0' });
});

// ─── Session API ─────────────────────────────────────────────────────────────

import { getSession, listActiveSessions, updateSession } from './modules/session.js';
import { addSseClient, removeSseClient } from './modules/events.js';
import { resolveChoice, rejectChoice, getChoicesBySession } from './modules/choice.js';
import { listPolicies, addPolicy, removePolicy, evaluatePolicy, type Policy } from './modules/policy.js';
import { queryAudit, getAuditStats } from './modules/audit.js';
import { cancelDelay, getPendingDelays } from './modules/delay.js';
import { getGlobalTimeline, getSessionTimeline } from './modules/timeline.js';
import { getSessionChanges } from './modules/snapshot.js';
import { listNotifyConfigs, addNotifyConfig, removeNotifyConfig, sendNotify, type NotifyConfig } from './modules/notify.js';
import { pickerContexts, buildPickerHtml } from './modules/picker.js';
import { uploadContexts, buildUploadHtml } from './modules/upload.js';

// ─── Asset types (legacy, can be removed when asset system is redesigned) ────

const ASSETS_DIR = path.join(PROJECT_ROOT, 'assets');
const IMAGE_EXTS_SET = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

// ─── Agent Workspace paths ───────────────────────────────────────────────────

const WORKSPACE_DIR = path.join(PROJECT_ROOT, 'agent-workspace');
const INBOX_PATH    = path.join(WORKSPACE_DIR, 'inbox.json');
const LOG_PATH      = path.join(WORKSPACE_DIR, 'agent-log.jsonl');
const STATE_PATH    = path.join(WORKSPACE_DIR, 'state.json');

function ensureWorkspace(): void {
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

function writeInboxFile(messages: InboxMessage[]): void {
  ensureWorkspace();
  fs.writeFileSync(INBOX_PATH, JSON.stringify(messages, null, 2), 'utf8');
}

app.get('/api/sessions', (_req, res) => {
  res.json({ sessions: listActiveSessions() });
});

app.get('/api/session/:id/status', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({
    id: session.id,
    tool: session.tool,
    status: session.status,
    createdAt: session.createdAt,
    resolvedAt: session.resolvedAt,
    result: session.result,
    error: session.error,
  });
});

app.post('/api/session/:id/abort', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  session.abortController?.abort(new Error('User requested abort'));
  updateSession(req.params.id, { status: 'cancelled', resolvedAt: Date.now() });
  res.json({ aborted: true });
});

// ─── Choice API ──────────────────────────────────────────────────────────────

app.post('/api/choice/:choiceId', (req, res) => {
  const resolved = resolveChoice(req.params.choiceId, req.body);
  res.json({ resolved });
});

app.get('/api/choices/:sessionId', (req, res) => {
  res.json({ choices: getChoicesBySession(req.params.sessionId) });
});

app.post('/api/cancel-choice/:choiceId', (req, res) => {
  const { reason } = req.body as { reason?: string };
  const cancelled = rejectChoice(req.params.choiceId, reason ?? 'User cancelled');
  res.json({ cancelled });
});

// ─── Policy API ──────────────────────────────────────────────────────────────

app.get('/api/policies', (_req, res) => {
  res.json({ policies: listPolicies() });
});

app.post('/api/policies', (req, res) => {
  const { id, name, scope, pattern, isRegex, action, delayMs, notifyMessage } = req.body;
  if (!id || !scope || !pattern || !action) {
    res.status(400).json({ error: 'Missing required fields: id, scope, pattern, action' });
    return;
  }
  const policy: Policy = {
    id,
    name: name ?? id,
    scope,
    pattern,
    isRegex: isRegex ?? false,
    action,
    delayMs,
    notifyMessage,
  };
  addPolicy(policy);
  res.json({ added: true, policy });
});

app.delete('/api/policies/:id', (req, res) => {
  const ok = removePolicy(req.params.id);
  res.json({ removed: ok, id: req.params.id });
});

app.post('/api/policies/evaluate', (req, res) => {
  const { scope, target } = req.body;
  if (!scope || !target) {
    res.status(400).json({ error: 'Missing required fields: scope, target' });
    return;
  }
  const result = evaluatePolicy(scope, target);
  res.json(result);
});

// ─── Audit API ───────────────────────────────────────────────────────────────

app.get('/api/audit', (req, res) => {
  const q = {
    sessionId: req.query.sessionId as string | undefined,
    tool: req.query.tool as string | undefined,
    blocked: req.query.blocked === 'true' ? true : req.query.blocked === 'false' ? false : undefined,
    since: req.query.since ? parseInt(req.query.since as string, 10) : undefined,
    until: req.query.until ? parseInt(req.query.until as string, 10) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
  };
  res.json(queryAudit(q));
});

app.get('/api/audit/stats', (_req, res) => {
  res.json(getAuditStats());
});

// ─── Timeline API ──────────────────────────────────────────────────────────────

app.get('/api/timeline', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  res.json({ entries: getGlobalTimeline(limit) });
});

app.get('/api/session/:id/timeline', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ session, entries: getSessionTimeline(req.params.id) });
});

app.get('/api/session/:id/changes', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ changes: getSessionChanges(req.params.id) ?? null });
});

// ─── Delay API ─────────────────────────────────────────────────────────────────

app.get('/api/delays', (_req, res) => {
  res.json({ delays: getPendingDelays() });
});

app.post('/api/delay/:id/cancel', (req, res) => {
  const ok = cancelDelay(req.params.id);
  res.json({ cancelled: ok, id: req.params.id });
});

// ─── Agent Workspace API ─────────────────────────────────────────────────────

app.get('/api/state', (_req, res) => {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    res.json(state);
  } catch {
    res.json({ phase: 'idle', timestamp: new Date().toISOString() });
  }
});

app.get('/api/log', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string ?? '100', 10);
    const lines = fs.readFileSync(LOG_PATH, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => JSON.parse(l))
      .slice(-limit);
    res.json(lines);
  } catch {
    res.json([]);
  }
});

app.get('/api/inbox', (_req, res) => {
  res.json(readInboxFile());
});

app.post('/api/inbox', (req, res) => {
  const { message, metadata } = req.body;
  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }
  const messages = readInboxFile();
  const entry: InboxMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    message,
    read: false,
    ...(metadata ? { metadata } : {}),
  };
  messages.push(entry);
  writeInboxFile(messages);
  res.json({ sent: true, id: entry.id });
});

// ─── Notification API ────────────────────────────────────────────────────────

app.get('/api/notify-configs', (_req, res) => {
  res.json({ configs: listNotifyConfigs() });
});

app.post('/api/notify-configs', (req, res) => {
  const { id, name, channel, enabled, events, url, template, rateLimitMs } = req.body;
  if (!id || !channel || !events || !Array.isArray(events) || events.length === 0) {
    res.status(400).json({ error: 'Missing required fields: id, channel, events' });
    return;
  }
  const cfg: NotifyConfig = {
    id,
    name: name ?? id,
    channel,
    enabled: enabled ?? true,
    events,
    url,
    template,
    rateLimitMs,
  };
  addNotifyConfig(cfg);
  res.json({ added: true, config: cfg });
});

app.delete('/api/notify-configs/:id', (req, res) => {
  const ok = removeNotifyConfig(req.params.id);
  res.json({ removed: ok, id: req.params.id });
});

app.post('/api/notify-test', async (req, res) => {
  const { event, message } = req.body;
  if (!event) {
    res.status(400).json({ error: 'Missing required field: event' });
    return;
  }
  const result = await sendNotify({
    event,
    title: 'Test notification',
    message: message ?? 'This is a test notification from cli-helper.',
  });
  res.json(result);
});

// ─── Picker routes ───────────────────────────────────────────────────────────

app.get('/picker/:sessionId', (req, res) => {
  const sid = req.params.sessionId;
  const session = pickerContexts.get(sid);
  if (!session) {
    res.status(404).type('text/plain').send('Session not found or expired');
    return;
  }
  const html = buildPickerHtml(sid, 'Asset Picker', 'Select assets below', session.items, session.multiSelect, !!session.uploadDir);
  res.type('text/html; charset=utf-8').send(html);
});

app.get('/picker-image', (req, res) => {
  const imgPath = req.query.path as string;
  if (!imgPath || !fs.existsSync(imgPath)) {
    res.status(404).send('Not found');
    return;
  }
  const ext = path.extname(imgPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png'
             : ext === '.gif' ? 'image/gif'
             : ext === '.webp' ? 'image/webp'
             : ext === '.mp3' ? 'audio/mpeg'
             : ext === '.wav' ? 'audio/wav'
             : ext === '.ogg' ? 'audio/ogg'
             : ext === '.mp4' ? 'video/mp4'
             : ext === '.webm' ? 'video/webm'
             : ext === '.mov' ? 'video/quicktime'
             : 'image/jpeg';
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'max-age=60');
  fs.createReadStream(imgPath).pipe(res);
});

app.post('/api/open-path', express.json(), (req, res) => {
  const targetPath = req.body.path as string;
  if (!targetPath) {
    res.status(400).json({ error: 'path is required' });
    return;
  }
  // Security: resolve and validate path
  let resolved: string;
  try {
    resolved = path.resolve(targetPath);
    const root = path.resolve(PROJECT_ROOT);
    if (!resolved.startsWith(root) && !resolved.startsWith(path.resolve(os.homedir()))) {
      res.status(403).json({ error: 'Path not allowed' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const platform = process.platform;
  let command: string;
  let cmdArgs: string[];
  const dir = path.dirname(resolved);

  if (platform === 'win32') {
    command = 'explorer.exe';
    cmdArgs = [dir];
  } else if (platform === 'darwin') {
    command = 'open';
    cmdArgs = [dir];
  } else {
    command = 'xdg-open';
    cmdArgs = [dir];
  }

  try {
    const r = spawnSync(command, cmdArgs, { shell: false, timeout: 10000 });
    const success = r.error === undefined;
    res.json({ opened: success, directory: dir });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ opened: false, error: msg });
  }
});

app.post('/api/image-edit', express.json({ limit: '50mb' }), (req, res) => {
  const { path: imgPath, action, params, outPath } = req.body as {
    path: string;
    action: string;
    params?: Record<string, unknown>;
    outPath?: string;
  };
  if (!imgPath || !action) {
    res.status(400).json({ error: 'path and action are required' });
    return;
  }
  try {
    const resolved = path.resolve(imgPath);
    const root = path.resolve(PROJECT_ROOT);
    if (!resolved.startsWith(root) && !resolved.startsWith(path.resolve(os.homedir()))) {
      res.status(403).json({ error: 'Path not allowed' });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const output = outPath || resolved;
    const venvPython = path.resolve(PROJECT_ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const scriptPath = path.resolve(PROJECT_ROOT, 'image-edit.py');
    const input = JSON.stringify({ path: resolved, action, params: params || {}, out: output });

    const r = spawnSync(venvPython, [scriptPath], {
      input,
      encoding: 'utf-8',
      timeout: 120000,
      shell: false,
    });

    if (r.status !== 0) {
      res.status(500).json({ error: r.stderr || 'Image edit failed' });
      return;
    }
    const result = JSON.parse(r.stdout.trim());
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post('/api/pick/:sessionId', express.json({ limit: '50mb' }), (req, res) => {
  const sid = req.params.sessionId;
  const session = pickerContexts.get(sid);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  try {
    const { indices, uploaded, cancelled, selections: clientSelections } = req.body as {
      indices: number[];
      uploaded: Array<{ name: string; path: string }>;
      cancelled: boolean;
      selections?: Array<{ label: string; index: number; imagePath: string; trimStart?: number; trimEnd?: number }>;
    };
    pickerContexts.delete(sid);
    if (cancelled) {
      resolveChoice(session.choiceId, { selections: [], uploadedFiles: [], cancelled: true });
    } else {
      // Use client-provided selections if available (includes trim info), otherwise build from indices
      const selections = clientSelections ?? (indices ?? []).map(i => ({
        label: session.items[i]?.label ?? '',
        index: i,
        imagePath: session.items[i]?.imagePath ?? '',
      }));
      resolveChoice(session.choiceId, { selections, uploadedFiles: uploaded ?? [], cancelled: false });
    }
    res.json({ ok: true });
  } catch {
    res.status(400).send('Bad request');
  }
});

app.post('/api/picker-upload/:sessionId', express.json({ limit: '50mb' }), (req, res) => {
  const sid = req.params.sessionId;
  const session = pickerContexts.get(sid);
  if (!session || !session.uploadDir) {
    res.status(404).send('Session not found or upload not enabled');
    return;
  }
  try {
    const { name, data, size } = req.body as { name: string; data: string; mime: string; size: number };
    const safeName = name.replace(/[/\\?%*:|"<>]/g, '_');
    const dest = path.join(session.uploadDir!, safeName);
    fs.writeFileSync(dest, Buffer.from(data, 'base64'));
    const newItem = { label: safeName, imagePath: dest, metadata: { _src: 'uploaded', size: `${Math.round(size / 1024)}KB` } };
    session.items.push(newItem);
    res.json({ ok: true, item: newItem });
  } catch { res.status(400).send('Bad request'); }
});

// ─── Upload routes ───────────────────────────────────────────────────────────

app.get('/upload/:sessionId', (req, res) => {
  const sid = req.params.sessionId;
  const session = uploadContexts.get(sid);
  if (!session) {
    res.status(404).type('text/plain').send('Session not found or expired');
    return;
  }
  const html = buildUploadHtml(sid, 'Upload Files', 'Drag images here or click to browse');
  res.type('text/html; charset=utf-8').send(html);
});

app.post('/api/upload/:sessionId', express.json({ limit: '50mb' }), (req, res) => {
  const sid = req.params.sessionId;
  const session = uploadContexts.get(sid);
  if (!session) {
    res.status(404).send('Session not found');
    return;
  }
  try {
    const { files, cancelled } = req.body as {
      files: Array<{ name: string; data: string; mime: string; size: number }>;
      cancelled: boolean;
    };
    uploadContexts.delete(sid);
    if (cancelled) {
      resolveChoice(session.choiceId, { files: [], cancelled: true });
    } else {
      const saved: Array<{ name: string; path: string; size: number }> = [];
      for (const f of files) {
        const safeName = f.name.replace(/[/\\?%*:|"<>]/g, '_');
        const dest = path.join(session.saveDir, safeName);
        fs.writeFileSync(dest, Buffer.from(f.data, 'base64'));
        saved.push({ name: safeName, path: dest, size: f.size });
      }
      resolveChoice(session.choiceId, { files: saved, cancelled: false });
    }
    res.json({ ok: true });
  } catch {
    res.status(400).send('Bad request');
  }
});

// ─── Asset routes (legacy) ───────────────────────────────────────────────────

app.get('/api/assets', (_req, res) => {
  const types = ['cards', 'relics', 'animations', 'orbs', 'characters'] as const;
  interface VersionInfo { version: number; file: string; url: string; mtime: number }
  interface AssetEntry { name: string; type: string; current: string | null; currentUrl: string | null; history: VersionInfo[] }
  const result: AssetEntry[] = [];

  for (const type of types) {
    const typeDir = path.join(ASSETS_DIR, type);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of fs.readdirSync(typeDir)) {
      const nameDir = path.join(typeDir, name);
      if (!fs.statSync(nameDir).isDirectory()) continue;
      const entry: AssetEntry = { name, type, current: null, currentUrl: null, history: [] };
      const currentDir = path.join(nameDir, 'current');
      if (fs.existsSync(currentDir)) {
        const files = fs.readdirSync(currentDir).filter(f => IMAGE_EXTS_SET.has(path.extname(f).toLowerCase()));
        if (files[0]) {
          entry.current = files[0];
          entry.currentUrl = `/assets/${type}/${name}/current/${files[0]}`;
        }
      }
      const historyDir = path.join(nameDir, 'history');
      if (fs.existsSync(historyDir)) {
        const hfiles = fs.readdirSync(historyDir).filter(f => IMAGE_EXTS_SET.has(path.extname(f).toLowerCase()));
        for (const hf of hfiles) {
          const match = hf.match(/^v(\d+)_/);
          const version = match ? parseInt(match[1], 10) : 0;
          const mtime = fs.statSync(path.join(historyDir, hf)).mtimeMs;
          entry.history.push({ version, file: hf, url: `/assets/${type}/${name}/history/${hf}`, mtime });
        }
        entry.history.sort((a, b) => b.version - a.version);
      }
      result.push(entry);
    }
  }
  res.json(result);
});

app.use('/assets', express.static(ASSETS_DIR));

// ─── SSE Events ──────────────────────────────────────────────────────────────

app.get('/api/events/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(':ok\n\n');
  addSseClient(sessionId, res);
  req.on('close', () => {
    removeSseClient(sessionId, res);
  });
});

// ─── Test helpers (dev only) ─────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  app.post('/api/test/create-choice', async (req, res) => {
    const { sessionId, type, payload } = req.body;
    const { createChoice } = await import('./modules/choice.js');
    const handle = createChoice(sessionId ?? 'test-session', type ?? 'test', payload ?? {});
    handle.promise
      .then((result) => console.log('[test] choice resolved:', result))
      .catch((err) => console.log('[test] choice rejected:', err.message));
    res.json({ created: true, choiceId: handle.id });
  });
}

// ─── Start ───────────────────────────────────────────────────────────────────

// SPA fallback — serve index.html for all non-API routes
app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/mcp/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

export function startHttpServer(mode: 'stdio' | 'sse'): Promise<void> {
  if (mode === 'sse') {
    registerMcpSseRoutes();
  }
  return new Promise((resolve) => {
    app.listen(PORT, '127.0.0.1', () => {
      process.stderr.write(`[server] CLI Helper ${mode} mode at http://localhost:${PORT}\n`);
      if (mode === 'sse') {
        process.stderr.write(`[mcp]    SSE endpoint at http://localhost:${PORT}/mcp/sse\n`);
      }
      resolve();
    });
  });
}

export const startSseServer = () => startHttpServer('sse');
