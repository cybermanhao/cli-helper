# CLI Helper MCP

通用跨平台 Agent 交互基础设施。为 AI Agent 提供与用户操作系统交互的能力，同时让人类能在关键节点介入 Agent 的执行流程。

**演进路线**：HITL (Human-in-the-Loop) → HOTM (Human-on-the-Loop)

---

## 架构

```
┌─────────┐     stdio MCP     ┌─────────────────────┐
│  Agent  │<─────────────────>│  cli-helper         │
│ (Kimi/  │                   │  ┌────────────────┐ │
│  Claude)│  SSE events       │  │ StdioTransport │ │
│         │<─────────────────│  ├────────────────┤ │
│         │                   │  │ SSETransport   │ │
│         │                   │  ├────────────────┤ │
│         │                   │  │ Express HTTP   │ │
│         │                   │  │  + Web UI      │ │
└─────────┘                   │  └────────────────┘ │
                              └─────────────────────┘
```

- **stdio 模式**：零配置，即插即用，适合本地 CLI Agent
- **SSE 模式**：支持异步、可观测、多客户端，适合远程和 Web UI 联动

---

## MCP 工具

| 工具 | 描述 | 模式 |
|------|------|------|
| `show_dialog` | 同步对话框 (ok/confirm/input/select/file_picker) | 同步 |
| `show_notification` | 非阻塞系统通知 | 即时 |
| `show_asset_picker` | 浏览器图片选择器（异步 Choice） | 异步 |
| `upload_files` | 拖拽文件上传（异步 Choice） | 异步 |
| `run_command` | 运行 shell 命令 | 同步 |
| `check_process` | 检查进程是否运行 | 同步 |
| `open_path` | 打开文件/文件夹 | 同步 |
| `read_inbox` | 读取用户消息 | 同步 |
| `write_log` | 写入日志 | 同步 |
| `update_state` | 更新状态快照 | 同步 |
| `send_to_agent` | 发送消息给 agent | 同步 |
| `list_sessions` | 列出活跃会话 | SSE |
| `get_session_status` | 查询会话状态 | SSE |
| `abort_session` | 取消进行中的会话 | SSE |
| `manage_policy` | 添加/删除策略规则 | 同步 |
| `list_policies` | 列出所有策略 | 同步 |

---

## 核心概念

### Session

每次交互（tool call）都会创建一个 Session，追踪其完整生命周期：

```
pending → waiting_user → running → completed | cancelled | error | timeout
```

Session 提供可观测性——Agent 和人类都能查询"刚才发生了什么"。

### Policy Engine（Phase 2）

策略引擎为 Agent 操作提供规则治理。人类预设规则，Agent 执行时自动评估：

| 动作 | 行为 |
|------|------|
| `allow` | 直接放行 |
| `deny` | 拒绝执行 |
| `confirm` | 弹出系统确认对话框 |
| `notify` | 发送系统通知后执行 |
| `delay` | 延迟 N 秒，期间可在 Dashboard 撤销 |

Scope 支持：`command` | `file` | `tool` | `network`

默认策略（不可删除）：
- `rm -rf /` → deny
- `git push` → confirm
- `npm install` → allow
- `.env` 文件 → confirm

### Audit Log（Phase 3）

每次工具调用和策略评估都被记录到审计日志（`~/.cli-helper/audit.jsonl`），提供完整的 Agent 行为追溯。

### Choice（Human-in-the-Loop）

当 Agent 需要人类输入时，创建一个 Choice：

