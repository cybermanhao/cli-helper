# Phase 1: HITL 基础设施 — 详细执行计划

> **周期**：2 周（10 个工作日）  
> **目标**：Agent 能在关键节点停下来，通过浏览器/Web UI 与人类交互  
> **验收标准**：见文末

---

## 前置依赖

开始前确保以下已就绪：

```bash
cd C:\code\cli-helper
npm install
# 确认 package.json 中已有：
#   @modelcontextprotocol/sdk, zod, esbuild, tsx, typescript, @types/node
```

---

## Week 1: 迁移与架构骨架

### Day 1: 项目骨架 + 迁移前身代码

#### Task 1.1: 清理并确认目录结构

目标目录树：
```
src/
├── index.ts              # 入口：模式分发
├── server.ts             # Express HTTP + SSE MCP
├── mcp/
│   ├── stdio.ts          # StdioServerTransport
│   ├── sse.ts            # SSEServerTransport
│   └── tools.ts          # Tool 定义列表
├── modules/
│   ├── session.ts        # Session 管理
│   ├── choice.ts         # Choice 框架
│   └── events.ts         # SSE 广播
├── platform/
│   ├── dialog.ts         # 跨平台对话框
│   └── notification.ts   # 跨平台通知
└── picker/
    ├── picker.ts         # 浏览器端逻辑（已有）
    └── types.ts          # 类型定义（已有）
```

操作：
```powershell
# 创建目录
mkdir src\mcp, src\modules, src\platform
```

#### Task 1.2: 迁移平台层代码

将前身 `index.ts` 中的平台相关函数提取到独立文件：

**`src/platform/dialog.ts`** — 从原 `toolShowDialog` 提取：
- `detectPlatform()` -> `Platform`
- `runCmd()` -> `{ stdout, success, stderr }`
- `toolShowDialog()` -> `object`
- 保持跨平台逻辑不变（Win PowerShell / mac AppleScript / Linux zenity+kdialog）

**`src/platform/notification.ts`** — 从原 `toolShowNotification` 提取：
- `toolShowNotification()` -> `object`

#### Task 1.3: 迁移核心工具代码

**`src/mcp/tools.ts`** — 包含所有 tool 实现函数：
- `toolRunCommand()`
- `toolCheckProcess()`
- `toolOpenPath()`
- `toolReadInbox()` / `toolWriteLog()` / `toolUpdateState()` / `toolSendToAgent()`
- `toolShowAssetPicker()`（先保留同步版本，Day 6 改为异步）
- `toolUploadFiles()`（先保留同步版本，Day 6 改为异步）

关键改造点：
```typescript
// 移除硬编码
// 原：const PROJECT_ROOT = 'C:/code/slay-the-mod';
// 新：
const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();

// workspace 目录改为基于 PROJECT_ROOT
const WORKSPACE_DIR = path.join(PROJECT_ROOT, 'agent-workspace');
```

#### Task 1.4: 编写入口文件

**`src/index.ts`**：
```typescript
import { startStdioServer } from './mcp/stdio.js';
import { startSseServer } from './server.js';

const mode = process.env.CLI_HELPER_MODE ?? 'stdio';

if (mode === 'sse') {
  startSseServer();
} else {
  startStdioServer();
}
```

#### Day 1 验收点
- [ ] `npm run typecheck` 无错误（除已知缺失模块外）
- [ ] `npm run build` 成功生成 `dist/`
- [ ] `npm start` 能启动（stdio 模式）
- [ ] Kimi CLI 连接后 `show_dialog` 能弹出对话框

---

### Day 2: Express HTTP 服务器 + 双传输

#### Task 2.1: 实现 stdio 传输封装

