---
name: link-checker
description: Markdown 链接断链检查。扫所有 md 文件，验证内部链接目标是否存在。
runAs: subagent
---

# 链接断链检查

## 工作流程

1. **扫描链接**：运行 `python3 scripts/link-checker.py --json`，获取断链清单
2. **归类**：断链分为「文件已移动」和「路径写错」两类
3. **修复输出**：写入 `docs/link-checker-report.md`，给出 `old → new` 替换表

## 判断标准

- 外部链接（`http://` `https://`）跳过
- 锚点链接（`#xxx`）跳过
- 相对路径相对于文件所在目录解析

## 输出格式

```markdown
## brokenlinks-report
| 文件 | 断链 | 推荐修复 |
|------|------|---------|
| `docs/xxx.md` | `[text](path)` | `[text](correct-path)` |
```
