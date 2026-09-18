---
kind: adr
name: toast-emoji-svg
tier: architecture
category: ui
status: active
source_files:
  - frontend/src/views/app-toast/index.ts
auto_fields:
  symbols_with_lines:
    - VIEW_TESTIDS
tests:
  - frontend/src/test-utils/index.test.ts
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-sync-manager/index.branches.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/index.extra.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - toast msg 载荷带 emoji 前缀（✅/❌/⚠️）不知如何处理
  - toast undo 按钮图标迁移
  - ADR-238 emoji→SVG 收债的 toast 盲区量不到不拦
pitfalls:
  - app-toast msg 槽走 esc() 转义，塞 SVG 会以字面 svg 标签文本显示，不能直接承载图标（ADR-267 盲区根因）
  - .toast 已按 type 左边框着色，msg 载荷 emoji 前缀是信息冗余，应交给 type 驱动
quick_groups:
  - toast 收债
quick_intents:
  - toast emoji
  - 消息弹窗图标
quick_risk_lines:
  - app-toast/index.ts|innerHTML
invariant_anchors:
  - frontend/src/views/app-toast/index.ts|show
---

# toast-emoji-svg

ADR-267：toast 消息载荷 emoji→类型驱动语义图标，去 esc 文本槽盲区。
ADR-238（emoji→SVG 收债）结构图标位已清零；本卡记录 toast 渲染层盲区的收债决策与进度。

## 概览

`<app-toast>` 渲染层 `<span class="msg">${esc(msg)}</span>` 走 esc 转义文本槽，
msg 载荷内的 emoji（✅/❌/⚠️ 前缀 + undo `↩`）属于结构性盲区债：塞 SVG 会字面显示，
`check-design-tokens` 又量不到（无字面量位）。ADR-267 决策：渲染层加 type→语义 SVG 图标位，
msg 一律去前缀 emoji；undo 按钮 `↩` 迁移 `UI_ICONS.undo`；门禁补盲防回潮。

## 核心职责

- 渲染层按 type（info/success/error/warn）前置一枚语义 SVG 图标（经 resolveIcon，内部常量），
  替代裸色左边框表达；msg 文本槽仍走 esc()（XSS 语义不变，仅图标位新增 SVG 通道）。
- 清理内联字面量与管理器 helper（toastError 等）中的前缀型 emoji。
- undo 按钮 `↩` → `UI_ICONS.undo`（icon-map 已登记 `↩→undo`）。
- 门禁补盲：check-design-tokens 增加 toast 载荷前缀型 emoji 检测。

## 对外 API / 入口

- `<app-toast>` 组件 show()：`bus.emit('toast:show', { msg, undo?, duration?, type? })`
- 渲染层 type 集合固定：info / success / error / warn

## 与其他子系统关系

- 图标映射：`scripts/_lib/icon-map.ts`（✅→success、❌→error、⚠️→warning、🔍→search、
  🗑️→delete、↩→undo、📁→folder、⏳→refresh 等齐备）
- 图标源：`frontend/src/utils/icon/ui-icons.ts`（UI_ICONS.*）
- 前例：copy-toast（ADR-238 C5，已提交「去 ✅/❌ 前缀 + type 驱动」）

## 不变量

- msg 始终经 esc() 转义，永不以非白名单 SVG 直接进 innerHTML（XSS 语义不可回退）。
- 图标位只喂 resolveIcon 产物（内部常量 SVG），永不是用户数据。
- 前缀型状态 emoji（✅/❌/⚠️…）不进入 msg 载荷 —— 状态由 type 驱动。

## 相关

- [](../adr/ADR-267-toast-emoji-esc.md)
- [](../adr/ADR-238-ui.md)