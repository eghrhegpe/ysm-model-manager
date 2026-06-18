---
name: binding-check
description: Wails Binding 签名一致性。对比 Go 端导出函数 vs 前端 wailsjs。
runAs: subagent
---

# Binding 签名检查

## 工作流程

1. **收集数据**：运行 `python3 scripts/binding-check.py` 获取结构化 JSON
2. **分析**：对每条不一致（Go 有 JS 无 / JS 有 Go 无），读取源码确认
3. **输出**：写入 `docs/binding-check-report.md`

## 输出格式

```markdown
## binding-check-report
| 函数 | Go 端 | JS 端 | 判断 |
|------|-------|-------|------|
| `GetFoo` | app.go | App.js | 一致 ✅ |
| `OldFunc` | - | App.js | 过时，需清理 ❌ |
```