**`src/mcp/stdio.ts`**：
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export function startStdioServer() {
  const server = new Server(
    { name: 'cli-helper-mcp', version: '2.1.0' },
    { capabilities: { tools: {} } }
  );
  registerToolHandlers(server);
  const transport = new StdioServerTransport();
  server.connect(transport);
}
```

#### Task 2.2: 实现 Express HTTP 服务器

**`src/server.ts`**：
```typescript
import express from 'express';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = Number(process.env.DASHBOARD_PORT) || 7842;

// MCP SSE endpoint
let transport: SSEServerTransport | null = null;

app.get('/mcp/sse', async (req, res) => {
  transport = new SSEServerTransport('/mcp/message', res);
  const server = new McpServer(
    { name: 'cli-helper-mcp', version: '2.1.0' },
    { capabilities: { tools: {} } }
  );
  registerToolHandlers(server);
  await server.connect(transport);
});

app.post('/mcp/message', async (req, res) => {
  if (!transport) {
    res.status(400).json({ error: 'No active SSE connection' });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

export function startSseServer() {
  app.listen(PORT, () => {
    console.log(`[server] CLI Helper running at http://localhost:${PORT}`);
    console.log(`[mcp]    SSE endpoint at http://localhost:${PORT}/mcp/sse`);
  });
}
```

#### Task 2.3: 注册统一 Tool Handlers

**`src/mcp/tools.ts`** 导出 `registerToolHandlers(server)`：
```typescript
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export function registerToolHandlers(server: Server) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [ /* 所有 tool 定义 */ ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
      case 'show_dialog': return { content: [{ type: 'text', text: JSON.stringify(toolShowDialog(args as any)) }] };
      // ... 其他 tools
    }
  });
}
```

#### Task 2.4: 添加缺失依赖

```bash
npm install express cors
npm install -D @types/express @types/cors
```

#### Day 2 验收点
- [ ] `CLI_HELPER_MODE=sse npm start` 启动成功
- [ ] `curl http://localhost:7842/mcp/sse` 返回 SSE stream
- [ ] stdio 模式仍正常工作

---

### Day 3: Session 管理模块

#### Task 3.1: 定义 Session 类型

**`src/modules/session.ts`**：
```typescript
export type OsType = 'windows' | 'macos' | 'linux';
export type DesktopEnv = 'gnome' | 'kde' | 'other' | null;
export type SessionStatus = 'pending' | 'waiting_user' | 'running' | 'completed' | 'cancelled' | 'error' | 'timeout';
export type ErrorCode = 'TIMEOUT' | 'CANCELLED' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'PLATFORM_UNSUPPORTED' | 'SESSION_EXPIRED' | 'UNKNOWN';

export interface CliSession {
  id: string;
  tool: string;
  status: SessionStatus;
  createdAt: number;
  resolvedAt?: number;
  payload: unknown;
  result?: unknown;
  error?: { code: ErrorCode; message: string };
  abortController?: AbortController;
  choiceId?: string;
}

const sessions = new Map<string, CliSession>();

export function createSession(tool: string, payload: unknown): CliSession {
  const session: CliSession = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    tool,
    status: 'pending',
    createdAt: Date.now(),
    payload,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): CliSession | undefined {
  return sessions.get(id);
}

export function updateSession(id: string, updates: Partial<CliSession>): void {
  const s = sessions.get(id);
  if (s) Object.assign(s, updates);
}

export function listActiveSessions(): CliSession[] {
  return Array.from(sessions.values()).filter(s =>
    s.status === 'pending' || s.status === 'waiting_user' || s.status === 'running'
  );
}

export function cleanupSessions(maxAgeMs = 3600000): void {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff && s.status !== 'pending' && s.status !== 'waiting_user' && s.status !== 'running') {
      sessions.delete(id);
    }
  }
}
```

#### Task 3.2: 注册 Session REST API

