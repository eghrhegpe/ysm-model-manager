---
kind: preview_menu_settings_state
name: 3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125）
tier: leaf
category: ui
source_files:
  - frontend/src/preview-3d/state/preview-state.ts
  - frontend/src/preview-3d/menu/settings.ts
  - frontend/src/preview-3d/menu/cap-controls.ts
  - frontend/src/preview-3d/caps/scene-capability.ts
auto_fields:
  symbols_with_lines:
    - buildCameraSchema:33
    - buildCrossCuttingControls:106
    - buildLightingSchema:47
    - buildPostprocessingSchema:70
    - buildSettingsControls:171
    - buildSettingsSchema:79
    - buildShadowSchema:61
    - collectSettingsCapControls:158
    - collectVisiblePredicates:457
    - createListenerSet:209
    - FieldRestorer:159
    - formatCapSliderValue:101
    - getStateValue:300
    - isPathAvailable:325
    - KNOWN_PATHS:53
    - MenuControlDef:17
    - MenuControlKind:14
    - persistState:143
    - previewSnapshot:334
    - PreviewSnapshot:82
    - PreviewStatePath:74
    - renderCapControls:461
    - resetActiveComponent:269
    - resetSettingsListeners:341
    - restoreFields:175
    - restoreState:148
    - SceneCapability:95
    - SceneCapabilityLookup:91
    - setStateValue:309
    - subscribeSettings:279
    - toStatePath:90
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
| P2 | 单渲染器 + 自动 cap 聚合 | `preview-menu/settings.ts` 产出 `MenuControlDef[]` 喂 `renderCapControls` |
| P3 | visible 规则定死 | `MenuControlDef.visible` / `collectVisiblePredicates()` |

## 核心职责

### P1 状态层：六条路径，一个读写口

| 路径 | 来源 | 持久化 |
|------|------|--------|
| `render.frustumCull` | `isFrustumCullEnabled/setFrustumCullEnabled`（`frustum-cull.ts`） | 本层管（键 `ysm_3d_frustumCull`） |
| `render.maxFps` | `MAX_FPS_KEY` | 本层管，写入后**必须** `invalidateMaxFpsCache()`（rAF 热路径有模块级缓存） |
| `render.maxPixelRatio` | `MAX_PIXEL_RATIO_KEY` | 本层管 |
| `render.bloom` | postprocessing cap `pp-enabled` | **不落盘**（cap 存自己的域） |
| `render.wireframe` | wireframe cap `wireframe-toggle` | 不落盘 |
| `env.pmrem` | sky cap `sky-env` | 不落盘 |

- 路径类型复用已有 `PreviewStatePath`（`state/preview-state.ts`，ADR-129 第一刀自 `preview-menu/node-types.ts` 归位）；`toStatePath()` 是编译期契约守卫，前缀写错即编译失败。
- cap 派生路径**惰性解析**：每次 `get/set` 都现查 `sceneCapabilityRegistry.getById()`，不在构建期捕获实例。这是 ADR-125 P3 明令禁止的「声明期求值 → cap 后创建则永不可见」（即 `05fe24b7` 所修「水池分组不出现」同类病）的根治点。
- 结构性探测：`hasMethod()` 判断 cap 是否真有 `isEnabled/setEnabled`，冒牌 cap 不误判为可用。
- **`render.bloom` 总闸语义（2026-08-29 审核修复）**：性能档位写入 = 总闸。`false` 关全部；`true` 尊重 per-type 门禁（`params.enabled`）不强制打开（防 YSM/车万女仆爆亮）。实现走 cap 的 `setMasterEnabled`（只写生效开关、**不抹门禁**，总闸 off→on 循环可恢复），缺该方法/`getParams`（旧实现/测试 fake）时结构化回退 `setEnabled(Boolean(v))`——不做硬转，防运行期炸裂。

### P2 自动聚合：cap 侧自声明，settings 侧零接线

- `MenuControlDef.settingsOrder?: number` —— **定义了才进设置面板**，升序排列。未定义则不进（否则 pp 的 20 个高级控件会淹没设置页）。
- 新 cap 想进设置面板：只改自己文件加一个 `settingsOrder`，`preview-menu/settings.ts` 不动。
- `collectSettingsCapControls()` 每次调用重取，**抹平 `group`**（设置面板是扁平视图，否则「高级」等折叠 section 会混进来）。
- 已声明：`pp-enabled`(10) / `sky-env`(20) / `wireframe-toggle`(30)。

