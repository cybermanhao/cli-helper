# CLI Helper — Agent 使用指南

## 简介

cli-helper-mcp 是一个 MCP (Model Context Protocol) 服务器，为 agent 提供与操作系统和用户交互的能力。注册为 MCP server 后，agent 可以通过工具调用来使用这些功能。

## 可用 SKILL（第一优先级）

- 指导 AI Agent 使用 skill-market-cli 将本地 SKILL 上传至 Skill Market，含用户案例与轨迹采集要求：[skill-market-cli](.kimi/skills/skill-market-cli/SKILL.md)

## MCP 注册

项目已构建，入口为 `dist/index.js`。用户需要在 Kimi Code CLI 配置中注册：

**`~/.kimi/mcp.json`**
```json
{
  "mcpServers": {
    "cli-helper": {
      "command": "node",
      "args": ["C:/code/cli-helper/dist/index.js"],
      "env": {
        "PROJECT_ROOT": "C:/code/cli-helper",
        "CLI_HELPER_MODE": "stdio"
      }
    }
  }
}
```

注册后重启 Kimi CLI，输入 `/mcp` 可查看已连接的服务器和工具列表。

## 工具分类

### 1. 异步人机交互工具（需要用户手动操作）

这些工具会**阻塞等待**用户操作，调用后 agent 应主动告知用户操作步骤。

#### `show_asset_picker` — 浏览器图片选择器

- **行为**：启动本地 HTTP server，在浏览器打开图片选择页面，阻塞等待用户选择
- **返回**：`{ selections, uploadedFiles, count, pickerUrl }`
- **Agent 应做**：
  1. 调用工具前先告知用户"我将打开浏览器让你选择图片"
  2. 返回结果中的 `pickerUrl` 可以展示给用户（如果浏览器没有自动打开）
  3. 用户选择并点击 Confirm 后，结果自动返回
- **超时**：MCP 工具调用默认 60 秒，如果用户选择较慢可能超时。可建议用户快速操作

#### `upload_files` — 浏览器文件上传

- **行为**：打开浏览器拖拽上传页面，阻塞等待用户上传文件
- **返回**：`{ files: [{ name, path, size }] }`
- **Agent 应做**：
  1. 调用前告知用户"请拖拽文件到浏览器上传区域"
  2. 用户上传并 Confirm 后，文件保存到指定目录，结果返回

### 2. 同步对话框工具（即时返回）

#### `show_dialog`

- **模式**：`ok` / `confirm` / `input` / `select` / `file_picker`
- **行为**：弹出系统原生对话框，阻塞等待用户响应
- **返回**：`{ response, success }`
- **注意**：`file_picker` 模式使用系统文件对话框，不是浏览器

#### `show_notification`

- **行为**：发送非阻塞系统通知（Windows balloon / macOS notification / Linux notify-send）
- **返回**：立即返回 `{ sent: true }`
- **用途**：提醒用户查看某个结果或执行某个操作

### 3. 系统操作工具

#### `run_command`

- **行为**：执行 shell 命令（`shell: false`，安全解析）
- **参数**：`{ command, cwd?, timeoutMs? }`
- **注意**：受 Policy Engine 管控，危险命令可能被拦截或要求确认
- **Agent 应做**：对于可能危险的命令（`rm`, `git push` 等），先用 `show_dialog` 询问用户

#### `check_process`

- **行为**：检查指定进程是否正在运行
- **参数**：`{ processName }`
- **当前限制**：仅支持 Windows（通过 `tasklist`）

#### `open_path`

- **行为**：用系统默认程序打开文件或文件夹
- **当前限制**：Windows 使用 `explorer.exe`

### 4. Agent 协作工具

#### `read_inbox`

- **行为**：读取用户通过 Web UI 或其他渠道发送给 agent 的消息
- **用途**：获取用户在 dashboard 上的输入或反馈

#### `write_log`

- **行为**：写入日志到 `agent-workspace/log.jsonl`
- **用途**：记录执行进度，用户可在 dashboard 查看

#### `update_state`

- **行为**：更新 agent 状态快照
- **用途**：保存当前工作上下文，便于恢复或查看

#### `send_to_agent`

