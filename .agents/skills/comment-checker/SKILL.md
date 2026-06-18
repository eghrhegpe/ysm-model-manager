---
name: comment-checker
description: 注释质量检查。检测 AI 废话注释、空 JSDoc、TODO 无编号、调试日志等。
runAs: subagent
---

# 注释检查 + 修复推理

## 工作流程

1. **收集违规**：运行 `python3 scripts/comment-checker.py --json`，获取结构化违规清单
2. **逐条分析**：对每条违规，读取违规文件的上下文（前后 3 行），判断是真违规还是合理注释
3. **输出修复计划**：写入 `docs/comment-checker-report.md`

## 判断标准

| 类型 | 真违规信号 | 误报信号 |
|------|-----------|---------|
| AI 废话 | 注释重复代码逻辑（"用于获取列表"→`getList()`） | 注释解释了 WHY 而非 WHAT |
| 空 JSDoc | `@param {string} path` 无下文 | 有实质描述 |
| TODO 无编号 | `TODO: 后续优化` 无关联 | 有 #issue 或责任人 |
| 注释掉的代码 | `// var old = ...` 完整语句 | 临时注释掉的调试行 |
| 调试日志 | `console.log(xxx)` 裸调用 | `[YSM]` / `[sync]` 等业务日志 |

## 输出格式

```markdown
## [type] file:line
- 当前：`...`
- 判断：真违规 / 误报
- 修复：删除 / 保留 / 改写为 `...`
```
