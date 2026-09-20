---
kind: ground-cap-materialgroup-factories
name: ground-cap 菜单节点工厂（ADR-195 刀2 cap 直产节点）
tier: leaf
category: rendering
perf:
  - cpu-bound
source_files:
  - frontend/src/preview-3d/caps/ground-menu.ts
  - frontend/src/preview-3d/caps/ground-capability.ts
auto_fields:
  symbols_with_lines:
    - buildGroundNodes
    - GROUND_MATERIAL_PRESET_KEYS
    - GroundCapability
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 评审 ground-capability.ts 菜单构建
  - ground 材质菜单节点
  - ADR-195 cap 直产节点
quick_risk_lines:
  - 地面菜单必须经 ground-menu.ts 的 buildGroundNodes 直产 PreviewMenuNode[]，禁止手写控件结构
pitfalls:
  - 手写菜单结构 → 与 buildGroundNodes 输出不一致、菜单构建重复；必须经工厂函数
  - 新增地面模式未走工厂 → 菜单缺控件；必须在 ground-menu.ts 中注册
  - 滑杆值域字面量写进菜单 → 与 schema 漂移（改一处不生效）；ADR-283 起值域只从 `getParamRange(key)` 取

use_when:
  - 评审 ground-capability.ts 菜单构建
  - ground 材质菜单节点
  - ADR-195 cap 直产节点
  - ground 滑杆值域 / ADR-283
status: active
---

# ground-cap 菜单节点工厂（ADR-195 刀2 cap 直产节点）

## 概览

ADR-195 刀2 将 ground 菜单从 `PreviewControlDef[]` 控件定义重构为 `PreviewMenuNode[]` 节点直产。`ground-menu.ts` 是纯声明层（零 THREE 依赖），仅构造 `PreviewMenuNode` 供 `cap.getMenuNodes()` 消费。

**ADR-249（2026-09-16）**：材质控件的 `visibleWhen` 由单一的粗粒度谓词 `groundSurfaceOn`（仅判 `matSource !== "none"`）改为 `paramVisible(param)` —— 逐参数 × 逐模式判定，事实源 = `ground-surface-spec.ts|paramIsEffective`（菜单与渲染共用，禁两处各写一份 if）。`colorNode`/`sliderNode` 工厂新增 `param: GroundMatParam` 形参。原 `groundSurfaceOn` 已删除（`paramIsEffective` 对 `none` 全返 false，语义已覆盖）。**阶段2 拆轴**：原单枚举 select（9 选 1）拆为来源轴（`ground-mat-source`，none/solid/canvas/texture）+ 样式轴（`ground-mat-canvas-style`，仅来源=canvas 时可见）两 select，与旧枚举一一映射。**阶段3 叠加层**：新增 `cap-group-ground-overlay` folder（独立于材质组），`groundBuildOverlayFolder` 工厂。

**历史**：2026-08-28 前 ground 菜单走 `buildGroundMaterialGroup` + `groundSliderDef`/`groundColorDef`/`groundButtonDef` 三工厂产出 `PreviewControlDef[]`（已退役）；2026-09 ADR-195 刀2 迁移至 `buildGroundNodes` 直产 `PreviewMenuNode[]`。

## 核心职责

构建「地面」参数面板的完整节点树：

- `ground-visible`：平铺 toggle（地面总开关，`GroundCapability.getMasterNodeId()="ground-visible"` 升级为 env 面板一级行 headerToggle）
- `ground-grid-visible`：平铺 toggle（参考网格 / GridHelper 层独立开关，2026-09-19；与总开关、材质层正交，`labelKey=preview.groundGridVisible`）
- 网格组 folder（`preview.groundGroupGrid`，锐评 P3 补齐 2026-09-21）：`ground-size`/`ground-divisions` 滑杆 + `ground-color-center`/`ground-color-grid` color——四键早有渲染接线（syncGeometry）与持久化，此前零 UI 出口纯靠存档通路；值域一律 `getParamRange`（groundSize range/uiRange 与 waterSize 同口径），cap setter 只写状态、落地归 ground 回调单路径
- 材质组 folder（`preview.groundGroupMaterial`）：来源轴 select + 样式轴 select（仅来源=canvas 显示）+ 3 color + 9 slider + 2 button（texture/clear，走 controls 通道节点）
- 叠加层 folder（`preview.groundGroupOverlay`，ADR-249 §2.3）：叠加样式 select（none/grid/checker/stripes/diamond）+ color/size/opacity（仅叠加 ≠ none 显示）