- **行为**：发送消息到 agent inbox
- **用途**：用户或其他系统向当前 agent 发送消息

### 5. 治理工具

#### `manage_policy` / `list_policies`

- **用途**：管理策略规则（命令/文件/工具/网络的白名单/黑名单）
- **默认策略**：
  - `rm -rf /` → deny
  - `git push` → confirm
  - `npm install` → allow
  - `.env` 文件 → confirm

#### `manage_notify_config` / `test_notify`

- **用途**：配置多通道通知（Slack Webhook / Webhook / Email / 系统通知）

## 补充交互场景

### 1. Policy Engine 拦截流程

当 `run_command` 触发策略规则时，可能的返回：

```json
// allow — 直接放行
{ "stdout": "...", "stderr": "", "exitCode": 0 }

// deny — 被拒绝
{ "error": "Policy denied: rm -rf / matches deny rule" }

// confirm — 弹出系统确认对话框
{ "policyAction": "confirm", "message": "Policy requires confirmation for: git push" }

// delay — 延迟 N 秒执行（期间可在 Dashboard 撤销）
{ "policyAction": "delay", "delayMs": 10000, "delayId": "xxx" }
```

**Agent 应做**：
- 如果返回 `deny`，停止执行并告知用户策略拒绝的原因
- 如果返回 `confirm`，已经弹出了系统对话框，等用户确认后继续
- 如果返回 `delay`，告知用户"命令将在 N 秒后执行，可在 Dashboard 撤销"

### 2. 异步工具超时后的处理

如果用户 60 秒内没有操作，`show_asset_picker` / `upload_files` 会抛出超时错误。

**Agent 应做**：
1. 告知用户"选择已超时"
2. 询问是否重新打开 picker，或改用其他方式（如直接指定文件路径）
3. 不要自动重试，避免反复弹出浏览器打扰用户

### 3. `show_dialog` 各模式选择指南

| 场景 | 推荐模式 | 示例 |
|------|---------|------|
| 只需要用户知晓 | `ok` | "构建完成" |
| 需要用户确认是否继续 | `confirm` | "确定要删除吗？" |
| 需要用户输入文本 | `input` | "请输入分支名称" |
| 需要从列表中选择 | `select` | "选择要部署的环境" |
| 需要选择本地文件 | `file_picker` | "选择要上传的文件" |

**注意**：`file_picker` 使用系统原生文件对话框（不是浏览器），适合快速选择单个文件。多文件或需要预览的场景用 `show_asset_picker`。

### 4. Dashboard 的使用

cli-helper 启动后会监听 `http://localhost:7842`，提供 Web UI：

- **Session 列表**：查看所有工具调用的状态和结果
- **Choice 面板**：如果异步工具卡住了，可以在这里手动 resolve/reject
- **Policies**：查看当前生效的策略规则
- **Audit**：查看完整的操作审计日志
- **Timeline**：查看 Session 的执行时间线

**Agent 应告知用户**：如果浏览器没有自动打开 picker，可以直接访问 Dashboard 查看状态。

### 5. State 和 Inbox 的配合使用

当任务需要分多步完成时，可以用 `update_state` + `read_inbox` 做状态持久化：

```
Step 1: update_state({ step: 1, data: {...} }) → 保存进度
Step 2: show_notification({ title: "需要确认", message: "请查看 dashboard 确认下一步" })
Step 3: 用户通过 dashboard 发送消息到 inbox
Step 4: read_inbox() → 获取用户反馈
Step 5: update_state({ step: 2, ... }) → 更新进度
```

**用途**：长任务中断后恢复、用户异步反馈、多轮人机协作。

### 6. 批量操作场景

**多图片选择**：`show_asset_picker` 的 `multiSelect: true` 支持批量选择，返回的 `selections` 是按索引排序的数组。

**多文件上传**：`upload_files` 支持拖拽多个文件，返回的 `files` 包含每个文件的路径和大小。

**Agent 应做**：批量操作后，遍历结果数组处理每个文件，并给用户一个汇总（"已选择 3 张图片：a.jpg, b.jpg, c.jpg"）。

### 7. 错误处理规范

