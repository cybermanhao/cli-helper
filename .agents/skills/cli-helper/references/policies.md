# Policy Engine 详细说明

## 作用

策略引擎为 Agent 操作提供规则治理。人类预设规则，Agent 执行时自动评估。

## 策略规则结构

```json
{
  "id": "rule-id",
  "scope": "command" | "file" | "tool" | "network",
  "pattern": "rm -rf /",
  "action": "deny" | "allow" | "confirm" | "notify" | "delay"
}
```

## Action 行为

| action | 行为 |
|--------|------|
| `allow` | 直接放行 |
| `deny` | 拒绝执行 |
| `confirm` | 弹出系统确认对话框 |
| `notify` | 发送系统通知后执行 |
| `delay` | 延迟 N 秒，期间可在 Dashboard 撤销 |

## 默认策略（不可删除）

| pattern | scope | action |
|---------|-------|--------|
| `rm -rf /` | command | deny |
| `git push` | command | confirm |
| `npm install` | command | allow |
| `.env` | file | confirm |

## 管理策略

### 列出所有策略
```json
{ "tool": "list_policies" }
```

### 添加策略
```json
{
  "tool": "manage_policy",
  "action": "add",
  "rule": {
    "scope": "command",
    "pattern": "docker push",
    "action": "confirm"
  }
}
```

### 删除策略
```json
{
  "tool": "manage_policy",
  "action": "remove",
  "ruleId": "rule-id"
}
```

## Agent 处理策略返回

### deny
```json
{ "error": "Policy denied: rm -rf / matches deny rule" }
```
**Agent 应做**：停止执行，告知用户策略拒绝的原因。

### confirm
```json
{ "policyAction": "confirm", "message": "Policy requires confirmation for: git push" }
```
**Agent 应做**：系统已弹出确认对话框，等待用户确认后继续。

### delay
```json
{ "policyAction": "delay", "delayMs": 10000, "delayId": "xxx" }
```
**Agent 应做**：告知用户"命令将在 N 秒后执行，可在 Dashboard 撤销"。

### notify
```json
{ "policyAction": "notify", "message": "Executing: npm install" }
```
**Agent 应做**：系统已发送通知，命令继续执行。

## 撤销 delay

如果用户想撤销一个正在倒计时的 delay：

```json
{ "tool": "cancel_delay", "delayId": "xxx" }
```

或在 Dashboard (`http://localhost:7842`) 的事件流中点击撤销按钮。
