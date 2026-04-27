# 常见对话场景

## "你刚才生成的图/文件在哪？给我看看"

**Agent 应做**：
1. 告诉用户文件保存的绝对路径
2. 调用 `open_path({ path: "文件路径" })` 自动打开文件夹或文件

**示例**：
```
用户：图在哪？
Agent：图片已保存到 C:\code\project\assets\output.png，我现在帮你打开。
[调用 open_path]
```

## "我刚才选的文件/图片在哪？"

**Agent 应做**：
1. `show_asset_picker` 结果 → 遍历 `selections` 数组，列出每个文件的 `imagePath`
2. `upload_files` 结果 → 遍历 `files` 数组，列出每个文件的 `path`
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

## "刚才的操作记录在哪看？" / "我做了什么？"

**Agent 应做**：
1. 告知用户通过 Dashboard 查看：`http://localhost:7842`
2. 调用 `list_sessions` 获取最近的 session 列表
3. 或读取 `agent-workspace/log.jsonl` 展示最近的操作日志

**示例**：
```
用户：我做了什么？
Agent：最近的操作记录：
  1. 12:30 — show_asset_picker — 选择了 neko_2.jpg
  2. 12:28 — run_command — git status
你可以在 http://localhost:7842 查看完整审计日志。
```

## "帮我撤销刚才的操作" / "取消"

**Agent 应做**：
1. 刚执行的 `run_command` 且触发了 delay 策略 → 调用 `cancel_delay` 撤销
2. `show_asset_picker` 还在等待中 → 告知用户直接关闭浏览器标签页
3. 已完成的操作 → 告知无法撤销，但可以重新执行反向操作

**示例**：
```
用户：撤销刚才的 git push
Agent：git push 触发了 delay 策略（10秒后执行），delayId 是 xxx。
[调用 cancel_delay]
已撤销，push 不会执行。
```

## "刚才的命令输出是什么？"

**Agent 应做**：
1. `run_command` 的结果包含 `stdout` 和 `stderr`，直接展示
2. 输出太长 → 用 `capOutput` 截断后展示，并告知完整输出在 Dashboard

**示例**：
```
用户：刚才 npm install 输出了什么？
Agent：
stdout: added 42 packages in 3s
stderr: 1 deprecated warning
```

## "进度怎么样了？" / "好了吗？"

**Agent 应做**：
1. 有 `update_state` 保存的状态 → 读取并展示当前进度
2. 有 pending 的 delay → 展示倒计时
3. 有等待中的 choice → 提醒用户去浏览器操作

**示例**：
```
用户：好了吗？
Agent：还在等待你操作。请打开浏览器选择图片：
  http://localhost:7842/picker/xxx
选完点 Confirm 我就继续。
```

## "帮我打开项目文件夹"

**Agent 应做**：
调用 `open_path({ path: process.env.PROJECT_ROOT })` 打开项目根目录。

## "通知我一下" / "好了告诉我"

**Agent 应做**：
调用 `show_notification({ title, message })` 发送系统通知，适用于长时间任务完成后提醒。

**示例**：
```
用户：构建好了通知我
Agent：好的，构建完成后我会发送系统通知。
[...构建中...]
[调用 show_notification: { title: "构建完成", message: "项目构建成功" }]
```

## "为什么这个命令被拒绝了？"

**Agent 应做**：
1. 解释 Policy Engine 的作用（安全策略拦截了危险操作）
2. 展示触发的策略规则
3. 如果是误拦截，建议用户通过 Dashboard 修改策略

**示例**：
```
用户：为什么 rm -rf 不能执行？
Agent：Policy Engine 拦截了这条命令。默认规则：`rm -rf /` 级别的高危操作会被 deny。
如果你确定要删除，可以先修改策略：
[调用 list_policies 展示规则]
```

## "帮我清理垃圾/重复/临时文件"（最典型的完整工作流）

这是**最典型的 cli-helper 工作流**：

```
用户：帮我清理下载文件夹里的垃圾图片
      ↓
Agent：[调用 run_command 扫描目录]
      ↓
Agent：找到 12 张图片，共 45MB：
        1. screenshot_001.png (2.3MB)
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
Agent：[调用 show_dialog(confirm) 二次确认]
      ↓
Agent：[调用 run_command 删除]
      已删除 2 张图片，释放 3.4MB 空间。
```

**关键步骤**：
1. **扫描**：用 `run_command` 或 Node.js `fs` 扫描目标目录
2. **展示**：把扫描结果格式化为列表，让用户了解有哪些文件
3. **点选**：调用 `show_asset_picker`（图片）或 `show_dialog(select)`（文本列表）
4. **确认**：删除等危险操作，再用 `show_dialog(confirm)` 二次确认
5. **执行**：执行具体操作，并汇报结果

**类似场景**：
- "帮我整理照片" → 扫描相册 → 展示 → 用户选要保留/删除的 → 分类移动
- "帮我选择要导入的图片" → 扫描源目录 → 展示 → 用户选 → 复制到目标
- "帮我压缩这些图片" → 扫描 → 展示 → 用户选 → 批量压缩
- "帮我选择要提交的文件" → `git status` → 展示修改文件 → 用户选 → `git add`

**注意事项**：
- 删除类操作务必**二次确认**，避免误删
- 大文件扫描可能耗时，先用 `show_notification` 告知"正在扫描，请稍候"
- 文件太多（>100 个）→ 考虑用 `show_dialog(select)` 而非 `show_asset_picker`，避免浏览器卡顿
