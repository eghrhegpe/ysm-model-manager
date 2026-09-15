---
kind: icon_kit
name: icon-kit 多源图标
tier: leaf
category: ui
source_files:
  - frontend/src/utils/icon/icon-kit/index.ts
  - frontend/src/utils/icon/icon-kit/render.ts
  - frontend/src/utils/icon/icon-kit/types.ts
  - frontend/src/utils/icon/icon-kit/icons.ts
auto_fields:
  symbols_with_lines:
    - ICON_KIT
    - IconKitName
    - iconKitNames
    - IconSource
    - IconSpec
    - renderIcon
use_when:
  - 图标
  - emoji
  - SVG 图标
  - icon-kit
  - renderIcon
quick_intents:
  - 多源图标、SVG/emoji/图标字体、renderIcon
pitfalls:
  - 图标实现写进调用点（外观名）→ 违反 ADR-238 D2，换图标要全局改名；必须用语义名
  - UI chrome 图标内联进 i18n 词条 → 应改走 ICON_KIT / UI_ICONS，词条只留纯文本
invariant_anchors:
  - frontend/src/utils/icon/icon-kit/icons.ts|ICON_KIT
  - frontend/src/utils/icon/icon-kit/render.ts|renderIcon
status: active
---

# icon-kit 多源图标

## 概览

在 ADR-238 的 `UI_ICONS`（纯 SVG）之上新增的**多源图标中介层**：把一个「图标语义名」绑定到
SVG / emoji / 图标字体中的某一种源，由 `renderIcon` 统一渲染成对应的 HTML 结构。

## 核心职责

- 解耦「图标语义」与「图标源」：调用方只 import 语义名（`ICON_KIT.enableAll`），
  不关心其底层是 SVG 还是 emoji。
- 提供三种源（`IconSource`）：
  - `svg` → 复用 `.ws-icon` 外壳（24×24 + currentColor，随主题/字号）；
  - `emoji` → `.eicon` span，保留字符原始外观（多源策略允许作回退/长尾）；
  - `font` → `.ficon` span + 图标字体类名（预留，接入字体库时启用）。
- 渲染策略：SVG 优先（默认选中），不强制全 SVG —— 需要世界表情/特殊字形时允许 emoji 源。

## 对外 API / 入口

- `ICON_KIT: Record<string, IconSpec>` — 语义名 → 多源图标定义（`icons.ts`）。
- `renderIcon(spec: IconSpec): string` — 把定义渲染成 HTML 字符串（`render.ts`）。
- `iconKitNames(): string[]` — 全部语义名（测试/文档用）。
- 类型：`IconSpec` / `IconSource`（`types.ts`）。
- 入口聚合：`@/utils/icon/icon-kit/index.ts`。

## 与其他子系统关系

- 是 `UI_ICONS`（`utils/icon/ui-icons.ts`，ADR-238）的**上层中介**：需要 SVG 时由
  render 内部复用 `.ws-icon` 外壳，不为 SVG 重造轮子。
- 语义名规范沿用 ADR-238 D2（语义名非外观名），`UI_ICONS` 的对拍契约
  `tests/test_ui_icons.ts` 不受影响。
- 消费方示例：`app-tree/tpl.ts` 批量按钮（`ICON_KIT.enableAll` / `disableAll`）。

## 不变量

- SVG 源渲染的字符串必须含 `class="ws-icon"` 与 `viewBox="0 0 24 24"`（否则不随主题/字号）。
- emoji 源渲染为 `<span class="eicon">…</span>`。
- 未知源回退为空串（不输出破坏结构的 HTML）。
- 新增图标必须用语义名，禁止把 emoji/SVG 字形写进调用点或 i18n 词条。

## 相关

- [utils-icon](./utils-icon.md) — ADR-238 SVG 图标体系（本层在其之上）
- `docs/adr/ADR-238-ui.md` — UI 图标规范
- `frontend/src/utils/icon/icon-kit/index.test.ts` — 单元测试