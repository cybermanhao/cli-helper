# 多媒体交互工作流

CLI 不适合处理需要**试听、预览、时间轴操作**的场景。以下是需要浏览器交互支持的多媒体场景。

## 音频场景

### 音频剪辑器（show_asset_picker 音频模式）

**场景**：用户需要精确选择音频片段（裁剪录音、提取片段）。

**交互设计**：
1. 点击音频卡片 → 打开**波形图剪辑器 Modal**
2. Modal 中显示：
   - Canvas 波形图（Web Audio API 解码绘制）
   - 播放光标（白色竖线，跟随播放进度）
   - 范围选择（半透明紫色覆盖层，拖拽边界调整）
   - 时间轴标尺（开始/结束/总时长）
   - 播放控制（播放、暂停、播放选中区间）
3. 在波形图上**点击** → 定位播放光标
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

### 录音（record_audio）

**场景**：用户需要录制语音备忘或口播。

**设计**：浏览器打开录音页面（MediaRecorder API），点击开始/停止，试听后可保存或重录。

### 文字转语音 / 语音转文字

**TTS**：调用 `speak_text({ text, voice?, speed? })`，浏览器播放合成语音，可选保存为 mp3。

**STT**：调用 `transcribe_audio({ path, language? })`，返回转录文本 + 时间戳。

## 视频场景

### 视频选择器（show_video_picker）

**场景**：从视频素材中选择要剪辑的片段。

**设计**：浏览器展示视频缩略图网格，点击播放预览，时间轴拖拽选择起止点，支持多选 + 每个视频的时间区间。

**返回**：
```json
{
  "selections": [
    { "label": "clip_001.mp4", "path": "...", "start": 10.5, "end": 45.2 }
  ]
}
```

### 视频剪辑预览

**场景**：用户说"帮我把中间那段剪掉"。

**设计**：浏览器打开视频编辑器，显示时间轴，用户标记删除区间，实时预览剪辑效果，确认后执行 ffmpeg。

### 录屏（record_screen）

**场景**：用户需要录制屏幕操作做教程。

**设计**：浏览器请求屏幕共享权限（getDisplayMedia），录制整个屏幕或某个窗口，停止后预览确认保存。

## 其他不适合 CLI 的场景

| 场景 | 工具 | 设计 |
|------|------|------|
| 颜色选择 | `pick_color` | `<input type="color">` 或自定义色板，支持吸管取色 |
| 日历/时间选择 | `pick_datetime` | 日历组件可视化选择日期+时间 |
| 地图/位置选择 | `pick_location` | 嵌入地图（OpenStreetMap/高德），点击选点或搜索 |
| 绘图/白板 | `draw_sketch` | Canvas 画板，画笔、形状、文字、箭头 |
| Markdown 预览 | `preview_markdown` | 分屏预览（左侧源码右侧渲染） |
| 大表格/数据可视化 | `preview_data` | 交互式表格（排序、筛选、分页）+ 一键生成图表 |

## ffmpeg 安装提示

cli-helper 本身不内置 ffmpeg，但**强烈推荐安装**：

```bash
# Windows (winget)
winget install Gyan.FFmpeg

# macOS
brew install ffmpeg

# Linux
sudo apt install ffmpeg
```

安装后验证：`ffmpeg -version`

## 视频处理工作流示例

### 场景 1：裁剪视频前 10 秒

```
Agent：[调用 show_asset_picker 展示视频列表]
用户：选择 video.mp4 → Confirm
Agent：ffmpeg -ss 0 -t 10 -i video.mp4 -c copy output_clip.mp4
```

### 场景 2：批量压缩到 720p

```
Agent：[调用 show_asset_picker 多选视频]
用户：选择 3 个视频 → Confirm
Agent：for each: ffmpeg -i input.mp4 -vf "scale=1280:720" -crf 23 output_720p.mp4
```

### 场景 3：提取音频 + 转文字

```
Agent：[调用 show_asset_picker 选择视频]
用户：选择 interview.mp4 → Confirm
Agent：
  Step 1: ffmpeg -i interview.mp4 -vn -acodec pcm_s16le interview.wav
  Step 2: [调用 transcribe_audio]
```

### 场景 4：合并多个视频片段

```
Agent：[调用 show_asset_picker 多选视频]
用户：选择 clip1.mp4, clip2.mp4, clip3.mp4 → Confirm
Agent：
  Step 1: 创建 concat 列表文件
  Step 2: ffmpeg -f concat -safe 0 -i list.txt -c copy merged.mp4
```

## 常用 ffmpeg 命令速查

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

## 🖼️ 图片编辑器

**场景**：用户需要裁剪、调整大小或抠图。

**交互设计**：
1. 点击图片卡片 → 打开**图片编辑器 Modal**
2. Modal 中显示：
   - 大图片预览（可缩放）
   - 裁剪工具：拖拽选区或输入坐标（左/上/右/下）
   - 调整大小：输入宽高，可选保持比例
   - 抠图：一键移除背景（调用 rembg）
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

## 多媒体交互的实现架构

所有多媒体工具复用现有的 **Choice 框架**：

```
Agent: 调用 show_asset_picker（传入图片/音频/视频文件）
       ↓
Server: 创建 Session + Choice → 启动 HTTP server
       ↓
Browser: 打开 picker 页面，根据文件类型渲染
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
