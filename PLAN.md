# CLI Helper MCP - 发展计划

> **定位**：AI Agent 的跨平台交互基础设施
> **演进路径**：HITL (Human-in-the-Loop) -> HOTM (Human-on-the-Loop)
> **最终形态**：Agent Governance Layer - Agent 与人类之间的治理与协作层

---

## 1. 项目背景

### 1.1 起源

CLI Helper 最初是 `slay-the-mod/packages/cli-helper-mcp` 中的专用工具，为 Slay the Spire 2 Mod 开发提供跨平台用户交互能力（对话框、通知、文件选择等）。后提取为独立项目，目标是成为**通用跨平台 Agent 交互基础设施**。

### 1.2 当前状态

| 项目 | 状态 |
|------|------|
| 当前仓库 (`C:\code\cli-helper`) | v2.0.0，仅含 `src/picker/`，`index.ts` 缺失，无法构建 |
| 前身 (`slay-the-mod/packages/cli-helper-mcp`) | v1.0.0，功能完整（1538 行），硬编码 `C:/code/slay-the-mod` |
| 参考 (`gemini-image-generate`) | 成熟的 MCP + HTTP 混合架构，SSE、Session、Choice、AbortController |

### 1.3 核心矛盾

前身代码是**无状态的本地脚本**：Agent 调用工具 -> 阻塞等待 -> 返回结果。这种模型无法支撑**人类在环路上监控**的愿景。需要从「同步阻塞」进化为「异步事件驱动」。

---

## 2. 愿景与定位

### 2.1 一句话定义

> CLI Helper 不是"给 Agent 用的工具箱"，而是"Agent 和人类共用的操作系统"。Agent 通过它操作世界，人类通过它监督 Agent。

### 2.2 三层架构愿景

```
+---------------------+
|      Human (人类)    |
|  在环路上监控/必要时介入 |
+---------------------+
           ^
           | SSE / Hook
           |
+---------------------+
|   cli-helper (治理层) |
|  +-----+ +-----+    |
|  |Policy| |Event|    |
|  |Engine| |Stream|   |
|  +-----+ +-----+    |
|  +----------------+ |
|  | Intervention   | |
|  | Point (介入点) | |
|  +----------------+ |
+---------------------+
           |
+---------------------+
|   Agent (Claude/     |
|   Kimi / 自研)       |
+---------------------+
```

### 2.3 HITL vs HOTM

| 维度 | HITL (Human-in-the-Loop) | HOTM (Human-on-the-Loop) |
|------|-------------------------|--------------------------|
| **Agent 状态** | 停下来等人类 | 持续运行，人类旁观 |
| **人类角色** | 参与者（必须响应） | 监督者（可选介入） |
| **交互频率** | 每一步都可能阻塞 | 只在异常/高风险时通知 |
| **典型场景** | "请确认删除？" | "Agent 已删除 3 个文件，正在执行第 4 个（您有 5 秒可撤销）" |

---

## 3. 技术架构设计

### 3.1 双传输协议

CLI Helper 同时支持两种 MCP 传输：

- **stdio**：零配置启动，即插即用，适合本地 CLI Agent（Kimi CLI / Claude Code）
- **SSE**：支持异步、可观测、多客户端，适合远程调用和 Web UI 联动

```
+-----------+  stdio MCP   +---------------------+
|   Agent   |<------------>|  cli-helper         |
| (Kimi/    |              |  +----------------+ |
|  Claude)  |  SSE events  |  | StdioTransport | |
|           |<-------------|  +----------------+ |
|           |              |  +----------------+ |
|           |              |  | SSETransport   | |
|           |              |  +----------------+ |
|           |              |  +----------------+ |
|           |              |  | Express HTTP   | |
|           |              |  +----------------+ |
+-----------+              +---------------------+
```

### 3.2 核心模块

#### Module A: Session 管理

所有交互都抽象为 Session，统一管理生命周期。

```typescript
interface CliSession {
  id: string;
  tool: 'dialog' | 'asset_picker' | 'upload' | 'command' | 'notification';
  status: 'pending' | 'waiting_user' | 'running' | 'completed' | 'cancelled' | 'error' | 'timeout';
  createdAt: number;
  resolvedAt?: number;
  payload: unknown;
  result?: unknown;
  error?: { code: ErrorCode; message: string };
  abortController?: AbortController;
  choiceId?: string;
}
```