在 `src/server.ts` 中添加：
```typescript
import { getSession, listActiveSessions, createSession, updateSession } from './modules/session.js';

// GET /api/session/:id/status
app.get('/api/session/:id/status', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
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

// GET /api/sessions
app.get('/api/sessions', (req, res) => {
  res.json({ sessions: listActiveSessions() });
});

// POST /api/session/:id/abort
app.post('/api/session/:id/abort', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.abortController?.abort(new Error('User requested abort'));
  updateSession(req.params.id, { status: 'cancelled', resolvedAt: Date.now() });
  res.json({ aborted: true });
});
```

#### Day 3 验收点
- [ ] `GET /api/sessions` 返回空数组 `[]`
- [ ] 创建一个 Session 后，`GET /api/session/:id/status` 返回正确数据
- [ ] `POST /api/session/:id/abort` 将状态改为 `cancelled`

---

### Day 4: Choice 框架

#### Task 4.1: 实现 Choice 核心逻辑

**`src/modules/choice.ts`**：
```typescript
import { randomUUID } from 'crypto';

export interface PendingChoice<T = unknown> {
  id: string;
  sessionId: string;
  type: string;
  payload: unknown;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  createdAt: number;
}

const pendingChoices = new Map<string, PendingChoice>();

export function createChoice<T>(
  sessionId: string,
  type: string,
  payload: unknown,
  timeoutMs = 300_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timeout = setTimeout(() => {
      pendingChoices.delete(id);
      reject(new Error(`Choice ${id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingChoices.set(id, { id, sessionId, type, payload, resolve, reject, timeout, createdAt: Date.now() });
    // 广播由调用方负责（避免循环依赖）
  });
}

export function resolveChoice(choiceId: string, result: unknown): boolean {
  const choice = pendingChoices.get(choiceId);
  if (!choice) return false;
  clearTimeout(choice.timeout);
  pendingChoices.delete(choiceId);
  choice.resolve(result);
  return true;
}

export function rejectChoice(choiceId: string, reason: string): boolean {
  const choice = pendingChoices.get(choiceId);
  if (!choice) return false;
  clearTimeout(choice.timeout);
  pendingChoices.delete(choiceId);
  choice.reject(new Error(reason));
  return true;
}

export function getChoicesBySession(sessionId: string): Array<Pick<PendingChoice, 'id' | 'type' | 'payload' | 'createdAt'>> {
  return Array.from(pendingChoices.values())
    .filter(c => c.sessionId === sessionId)
    .map(c => ({ id: c.id, type: c.type, payload: c.payload, createdAt: c.createdAt }));
}

export function getChoice(choiceId: string): PendingChoice | undefined {
  return pendingChoices.get(choiceId);
}
```

#### Task 4.2: 注册 Choice REST API

在 `src/server.ts` 中添加：
```typescript
import { resolveChoice, rejectChoice, getChoicesBySession } from './modules/choice.js';

// POST /api/choice/:choiceId
app.post('/api/choice/:choiceId', (req, res) => {
  const resolved = resolveChoice(req.params.choiceId, req.body);
  res.json({ resolved });
});

// GET /api/choices/:sessionId
app.get('/api/choices/:sessionId', (req, res) => {
  res.json({ choices: getChoicesBySession(req.params.sessionId) });
});

// POST /api/cancel-choice/:choiceId
app.post('/api/cancel-choice/:choiceId', (req, res) => {
  const { reason } = req.body as { reason?: string };
  const cancelled = rejectChoice(req.params.choiceId, reason ?? 'User cancelled');
  res.json({ cancelled });
});
```

#### Day 4 验收点
- [ ] 单元测试：create -> resolve -> Promise resolved
- [ ] 单元测试：create -> timeout -> Promise rejected
- [ ] REST API `POST /api/choice/:id` 能正确 resolve

---

### Day 5: SSE 事件流 + 整合

#### Task 5.1: 实现 SSE 广播模块

**`src/modules/events.ts`**：
```typescript
import type { Response } from 'express';

const sseClients = new Map<string, Set<Response>>();

