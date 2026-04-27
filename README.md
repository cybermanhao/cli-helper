# CLI Helper MCP

为 CLI Agent 补充操作系统交互能力的 MCP Server。在 Agent 需要人类介入的关键节点，临时拉起浏览器或系统对话框完成交互，然后继续执行。

> 详细使用指南、工具说明、工作流示例见 [SKILL.md](.agents/skills/cli-helper/SKILL.md)

---

## 安装

```bash
npm install
npm run build
```

## 注册到 MCP

编辑 `~/.kimi/mcp.json`（路径改为你的实际路径）：

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

## 功能速览

| 能力 | 说明 |
|------|------|
| `show_asset_picker` | 浏览器选择图片/音频/视频，支持裁剪剪辑 |
| `upload_files` | 拖拽上传文件到指定目录 |
| `run_command` | 执行 shell 命令，受策略引擎管控 |
| `show_dialog` | 系统原生对话框（确认/输入/选择） |
| `show_notification` | 系统通知 |
| `open_path` | 打开文件或文件夹 |
| `manage_policy` | 策略规则管理 |

所有 GUI 都是**任务触发后临时弹出**，任务结束即关闭，不是常驻应用。

## 运行

```bash
npm start                    # stdio 模式
CLI_HELPER_MODE=sse npm start # SSE 模式
```

Dashboard: `http://localhost:7842`

## 截图

![图片选择器](assets/screenshots/01-image-picker.png)
![音频剪辑器](assets/screenshots/03-audio-editor.png)
![视频选择器](assets/screenshots/05-video-picker.png)
