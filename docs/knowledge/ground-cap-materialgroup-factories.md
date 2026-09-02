---
kind: ground-cap-materialgroup-factories
name: ground-cap 材质菜单工厂（material-group factories）
tier: leaf
category: rendering
perf:
  - cpu-bound
source_files:
  - frontend/src/preview-3d/caps/ground-capability.ts
auto_fields:
  symbols_with_lines:
    - DEFAULT_GROUND_PARAMS
    - GroundCapability
    - GroundParams
  quick_groups:
    - 3D 预览与模型追加
  quick_intents:
    - 拆 gcBuildMaterialGroup 长函数
    - 评审 ground-capability.ts 菜单构建
  quick_risk_lines:
    - 地面材质菜单必须经 gcSliderDef/gcColorDef/gcButtonDef 工厂构建，禁止手写控件结构
  pitfalls:
    - 手写控件结构 → 与工厂输出不一致、菜单构建重复；必须经工厂函数
    - 新增地面模式未走工厂 → 菜单缺控件；必须在工厂中注册
  use_when:
    - 拆 gcBuildMaterialGroup 长函数
    - 评审 ground-capability.ts 菜单构建
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 拆 gcBuildMaterialGroup 长函数
  - 评审 ground-capability.ts 菜单构建
quick_risk_lines:
  - 地面材质菜单必须经 gcSliderDef/gcColorDef/gcButtonDef 工厂构建，禁止手写控件结构
pitfalls:
  - 手写控件结构 → 与工厂输出不一致、菜单构建重复；必须经工厂函数
  - 新增地面模式未走工厂 → 菜单缺控件；必须在工厂中注册

use_when:
  - 拆 gcBuildMaterialGroup 长函数
  - 评审 ground-capability.ts 菜单构建
status: active
---

# ground-cap 材质菜单工厂（material-group factories）

## 概览

`ground-capability.ts` `gcBuildMaterialGroup` 约 55 行（T2 工厂化后从 133 行降至 <60 行），构建「表面材质」菜单组 14 个控件。已按建议抽 `gcSliderDef`/`gcColorDef`/`gcButtonDef` 工厂，消除重复结构。2026-08-28 拓展：新增 `stripes`/`diamond`/`marble` 三种程序化表面模式；select 列表、副色 color2、density、angle 三项控件。

## 核心职责

构建「表面材质」菜单组的 14 个控件项（source select、底/副/线 3 color、grid-size、density、angle、2 buttons、opacity、scale、rotation、roughness、metalness），返回 `MenuControlDef[]` 供 `getMenuControls()` 聚合。

## 对外 API / 入口

- `gcBuildMaterialGroup(cap: GroundCapability): MenuControlDef[]` — 包级函数，仅 `getMenuControls()` 调用。
- 辅助工厂（包级、material group 专用）：`gcSliderDef` / `gcColorDef` / `gcButtonDef`。
- 水面菜单（原 `gcBuildWaterGroup` 的 12 项 water 控件）已随 2026-08-28 拆分迁至独立 `WaterCapability`（`frontend/src/preview-3d/caps/water-capability.ts`），ground 不再聚合水面组。

## 与其他子系统关系

- 上游：`GroundCapability.getMenuControls()` 聚合 `gcBuildMain`/`gcBuildMaterialGroup` 两组（1 + 14 = 15 控件；水面已拆为独立 WaterCapability，其 `gcBuildWaterGroup` 在 water-capability.ts 内）。
- 下游：`renderCapControls`（preview-menu/cap-controls.ts）消费 `MenuControlDef[]` 渲染声明式菜单。
- 横向：`gcBuildMain` ~12 行、`gcBuildMaterialGroup` ~55 行——组长尾均 <100 行。

## 不变量

- 14 个控件项的 `id`/`labelKey`/`group`/`kind`/`slider`/`getValue`/`setValue` 字段不可变（e2e 选择器依赖）。
- `group: "preview.groundGroupMaterial"` 所有 material 项共享，不可改；水面组（现 `WaterCapability`）对应 `preview.waterGroup`。
- `GROUND_SURFACE_MODES` 白名单与 select 选项列表保持对齐（9 项）：`none/solid/plain/grid/checker/stripes/diamond/marble/texture`。

## 历史问题清单（2026-08-27 ts-package-review）— 已完成修复

1. ~~133 行超 100 行红线~~：抽出 3 个工厂后，主函数从 133 行降至 ~55 行。
2. ~~重复结构~~：7 slider（后扩至 9）→ `gcSliderDef` 工厂 1 处；2 color（后扩至 3）→ `gcColorDef` 工厂。
3. ~~`as unknown as` 窄化~~：保留现状（私有字段访问用类型断言集中一处），无需扩大 public API 面。

## 建议动作（续）

1. 水面控件（12 项）已迁至 `water-capability.ts` 的 `gcBuildWaterGroup`，其工厂化演进在该卡维护。
2. 增加 pool 模式下 4 个专属控件的条件隐藏：当前全部常显，菜单偏长——可考虑 MenuControlDef 加 `enabled?:()=>boolean` 再做（ADR-109 次优先级）。

## 相关

- 兄弟卡：`ground_surface_spec.md`（材质 spec 单源驱动，新增 3 种程序化像素）
- ADR-076 v2（声明式根菜单，菜单项结构 e2e 依赖）
- ADR-117（ground-material-spec 单一事实源，参数嵌套设计）