所有工具的错误返回格式：

```json
{ "error": "具体错误信息" }
```

常见错误：
- `No assets provided` — `show_asset_picker` 没有传图片列表
- `uploadDir is required when allowUpload is true` — `upload_files` 缺少 `saveDir`
- `Session not found or expired` — picker session 已过期，需要重新调用
- `Policy denied: ...` — 命令被策略引擎拒绝

**Agent 应做**：遇到错误时，把错误信息翻译成人话告诉用户，不要直接展示原始 JSON。

### 8. 跨平台功能差异

| 功能 | Windows | macOS | Linux |
|------|---------|-------|-------|
| `show_dialog` | ✅ cmd dialog / VBScript | ✅ osascript | ✅ zenity / kdialog |
| `show_notification` | ✅ WinForms balloon | ✅ osascript | ✅ notify-send |
| `run_command` | ✅ | ✅ | ✅ |
| `check_process` | ✅ tasklist | ❌ 未实现 | ❌ 未实现 |
| `open_path` | ✅ cmd /c start | ✅ open | ✅ xdg-open |
| `show_asset_picker` | ✅ | ✅ | ✅ |

**Agent 应注意**：在非 Windows 平台上，`check_process` 和 `open_path` 可能不可用。

## 多媒体交互设计（音频/视频/其他）

CLI 不适合处理需要**试听、预览、时间轴操作**的场景。以下是需要浏览器交互支持的多媒体场景：

### 音频场景

#### 音频剪辑器（`show_asset_picker` 音频模式）

**场景**：用户需要精确选择音频片段（如裁剪录音、提取片段）。

**交互设计**：
1. 点击音频卡片 → 打开**波形图剪辑器 Modal**
2. Modal 中显示：
   - **Canvas 波形图**（使用 Web Audio API 解码绘制）
   - **播放光标**（白色竖线，跟随播放进度）
   - **范围选择**（半透明紫色覆盖层，拖拽边界调整）
   - **时间轴标尺**（开始/结束/总时长）
   - **播放控制**（播放、暂停、播放选中区间）
3. 在波形图上**点击** → 定位播放光标到该位置
4. 在波形图上**拖拽** → 选择起止区间
5. 点击**确认裁剪** → 关闭 Modal，卡片显示裁剪区间

**返回**：
```json
{
  "selections": [
    { "label": "interview_001.mp3", "path": "...", "trimStart": 0.35, "trimEnd": 2.04 }
  ]
}
```

**Agent 后续操作**：
```bash
ffmpeg -ss 0.35 -to 2.04 -i interview_001.mp3 -c copy output_clip.mp3
```

**示例对话**：
```
用户：帮我从这段采访里截取提到"预算"的部分
Agent：扫描到 5 条录音。我打开波形图剪辑器让你精确选择。
[调用 show_asset_picker]
用户：点击 interview_002.mp3 → 波形图 Modal 打开
       → 在波形上找到"预算"对应的波形峰
       → 拖拽选择 0:35~2:04 区间
       → ▶ 播放选中区间确认
       → 确认裁剪
Agent：已选择 interview_002.mp3 (0:35~2:04)，正在裁剪...
[调用 run_command: ffmpeg -ss 0.35 -to 2.04 ...]
Agent：裁剪完成：output_clip.mp3
```

#### 2. 录音（`record_audio`）

**场景**：用户需要录制一段语音备忘或口播。

**设计**：
- 浏览器打开录音页面（MediaRecorder API）
- 点击开始/停止录音
- 试听录制内容，满意则保存，不满意则重录
- 返回音频文件路径

**示例对话**：
```
用户：帮我录一段 30 秒的语音备忘
Agent：打开录音页面，点击开始录制，说完后点停止。
[调用 record_audio]
用户：录制 → 试听 → 确认保存
Agent：已保存到 C:\project\audio\memo_20260426_143022.wav
```

#### 3. 文字转语音 / 语音转文字

**TTS**：
- Agent 生成文本后，调用 `speak_text({ text, voice?, speed? })`
- 浏览器播放合成语音
- 可选保存为 mp3 文件

**STT**：
- 用户上传音频或录音后
- 调用 `transcribe_audio({ path, language? })`
- 返回转录文本 + 时间戳

