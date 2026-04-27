# REST API 完整参考

以下是 cli-helper 提供的全部 REST API 端点，包括核心交互端点和可观测性/辅助端点。

## 核心交互端点

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

## 可观测性/辅助端点

以下端点提供调试和安全追溯能力，**不是产品核心功能**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/audit` | 查询审计日志（可观测性副产品） |
| GET | `/api/audit/stats` | 审计统计 |
| GET | `/api/delays` | 列出 pending delay |
| POST | `/api/delay/:id/cancel` | 撤销 delay |
| GET | `/api/timeline` | 全局时间线（可观测性副产品） |
| GET | `/api/session/:id/timeline` | Session 执行时间线 |
| GET | `/api/session/:id/changes` | Session 文件变更 |
| GET | `/api/notify-configs` | 列出通知配置 |
| POST | `/api/notify-configs` | 添加/更新通知配置 |
| DELETE | `/api/notify-configs/:id` | 删除通知配置 |
| POST | `/api/notify-test` | 发送测试通知 |

## Dashboard 完整功能

访问 `http://localhost:7842`

- **Session 列表**：实时显示所有活跃交互
- **Choice 面板**：响应 Agent 的人工确认请求，手动 resolve/reject
- **Policies 标签**：查看/添加/删除策略规则
- **事件流 / 时间线切换**：SSE 实时推送 或 Session 执行时间线回放（可观测性）
- **Audit 标签**：查看审计日志和统计（可观测性副产品）
- **Notify 标签**：配置多通道告警（Slack/Webhook/系统通知）
- **Delay 撤销**：事件流中显示倒计时，可一键撤销

通过 URL 参数自动连接：`http://localhost:7842?session=xxx`
