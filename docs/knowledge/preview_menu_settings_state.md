---
kind: preview_menu_settings_state
name: 3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125）
tier: leaf
category: ui
source_files:
  - frontend/src/preview-3d/state/preview-state.ts
  - frontend/src/preview-3d/menu/panels/settings.ts
  - frontend/src/preview-3d/menu/render/cap-controls.ts
  - frontend/src/preview-3d/caps/scene-capability.ts
auto_fields:
  symbols_with_lines:
    - bindFieldRestorers
    - buildCameraSchema
    - buildCrossCuttingNodes
    - buildLightingSchema
    - buildPostprocessingSchema
    - buildSettingsControls
    - buildSettingsSchema
    - buildShadowSchema
    - CapabilityId
    - CapabilityMap
    - CapControlView
    - capLabel
    - collectSettingsCapControls
    - collectVisiblePredicates
    - disposeSceneCapSubscriptions
    - EnvPlacement
    - EnvSectionId
    - FieldKind
    - FieldRestorer
    - formatCapSliderValue
    - getStateValue
    - getTypedCap
    - GROUND_LAYER_OFFSETS
    - isPathAvailable
    - KNOWN_PATHS
    - oneOf
    - PathInput
    - PathValue
    - persistState
    - pickPersistFields
    - previewSnapshot
    - PreviewSnapshot
    - PreviewStatePath
    - renderCapColor
    - renderCapControls
    - renderCapSelect
    - renderCapSlider
    - renderCapToggle
    - resetSettingsListeners
    - restoreFields
    - restoreState
    - ringLog
    - SceneCapability
    - SceneCapabilityLookup
    - setPreviewUiMode
    - setSceneCapabilityLookup
    - setStateValue
    - subscribeSettings
    - toStatePath
  tests:
    - frontend/src/preview-3d/state/preview-state.test.ts
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 新增 3D 预览设置项、新增 cap 让开关出现在设置面板
  - 排查设置项改了不生效 / 重开面板值不对
  - 条件显隐控件不出现
  - ADR-125 三块落地状态核对
quick_risk_lines:
  - 3D 预览设置必须走 preview-state 的 KNOWN_PATHS 注册 + 自动 cap 聚合，禁止横切设置项各自有独立读写通道
pitfalls:
  - 横切设置项各自有独立读写通道 → 状态单向流失效、菜单控件与状态不同步；必须走 preview-state
  - cap 未自动聚合 → 新增 cap 后菜单缺控件；必须在 cap 实现 getMenuControls 并注册

use_when:
  - 新增 3D 预览设置项
  - 新增 cap 想让某个开关出现在设置面板
  - 排查设置项改了不生效 / 重开面板值不对
  - 排查条件显隐控件不出现
  - ADR-125 三块落地状态核对
status: active
---

# 3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125）

## 概览

ADR-085（菜单单一事实来源）采纳的 S1 注册表、S3 refreshDock 已落地，**S2「状态单向流」只落了 bind 回写，未落统一状态源**——横切设置项各自有独立读写通道，声明式 Schema 的 `control.bind` 因此是死代码。ADR-125 补上这一半，分三块：

| 块 | 内容 | 落点 |
|----|------|------|
| P1 | `settingsState` 横切状态层（[ADR-126 P4-A] 已升格为 `previewState`） | `frontend/src/preview-3d/state/preview-state.ts` |
| P2 | 单渲染器 + 自动 cap 聚合 | `preview-menu/settings.ts` 产出控件定义喂 `renderCapControls` |
| P3 | visible 规则定死 | 控件 visibleWhen / `collectVisiblePredicates()` |

## 核心职责

### P1 状态层：六条路径，一个读写口

| 路径 | 来源 | 持久化 |
|------|------|--------|
| `render.frustumCull` | `isFrustumCullEnabled/setFrustumCullEnabled`（`frustum-cull.ts`） | 本层管（键 `ysm_3d_frustumCull`） |
| `render.maxFps` | `MAX_FPS_KEY` | 本层管，写入后**必须** `invalidateMaxFpsCache()`（rAF 热路径有模块级缓存） |
| `render.maxPixelRatio` | `MAX_PIXEL_RATIO_KEY` | 本层管 |
| `render.wireframe` | RenderModeCapability `rm-wireframe`（幽灵船 `wireframe-toggle` 已收口） | 不落盘 |
| `env.pmrem` | sky cap `sky-env` | 不落盘 |