REST API:
- `GET /api/session/:id/status`
- `POST /api/session/:id/abort`
- `GET /api/sessions` (list active)

#### Module B: Choice 框架（HITL 核心）

借鉴 `gemini-image-generate` 的 `createChoice` / `resolveChoice` 模式。

```typescript
interface PendingChoice {
  id: string;
  sessionId: string;
  type: string;
  payload: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  createdAt: number;
}
```

工作流：
1. Agent 调用 tool -> 创建 Choice -> Promise 阻塞
2. SSE broadcast 通知所有客户端 -> Web UI 展示交互界面
3. 用户操作 -> POST `/api/choice/:id` -> resolveChoice -> Promise resolve
4. Agent 收到结果，继续执行

REST API:
- `POST /api/choice/:choiceId`
- `GET /api/choices/:sessionId`
- `POST /api/cancel-choice/:choiceId`

#### Module C: Policy Engine（HOTM 核心）

人类预设规则，Agent 执行前自动校验。

```typescript
interface Policy {
  id: string;
  name: string;
  scope: 'tool' | 'command' | 'file' | 'network';
  pattern: string | RegExp;
  action: 'allow' | 'deny' | 'confirm' | 'notify' | 'delay';
  delayMs?: number;
  notifyMessage?: string;
}
```

默认策略示例：
```typescript
const defaultPolicies: Policy[] = [
  { scope: 'command', pattern: 'rm -rf /', action: 'deny' },
  { scope: 'command', pattern: 'git push', action: 'confirm' },
  { scope: 'command', pattern: 'npm install', action: 'allow' },
  { scope: 'file', pattern: '*.env', action: 'confirm' },
  { scope: 'tool', pattern: 'run_command', action: 'notify', delayMs: 5000 },
];
```

执行逻辑：
```
Agent 调用 run_command("git push origin main")
        |
        v
+---------------+
| Policy Engine | <- 匹配规则：git push -> action: 'confirm'
|               | <- 发送通知到 Web UI + SSE
|               | <- 启动 5 秒倒计时
+---------------+
        |
    +---+---+
    v       v
  人类确认  超时
    |       |
    v       v
  允许     允许（默认通过）
```

#### Module D: Event Stream（可观测性）

所有 Agent 操作变成可观测的事件序列。

```typescript
interface AgentEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  type: 'tool_call' | 'tool_result' | 'decision' | 'policy_triggered' | 'human_intervention';
  tool?: string;
  input?: unknown;
  output?: unknown;
  policyAction?: 'allow' | 'deny' | 'confirm' | 'notify';
  humanResponse?: 'approved' | 'denied' | 'modified' | 'timeout';
}
```

SSE 端点：`GET /api/events/:sessionId`

#### Module E: Intervention Point（介入点）

人类可随时主动操控 Agent 执行流。

```typescript
interface Intervention {
  type: 'pause' | 'resume' | 'modify' | 'inject' | 'abort' | 'rewind';
  targetEventId?: string;
  payload?: unknown;
}
```

REST API: `POST /api/intervene/:sessionId`

#### Module F: Context Snapshot（上下文快照）

可回溯的交互历史，用于调试和 Agent 自省。

```typescript
interface ContextSnapshot {
  sessionId: string;
  timeline: Array<{
    t: number;
    event: string;
    data: unknown;
  }>;
  platform: { os: OsType; desktop: DesktopEnv };
  result?: unknown;
}
```

REST API: `GET /api/session/:sessionId/snapshot`

### 3.3 错误码体系

```typescript
type ErrorCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'PLATFORM_UNSUPPORTED'
  | 'POLICY_DENIED'
  | 'SESSION_EXPIRED'
  | 'UNKNOWN';
```

### 3.4 MCP Tools 清单

#### 现有工具（从前身继承）