export function addSseClient(sessionId: string, res: Response): void {
  if (!sseClients.has(sessionId)) sseClients.set(sessionId, new Set());
  sseClients.get(sessionId)!.add(res);
}

export function removeSseClient(sessionId: string, res: Response): void {
  sseClients.get(sessionId)?.delete(res);
}

export function broadcast(sessionId: string, data: unknown): void {
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

export function broadcastToAll(data: unknown): void {
  for (const [sessionId, clients] of sseClients) {
    broadcast(sessionId, data);
  }
}
```

#### Task 5.2: 注册 SSE Endpoint

在 `src/server.ts` 中添加：
```typescript
import { addSseClient, removeSseClient } from './modules/events.js';

// GET /api/events/:sessionId
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
```

#### Task 5.3: 整合 Choice + SSE

修改 `src/modules/choice.ts` 中的 `createChoice`：
```typescript
import { broadcast } from './events.js';

export function createChoice<T>(sessionId: string, type: string, payload: unknown, timeoutMs = 300_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timeout = setTimeout(() => {
      pendingChoices.delete(id);
      broadcast(sessionId, { type: 'choice-timeout', choiceId: id });
      reject(new Error(`Choice ${id} timed out`));
    }, timeoutMs);
    pendingChoices.set(id, { id, sessionId, type, payload, resolve, reject, timeout, createdAt: Date.now() });
    // 广播 choice-request 事件
    broadcast(sessionId, { type: 'choice-request', choiceId: id, choiceType: type, payload });
  });
}
```

修改 `resolveChoice` 和 `rejectChoice`：
```typescript
export function resolveChoice(choiceId: string, result: unknown): boolean {
  const choice = pendingChoices.get(choiceId);
  if (!choice) return false;
  clearTimeout(choice.timeout);
  pendingChoices.delete(choiceId);
  broadcast(choice.sessionId, { type: 'choice-resolved', choiceId, result });
  choice.resolve(result);
  return true;
}

export function rejectChoice(choiceId: string, reason: string): boolean {
  const choice = pendingChoices.get(choiceId);
  if (!choice) return false;
  clearTimeout(choice.timeout);
  pendingChoices.delete(choiceId);
  broadcast(choice.sessionId, { type: 'choice-rejected', choiceId, reason });
  choice.reject(new Error(reason));
  return true;
}
```

#### Task 5.4: 周期性清理

在 `src/server.ts` 启动时添加：
```typescript
import { cleanupSessions } from './modules/session.js';

// 每 5 分钟清理过期 Session
setInterval(() => cleanupSessions(3600000), 300000);
```

#### Day 5 验收点
- [ ] `curl http://localhost:7842/api/events/test-session` 建立 SSE 连接
- [ ] 调用 `broadcast('test-session', { type: 'test' })` 后 curl 收到数据
- [ ] createChoice 后 SSE 客户端收到 `choice-request` 事件
- [ ] resolveChoice 后 SSE 客户端收到 `choice-resolved` 事件

---

## Week 2: 工具异步化 + Web UI

### Day 6: 改造 show_asset_picker 为异步

#### Task 6.1: 重写 toolShowAssetPicker

