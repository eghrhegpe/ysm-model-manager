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

`ground-capability.ts:613-745` `gcBuildMaterialGroup` 133 行，超 100 行红线。11 个 `MenuControlDef` 字面量堆叠（mat-source/color/line-color/grid-size/texture/clear/opacity/scale/rotation/roughness/metalness），坏味道「重复 DOM 装配」。

## 核心职责

构建「表面材质」菜单组的 11 个控件项，返回 `MenuControlDef[]` 供 `getMenuControls()` 聚合。

## 对外 API / 入口

- `gcBuildMaterialGroup(cap: GroundCapability): MenuControlDef[]` — 包级函数，仅 `getMenuControls()` 调用。

## 与其他子系统关系

- 上游：`GroundCapability.getMenuControls()` L470-472 聚合 `gcBuildMain`/`gcBuildWaterGroup`/`gcBuildMaterialGroup` 三组。
- 下游：`mountPreviewRootMenu`（preview-menu.ts）消费 `MenuControlDef[]` 渲染声明式菜单。
- 横向：`gcBuildMain` L556-567 12 行、`gcBuildWaterGroup` L569-611 43 行——都 <100 行，仅 `gcBuildMaterialGroup` 超标。

## 不变量

- 11 个控件项的 `id`/`labelKey`/`group`/`kind`/`slider`/`getValue`/`setValue` 字段不可变（e2e 选择器依赖）。
- `group: "preview.groundGroupMaterial"` 所有项共享，不可改。

## 问题清单（ts-package-review 2026-08-27）

1. **133 行超 100 行红线**：11 个 `MenuControlDef` 字面量堆叠，无子函数拆分。
2. **重复结构**：7 个 slider 项（grid-size/opacity/scale/rotation/roughness/metalness）结构同构（`kind: "slider"` + `slider: {min,max,step}` + `getValue`/`setValue`），可抽 `makeSliderDef(id,labelKey,slider,get,set)` 工厂。
3. **`as unknown as` 窄化** L614-617：`cap as unknown as { params: ...; customTexName: string; openTexturePicker(): void }` 绕过私有字段访问——可改用 `#params` 私有字段 + 公开 getter，消除 `as unknown as`。

## 建议动作

1. 抽 `makeSliderDef`/`makeColorDef`/`makeButtonDef` 工厂，消除 7 个 slider 项的重复结构。
2. 按控件语义分组：`buildMatSourceGroup`（mat-source）/ `buildMatColorGroup`（color/line-color）/ `buildMatTextureGroup`（texture/clear）/ `buildMatSliderGroup`（grid-size/opacity/scale/rotation/roughness/metalness）——主函数 ≤40 行纯聚合。
3. 命名前缀：`gc*`（ground-capability，已用）。

## 相关

- 兄弟卡：`mount3D-584-giant`（同审核批次，3D 层坏味道）
- ADR-076 v2（声明式根菜单，菜单项结构 e2e 依赖）