| Tool | 描述 | HITL 阶段 | HOTM 阶段 |
|------|------|----------|----------|
| `show_dialog` | 同步对话框 | 保持 | + Policy 集成 |
| `show_notification` | 非阻塞系统通知 | 保持 | 核心（延迟窗口通知） |
| `show_asset_picker` | 浏览器图片选择器 | 改为 Choice 异步 | 保持 |
| `upload_files` | 拖拽文件上传 | 改为 Choice 异步 | 保持 |
| `run_command` | 运行 shell 命令 | 保持 | + Policy 拦截 |
| `check_process` | 检查进程是否运行 | 保持 | 保持 |
| `open_path` | 打开文件/文件夹 | 保持 | 保持 |
| `read_inbox` | 读取用户消息 | 保持 | 保持 |
| `write_log` | 写入日志 | 保持 | 保持 |
| `update_state` | 更新状态快照 | 升级为 Snapshot | 保持 |
| `send_to_agent` | 发送消息给 agent | 保持 | 保持 |

#### 新增工具

| Tool | 描述 | 阶段 |
|------|------|------|
| `screenshot` | 截取当前屏幕 | Phase 3 |
| `clipboard_read` / `clipboard_write` | 剪贴板交互 | Phase 3 |
| `check_policy` | 查询策略 | Phase 2 |
| `list_sessions` | 列出活跃会话 | Phase 1 |
| `get_session_status` | 查询会话状态 | Phase 1 |
| `abort_session` | 取消会话 | Phase 1 |
| `intervene` | 发送干预指令 | Phase 2 |


---

## 4. 实施路线图

### Phase 1: HITL 基础设施（2 周）

**目标**：Agent 能在关键节点停下来，通过浏览器/Web UI 与人类交互。

#### Week 1: 迁移与架构骨架

**Task 1.1: 迁移前身代码**
- 将 `slay-the-mod/packages/cli-helper-mcp/src/index.ts` 迁移到当前仓库
- 移除硬编码 `PROJECT_ROOT = 'C:/code/slay-the-mod'`，改为环境变量
- 确保 `npm run build && npm start` 能跑通
- 保持所有原有工具功能不变

**Task 1.2: Express HTTP 服务器**
- 引入 Express，内嵌在 MCP 进程中
- 配置 CORS、JSON body parser（limit: 50mb）
- 静态文件服务（`dist/` 目录）
- 端口：`DASHBOARD_PORT` 环境变量，默认 7842

**Task 1.3: 双传输支持**
- stdio：保留 `StdioServerTransport`（默认模式）
- SSE：新增 `SSEServerTransport`（`CLI_HELPER_MODE=sse` 时启用）
- MCP endpoint：`GET /mcp/sse`，`POST /mcp/message`

**Task 1.4: Session 管理基础设施**
- 定义 `CliSession` 类型
- 内存 Session Store（`Map<string, CliSession>`）
- 实现 `getOrCreateSession()` / `setSessionStatus()` / `setSessionError()`
- REST API：`GET /api/session/:id/status`
- REST API：`POST /api/session/:id/abort`
- REST API：`GET /api/sessions`（列出活跃会话）

#### Week 2: Choice 框架与 Web UI

**Task 2.1: Choice 框架**
- 实现 `createChoice()` / `resolveChoice()` / `rejectChoice()`
- `PendingChoice` Map 管理（内存）
- 超时处理（默认 5 分钟）
- REST API：`POST /api/choice/:choiceId`
- REST API：`GET /api/choices/:sessionId`
- REST API：`POST /api/cancel-choice/:choiceId`

**Task 2.2: SSE 事件流**
- `GET /api/events/:sessionId` SSE endpoint
- `broadcast(sessionId, data)` 工具函数
- 事件类型：
  - `choice-request`：需要人类响应
  - `status`：会话状态变更
  - `round`：新的交互轮次
  - `error`：错误事件
  - `aborted`：操作被取消

**Task 2.3: 工具异步化**
- `show_asset_picker`：改为 Choice 异步模式
  - 创建 Session -> 打开浏览器 -> 创建 Choice -> Promise 等待
  - 用户选择后 POST `/api/choice/:id` -> resolve -> Agent 收到结果
- `upload_files`：同理改为 Choice 异步模式
- `show_dialog`：保留同步（简单场景），但内部记录 Session