**`src/mcp/tools.ts`** 中的 `show_asset_picker` handler：
```typescript
import { createSession, updateSession, getSession } from '../modules/session.js';
import { createChoice } from '../modules/choice.js';
import { broadcast } from '../modules/events.js';

async function handleShowAssetPicker(args: any) {
  const { title, message, assets, multiSelect, allowUpload, uploadDir, showHistory } = args;

  // 1. 创建 Session
  const session = createSession('show_asset_picker', args);
  updateSession(session.id, { status: 'waiting_user' });

  // 2. 构建 picker HTML（复用前身逻辑）
  const html = buildPickerHtml(session.id, title, message, assets, multiSelect, allowUpload);

  // 3. 提供 HTTP endpoint 供浏览器获取页面
  // （页面路由已在 server.ts 中注册）

  // 4. 打开浏览器
  const url = `http://localhost:${PORT}/picker/${session.id}`;
  spawnSync('cmd.exe', ['/c', 'start', '"

", url], { shell: false, timeout: 5000 });

  // 5. 创建 Choice 等待用户响应
  try {
    const result = await createChoice(session.id, 'asset_picker', { sessionId: session.id }, 600000);
    updateSession(session.id, { status: 'completed', result, resolvedAt: Date.now() });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err: any) {
    updateSession(session.id, { status: 'cancelled', error: { code: 'CANCELLED', message: err.message }, resolvedAt: Date.now() });
    return { content: [{ type: 'text', text: JSON.stringify({ cancelled: true, error: err.message }) }] };
  }
}
```

#### Task 6.2: Picker HTTP 路由

在 `src/server.ts` 中添加 picker 页面路由：
```typescript
// GET /picker/:sessionId
app.get('/picker/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).send('Session not found');
  const { title, message, assets, multiSelect, allowUpload } = session.payload as any;
  const html = buildPickerHtml(req.params.sessionId, title, message, assets, multiSelect, allowUpload);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});
```

#### Task 6.3: Picker 选择结果端点

在 `src/server.ts` 中添加：
```typescript
// POST /api/pick/:sessionId
app.post('/api/pick/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.choiceId) return res.status(400).json({ error: 'No pending choice' });

  const { indices, uploaded, cancelled } = req.body;
  if (cancelled) {
    rejectChoice(session.choiceId, 'User cancelled');
  } else {
    resolveChoice(session.choiceId, { selections: indices, uploadedFiles: uploaded, cancelled: false });
  }
  res.json({ received: true });
});
```

修改 `buildPickerHtml` 中的表单提交逻辑，指向 `/api/pick/${sessionId}`。

#### Day 6 验收点
- [ ] MCP 调用 `show_asset_picker` 后返回 Promise（不阻塞 stdio）
- [ ] 浏览器自动打开 picker 页面
- [ ] 用户选择后点击 Confirm，Agent 收到结果
- [ ] 用户点击 Cancel，Agent 收到 cancelled 响应
- [ ] SSE 事件流能观察到 choice-request 和 choice-resolved

---

### Day 7: 改造 upload_files 为异步 + Web UI 骨架

#### Task 7.1: 重写 toolUploadFiles

与 `show_asset_picker` 类似：
1. 创建 Session
2. 构建 upload HTML 页面
3. 打开浏览器
4. 创建 Choice 等待用户上传完成

#### Task 7.2: Upload HTTP 端点

```typescript
// POST /api/upload/:sessionId
app.post('/api/upload/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);
  if (!session || !session.choiceId) return res.status(404).json({ error: 'Session not found' });

  const { files, cancelled } = req.body;
  if (cancelled) {
    rejectChoice(session.choiceId, 'User cancelled');
  } else {
    resolveChoice(session.choiceId, { files, cancelled: false });
  }
  res.json({ received: true });
});
```

#### Task 7.3: Web UI 最小可用面板

**`public/index.html`**：
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>CLI Helper Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f0f1a; color: #e0e0e0; padding: 24px; margin: 0; }
    h1 { color: #c8a2e8; font-size: 1.4rem; }
    .session { background: #16213e; border: 1px solid #2a2a4e; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
    .session-id { color: #7b5ea7; font-family: monospace; }
    .status { color: #888; }
    .status.waiting_user { color: #f0c040; }
    .status.completed { color: #40c040; }
    .status.cancelled { color: #c04040; }
    #events { background: #0a0a14; border-radius: 8px; padding: 12px; max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 0.85rem; }
    .event { margin-bottom: 4px; color: #aaa; }
  </style>
</head>
<body>
  <h1>CLI Helper Dashboard</h1>
  <div id="sessions"></div>
  <h2>Events</h2>
  <div id="events"></div>

  <script>
    const sessionId = new URLSearchParams(location.search).get('session') || 'default';
    const es = new EventSource(`/api/events/${sessionId}`);
    const eventsDiv = document.getElementById('events');
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      const div = document.createElement('div');
      div.className = 'event';
      div.textContent = `[${new Date().toLocaleTimeString()}] ${data.type}`;
      eventsDiv.appendChild(div);
      eventsDiv.scrollTop = eventsDiv.scrollHeight;
    };

    async function loadSessions() {
      const r = await fetch('/api/sessions');
      const { sessions } = await r.json();
      const container = document.getElementById('sessions');
      container.innerHTML = sessions.length ? '' : '<p style="color:#666">No active sessions</p>';
      sessions.forEach(s => {
        const div = document.createElement('div');
        div.className = 'session';
        div.innerHTML = `
          <div class="session-id">${s.id}</div>
          <div>Tool: ${s.tool}</div>
          <div class="status ${s.status}">Status: ${s.status}</div>
          <div>Created: ${new Date(s.createdAt).toLocaleString()}</div>
        `;
        container.appendChild(div);
      });
    }
    loadSessions();
    setInterval(loadSessions, 3000);
  </script>
</body>
</html>
```