### 视频场景

#### 4. 视频选择器（`show_video_picker`）

**场景**：从一堆视频素材中选择要剪辑的片段。

**设计**：
- 浏览器展示视频缩略图网格
- 点击播放预览（原生 `<video>`）
- 时间轴拖拽选择起止点
- 支持多选 + 每个视频的时间区间

**返回**：
```json
{
  "selections": [
    { "label": "clip_001.mp4", "path": "...", "start": 10.5, "end": 45.2 }
  ]
}
```

#### 5. 视频剪辑预览

**场景**：用户说"帮我把中间那段剪掉"。

**设计**：
- 浏览器打开视频编辑器（简单版）
- 显示时间轴，用户标记删除区间
- 实时预览剪辑后的效果
- 确认后执行 ffmpeg 剪辑

#### 6. 录屏（`record_screen`）

**场景**：用户需要录制屏幕操作做教程。

**设计**：
- 浏览器请求屏幕共享权限（getDisplayMedia）
- 录制整个屏幕或某个窗口
- 停止后预览，确认保存

### 其他不适合 CLI 的场景

#### 7. 颜色选择器（`pick_color`）

**场景**："帮我选一个主题色"。

**设计**：
- 浏览器打开颜色选择器（原生 `<input type="color">` 或自定义色板）
- 支持吸管取色、色板预设、HEX/RGB 复制
- 返回 `{ hex: "#7B5EA7", rgb: "123, 94, 167" }`

#### 8. 日历/时间选择（`pick_datetime`）

**场景**："帮我定个会议时间"。

**设计**：
- 浏览器打开日历组件
- 可视化选择日期 + 时间
- 返回 ISO 格式时间字符串

#### 9. 地图/位置选择（`pick_location`）

**场景**："帮我选个 meeting 地点"。

**设计**：
- 浏览器嵌入地图（OpenStreetMap / 高德）
- 点击选点或搜索地址
- 返回 `{ lat, lng, address }`

#### 10. 绘图/白板（`draw_sketch`）

**场景**："帮我画个简单的流程图"。

**设计**：
- 浏览器打开 Canvas 画板
- 画笔、形状、文字、箭头
- 保存为 PNG/SVG

#### 11. Markdown 预览（`preview_markdown`）

**场景**："帮我看看这个文档渲染出来什么样"。

**设计**：
- 浏览器打开分屏预览（左侧源码右侧渲染）
- 支持导出 PDF/HTML

#### 12. 大表格/数据可视化（`preview_data`）

**场景**："帮我看看这些数据的趋势"。

**设计**：
- 浏览器展示交互式表格（排序、筛选、分页）
- 一键生成图表（柱状图、折线图、饼图）
- 支持 CSV/Excel 导出

### ffmpeg 安装提示

cli-helper 本身不内置 ffmpeg，但**强烈推荐安装**以充分利用音视频处理能力：

```bash
# Windows (winget)
winget install Gyan.FFmpeg

# macOS
brew install ffmpeg

# Linux
sudo apt install ffmpeg
```

安装后验证：`ffmpeg -version`

### 视频处理工作流示例

**场景 1：用户选择视频片段并裁剪**

```
用户：帮我裁剪视频的前 10 秒
Agent：[调用 show_asset_picker 展示视频列表]
用户：选择 video.mp4 → Confirm
Agent：已选择 video.mp4，现在裁剪前 10 秒：
      [调用 run_command]
      ffmpeg -ss 0 -t 10 -i video.mp4 -c copy output_clip.mp4
Agent：裁剪完成，保存在 output_clip.mp4
```

**场景 2：批量压缩视频**

```
用户：帮我把这些视频压缩到 720p
Agent：[调用 show_asset_picker 多选视频]
用户：选择 3 个视频 → Confirm
Agent：收到 3 个视频，开始批量压缩：
      for each video:
        ffmpeg -i input.mp4 -vf "scale=1280:720" -crf 23 output_720p.mp4
Agent：3 个视频全部压缩完成
```

**场景 3：提取音频 + 转文字**