**Task 2.4: Web UI 观测面板（最小可用）**
- 单页应用，展示当前活跃 Session 列表
- 实时接收 SSE 事件并更新界面
- 支持响应 Choice（确认/取消/输入）
- 技术栈：保持轻量（纯 HTML + 少量 JS），不引入 React
  - 原因：cli-helper 是基础设施，启动速度很重要
  - 如果后续功能复杂，再考虑迁移到 React

**Phase 1 验收标准**：
- [ ] `npm run build && npm start` 无报错
- [ ] Kimi CLI 通过 stdio 调用 `show_dialog` 正常工作
- [ ] 浏览器访问 `http://localhost:7842` 能看到 Web UI
- [ ] `show_asset_picker` 调用后 Agent 不阻塞，用户能在浏览器中选择
- [ ] Agent 能通过 SSE/轮询获取选择结果
- [ ] `POST /api/session/:id/abort` 能取消进行中的操作

---

### Phase 2: Policy Engine（1.5 周）

**目标**：Agent 能自主运行，但受预设规则约束。

#### Week 3: 策略引擎核心

**Task 3.1: Policy 类型与存储**
- 定义 `Policy` 接口
- JSON 文件持久化（`~/.cli-helper/policies.json`）
- 默认策略内置（不可删除，可覆盖）
- 热加载：文件变更自动重载

**Task 3.2: 策略匹配引擎**
- `matchPolicy(scope, value)` -> `Policy | undefined`
- 支持：字符串精确匹配、前缀匹配、正则匹配
- 优先级：用户自定义策略 > 默认策略

**Task 3.3: 策略执行**
- `evaluateAction(policy, context)` -> `{ action, message?, delayMs? }`
- 集成到 `run_command`：执行前自动 check policy
- 集成到 `open_path`：访问敏感路径前 check policy
- 新增工具 `check_policy`：Agent 主动查询策略

**Task 3.4: Policy MCP Tools**
- `list_policies`：列出当前生效策略
- `update_policy`：运行时更新策略（需要 human confirm，通过 Choice）

#### Week 4: Hook 集成与延迟确认

**Task 4.1: Claude Code Hook 模板**
- `hooks/before_tool_use.sh`：
  - 调用 `http://localhost:7842/api/hook/check`
  - 传入 tool name 和 args
  - 根据返回的 action 决定：继续 / 阻止 / 弹出确认对话框
- `hooks/after_tool_use.sh`：
  - 调用 `http://localhost:7842/api/hook/notify`
  - 用于审计和事件记录

**Task 4.2: Kimi CLI Hook 适配**
- 研究 Kimi CLI 的 hook / middleware 机制
- 提供对应脚本模板或配置示例

**Task 4.3: 延迟确认（Delay）模式**
- `action: 'delay', delayMs: 5000`
- Agent 执行命令，同时 SSE 通知人类
- 人类在 delayMs 内可点击"撤销"
- 超时未撤销则自动通过
- 这是 HOTM 的核心体验：Agent 在跑，人类在旁边看着，能随时踩刹车

**Phase 2 验收标准**：
- [ ] 配置文件 `~/.cli-helper/policies.json` 生效
- [ ] `run_command("git push")` 触发 confirm 策略，弹出对话框
- [ ] `run_command("npm install")` 被 allow 策略直接通过
- [ ] delay 模式下，命令先执行，5 秒内人类可在 Web UI 撤销
- [ ] Claude Code Hook 模板能正常工作

---

### Phase 3: 可观测性与治理面板（1.5 周）

**目标**：人类能实时看到 Agent 在做什么，随时介入。

#### Week 5: Event Stream 与 Context Snapshot

**Task 5.1: 统一事件记录**
- 所有 tool call / tool result / policy decision 都生成 `AgentEvent`
- 内存环形缓冲区（保留最近 1000 条）
- 可选：JSONL 文件持久化

**Task 5.2: Context Snapshot API**
- `GET /api/session/:sessionId/snapshot`
- 返回完整的交互时间线
- 包含：请求参数、平台信息、执行结果、策略决策

**Task 5.3: Intervention API**
- `POST /api/intervene/:sessionId`
- 支持类型：
  - `pause`：暂停 Agent 后续操作
  - `resume`：恢复执行
  - `modify`：修改即将执行的命令参数
  - `inject`：向 Agent 注入额外上下文/提示
  - `abort`：终止当前会话
  - `rewind`：回退到某个历史事件点（未来）