1. Agent 调用 tool → 创建 Choice → Promise 等待
2. SSE 广播 `choice-request` → Web UI 展示交互界面
3. 用户操作 → POST `/api/choice/:id` → `resolveChoice()` → Promise resolve
4. Agent 收到结果，继续执行

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PROJECT_ROOT` | `process.cwd()` | 项目根目录，用于路径解析 |
| `DASHBOARD_PORT` | `7842` | HTTP 服务器端口 |
| `CLI_HELPER_MODE` | `stdio` | 运行模式：`stdio` 或 `sse` |
| `CLI_HELPER_LOG_LEVEL` | `info` | 日志级别 |

---

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/sessions` | 列出活跃 Session |
| GET | `/api/session/:id/status` | 查询 Session 状态 |
| POST | `/api/session/:id/abort` | 取消 Session |
| POST | `/api/choice/:choiceId` | 响应 Choice |
| GET | `/api/choices/:sessionId` | 列出 Session 的待处理 Choice |
| POST | `/api/cancel-choice/:choiceId` | 取消 Choice |
| GET | `/api/events/:sessionId` | SSE 事件流 |
| GET | `/api/policies` | 列出策略 |
| POST | `/api/policies` | 添加策略 |
| DELETE | `/api/policies/:id` | 删除策略 |
| POST | `/api/policies/evaluate` | 评估策略 |
| GET | `/api/audit` | 查询审计日志 |
| GET | `/api/audit/stats` | 审计统计 |
| GET | `/api/delays` | 列出 pending delay |
| POST | `/api/delay/:id/cancel` | 撤销 delay |
| GET | `/api/timeline` | 全局时间线 |
| GET | `/api/session/:id/timeline` | Session 执行时间线 |
| GET | `/api/session/:id/changes` | Session 文件变更 |
| GET | `/api/notify-configs` | 列出通知配置 |
| POST | `/api/notify-configs` | 添加/更新通知配置 |
| DELETE | `/api/notify-configs/:id` | 删除通知配置 |
| POST | `/api/notify-test` | 发送测试通知 |

---

## Web UI Dashboard

访问 `http://localhost:7842`

功能：
- **Session 列表**：实时显示所有活跃交互
- **事件流 / 时间线切换**：SSE 实时推送 或 Session 执行时间线回放
- **Choice 面板**：响应 Agent 的人工确认请求
- **Policies 标签**：查看/添加/删除策略规则
- **Audit 标签**：查看审计日志和统计
- **Notify 标签**：配置多通道告警（Slack/Webhook/系统通知）
- **Delay 撤销**：事件流中显示倒计时，可一键撤销

通过 URL 参数自动连接：`http://localhost:7842?session=xxx`

---

## 功能截图

### 🖼️ 图片选择器

支持多选、搜索过滤、全选/反选、文件详情、打开所在目录。

![图片选择器](assets/screenshots/01-image-picker.png)

### 🎵 音频选择器 + 波形图剪辑器

点击音频卡片打开波形图剪辑器，支持拖拽选择区间、光标定位播放、预览裁剪。

![音频选择器](assets/screenshots/02-audio-picker.png)

![音频剪辑器](assets/screenshots/03-audio-editor.png)

### 🔍 搜索过滤

实时按文件名筛选，快速定位目标文件。

![搜索过滤](assets/screenshots/04-search-filter.png)

### 🎬 视频选择器

支持视频预览播放，hover 显示路径，一键打开所在目录。

![视频选择器](assets/screenshots/05-video-picker.png)

### 🖼️ 图片编辑器

点击图片卡片打开编辑器，支持裁剪、调整大小、一键抠图（rembg）。

![图片编辑器](assets/screenshots/07-image-editor-modal.png)

![图片裁剪](assets/screenshots/08-image-editor-crop.png)

---

## 开发

```bash
npm install
npm run build
npm start              # stdio 模式
CLI_HELPER_MODE=sse npm start   # SSE 模式
```

### 脚本

| 脚本 | 说明 |
|------|------|
| `npm run build` | TypeScript 编译 + esbuild 打包 picker.js |
| `npm run start` | 运行编译后的 dist/index.js |
| `npm run dev` | tsx watch 开发模式 |
| `npm run typecheck` | TypeScript 类型检查（不输出文件） |

---

## 目录结构

```
src/
├── index.ts              # 入口：根据 mode 启动 stdio 或 sse
├── server.ts             # Express HTTP + SSE MCP
├── mcp/
│   ├── stdio.ts          # StdioServerTransport（内联于 index.ts）
│   └── tools.ts          # Tool 定义列表（内联于 index.ts）
├── modules/
│   ├── session.ts        # Session 管理（每次 tool call 自动创建）
│   ├── choice.ts         # Choice 框架
│   ├── events.ts         # SSE 广播
│   ├── policy.ts         # 策略引擎
│   ├── audit.ts          # 审计日志
│   ├── delay.ts          # Delay 倒计时
│   ├── timeline.ts       # Session 时间线聚合
│   ├── snapshot.ts       # 文件变更快照
│   └── notify.ts         # 多通道通知告警
├── platform/
│   ├── dialog.ts         # 跨平台对话框
│   └── notification.ts   # 跨平台通知
└── picker/
    ├── picker.ts         # 浏览器端选择器逻辑
    └── types.ts          # 类型定义
public/
└── index.html            # Dashboard Web UI
```