```
用户：帮我把这段采访视频的音频提取出来转文字
Agent：[调用 show_asset_picker 选择视频]
用户：选择 interview.mp4 → Confirm
Agent：
  Step 1: ffmpeg -i interview.mp4 -vn -acodec pcm_s16le interview.wav
  Step 2: [调用 transcribe_audio 或外部 API 转文字]
Agent：转录完成，共 5 分钟，文字已保存到 interview.txt
```

**场景 4：合并多个视频片段**

```
用户：帮我把这 3 段视频按顺序合并
Agent：[调用 show_asset_picker 多选视频]
用户：选择 clip1.mp4, clip2.mp4, clip3.mp4（按选择顺序）→ Confirm
Agent：
  Step 1: 创建 concat 列表文件
  Step 2: ffmpeg -f concat -safe 0 -i list.txt -c copy merged.mp4
Agent：合并完成：merged.mp4
```

**常用 ffmpeg 命令速查**：

| 操作 | 命令 |
|------|------|
| 裁剪视频 | `ffmpeg -ss 30 -t 15 -i in.mp4 -c copy out.mp4` |
| 裁剪音频 | `ffmpeg -ss 30 -t 15 -i in.mp3 -c copy out.mp3` |
| 压缩视频 | `ffmpeg -i in.mp4 -crf 23 -preset fast out.mp4` |
| 调整分辨率 | `ffmpeg -i in.mp4 -vf "scale=1280:720" out.mp4` |
| 提取音频 | `ffmpeg -i in.mp4 -vn -acodec mp3 out.mp3` |
| 转换格式 | `ffmpeg -i in.avi -c:v libx264 -c:a aac out.mp4` |
| 合并视频 | `ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4` |
| 生成缩略图 | `ffmpeg -i in.mp4 -ss 00:00:05 -vframes 1 thumb.jpg` |
| 添加水印 | `ffmpeg -i in.mp4 -i logo.png -filter_complex "overlay=10:10" out.mp4` |

### 🖼️ 图片编辑器

**场景**：用户需要裁剪、调整大小或抠图。

**交互设计**：
1. 点击图片卡片 → 打开**图片编辑器 Modal**
2. Modal 中显示：
   - **大图片预览**（可缩放）
   - **裁剪工具**：拖拽选区或输入坐标（左/上/右/下）
   - **调整大小**：输入宽高，可选保持比例
   - **抠图**：一键移除背景（调用 rembg）
3. 点击确认 → 后端处理图片 → 返回处理后的路径

**Agent 后续操作**：
```bash
# 裁剪
python image-edit.py <<< '{"path":"input.jpg","action":"crop","params":{"left":0.1,"top":0.1,"right":0.9,"bottom":0.9}}'

# 调整大小
python image-edit.py <<< '{"path":"input.jpg","action":"resize","params":{"width":800,"height":600}}'

# 抠图
python image-edit.py <<< '{"path":"input.jpg","action":"removebg"}'
```

### 多媒体交互的实现架构

所有多媒体工具复用现有的 **Choice 框架**：

```
Agent: 调用 show_asset_picker（传入图片/音频/视频文件）
       ↓
Server: 创建 Session + Choice → 启动 HTTP server
       ↓
Browser: 打开 picker 页面，根据文件类型渲染：
         - 图片 → <img>（点击打开图片编辑器）
         - 音频 → <audio controls> + 时长显示（点击打开波形图剪辑器）
         - 视频 → <video> + 播放按钮（点击打开缩略图剪辑器）
       ↓
User: 预览/编辑 → 点击选择 → Confirm
       ↓
Browser: POST /api/pick/:id → resolveChoice()
       ↓
Server: Promise resolve → 返回结果给 Agent
       ↓
Agent: 收到 selections（含 label, path, trimStart/trimEnd, crop, resize, removebg）
       → 调用 ffmpeg / image-edit.py 处理
```

**返回结果格式**：
```json
{
  "selections": [
    {
      "label": "sweep_5s.mp3",
      "index": 5,
      "imagePath": "C:/project/audio/sweep_5s.mp3",
      "trimStart": 12.5,
      "trimEnd": 28.3
    }
  ],
  "uploadedFiles": [],
  "count": 1,
  "pickerUrl": "http://localhost:7842/picker/xxx"
}
```

