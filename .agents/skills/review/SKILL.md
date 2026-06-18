---
name: review
description: 代码审查 + 修复推理。先扫违规，再逐个分析上下文输出修复方案。
runAs: subagent
---

# 代码审查 + 修复推理

## 工作流程

1. **收集违规**：运行 `python3 scripts/review.py --json`，获取结构化违规清单（13 条规则 × 41+ 违规）
2. **逐个分析**：对每条有违规的规则，读取违规文件的上下文（前后 3 行）
3. **输出修复计划**：针对每条规则，给出可执行的修改方案

## 输出格式

```markdown
## [rule_id] rule_name (N 处)

### 文件 path:line
- 当前代码：`...`
- 问题：...
- 修复：`...`
```

## 输出文件

写入 `docs/review-report.md`，包含完整的修复计划。输出完后打印 "Review complete with fix plan → docs/review-report.md"。
