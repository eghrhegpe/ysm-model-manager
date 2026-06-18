---
name: type-consistency
description: 资源类型三方一致性检查。比对 resource_types.json ↔ Go ↔ JS。
runAs: subagent
---

# 三方一致性检查

## 工作流程

1. **收集数据**：运行 `python3 scripts/type-consistency.py --json`，获取一致性差异清单
2. **逐条分析**：判断是「JSON 改了 JS 未同步」还是「JS 多了过期条目」
3. **输出修复建议**：写入 `docs/type-consistency-report.md`

## 判断标准

- JSON 是唯一事实来源（resource_types.json）
- Go 端动态读取 JSON，理论上自动同步
- JS 端（extensions.js）是静态兜底，必须手动同步

## 输出格式

```markdown
## type-consistency-report
| 类型 | 问题 | 修复 |
|------|------|------|
| `ysm` | JS 缺少 .json | 加到 RESOURCE_EXTS 中 |
```
