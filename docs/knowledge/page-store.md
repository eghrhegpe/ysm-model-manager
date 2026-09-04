---
kind: page-store
name: 页面状态管理 page-store.ts
tier: architecture
category: core
source_files:
  - frontend/src/core/page-store.ts
auto_fields:
  symbols_with_lines:
    - PAGE_WHITELIST
    - PageStore
    - registerPageStore
    - resolveInitialPage
    - sanitizePage
  tests:
    - frontend/src/core/page-store.test.ts
tests:
  - frontend/src/core/page-store.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 页面状态管理、当前页、page store
  - resolveInitialPage / sanitizePage
  - 启动初始页解析
quick_risk_lines:
  - page-store 只管理当前页标识（只读 getter），不协调页面挂载 / 卸载，那是 app-content 的职责
pitfalls:
  - 在 page-store 里挂页面挂载 / 卸载逻辑 → 与 app-content 重复、状态串扰；必须分开
  - resolveInitialPage 无回退 → 隐私模式读不到 localStorage 时死页；必须经三优先级回退 repository

use_when:
  - 页面
  - 当前页
  - 状态管理
  - page store
  - currentPage
invariant_anchors:
  - frontend/src/core/page-store.ts|sanitizePage
status: active
---

# 页面状态管理 page-store.ts
> **架构事实已迁移至 **[architecture.md#64-事件总线与状态](../architecture.md#64-事件总线与状态)。
> 本卡仅保留 frontmatter 机器字段（symbols/tests/quick_risk_lines），架构描述以 architecture.md 为准。

---

## 符号索引

> 符号列表见 frontmatter `auto_fields.symbols_with_lines`。