#### Week 6: Governance Dashboard

**Task 6.1: Web UI 升级**
- 新增 Governance Dashboard 页面
- 功能模块：
  - **Activity Stream**：实时滚动显示 Agent 操作流
  - **Session Inspector**：查看单个 Session 的完整时间线
  - **Policy Manager**：可视化查看和编辑策略
  - **Control Panel**：暂停/恢复/终止按钮

**Task 6.2: 通知增强**
- `show_notification` 支持更多平台原生的通知样式
- 通知可携带 action 按钮（"撤销" / "查看详情"）
- Windows: Toast notification with actions
- macOS: NSUserNotification with buttons

**Phase 3 验收标准**：
- [ ] Web UI 能看到 Agent 实时操作流
- [ ] 点击"暂停"后，Agent 的后续 tool call 被阻塞
- [ ] Context Snapshot 能完整回放一次交互过程
- [ ] 通知带"撤销"按钮，点击后取消对应操作

---

### Phase 4: 能力扩展与生态（2 周）

**目标**：补齐 Agent 高频需要但无法自给自足的平台能力。

#### Week 7-8: 新工具与分发

**Task 7.1: 截图工具**
- `screenshot` MCP tool
- 返回 base64 编码的 PNG
- 平台实现：
  - Windows: `nircmd` 或 PowerShell + .NET
  - macOS: `screencapture`
  - Linux: `gnome-screenshot` / `import`

**Task 7.2: 剪贴板工具**
- `clipboard_read` / `clipboard_write`
- Windows: PowerShell `Get-Clipboard` / `Set-Clipboard`
- macOS: `pbpaste` / `pbcopy`
- Linux: `xclip` / `wl-clipboard`

**Task 7.3: npm 发布**
- 包名：`cli-helper-mcp`
- 支持 `npx cli-helper-mcp` 一键运行
- 区分全局安装（长期服务）和本地安装（项目内使用）

**Task 7.4: Docker 支持**
- Dockerfile（基于 node:20-alpine）
- docker-compose.yml（带端口映射）
- 适合：远程部署、CI/CD 集成

**Task 7.5: 配置系统完善**
- 配置文件：`~/.cli-helper/config.json`
- 支持配置项：
  - `defaultPolicies`
  - `dashboardPort`
  - `notificationTimeout`
  - `autoStartDashboard`

**Phase 4 验收标准**：
- [ ] `npx cli-helper-mcp` 能直接启动
- [ ] `screenshot` 工具返回有效 base64 图片
- [ ] `clipboard_read` 能读取系统剪贴板内容
- [ ] Docker 镜像构建成功并运行


---

## 5. 非功能需求

### 5.1 性能

| 指标 | 目标 |
|------|------|
| 启动时间 | < 2 秒（stdio 模式） |
| HTTP 响应延迟 | < 50ms（本地） |
| Choice 超时 | 默认 5 分钟，可配置 |
| SSE 连接数 | 单进程支持 100+ 并发 |
| 内存占用 | < 200MB（空闲状态） |

### 5.2 可靠性

- **优雅降级**：某个平台功能不支持时，返回清晰的 `PLATFORM_UNSUPPORTED` 错误，而非崩溃
- **超时保护**：所有长时间操作都有超时机制
- **Abort 支持**：所有异步操作支持 `AbortController` 取消
- **会话清理**：已完成的 Session 定期清理（默认保留 1 小时）

### 5.3 安全性

- **命令注入防护**：`run_command` 的 `shell: true` 使用需要谨慎，Policy Engine 是主要防线
- **路径逃逸防护**：`resolveProjectPath()` 阻止访问 `PROJECT_ROOT` 之外的敏感路径
- **通知权限**：首次使用系统通知时请求权限（macOS / Windows）
- **CORS 限制**：HTTP 服务器默认只允许 localhost 访问，生产环境可配置白名单

### 5.4 可维护性

- **模块化**：按 Module A-F 拆分文件，避免单文件过大
- **类型安全**：100% TypeScript，严格模式
- **日志分级**：`info` / `warn` / `error` / `debug`，环境变量控制
- **向后兼容**：stdio MCP 接口保持稳定，SSE 和 REST API 遵循语义化版本

