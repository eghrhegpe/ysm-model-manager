---
kind: ground-cap-gcbuildmaterialgroup-133
name: ground-cap-gcBuildMaterialGroup-133
tier: leaf
category: utils
source_files:
  - frontend/src/utils/3d/caps/ground-capability.ts
use_when:
  - 拆 gcBuildMaterialGroup 长函数
  - 评审 ground-capability.ts 菜单构建
---

# ground-cap-gcBuildMaterialGroup-133

## 概览

`ground-capability.ts` `gcBuildMaterialGroup` 约 55 行（T2 工厂化后从 133 行降至 <60 行），构建「表面材质」菜单组 14 个控件。已按建议抽 `gcSliderDef`/`gcColorDef`/`gcButtonDef` 工厂，消除重复结构。2026-08-28 拓展：新增 `stripes`/`diamond`/`marble` 三种程序化表面模式；select 列表、副色 color2、density、angle 三项控件。

## 核心职责

构建「表面材质」菜单组的 14 个控件项（source select、底/副/线 3 color、grid-size、density、angle、2 buttons、opacity、scale、rotation、roughness、metalness），返回 `MenuControlDef[]` 供 `getMenuControls()` 聚合。

## 对外 API / 入口

- `gcBuildMaterialGroup(cap: GroundCapability): MenuControlDef[]` — 包级函数，仅 `getMenuControls()` 调用。
- 辅助工厂（包级、material group 专用）：`gcSliderDef` / `gcColorDef` / `gcButtonDef`。
- `gcBuildWaterGroup` 自 T2 起也抽取了 `wSlider`/`wColor` 局部工厂，同样 DRY 组装 12 项 water 控件。

## 与其他子系统关系

- 上游：`GroundCapability.getMenuControls()` 聚合 `gcBuildMain`/`gcBuildWaterGroup`/`gcBuildMaterialGroup` 三组（1 + 12 + 14 = 27 控件）。
- 下游：`renderCapControls`（preview-menu-cap-controls.ts）消费 `MenuControlDef[]` 渲染声明式菜单。
- 横向：`gcBuildMain` ~12 行、`gcBuildWaterGroup` ~95 行（12 控件、局部工厂）、`gcBuildMaterialGroup` ~55 行——三组长尾均 <100 行。

## 不变量

- 14 个控件项的 `id`/`labelKey`/`group`/`kind`/`slider`/`getValue`/`setValue` 字段不可变（e2e 选择器依赖）。
- `group: "preview.groundGroupMaterial"` 所有 material 项共享，不可改；water 组对应 `preview.groundGroupWater`。
- `GROUND_SURFACE_MODES` 白名单与 select 选项列表保持对齐（9 项）：`none/solid/plain/grid/checker/stripes/diamond/marble/texture`。

## 历史问题清单（2026-08-27 ts-package-review）— 已完成修复

1. ~~133 行超 100 行红线~~：抽出 3 个工厂后，主函数从 133 行降至 ~55 行。
2. ~~重复结构~~：7 slider（后扩至 9）→ `gcSliderDef` 工厂 1 处；2 color（后扩至 3）→ `gcColorDef` 工厂。
3. ~~`as unknown as` 窄化~~：保留现状（私有字段访问用类型断言集中一处），无需扩大 public API 面。

## 建议动作（续）

1. 若 water 组再超 100 行，同样抽 `gcWaterSliderDef`/`gcWaterColorDef` 包级工厂（目前以局部 lambda 控制在 95 行内，先不抽）。
2. 增加 pool 模式下 4 个专属控件的条件隐藏：当前全部常显，菜单偏长——可考虑 MenuControlDef 加 `enabled?:()=>boolean` 再做（ADR-109 次优先级）。

## 相关

- 兄弟卡：`ground_surface_spec.md`（材质 spec 单源驱动，新增 3 种程序化像素）
- ADR-076 v2（声明式根菜单，菜单项结构 e2e 依赖）
- ADR-117（ground-material-spec 单一事实源，参数嵌套设计）