在 `src/server.ts` 中添加静态文件服务：
```typescript
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '../public')));

// catch-all: SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
```

#### Day 7 验收点
- [ ] `http://localhost:7842` 显示 Dashboard
- [ ] Dashboard 显示活跃 Session 列表
- [ ] Dashboard 实时显示 SSE 事件
- [ ] `upload_files` 异步工作正常

---

### Day 8: 整合测试

#### Task 8.1: 端到端测试用例

| # | 场景 | 步骤 | 预期结果 |
|---|------|------|---------|
| 1 | stdio dialog | Kimi CLI 调用 `show_dialog` | 弹出系统对话框 |
| 2 | stdio command | Kimi CLI 调用 `run_command` | 返回 stdout/stderr |
| 3 | SSE picker | MCP 连接 `/mcp/sse`，调用 `show_asset_picker` | 浏览器打开，选择后 MCP 返回结果 |
| 4 | Session 查询 | `GET /api/session/:id/status` | 返回正确状态 |
| 5 | Abort | `POST /api/session/:id/abort` | Session 状态变为 cancelled |
| 6 | Choice timeout | 创建 Choice 后不响应，等待超时 | Promise reject，SSE 发送 timeout 事件 |
| 7 | 多客户端 SSE | 两个浏览器标签同时订阅同一 session | 两个标签都收到事件 |

#### Task 8.2: 修复编译错误

```bash
npm run typecheck
# 修复所有类型错误
```

#### Task 8.3: 修复运行时 Bug

- [ ] Windows 路径处理（`\` vs `/`）
- [ ] SSE 连接断开未清理（`req.on('close')`）
- [ ] Session 内存泄漏（确认 cleanup 生效）
- [ ] Choice 超时后 Map 未清理

#### Day 8 验收点
- [ ] 全部 7 个测试用例通过
- [ ] `npm run typecheck` 无错误
- [ ] `npm run build` 成功

---

### Day 9: 优化与文档

#### Task 9.1: 日志系统

**`src/modules/logger.ts`**：
```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL = (process.env.CLI_HELPER_LOG_LEVEL ?? 'info') as LogLevel;
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[LOG_LEVEL]) return;
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`);
}
```

替换所有 `console.log` / `console.error` 为结构化日志。

#### Task 9.2: 配置系统