> **[ADR-250] `render.bloom` 已退场**（原「postprocessing cap `pp-enabled`」，不落盘）。它经 `setMasterEnabled` 写 cap 私有总闸，与 per-type 门禁二元相与构成「一枚字段三重语义」，且档位切换会覆盖用户手动开关。后处理是视觉项（与 wireframe/pmrem 同类），开关唯一入口 = cap 自报的 `pp-enabled` 控件写 `envState.ppEnabled`。

- 路径类型复用已有 `PreviewStatePath`（`state/preview-state.ts`，ADR-129 第一刀自 `preview-menu/node-types.ts` 归位）；`toStatePath()` 是编译期契约守卫，前缀写错即编译失败。
- cap 派生路径**惰性解析**：每次 `get/set` 都现查 `sceneCapabilityRegistry.getById()`，不在构建期捕获实例。这是 ADR-125 P3 明令禁止的「声明期求值 → cap 后创建则永不可见」（即 `05fe24b7` 所修「水池分组不出现」同类病）的根治点。
- 结构性探测：`hasMethod()` 判断 cap 是否真有 `isEnabled/setEnabled`，冒牌 cap 不误判为可用。（原 `toggleCap()` 工厂随 `render.bloom` 退表一并删除——其唯一消费方即该路径。）

### P2 自动聚合：cap 侧自声明，settings 侧零接线

- `PreviewControlDef.settingsOrder?: number` —— **定义了才进设置面板**，升序排列。未定义则不进（否则 pp 的 20 个高级控件会淹没设置页）。
- 新 cap 想进设置面板：只改自己文件加一个 `settingsOrder`，`preview-menu/settings.ts` 不动。
- `collectSettingsCapControls()` 每次调用重取，**抹平 `group`**（设置面板是扁平视图，否则「高级」等折叠 section 会混进来）。
- 已声明：RenderModeCapability 五件套 `rm-wireframe`(30) / `rm-blending`(31) / `rm-depth-test`(32) / `rm-side`(33) / `rm-depth-write`(34)。（pp-enabled / sky-env 曾声明 10/20，已退场：总开关归各自面板基座级，设置页画质分组不再复制——见 postprocessing-capability / sky-capability。）

### P3 visible 规则

只允许两种：① cap 内 `visible`（必须基于自身 params，**禁止跨 cap 探查**）；② 声明式节点 `visibleWhen(s)`（吃状态层快照的纯函数）。禁止在 schema 构建期以 `if (cap)` 做条件插入。

### 性能档位（P4 延续：薄壳版，`perf-presets.ts`）

一键性能档位 = **纯数据表 + 通用套用器**，刻意规避隔壁 MikuMikuAR 的坑（每个模式手写参数映射 + Go 绑定 + custom 档手动 reRender）：

