---
name: cli-helper
description: >
  MCP Server 提供操作系统交互能力。当用户需要以下操作时使用此 skill：
  (1) 打开浏览器选择图片/音频/视频文件（show_asset_picker）
  (2) 拖拽上传文件到指定目录（upload_files）
  (3) 执行 shell 命令并获取输出（run_command）
  (4) 发送系统通知（show_notification）
  (5) 打开文件或文件夹（open_path）
  (6) 弹出系统对话框确认/输入/选择（show_dialog）
  (7) 管理策略规则或查看审计日志（manage_policy / list_policies）
  (8) 清理/整理/扫描文件（需结合 run_command + show_asset_picker）
  (9) 裁剪音视频、处理图片（ffmpeg / image-edit.py）
---

# CLI Helper Skill

通用跨平台 Agent 交互基础设施。为 AI Agent 提供与操作系统和用户交互的能力，同时让人类能在关键节点介入 Agent 的执行流程。

## 快速判断：用什么工具

| 用户意图 | 工具 | 模式 |
|---------|------|------|
| "帮我选图片/音频/视频" | `show_asset_picker` | 异步（浏览器） |
| "上传文件到这个目录" | `upload_files` | 异步（浏览器） |
| "运行这个命令" | `run_command` | 同步 |
| "帮我打开这个文件夹" | `open_path` | 同步 |
| "通知我一下" | `show_notification` | 即时 |
| "确认/输入/选择" | `show_dialog` | 同步（系统对话框） |
| "查看策略/审计日志" | `list_policies` / `read_audit` | 同步 |

## 核心工作流

### 1. 文件选择（show_asset_picker）

**调用前必须告知用户**："我将打开浏览器让你选择文件"

```json
{
  "title": "选择图片",
  "message": "请勾选需要的图片",
  "assets": ["path/to/file1.jpg", "path/to/file2.jpg"],
  "multiSelect": true,
  "allowUpload": false
}
```

**返回**：`{ selections, uploadedFiles, count, pickerUrl }`

**注意**：
- MCP 超时 60 秒，告知用户尽快操作
- 如果浏览器没自动打开，把 `pickerUrl` 发给用户
- 音频/视频选择后可能返回 `trimStart`/`trimEnd`，用 ffmpeg 处理

### 2. 文件上传（upload_files）

**调用前必须告知用户**："请拖拽文件到浏览器上传区域"

```json
{
  "title": "上传文件",
  "message": "拖拽文件到下方区域",
  "saveDir": "./uploads"
}
```

### 3. 命令执行（run_command）

```json
{
  "command": "git status",
  "cwd": "./project"
}
```

**Policy Engine 可能拦截危险命令**：
- `allow` → 正常执行，返回 `stdout`/`stderr`
- `deny` → 返回 `{ error: "Policy denied: ..." }`
- `confirm` → 弹出系统确认对话框
- `delay` → N 秒后执行，期间可在 Dashboard 撤销

**Agent 应做**：对 `rm`, `git push` 等危险命令，先用 `show_dialog(confirm)` 询问用户。

## Dashboard

cli-helper 启动后监听 `http://localhost:7842`，提供 Web UI：
- Session 列表、Choice 面板、Policies、Audit、Timeline
- 异步工具卡住时可手动 resolve/reject
- 通过 URL 参数连接：`http://localhost:7842?session=xxx`

## 跨平台差异

| 功能 | Windows | macOS | Linux |
|------|---------|-------|-------|
| `show_dialog` | ✅ cmd dialog | ✅ osascript | ✅ zenity |
| `show_notification` | ✅ WinForms | ✅ osascript | ✅ notify-send |
| `run_command` | ✅ | ✅ | ✅ |
| `check_process` | ✅ tasklist | ❌ | ❌ |
| `open_path` | ✅ cmd /c start | ✅ open | ✅ xdg-open |

## 详细参考

- **完整工具说明**：[references/tools.md](references/tools.md)
- **多媒体工作流（音频/视频/图片剪辑 + ffmpeg）**：[references/multimedia.md](references/multimedia.md)
- **常见对话场景**：[references/scenarios.md](references/scenarios.md)
- **Policy Engine 详细说明**：[references/policies.md](references/policies.md)
