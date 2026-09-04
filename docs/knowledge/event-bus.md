---
kind: event-bus
name: 事件总线 bus.ts
tier: architecture
category: core
source_files:
  - frontend/src/bus.ts
auto_fields:
  symbols_with_lines:
    - bus
    - Bus
    - BusEventName
    - BusEvents
    - CtxShowPayload
    - MenuItem
    - ModelSelectPayload
    - NavPagePayload
    - PageName
    - ToastPayload
  tests:
    - frontend/src/bus.test.ts
tests:
  - frontend/src/bus.test.ts
use_when:
  - 事件
  - 事件总线
  - 通信
  - emit
  - 跨组件通信
  - bus
invariant_anchors:
  - frontend/src/bus.ts|once
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - emit 事件 / 跨组件通信
  - 订阅 / 退订事件 / once
quick_risk_lines:
  - 所有跨组件异步通信必经 bus.ts，禁止组件间直耦
  - once 只能用它返回的退订函数取消（off 原 fn 匹配不到 wrapper）
pitfalls:
  - 「bus.off(event, 原fn)」once off 错对象 → 用 once 返回的 unsub 函数取消
status: active
---

# 事件总线 bus.ts
> **架构事实已迁移至 **[architecture.md#64-事件总线与状态](../architecture.md#64-事件总线与状态)。
> 本卡仅保留 frontmatter 机器字段（symbols/tests/quick_risk_lines），架构描述以 architecture.md 为准。

---

## 符号索引

> 符号列表见 frontmatter `auto_fields.symbols_with_lines`。
