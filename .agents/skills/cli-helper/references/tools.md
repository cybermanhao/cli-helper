# 完整工具说明

## 1. 异步人机交互工具（阻塞等待用户操作）

### `show_asset_picker` — 浏览器资产选择器

- **行为**：启动本地 HTTP server，在浏览器打开选择页面，阻塞等待用户选择
- **返回**：`{ selections, uploadedFiles, count, pickerUrl }`
- **Agent 应做**：
  1. 调用前告知用户"我将打开浏览器让你选择文件"
  2. 返回的 `pickerUrl` 可展示给用户（浏览器未自动打开时）
  3. 用户选择并点击 Confirm 后，结果自动返回
- **超时**：MCP 默认 60 秒，选择较慢可能超时，建议用户快速操作

### `upload_files` — 浏览器文件上传

- **行为**：打开浏览器拖拽上传页面，阻塞等待用户上传
- **返回**：`{ files: [{ name, path, size }] }`
- **Agent 应做**：
  1. 调用前告知用户"请拖拽文件到浏览器上传区域"
  2. 用户上传并 Confirm 后，文件保存到指定目录

## 2. 同步对话框工具（即时返回）

### `show_dialog`

- **模式**：`ok` / `confirm` / `input` / `select` / `file_picker`
- **行为**：弹出系统原生对话框，阻塞等待用户响应
- **返回**：`{ response, success }`
- **注意**：`file_picker` 使用系统文件对话框，不是浏览器

### `show_notification`

- **行为**：发送非阻塞系统通知
- **返回**：立即返回 `{ sent: true }`
- **用途**：提醒用户查看结果或执行操作

## 3. 系统操作工具

### `run_command`

- **行为**：执行 shell 命令（`shell: false`，安全解析）
- **参数**：`{ command, cwd?, timeoutMs? }`
- **注意**：受 Policy Engine 管控，危险命令可能被拦截
- **Agent 应做**：对 `rm`, `git push` 等危险命令，先用 `show_dialog` 询问

### `check_process`

- **行为**：检查指定进程是否正在运行
- **参数**：`{ processName }`
- **当前限制**：仅支持 Windows（通过 `tasklist`）

### `open_path`

- **行为**：用系统默认程序打开文件或文件夹
- **当前限制**：Windows 使用 `explorer.exe`

## 4. Agent 协作工具

### `read_inbox`

- **行为**：读取用户通过 Web UI 或其他渠道发送给 agent 的消息
- **用途**：获取用户在 dashboard 上的输入或反馈

### `write_log`

- **行为**：写入日志到 `agent-workspace/log.jsonl`
- **用途**：记录执行进度，用户可在 dashboard 查看

### `update_state`

- **行为**：更新 agent 状态快照
- **用途**：保存当前工作上下文，便于恢复或查看

### `send_to_agent`

- **行为**：发送消息到 agent inbox
- **用途**：用户或其他系统向当前 agent 发送消息

## 5. 治理工具

### `manage_policy` / `list_policies`

- **用途**：管理策略规则（命令/文件/工具/网络的白名单/黑名单）
- **默认策略**：
  - `rm -rf /` → deny
  - `git push` → confirm
  - `npm install` → allow
  - `.env` 文件 → confirm

### `manage_notify_config` / `test_notify`

- **用途**：配置多通道通知（Slack Webhook / Webhook / Email / 系统通知）

## 补充交互场景

### Policy Engine 拦截流程

当 `run_command` 触发策略规则时：

| action | 返回 | Agent 应做 |
|--------|------|-----------|
| `allow` | `{ stdout, stderr, exitCode }` | 正常继续 |
| `deny` | `{ error: "Policy denied: ..." }` | 停止执行，告知用户原因 |
| `confirm` | `{ policyAction: "confirm", message }` | 已弹出系统对话框，等用户确认 |
| `delay` | `{ policyAction: "delay", delayMs, delayId }` | 告知用户"N 秒后执行，可在 Dashboard 撤销" |

### 异步工具超时处理

如果 60 秒内用户没有操作：
1. 告知用户"选择已超时"
2. 询问是否重新打开 picker，或改用其他方式
3. 不要自动重试

### `show_dialog` 模式选择

| 场景 | 推荐模式 | 示例 |
|------|---------|------|
| 只需用户知晓 | `ok` | "构建完成" |
| 需要确认是否继续 | `confirm` | "确定要删除吗？" |
| 需要用户输入文本 | `input` | "请输入分支名称" |
| 从列表中选择 | `select` | "选择要部署的环境" |
| 选择本地文件 | `file_picker` | "选择要上传的文件" |

### State 和 Inbox 的配合

长任务分多步完成时，用 `update_state` + `read_inbox` 做状态持久化：

```
Step 1: update_state({ step: 1, data: {...} })
Step 2: show_notification({ title: "需要确认", message: "请查看 dashboard" })
Step 3: 用户通过 dashboard 发送消息到 inbox
Step 4: read_inbox() → 获取用户反馈
Step 5: update_state({ step: 2, ... })
```

### 批量操作

- `show_asset_picker` 的 `multiSelect: true` 支持批量选择
- `upload_files` 支持拖拽多个文件
- **Agent 应做**：遍历结果数组，给用户汇总（"已选择 3 张图片：a.jpg, b.jpg, c.jpg"）

### 错误处理规范

所有工具错误返回格式：`{ error: "具体错误信息" }`

常见错误：
- `No assets provided` — picker 未传图片列表
- `uploadDir is required when allowUpload is true` — upload_files 缺少 saveDir
- `Session not found or expired` — picker session 已过期
- `Policy denied: ...` — 命令被策略引擎拒绝

**Agent 应做**：遇到错误时，把错误信息翻译成人话告诉用户。
