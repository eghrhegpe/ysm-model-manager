---
name: ultrawork
description: 一键三连。顺序执行：Go 编译 → 前端构建 → 测试 → 红线审查 → Git 状态。
runAs: subagent
---

# Ultrawork

说"ultrawork"或"跑一遍"，就会顺序执行：

```
① Go Build     → go build ./go/...
② Frontend     → npx vite build
③ Go Test      → go test ./go/...
④ Code Review  → python3 scripts/review.py
⑤ Git Status   → git status --short
```

每步失败即停，不往下走（review 和 git status 除外）。

```bash
python3 scripts/ultrawork.py
```
