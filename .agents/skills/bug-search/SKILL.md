---
name: bug-search
description: 问题排查记录搜索。按关键词查找 bug-chronicle.md 中的相关 bug。
runAs: subagent
---

# Bug 搜索

## 工作流程

1. **搜索**：用户提供关键词，运行 `python3 scripts/bug-search.py <keyword> --json`
2. **提取**：从返回的 JSON 中提取匹配的 bug 标题和症状/根因/修复
3. **输出**：写入 `docs/bug-search-report.md`，包含相关 bug 的摘要和修复要点

## 输出格式

```markdown
## bug-search-report
关键词: xxx

### #N. bug 标题
- 症状: ...
- 根因: ...
- 修复: ...
```