## 对外 API / 入口

- `buildGroundNodes(cap: GroundCapability): PreviewMenuNode[]` — 包级函数，`GroundCapability.getMenuNodes()` 唯一桥接入口。
- 内部工厂（包级、material group 专用）：`colorNode` / `sliderNode` / `textureButtonsNode` / `groundBuildMatFolder`。
- 水面菜单（12 项 water 控件）已随 2026-08-28 拆分迁至独立 `WaterCapability`（`frontend/src/preview-3d/caps/water-capability.ts`），ground 不再聚合水面组。

## 与其他子系统关系

- 上游：`GroundCapability.getMenuNodes()`（`ground-capability.ts:369-370`）调用 `buildGroundNodes(this)`。
- 下游：`preview-menu/` 渲染层消费 `PreviewMenuNode[]` 递归渲染声明式菜单。
- 横向：`scene-capability.ts` 定义 `getMenuNodes?()` 可选接口，各 cap（ground/sky/fog/shadow/light/water/reflector/postprocessing/render-mode）统一走 cap 直产节点。

## 不变量

- 全部节点 `id`/`labelKey`/`group`/`kind`/`control` 字段不可变（e2e 选择器依赖）。
- `group: "preview.groundGroupMaterial"` 所有 material 项共享，不可改。
- 白名单与 select 选项列表保持对齐（ADR-249/252 拆轴后：来源轴 `GROUND_SOURCE_KINDS` = none/solid/canvas/texture，样式轴 `GROUND_CANVAS_STYLES` = plain/marble/sand/grass；统一枚举 `GROUND_SURFACE_MODES` 当前 7 项 = none/solid/plain/marble/sand/grass/texture，旧 9 值已迁出至 `LEGACY_GROUND_MAT_SOURCES` 仅迁移路径消费）。
- `textureButtonsNode` 走 `controls` 通道节点（保 `variant`/`getHint` 语义），非原生 button 节点。
- `visibleWhen` 谓词（B 轨快照驱动）原样挂节点：`paramVisible(param)` 逐参数 × 逐模式判定（`ground-surface-spec.ts|paramIsEffective`），在来源轴/样式轴下对应子控件可见；原 `groundSurfaceOn` 已删除（`paramIsEffective` 对 `none` 全返 false，语义已覆盖）。
- **滑杆值域唯一事实源 = `env-state-schema.ts` 的 `range`**（ADR-283）：全部滑杆（8 材质 + 叠加层 size/opacity + 网格组 size/divisions）一律 `getParamRange("<key>")` 取值域，菜单内零 `min/max/step` 字面量；钳制收口 `setEnvState` 唯一写入口，setter 不再手写 `Math.max/min`（`groundMatGridSize` 的取整单一收口在 cap setter——菜单侧不得重复 `Math.round`，锐评 P6b）。

## 历史问题清单（2026-08-27 ts-package-review）— 已完成修复

1. ~~超 100 行红线~~：抽出工厂后主函数曾降至红线内；2026-08-28 拓展 stripes/diamond/marble 模式 + color2/density/angle 控件后回升超红线。ADR-195 刀2 迁移至 `ground-menu.ts` 后彻底解决（纯声明层，无 THREE 依赖）。
2. ~~重复结构~~：多个 color → `colorNode` 工厂；多个 slider → `sliderNode` 工厂。
3. ~~`as unknown as` 窄化~~：ADR-195 刀2 迁移后 `PreviewMenuNode` 类型完整，无需类型断言。

## 相关

- 兄弟卡：`ground_surface_spec.md`（材质 spec 单源驱动，新增 3 种程序化像素）
- ADR-195（cap 直产 PreviewMenuNode[] 终态）
- ADR-117（ground-material-spec 单一事实源，参数嵌套设计）
- ADR-283（参数值域描述符：schema `range`/`uiRange` 单一事实源，钳制收口 `setEnvState`）