---

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| MCP SDK 版本升级导致 API 变更 | 高 | 锁定 SDK 主版本，升级前充分测试 |
| 跨平台实现差异大（Win/mac/Linux） | 中 | 平台检测 + 优雅降级 + 社区贡献 |
| 内存泄漏（SSE 连接未清理） | 中 | `req.on('close', ...)` 确保连接断开时清理 |
| Agent 不兼容异步 Choice 模式 | 中 | Phase 1 保留同步模式作为 fallback |
| 用户觉得 Web UI 太重不想用 | 低 | 保持轻量，纯 HTML+JS，不引入前端框架 |
| Claude Code / Kimi CLI Hook 机制变更 | 中 | Hook 脚本保持简单，核心是 HTTP API 调用 |

---

## 7. 附录

### 7.1 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PROJECT_ROOT` | `process.cwd()` | 项目根目录，用于路径解析 |
| `DASHBOARD_PORT` | `7842` | HTTP 服务器端口 |
| `CLI_HELPER_MODE` | `stdio` | 运行模式：`stdio` 或 `sse` |
| `CLI_HELPER_LOG_LEVEL` | `info` | 日志级别 |
| `CLI_HELPER_CONFIG_DIR` | `~/.cli-helper` | 配置文件目录 |

### 7.2 目录结构（目标）

```
cli-helper/
├── src/
│   ├── index.ts              # 入口：根据 mode 启动 stdio 或 sse
│   ├── server.ts             # Express HTTP 服务器 + SSE MCP
│   ├── mcp/
│   │   ├── stdio.ts          # StdioServerTransport 封装
│   │   ├── sse.ts            # SSEServerTransport 封装
│   │   └── tools.ts          # MCP Tool 定义与路由
│   ├── modules/
│   │   ├── session.ts        # Module A: Session 管理
│   │   ├── choice.ts         # Module B: Choice 框架
│   │   ├── policy.ts         # Module C: Policy 引擎
│   │   ├── events.ts         # Module D: Event Stream
│   │   ├── intervention.ts   # Module E: Intervention Point
│   │   └── snapshot.ts       # Module F: Context Snapshot
│   ├── platform/
│   │   ├── dialog.ts         # 跨平台对话框实现
│   │   ├── notification.ts   # 跨平台通知实现
│   │   └── screenshot.ts     # 跨平台截图实现 (Phase 3)
│   └── picker/
│       ├── picker.ts         # 浏览器端选择器逻辑
│       └── types.ts          # 共享类型
├── public/                   # Web UI 静态文件
│   ├── index.html
│   ├── dashboard.html
│   └── js/
│       └── app.js
├── dist/                     # 构建输出
├── .cli-helper/              # 运行时配置（gitignore）
│   └── policies.json
├── package.json
├── tsconfig.json
└── PLAN.md                   # 本文档
```

### 7.3 参考项目

| 项目 | 路径 | 借鉴点 |
|------|------|--------|
| cli-helper-mcp (前身) | `C:\code\slay-the-mod\packages\cli-helper-mcp` | 工具实现、跨平台对话框 |
| gemini-image-generate | `C:\code\gemini-image-generate\web-ui` | SSE、Session、Choice、AbortController |

### 7.4 成功定义

**Phase 1 成功**：Agent 能异步调用选择器，人类在浏览器中响应，Agent 收到结果继续执行。

**Phase 2 成功**：Agent 执行 `git push` 时自动触发确认对话框；执行 `npm install` 直接通过；高风险操作自动进入 delay 模式。

**Phase 3 成功**：人类打开 Web UI，能看到 Agent 过去 5 分钟的所有操作时间线，能随时点击"暂停"阻止后续操作。

**Phase 4 成功**：`npx cli-helper-mcp` 一键启动，截图和剪贴板工具正常工作，Docker 镜像可运行。

**最终成功**：使用 Claude Code 开发时，Agent 能自主运行 10 分钟无需打扰，人类只需在 Web UI 旁路监控，异常时一键介入。

---

*文档版本：v1.0*  
*最后更新：2026-04-20*  
*状态：草案，待评审*