- `PERF_PRESETS`：低/中/高三档 → `StatePath → 值`（路径类型 `typeof KNOWN_PATHS[number]` 编译期守卫）。只控有状态层路径的性能项：`render.maxFps` / `render.maxPixelRatio`。wireframe/pmrem/**bloom** 是视觉项不进表；frustumCull 是纯优化（无画质损失）恒开不进表。
- `applyPerfPreset(level)`：遍历表走 `setStateValue`（cap 缺席的派生路径静默跳过）；**custom 不套用**（保持用户手调，零副作用）。
- `setPerfPreset(level)`：持久化（键 `ysm_3d_perfPreset`）+ 套用；`getPerfPreset()` 无存档回 `medium`。
- 设置面板性能组**顶部**档位 select（低/中/高/自定义，`settings-perf-preset` 节点），切档套用后 `menu?.refresh()` 刷新兄弟控件显示。
- 进入预览时 `mount-preview-core` 在 `loadAll → applyModelPreset(模型类别)` **之后**调 `applyPerfPreset(getPerfPreset())`——用户显式档位最后覆盖模型预设。

### P5 归属判定：横切项 vs cap 自报项（2026-09-07 翻明）

settings 面板是**聚合器**：横切项（P1 本层管）与 cap 自报项（P2 带 settingsOrder）都被转成 `PreviewMenuNode[]` 进同一张面板，渲染走同一 renderMenu——**看起来一样，底下是两套状态层 + 两套键轨**。新增"渲染设置"开关时，归属判定口诀：

> **跟某一 cap 能力绑定（该 cap 的显隐/生命周期/守卫驱动它）→ 该 cap 自报（加 `settingsOrder`）；与具体能力无关的全局显示/性能设置 → 横切（preview-state 本层管）。**

分界判据（自上而下问三句，任一句命中"cap"即归 cap）：
1. **有无能力宿主**——它是否为某 cap 的能力/参数（wireframe→render-mode、bloom→postprocessing、pmrem→sky）？是 → cap。
2. **有无预设仲裁需求**——需不需要被 model 预设 (auto-model) / 用户手动 (manual) 仲裁（应属 cap 的 `lastWriteSource` 守卫）？需要 → cap。
3. **有无 cap 私有状态依赖**——依赖 `this.enabled` / `isStateLoaded` 等 cap 私有运行时态？依赖 → cap。
全部否定 → 横切（frustumCull/maxFps/maxPixelRatio 即此例：无宿主、无仲裁、无私有态）。

> **[ADR-250] 判据落点修订**：bloom 经该三句判定归 cap——**且该判定被证明是对的**，但当时的实现把它落成了「cap 私有总闸字段 + 与门禁相与」，由此产生三重语义。现 bloom 归 cap 的形式改为 **cap 自报控件（`pp-enabled`）写 `envState.ppEnabled`**：仍属 cap 域（判据不变），但真值源在统一状态层，不再有 cap 私有字段参与仲裁。

**历史动机 vs 规则**：frustumCull/maxFps/maxPixelRatio 归横切是 ADR-125 P1 时代"settings-state"遗产（无 cap 归属）；wireframe 等归 cap 是同一能力注销时"真值源归属 cap"。规则把历史分歧收敛为可判定口诀，避免新增设置主观选边。

**已知缝隙已闭合（ADR-250）**：原记录「preview-state 兼作状态 + 转发代理——`render.bloom` 经 set 转发给 postprocessing cap 的 `setMasterEnabled`，本层不落盘」。该代理 path 已随 `render.bloom` 退表删除，本层不再有任何「转发给 cap 私有字段」的路径——**新能力级开关一律走 P2 cap 自报控件 + `envState` 参数**，不复制进本层（该约束继续有效）。

## 对外 API / 入口

```ts
// 状态层
getStateValue(path)                      // 读
setStateValue(path, v, { notify?: false }) // 写（滑块高频传 notify:false）
isPathAvailable(path)                    // cap 派生项在 cap 缺席时 false
previewSnapshot()                        // 全量快照，供 visibleWhen 纯函数消费（[ADR-126 P4-A] 升格名）
subscribeSettings(listener) → off        // 订阅变更
resetSettingsListeners()                 // 测试隔离
toStatePath(path)                        // 编译期契约守卫

// 设置面板
buildCrossCuttingNodes()                 // 3 个横切数据节点（直产 PreviewMenuNode，桥接层退役）
collectSettingsCapControls()             // 自动聚合（settingsOrder 升序 + 抹平 group）
buildSettingsControls()                  // 横切 + 聚合，供契约测试断言

// 性能档位（perf-presets.ts，薄壳版）
PERF_PRESETS                             // 三档数据表（low/medium/high → 路径值）
getPerfPreset() / setPerfPreset(level)   // 档位读写（持久化 ysm_3d_perfPreset + 套用）
applyPerfPreset(level)                   // 数据表套用（custom 不套用）

// P3
collectVisiblePredicates(controls)       // 纯函数，枚举带 visible 的控件
```

## 与其他子系统关系

- **ADR-085**：本卡是其 S2 的补全，S1/S3 仍有效（`refreshDock` 在 `preview-menu/core.ts`）。
- **`05fe24b7` 手工 refresh 链路**（`SceneCapability.subscribe?` + `rebuildEnvSubs` + `menu.refresh()`）：P1 的 `subscribeSettings` 是它的替代方向，但**尚未接入**——env 局部刷新仍在用旧链路，迁移是遗留项。
- **`renderCapControls`**：controls 通道的**复杂件**渲染器（增量2a 起 `PreviewControlKind` 收窄为 5 种复杂 kind：button/image/timeline/histogram/preset-thumb）+ group 折叠 + visibleWhen 过滤；简单件（slider/toggle/select/color）不再经此通道，改由 `renderMenu` 节点原生 kind → `nodeControlToView` → `CapControlView` → `renderCap*` 渲染器直渲。**2026-09 归一**：cap 控件经 `PreviewMenuNode.controls`（`node-types.ts` 新 kind）原生进声明式节点树，settings/env 面板不再 `renderCustom` 套壳手调；`renderPreviewSchemaContent` 已删（其 field/divider/sectionTitle/controls/renderCustom 分支统一收编进 `renderMenu`，schema 面板路径传 `renderCustomDirect: true` 让 custom 直接填充）。
- **`restoreFields()`**（`scene-capability.ts`）：顺带收敛了各 cap `loadState` 的 `typeof` 样板，消除 `ground#sky` 的 jscpd 10 行重复块。**目前仅 sky-capability 接入**，ground/water 待跟进。

## 不变量

1. 六条路径的读写必须经状态层，**不得**在菜单侧直接 `safeSet` 那两个 localStorage 键。
2. cap 派生路径**永不落盘**——双写即双源。
3. `settingsOrder` 是控件进设置面板的**唯一**开关；settings 侧不得手写 cap 已自报的控件（契约测试锁定 `settings-bloom` / `settings-pmrem` / `settings-wireframe` 三个 id 永不出现）。
4. `collectSettingsCapControls()` 不得缓存 cap 实例。
5. 新增设置项 = 加一行数据，不是加一个 20-30 行 `renderCustom` 闭包。

## e2e 覆盖边界

3D 预览菜单（slide menu）的交互断言在 e2e 环境**不可行**：mock 数据下 `showModelDetail` 走 catch 分支、`loadModel2D` 在 throw 之前不会被调用，故 `btn-3d-preview` 的 onclick 不绑定（3D 不挂载，`preview.spec.ts` 注释实证），无 GPU 环境 WebGL 又 `test.skip`。故设置面板（含性能档位 select）的断言**由 vitest 层完整覆盖**（`preview-state.test` 面板接入 + `perf-presets.test` 切档语义/持久化/custom），不补「no-op 点击」类假断言。

**注（2026-09-16，ADR-253 D5）**：`loadModel2D` 内部三条错误路径（`loadModelData` 抛错 / 无 bones / 容器被移除）原先也不绑定 FAB，已改为在 2D 加载前同步绑定。但本节所述 e2e 场景（`showModelDetail` 自身 catch → **根本不调用** `loadModel2D`）**不受该修复影响**，`preview.spec.ts` 的注释与断言仍然成立；要覆盖该路径需走 ADR-253 D4（`showResourcePack`/YSM 详情收编 `showCard`，渲染期同步绑 `wireFab`）。

## 相关

- ADR-125（本决策）、ADR-085（S2 补全对象）、ADR-076（菜单壳）、ADR-093（声明式 Schema 类型来源）
- 契约测试：`frontend/src/preview-3d/state/preview-state.test.ts`（20 例，[ADR-126 P4-A] 随迁改名）
- 历史病征：`f0fa3e23`（cap 已自报却手写 29 行重复 toggle）、`05fe24b7`（无状态层可订阅 → 手工 pub/sub）、`7fdfdcc7`（visible 谓词散落无清单）
- 遗留：`auto-import.mjs` 对 ground/water 的 `private notify()` 报 2 条误判（`05fe24b7` 引入，非本卡范围）