**`src/config.ts`**：
```typescript
import path from 'path';
import os from 'os';

export const CONFIG = {
  PROJECT_ROOT: process.env.PROJECT_ROOT ?? process.cwd(),
  DASHBOARD_PORT: Number(process.env.DASHBOARD_PORT) || 7842,
  MODE: process.env.CLI_HELPER_MODE ?? 'stdio',
  LOG_LEVEL: (process.env.CLI_HELPER_LOG_LEVEL ?? 'info') as LogLevel,
  CONFIG_DIR: process.env.CLI_HELPER_CONFIG_DIR ?? path.join(os.homedir(), '.cli-helper'),
  SESSION_TIMEOUT_MS: 600_000,  // 10 分钟
  SESSION_CLEANUP_INTERVAL_MS: 300_000,  // 5 分钟
  CHOICE_TIMEOUT_MS: 300_000,  // 5 分钟
};
```

#### Task 9.3: README 更新

更新 `README.md`，添加：
- 双模式说明（stdio / sse）
- 环境变量列表
- REST API 端点列表
- Web UI 使用说明

#### Day 9 验收点
- [ ] 日志分级正常工作
- [ ] 配置集中管理
- [ ] README 包含 Phase 1 所有新功能

---

### Day 10: 验收与交付

#### Task 10.1: 最终构建测试

```bash
# 清理构建
rm -rf dist/
npm run build

# 测试 stdio 模式
npm start
# -> 用 Kimi CLI 连接，测试 dialog + command

# 测试 SSE 模式
$env:CLI_HELPER_MODE='sse'; npm start
# -> 用 Inspector 或自定义客户端连接 /mcp/sse
# -> 测试 picker + upload
```

#### Task 10.2: 性能基准

| 指标 | 测试方法 | 目标值 |
|------|---------|--------|
| 启动时间 | `time npm start` | < 2s |
| HTTP 响应 | `curl -w "%{time_total}" http://localhost:7842/api/sessions` | < 50ms |
| SSE 延迟 | 发送 broadcast 到客户端收到 | < 10ms |
| 内存占用 | `process.memoryUsage().heapUsed` | < 100MB |

#### Task 10.3: 交付清单

- [ ] `src/` 目录完整，模块拆分清晰
- [ ] `public/` 包含 Dashboard HTML
- [ ] `dist/` 构建成功
- [ ] `package.json` 依赖完整
- [ ] `README.md` 已更新
- [ ] `PLAN-PHASE1.md` 中所有 Task 打勾

---

## 验收标准（Phase 1 总体）

### 必须完成（P0）

- [ ] `npm run build && npm start` 无报错
- [ ] stdio 模式下 `show_dialog` / `run_command` 正常工作
- [ ] SSE 模式下 MCP 连接成功，工具调用返回正确
- [ ] `show_asset_picker` 改为异步 Choice 模式：
  - Agent 调用后不阻塞
  - 浏览器自动打开 picker 页面
  - 用户选择后 Agent 收到结果
- [ ] `upload_files` 同理改为异步 Choice 模式
- [ ] Web UI Dashboard 显示活跃 Session 列表
- [ ] SSE 事件流实时推送
- [ ] `POST /api/session/:id/abort` 能取消进行中的操作
- [ ] Session 超时自动清理

### 最好完成（P1）

- [ ] 日志分级系统
- [ ] 配置集中管理
- [ ] README 完整更新
- [ ] 性能基准测试通过

### 可延后（P2）

- [ ] Dashboard 美观优化（当前可用即可）
- [ ] 多语言支持
- [ ] 移动端适配

---

## 风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| Express + MCP SDK 集成冲突 | 中 | Day 2 专注解决，参考 gemini-image-generate 的 server.ts |
| Windows 浏览器打开失败 | 低 | 备用方案：输出 URL 到控制台，让用户手动打开 |
| SSE 连接数过多导致内存泄漏 | 中 | Day 3 实现 `req.on('close')` 清理，Day 8 专项测试 |
| 前身代码耦合度高难以拆分 | 中 | Day 1 不过度重构，先整体迁移再逐步拆分 |
| 异步 picker 与旧代码不兼容 | 低 | 保留同步 fallback，通过参数切换 |

---

*文档版本：v1.0*  
*最后更新：2026-04-20*  
*状态：待执行*