### P3 visible 规则

只允许两种：① cap 内 `visible`（必须基于自身 params，**禁止跨 cap 探查**）；② 声明式节点 `visibleWhen(s)`（吃状态层快照的纯函数）。禁止在 schema 构建期以 `if (cap)` 做条件插入。

### 性能档位（P4 延续：薄壳版，`perf-presets.ts`）

一键性能档位 = **纯数据表 + 通用套用器**，刻意规避隔壁 MikuMikuAR 的坑（每个模式手写参数映射 + Go 绑定 + custom 档手动 reRender）：

- `PERF_PRESETS`：低/中/高三档 → `StatePath → 值`（路径类型 `typeof KNOWN_PATHS[number]` 编译期守卫）。一期只控有状态层路径的性能项：`render.maxFps` / `render.maxPixelRatio` / `render.bloom`。wireframe/pmrem 是视觉项不进表；frustumCull 是纯优化（无画质损失）恒开不进表。
- `applyPerfPreset(level)`：遍历表走 `setStateValue`（cap 缺席的派生路径静默跳过）；**custom 不套用**（保持用户手调，零副作用）。
- `setPerfPreset(level)`：持久化（键 `ysm_3d_perfPreset`）+ 套用；`getPerfPreset()` 无存档回 `medium`。
- 设置面板性能组**顶部**档位 select（低/中/高/自定义，`settings-perf-preset` 节点），切档套用后 `menu?.refresh()` 刷新兄弟控件显示。
- 进入预览时 `mount-preview-core` 在 `loadAll → setPreset(模型类别)` **之后**调 `applyPerfPreset(getPerfPreset())`——用户显式档位最后覆盖模型预设。

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
buildCrossCuttingControls()              // 3 个横切数据节点
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
- **`renderCapControls`**：唯一的控件渲染器，10 种 kind + group 折叠 + visible 过滤。**2026-09 归一**：cap 控件经 `PreviewMenuNode.controls`（`node-types.ts` 新 kind）原生进声明式节点树，settings/env 面板不再 `renderCustom` 套壳手调；`renderPreviewSchemaContent` 已删（其 field/divider/sectionTitle/controls/renderCustom 分支统一收编进 `renderMenu`，schema 面板路径传 `renderCustomDirect: true` 让 custom 直接填充）。
- **`restoreFields()`**（`scene-capability.ts`）：顺带收敛了各 cap `loadState` 的 `typeof` 样板，消除 `ground#sky` 的 jscpd 10 行重复块。**目前仅 sky-capability 接入**，ground/water 待跟进。

## 不变量

1. 六条路径的读写必须经状态层，**不得**在菜单侧直接 `safeSet` 那两个 localStorage 键。
2. cap 派生路径**永不落盘**——双写即双源。
3. `settingsOrder` 是控件进设置面板的**唯一**开关；settings 侧不得手写 cap 已自报的控件（契约测试锁定 `settings-bloom` / `settings-pmrem` / `settings-wireframe` 三个 id 永不出现）。
4. `collectSettingsCapControls()` 不得缓存 cap 实例。
5. 新增设置项 = 加一行数据，不是加一个 20-30 行 `renderCustom` 闭包。

## e2e 覆盖边界

3D 预览菜单（slide menu）的交互断言在 e2e 环境**不可行**：mock 数据下 `showModelDetail` 走 catch 分支、不绑定 `btn-3d-preview` 的 onclick（3D 不挂载，`preview.spec.ts` 注释实证），无 GPU 环境 WebGL 又 `test.skip`。故设置面板（含性能档位 select）的断言**由 vitest 层完整覆盖**（`preview-state.test` 面板接入 + `perf-presets.test` 切档语义/持久化/custom），不补「no-op 点击」类假断言。

## 相关

- ADR-125（本决策）、ADR-085（S2 补全对象）、ADR-076（菜单壳）、ADR-093（声明式 Schema 类型来源）
- 契约测试：`frontend/src/preview-3d/state/preview-state.test.ts`（20 例，[ADR-126 P4-A] 随迁改名）
- 历史病征：`f0fa3e23`（cap 已自报却手写 29 行重复 toggle）、`05fe24b7`（无状态层可订阅 → 手工 pub/sub）、`7fdfdcc7`（visible 谓词散落无清单）
- 遗留：`auto-import.mjs` 对 ground/water 的 `private notify()` 报 2 条误判（`05fe24b7` 引入，非本卡范围）
