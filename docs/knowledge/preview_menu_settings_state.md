---
kind: preview_menu_settings_state
name: 3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125）
tier: leaf
category: ui
source_files:
  - frontend/src/utils/3d/state/preview-state.ts
  - frontend/src/utils/3d/adapters/preview-menu-settings.ts
  - frontend/src/utils/3d/adapters/preview-menu-cap-controls.ts
  - frontend/src/utils/3d/caps/scene-capability.ts
tests:
  - frontend/src/utils/3d/state/preview-state.test.ts
use_when:
  - 新增 3D 预览设置项
  - 新增 cap 想让某个开关出现在设置面板
  - 排查设置项改了不生效 / 重开面板值不对
  - 排查条件显隐控件不出现
  - ADR-125 三块落地状态核对
---

# 3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125）

## 概览

ADR-085（菜单单一事实来源）采纳的 S1 注册表、S3 refreshDock 已落地，**S2「状态单向流」只落了 bind 回写，未落统一状态源**——横切设置项各自有独立读写通道，声明式 Schema 的 `control.bind` 因此是死代码。ADR-125 补上这一半，分三块：

| 块 | 内容 | 落点 |
|----|------|------|
| P1 | `settingsState` 横切状态层 | `frontend/src/utils/3d/state/settings-state.ts` |
| P2 | 单渲染器 + 自动 cap 聚合 | `preview-menu-settings.ts` 产出 `MenuControlDef[]` 喂 `renderCapControls` |
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

- 路径类型复用已有 `PreviewStatePath`（`preview-menu-node-types.ts`）；`toStatePath()` 是编译期契约守卫，前缀写错即编译失败。
- cap 派生路径**惰性解析**：每次 `get/set` 都现查 `sceneCapabilityRegistry.getById()`，不在构建期捕获实例。这是 ADR-125 P3 明令禁止的「声明期求值 → cap 后创建则永不可见」（即 `05fe24b7` 所修「水池分组不出现」同类病）的根治点。
- 结构性探测：`hasMethod()` 判断 cap 是否真有 `isEnabled/setEnabled`，冒牌 cap 不误判为可用。

### P2 自动聚合：cap 侧自声明，settings 侧零接线

- `MenuControlDef.settingsOrder?: number` —— **定义了才进设置面板**，升序排列。未定义则不进（否则 pp 的 20 个高级控件会淹没设置页）。
- 新 cap 想进设置面板：只改自己文件加一个 `settingsOrder`，`preview-menu-settings.ts` 不动。
- `collectSettingsCapControls()` 每次调用重取，**抹平 `group`**（设置面板是扁平视图，否则「高级」等折叠 section 会混进来）。
- 已声明：`pp-enabled`(10) / `sky-env`(20) / `wireframe-toggle`(30)。

### P3 visible 规则

只允许两种：① cap 内 `visible`（必须基于自身 params，**禁止跨 cap 探查**）；② 声明式节点 `visibleWhen(s)`（吃状态层快照的纯函数）。禁止在 schema 构建期以 `if (cap)` 做条件插入。

## 对外 API / 入口

```ts
// 状态层
getStateValue(path)                      // 读
setStateValue(path, v, { notify?: false }) // 写（滑块高频传 notify:false）
isPathAvailable(path)                    // cap 派生项在 cap 缺席时 false
settingsSnapshot()                       // 全量快照，供 visibleWhen 纯函数消费
subscribeSettings(listener) → off        // 订阅变更
resetSettingsListeners()                 // 测试隔离
toStatePath(path)                        // 编译期契约守卫

// 设置面板
buildCrossCuttingControls()              // 3 个横切数据节点
collectSettingsCapControls()             // 自动聚合（settingsOrder 升序 + 抹平 group）
buildSettingsControls()                  // 横切 + 聚合，供契约测试断言

// P3
collectVisiblePredicates(controls)       // 纯函数，枚举带 visible 的控件
```

## 与其他子系统关系

- **ADR-085**：本卡是其 S2 的补全，S1/S3 仍有效（`refreshDock` 在 `preview-menu.ts`）。
- **`05fe24b7` 手工 refresh 链路**（`SceneCapability.subscribe?` + `rebuildEnvSubs` + `menu.refresh()`）：P1 的 `subscribeSettings` 是它的替代方向，但**尚未接入**——env 局部刷新仍在用旧链路，迁移是遗留项。
- **`renderCapControls`**：唯一的控件渲染器，10 种 kind + group 折叠 + visible 过滤。A 层 `renderPreviewSchemaContent` 只实现 sectionTitle/divider/field，其余仍走 `renderCustom`（本 ADR 不扩展）。
- **`restoreFields()`**（`scene-capability.ts`）：顺带收敛了各 cap `loadState` 的 `typeof` 样板，消除 `ground#sky` 的 jscpd 10 行重复块。**目前仅 sky-capability 接入**，ground/water 待跟进。

## 不变量

1. 六条路径的读写必须经状态层，**不得**在菜单侧直接 `safeSet` 那两个 localStorage 键。
2. cap 派生路径**永不落盘**——双写即双源。
3. `settingsOrder` 是控件进设置面板的**唯一**开关；settings 侧不得手写 cap 已自报的控件（契约测试锁定 `settings-bloom` / `settings-pmrem` / `settings-wireframe` 三个 id 永不出现）。
4. `collectSettingsCapControls()` 不得缓存 cap 实例。
5. 新增设置项 = 加一行数据，不是加一个 20-30 行 `renderCustom` 闭包。

## 相关

- ADR-125（本决策）、ADR-085（S2 补全对象）、ADR-076（菜单壳）、ADR-093（声明式 Schema 类型来源）
- 契约测试：`frontend/src/utils/3d/state/settings-state.test.ts`（20 例）
- 历史病征：`f0fa3e23`（cap 已自报却手写 29 行重复 toggle）、`05fe24b7`（无状态层可订阅 → 手工 pub/sub）、`7fdfdcc7`（visible 谓词散落无清单）
- 遗留：`auto-import.mjs` 对 ground/water 的 `private notify()` 报 2 条误判（`05fe24b7` 引入，非本卡范围）
