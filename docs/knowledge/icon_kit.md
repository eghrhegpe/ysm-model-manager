---
kind: icon_kit
name: icon-kit 多源图标（已并入 UI_ICONS）
tier: leaf
category: ui
status: superseded
affected: false
source_files:
  - frontend/src/utils/icon/ui-icons.ts
  - frontend/src/utils/icon/resolve.ts
invariant_anchors:
  - frontend/src/utils/icon/ui-icons.ts|UI_ICONS
use_when:
  - icon-kit
  - 多源图标
  - renderIcon
  - emoji 图标源
  - 图标字体
quick_intents:
  - icon-kit 去哪了、为何被删
  - 想给图标加 emoji 或字体源该怎么做
  - resolveIcon 现在查几张表
quick_groups:
  - 图标体系
pitfalls:
  - 别再新建第二图标命名空间——多源中介层的成本已实测高于收益（见 ADR-248 §3）
  - 若确需 emoji/图标字体源，那是推翻 ADR-238 D1 的决策，须另立 ADR 而非「补一个源」
  - 纯 SVG 设计的新图标若漏登记 icon-map，双向对拍会失败（需补字形映射）
---

# icon-kit 多源图标（已并入 UI_ICONS）

> **状态：已废弃（superseded）**——2026-09 由 [ADR-248](../adr/ADR-248-icon-field-typing.md) §3 决策
> 并入 `UI_ICONS`，模块整体删除。本卡保留为**可检索的历史记录**：它曾是什么、为何移除、
> 以及「若想再要多源能力，先读哪两份 ADR」。

## 概览（历史）

`frontend/src/utils/icon/icon-kit/`（4 文件 + 单测）是一个**多源图标中介层**：
语义名 → `{ src: "svg" | "emoji" | "font" }`，由 `renderIcon(spec)` 渲染成
`<svg>` / `<span class="eicon">` / `<span class="ficon">`。
当时自述目的是「承接 ADR-238 的 SVG 单一体系，**破掉「只支持 SVG」的限制**」。

## 为何被移除（实测事实，非判断）

| 事实 | 含义 |
|---|---|
| 只注册 **2 个图标**（`enableAll` / `disableAll`，树工具栏批量按钮用） | 收益面极窄 |
| 两者 `src` **均为 `"svg"`** | 多源能力**一次都没用上** |
| `emoji` / `font` 源**生产零使用**（仅其单测断言过） | 投机性抽象 |
| **无任何 ADR 建立它** | 缺决策背书 |
| 其立论与 **ADR-238 D1**（UI 图标一律走 SVG）**方向相反** | 与既有决策冲突 |
| 引入**第二个语义名命名空间** | 换来解析优先级 + 类型并集 + 同树 `IconSpec` 重名 + 对拍复杂度 |

结论：收益（emoji/字体源）从未被使用，成本是四项持续开销。

## 决策与去向

- 决策见 [ADR-248](../adr/ADR-248-icon-field-typing.md) §3「已收敛」；
- `enableAll` / `disableAll` 两个语义名原样搬进 `UI_ICONS`（消费点零改动）；
- `resolveIcon()` 由「两表按优先级查找」简化为**单表查找**；
- 过渡类型 `IconKitName` / `IconName` 一并删除，结构槽字段直接写 `UiIconName`；
- 多源能力（`emoji`/`font` 源与 `renderIcon`）删除；`.ficon` 样式另有独立消费者
  （app-tree 文件列表），不受影响。

## 相关

- [ADR-238](../adr/ADR-238-ui.md)：图标语义名规范（移除本模块的依据）
- [ADR-248](../adr/ADR-248-icon-field-typing.md)：图标字段类型化 + 本次收敛决策
- [app-tree](./app-tree.md)：批量启用/禁用按钮（两个图标的消费方）
