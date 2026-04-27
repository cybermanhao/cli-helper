# 安装与配置指南

## 环境要求

- Node.js >= 18
- Python 3.x + `uv`（用于图片处理：rembg + pillow）
- ffmpeg（可选，推荐安装以充分利用音视频处理）

## 安装步骤

```bash
# 1. 安装 Node.js 依赖
npm install

# 2. 编译 TypeScript + 打包 picker.js
npm run build

# 3. 创建 Python 虚拟环境并安装依赖（用于图片编辑）
uv venv
uv pip install rembg[cpu] pillow
```

## MCP 注册

编辑 `~/.kimi/mcp.json`（路径改为实际路径）：

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

注册后重启 Kimi CLI，输入 `/mcp` 查看已连接的服务器和工具列表。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PROJECT_ROOT` | `process.cwd()` | 项目根目录，用于路径解析 |
| `DASHBOARD_PORT` | `7842` | HTTP 服务器端口 |
| `CLI_HELPER_MODE` | `stdio` | 运行模式：`stdio` 或 `sse` |
| `CLI_HELPER_LOG_LEVEL` | `info` | 日志级别 |

## 运行

```bash
# stdio 模式（默认）
npm start

# SSE 模式
CLI_HELPER_MODE=sse npm start
```

Dashboard: `http://localhost:7842`

## 开发脚本

| 脚本 | 说明 |
|------|------|
| `npm run build` | TypeScript 编译 + esbuild 打包 picker.js |
| `npm run start` | 运行编译后的 dist/index.js |
| `npm run dev` | tsx watch 开发模式 |
| `npm run typecheck` | TypeScript 类型检查（不输出文件） |

## 跨平台 ffmpeg 安装

```bash
# Windows (winget)
winget install Gyan.FFmpeg

# macOS
brew install ffmpeg

# Linux
sudo apt install ffmpeg
```

验证：`ffmpeg -version`