**如果用户使用了裁剪功能**，`selections` 会包含 `trimStart` 和 `trimEnd`（秒）。Agent 应检查这些字段并执行 ffmpeg 裁剪：

```bash
ffmpeg -ss 12.5 -to 28.3 -i sweep_5s.mp3 -c copy output_clip.mp3
```

**前端页面**：
- `picker.ts` 已扩展支持 img/audio/video 三种媒体类型的自动渲染
- 上传区域支持图片/音频/视频文件
- 音频卡片显示 ♪ 图标 + 播放器控件 + 时长
- 视频卡片显示缩略图 + ▶/⏸ 播放按钮 + 时长

## 常见对话场景

### "你刚才生成的图/文件在哪？给我看看"

**Agent 应做**：
1. 告诉用户文件保存的绝对路径
2. 调用 `open_path({ path: "文件路径" })` 自动打开文件夹或文件
3. 如果文件是图片，可以告知用户路径，让用户自行查看

**示例**：
```
用户：图在哪？
Agent：图片已保存到 C:\code\project\assets\output.png，我现在帮你打开。
[调用 open_path]
```

### "我刚才选的文件/图片在哪？"

**Agent 应做**：
1. 如果是 `show_asset_picker` 的结果，遍历 `selections` 数组，列出每个文件的 `imagePath`
2. 如果是 `upload_files` 的结果，遍历 `files` 数组，列出每个文件的 `path`
3. 调用 `open_path` 打开所在目录

**示例**：
```
用户：我刚才选的图在哪？
Agent：你选了 2 张图片：
  - neko_2.jpg → C:\project\assets\waifu\neko_2.jpg
  - shinobu_3.jpg → C:\project\assets\waifu\shinobu_3.jpg
我帮你打开文件夹。
[调用 open_path]
```

### "刚才的操作记录在哪看？" / "我做了什么？"

**Agent 应做**：
1. 告知用户可以通过 Dashboard 查看完整历史：`http://localhost:7842`
2. 调用 `list_sessions` 获取最近的 session 列表
3. 或者读取 `agent-workspace/log.jsonl` 展示最近的操作日志

**示例**：
```
用户：我做了什么？
Agent：最近的操作记录：
  1. 12:30 — show_asset_picker — 选择了 neko_2.jpg
  2. 12:28 — run_command — git status
你可以在 http://localhost:7842 查看完整审计日志。
```

### "帮我撤销刚才的操作" / "取消"

**Agent 应做**：
1. 如果是刚执行的 `run_command` 且触发了 delay 策略，调用 `cancel_delay` 撤销
2. 如果是 `show_asset_picker` 还在等待中，告知用户可以直接关闭浏览器标签页
3. 如果是已经完成的操作，告知无法撤销，但可以重新执行反向操作

**示例**：
```
用户：撤销刚才的 git push
Agent：git push 触发了 delay 策略（10秒后执行），delayId 是 xxx。
[调用 cancel_delay]
已撤销，push 不会执行。
```

### "刚才的命令输出是什么？"

**Agent 应做**：
1. `run_command` 的结果包含 `stdout` 和 `stderr`，直接展示给用户
2. 如果输出太长，用 `capOutput` 截断后展示，并告知用户完整输出在 Dashboard

**示例**：
```
用户：刚才 npm install 输出了什么？
Agent：
stdout: added 42 packages in 3s
stderr: 1 deprecated warning
```

### "进度怎么样了？" / "好了吗？"

**Agent 应做**：
1. 如果有 `update_state` 保存的状态，读取并展示当前进度
2. 如果有 pending 的 delay，展示倒计时
3. 如果有等待中的 choice（用户还没操作 picker），提醒用户去浏览器操作

**示例**：
```
用户：好了吗？
Agent：还在等待你操作。请打开浏览器选择图片：
  http://localhost:7842/picker/xxx
选完点 Confirm 我就继续。
```

### "帮我打开项目文件夹"

**Agent 应做**：
1. 调用 `open_path({ path: process.env.PROJECT_ROOT })` 打开项目根目录

