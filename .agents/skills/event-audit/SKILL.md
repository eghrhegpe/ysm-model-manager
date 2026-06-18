---
name: event-audit
description: 事件注册审计。扫描 EventsOn/bus.on 注册位置是否合规。
runAs: subagent
---

# 事件注册审计

## 工作流程

1. **收集数据**：运行 `python3 scripts/event-audit.py --json`，获取所有事件注册清单
2. **逐条分析**：对每条注册，判断是否在正确位置（全局 handler 必须在 `app-content/index.js` 的 `_registerGlobalHandlers()`）
3. **输出报告**：写入 `docs/event-audit-report.md`

## 判断标准

| 类型 | 合规 | 不合规 |
|------|------|--------|
| `EventsOn`（Wails 全局事件） | 在 `app-content/index.js` | 在其他文件 |
| `bus.on`（组件内事件） | 在组件自己的 `events.js` | 在无关组件中 |

## 输出格式

```markdown
## event-audit-report
| 文件 | 事件 | 判断 |
|------|------|------|
| `bus-handlers.js` | `entry:toggle` | 合规（组件内事件） |
```
