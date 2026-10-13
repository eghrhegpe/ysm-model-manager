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
use_when:
  - 事件
  - 事件总线
  - 通信
  - emit
  - 跨组件通信
  - bus
  - 配置变更
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

## 事件登记表（机器守卫）

合法发射者登记表 = `docs/.bus-emitters.json`，由 `scripts/event-graph.ts` 执法（新发射点表外 = `--strict` 硬错误，
合法新增须 `--update --force` 显式登记）。守卫行为与陷阱见知识卡 `event_graph_guard`。

⚠️ **登记表是「发射者」集合，不是「事件语义」集合**——它只回答「谁有权发这个名字」，不回答「谁该收、载荷什么形状」。
新增非 void 事件时，事件语义与不变量的落点必须写进**消费方的归属卡**，别只登记表名就算完。

## 配置类事件 `config:changed`（跨视图配置读取的单一信号）

落盘成功后广播，载荷 = 实际写入六元组（`filesRoot` / `rpRoot` / `mcRoot` / `linkMode` / `theme` / `themeAuto`），
订阅分支**零 IPC** 直接渲染。发射点唯一 = `frontend/src/views/config-write.ts|writeAppConfig`（ADR-313 唯一实参点），
**仅在落盘成功后** emit——禁止广播半落盘状态。形状就地声明于 `bus.ts`（避免 bus 反向依赖 views）。

不变量「配置读取事件驱动，禁『每次 reload 重拉配置』」的完整理由与回归锁清单 → 知识卡 `app_sidebar` 的
「配置读取事件驱动」节。**新增配置读取方一律订阅该事件，不要回落到每轮 reload 重读。**

---

## 符号索引

> 符号列表见 frontmatter `auto_fields.symbols_with_lines`。