### "通知我一下" / "好了告诉我"

**Agent 应做**：
1. 调用 `show_notification({ title, message })` 发送系统通知
2. 适用于长时间任务完成后提醒用户

**示例**：
```
用户：构建好了通知我
Agent：好的，构建完成后我会发送系统通知。
[...构建中...]
[调用 show_notification: { title: "构建完成", message: "项目构建成功" }]
```

### "为什么这个命令被拒绝了？"

**Agent 应做**：
1. 解释 Policy Engine 的作用（安全策略拦截了危险操作）
2. 展示触发的策略规则
3. 如果是误拦截，建议用户通过 Dashboard 修改策略或联系管理员

**示例**：
```
用户：为什么 rm -rf 不能执行？
Agent：Policy Engine 拦截了这条命令。默认规则：`rm -rf /` 级别的高危操作会被 deny。
如果你确定要删除，可以先修改策略：
[调用 list_policies 展示规则]
```

### "帮我清理垃圾/重复/临时文件"（扫描 → 展示 → 点选 → 执行）

这是**最典型的 cli-helper 工作流**：

```
用户：帮我清理下载文件夹里的垃圾图片
      ↓
Agent：[调用 run_command 扫描目录]
      ↓
Agent：找到 12 张图片，共 45MB：
        1. screenshot_001.png (2.3MB) — C:\Users\xxx\Downloads
        2. temp_banner.jpg (1.1MB)
        ...
      我打开浏览器让你选择要删除哪些：
      ↓
Agent：[调用 show_asset_picker，传入扫描结果]
      ↓
用户：在浏览器中勾选要删除的图片，点 Confirm
      ↓
Agent：收到选择结果：[screenshot_001.png, temp_banner.jpg]
      确认删除这 2 张图片吗？
      ↓
用户：确认
      ↓
Agent：[调用 run_command 删除]
      已删除 2 张图片，释放 3.4MB 空间。
```

**关键步骤**：
1. **扫描**：用 `run_command` 或 Node.js `fs` 扫描目标目录
2. **展示**：把扫描结果格式化为列表，让用户了解有哪些文件
3. **点选**：调用 `show_asset_picker`（图片）或 `show_dialog(select)`（文本列表）
4. **确认**：对于删除等危险操作，再用 `show_dialog(confirm)` 二次确认
5. **执行**：执行具体操作，并汇报结果

**类似场景**：
- "帮我整理照片" → 扫描相册 → 展示 → 用户选要保留/删除的 → 分类移动
- "帮我选择要导入的图片" → 扫描源目录 → 展示 → 用户选 → 复制到目标
- "帮我压缩这些图片" → 扫描 → 展示 → 用户选 → 批量压缩
- "帮我选择要提交的文件" → `git status` → 展示修改文件 → 用户选 → `git add`

**注意事项**：
- 删除类操作务必**二次确认**，避免误删
- 大文件扫描可能耗时，先用 `show_notification` 告知"正在扫描，请稍候"
- 如果文件太多（>100 个），考虑用 `show_dialog(select)` 而非 `show_asset_picker`，避免浏览器卡顿

## 最佳实践

1. **异步工具先告知**：调用 `show_asset_picker` 或 `upload_files` 前，务必告诉用户"我将打开浏览器，请你在页面中选择/上传"
2. **展示 pickerUrl**：如果浏览器没有自动弹出，把返回的 `pickerUrl` 发给用户
3. **等待用户操作**：这些工具是阻塞的，不要重复调用
4. **超时处理**：如果 60 秒内用户没有操作，工具会返回超时错误。询问用户是否重新打开或改用其他方式
5. **Policy 拦截**：`run_command` 执行危险命令时可能被 Policy Engine 拦截，检查返回结果中的 `policyAction` 字段
6. **记录审计日志**：重要操作后用 `write_log` 记录，方便后续追溯
7. **善用 State**：长任务用 `update_state` 保存进度，避免重复执行
8. **主动展示路径**：用户问及文件位置时，不要只说"在 assets 目录"，给出完整绝对路径并主动打开
9. **命令输出要摘要**：`run_command` 的输出可能很长，先给用户摘要，完整日志在 Dashboard
