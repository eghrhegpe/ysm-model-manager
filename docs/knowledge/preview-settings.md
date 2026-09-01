---
kind: preview-settings
name: 预览面板设置与显示控制
tier: architecture
adr:
  - ADR-132
category: feature
source_files:
  - frontend/src/views/app-preview/shot-panel-shared.ts
  - frontend/src/views/app-preview/skeleton-render.ts
  - frontend/src/views/app-preview/skeleton-utils.ts
  - frontend/src/views/app-preview/skeleton-fill-panel.ts
  - frontend/src/views/app-preview/skeleton.ts
  - frontend/src/views/app-preview/zoom.ts
  - frontend/src/views/app-preview/utils.ts
  - frontend/src/views/app-preview/index.ts
  - frontend/src/views/app-preview/model2d/model2d.ts
  - frontend/src/preview-3d/state/preview-state.ts
  - frontend/src/preview-3d/render-budget.ts
tests:
  - frontend/src/preview-3d/decoder/utils.test.ts
  - frontend/src/preview-3d/render-budget.test.ts
  - frontend/src/preview-3d/state/preview-state.test.ts
  - frontend/src/test-utils/index.test.ts
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-preview/model2d/model2d.test.ts
  - frontend/src/views/app-preview/skeleton-fill-panel.test.ts
  - frontend/src/views/app-preview/skeleton-render.test.ts
  - frontend/src/views/app-preview/skeleton.test.ts
  - frontend/src/views/app-preview/utils.test.ts
  - frontend/src/views/app-preview/zoom.test.ts
  - frontend/src/views/app-sync-manager/index.branches.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/index.extra.test.ts
  - frontend/src/views/context-menu/index.test.ts
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 预览设置、显示控制、骨骼名称开关
  - 帧率 / 像素比 / 视锥剔除 / 3D 偏好
  - 截图灯光、activeComponent、组件选择
quick_risk_lines:
  - 预览设置集中由 preview-state.ts 的 KNOWN_PATHS 注册管理，新增选项必须经注册而非直接读写状态
pitfalls:
  - 直接改 preview-state 未注册字段 → 切页/换模后状态回滚、选项失效；应走 KNOWN_PATHS
  - 截图灯光与预览灯光混用 → 导出 PNG 与实时预览不一致；截图灯光必须走 shot-panel 独立通道
use_when:
  - 预览设置
  - 显示控制
  - 骨骼名称
  - 帧率
  - 截图灯光
invariant_anchors:
  - frontend/src/preview-3d/state/preview-state.ts|KNOWN_PATHS
  - frontend/src/preview-3d/state/preview-state.ts|setStateValue
  - frontend/src/views/app-preview/skeleton-render.ts|buildToggleRow
  - frontend/src/preview-3d/render-budget.ts|MAX_FPS_DEFAULT
---

# 预览面板设置与显示控制

## 概览

> **重要前提**：预览面板设置**不是单一 settings 面板**，而是分散在 **3 域**（2D 显示控制 / 3D 全域状态层 / 截图 & 填充面板）。本 feature 卡汇总三域设置项的语义、持久化点、广播契约与相互依赖，给入开发者一个完整认知。

## 三域总览

### 域一：2D 显示控制
- `skeleton.ts` / `skeleton-render.ts` / `model2d.ts` / `zoom.ts`
- **骨骼名称可见性**（`ysm_showBoneLabels` localStorage，默认 `true`）
- **3D 偏好切换**（模块级 `_prefer3D`，跨模型保留；ESC/关闭时用户主动关闭才清）
- **2D 画布缩放/旋转**（`renderModel2D` 的 zoom/rotation，无持久化，交互态）
- **全屏放大预览**（`openFullPreview`，独立 overlay，滚轮缩放 + 拖拽旋转）

### 域二：3D 全域状态层
- `preview-3d/state/preview-state.ts`（ADR-126 P4-A 升格；ADR-129 第一刀归位）
- 10 条已落地横切设置路径（`KNOWN_PATHS`）：
  - 直管 localStorage：`render.maxFps`（60）、`render.maxPixelRatio`（1.5）、`render.frustumCull`
  - cap 派生（不落盘）：`render.bloom` / `render.wireframe` / `env.pmrem` / `env.waterMode` / `env.groundMatSource`
  - per-scene 会话态（不落盘）：`ui.activeComponent`（`-1 = All`）

### 域三：截图 & 填充面板
- `shot-panel-shared.ts`（6 角度按钮）、`skeleton-render.ts`（`saveScreenshot`）、`skeleton-fill-panel.ts`（组件选择 + 统计 + 纹理）
- 截图灯光从 `LightCapability` 派生（"所见即所得"），缺省回退标准灯
- 模型填充面板：组件选择（`sessionActiveComponent` 闭包）、骨骼/立方体数统计、纹理声明 vs 加载尺寸

## 持久化键（真实存在）

| 键 | 语义 | 默认 | 来源 |
|------|------|------|------|
| `ysm_showBoneLabels` | 2D 骨骼名显示 | `true`（未存即开） | `skeleton-render.ts::buildToggleRow` |
| `ysm_3d_maxFps` | 帧率上限（0=不限，负数回退 60） | `60` | `render-budget.ts` |
| `ysm_3d_maxPixelRatio` | 像素比上限（clamp [0.5, 2]） | `1.5` | `render-budget.ts` |

> `render.bloom` / `render.wireframe` / `env.pmrem` / `env.waterMode` / `env.groundMatSource` 由对应 `SceneCapability` 自行 `saveState`，状态层**不落盘**（ADR-125 P1 防双写红线）；`ui.activeComponent` 是 per-scene 会话态，`resetActiveComponent()` 在预览 dispose 时复位。

## 设置项清单

| 名称 | 作用 | 默认 | 来源文件 |
|------|------|------|---------|
| 骨骼名称显示 | 2D 图是否显示骨骼文字 | `true` | `skeleton-render.ts::buildToggleRow` |
| 3D 偏好 | 是否默认打开 3D 预览（跨模型保留；主动关闭清） | `false` | `skeleton.ts` / `utils.ts::_prefer3D` |
| 2D 缩放 | 画布缩放系数（交互态，滚轮，[0.2,10]） | `1` | `skeleton.ts` / `zoom.ts` |
| 2D 旋转 | 画布 Y 轴旋转（交互态，拖拽，模 360） | `0` | `skeleton.ts` / `zoom.ts` |
| 帧率上限 | 3D 渲染节流（0=不限） | `60` | `render-budget.ts` |
| 像素比上限 | 渲染分辨率上限（clamp [0.5,2]） | `1.5` | `render-budget.ts` |
| 视锥剔除 | `render.frustumCull`（状态层直管） | 待确认 | `preview-state.ts` |
| Bloom 后处理 | `render.bloom`（postprocessing cap 派生） | `false` | `preview-state.ts` |
| 线框模式 | `render.wireframe`（wireframe cap） | `false` | `preview-state.ts` |
| PMREM 环境 | `env.pmrem`（sky cap） | `false` | `preview-state.ts` |
| 水面模式 | `env.waterMode` | `"film"` | `preview-state.ts` |
| 地面材质源 | `env.groundMatSource` | `"none"` | `preview-state.ts` |
| 组件选择 | `ui.activeComponent`（per-scene 会话态） | `-1` | `preview-state.ts` / `ysm-controls.ts` |
| 截图角度 | 6 键（`current/front/45/side/back45/all`） | — | `shot-panel-shared.ts` |
| 截图灯光 | 三点布光，从 LightCapability 派生 | 缺省标准灯 | `screenshot-lights.ts` |
| MMD 播放/动作 | 播放/暂停 + 多 clip 选择 | 首 clip | `mmd-controls.ts::playNodes` |

## 广播契约

- **离散操作**走 `setStateValue(path, v)` → `notify(path)` → 触发 `subscribeSettings` 回调（用于 `visibleWhen(s) => boolean` 谓词重算 + panel 重渲染）
- **高频滑块必须 `setStateValue(path, v, {notify:false})`**，否则每像素触发面板重算（沿用 SceneCapability 约定）

## 与其他子系统关系

- **与 `app-preview/index.ts`**：主组件是派发层（`PREVIEW_HANDLERS` 按 `RESOURCE_TYPES` 分派），不持有具体设置；设置持久化分散在各子模块
- **与 `model2d/model2d.ts`**：`renderModel2D` 渲染核心无设置态，设置项（`ysm_showBoneLabels`）的存储读写在 `skeleton-render.ts::buildToggleRow`
- **与 `model3d-loader.ts` / 各 adapter**：`skeleton-fill-panel.ts::fill3DPanel` 消费 `Model3DHandleX`/`YsmContentHandle`
- **与 `preview-3d/state/preview-state.ts`**：本模块唯一状态源，`visibleWhen` 谓词统一消费 `previewSnapshot()`；YSM model 面板 schema 读 `snapshot["ui.activeComponent"]` 作回退
- **与 `preview-3d/caps/*`**：`preview-state.ts` 的 cap 派生路径惰性解析 cap（不持有实例）；`screenshot-lights.ts` 从 `LightCapability` 提取截图灯光
- **与 `utils-export` / `preview-controls` / `export`**：截图面板共享按钮（`shot-panel-shared.ts`）被 preview-controls 装配；截图链路（`screenshot.ts`/`screenshot-render.ts`/`screenshot-lights.ts`）由 export 卡详述

## 不变量

- **状态层双写红线**：cap 派生项（`render.bloom` 等）状态层不落盘——cap 自己 `saveState`；直管项（`maxFps`/`maxPixelRatio`/`frustumCull`）由状态层直管 localStorage；`ui.activeComponent` 是会话态内存值
- **路径契约**（ADR-129）：`PreviewStatePath = typeof KNOWN_PATHS[number]`；新增路径必须「扩 `KNOWN_PATHS` + 填 `bindings`」两步走，否则编译失败
- **`ui.activeComponent` 会话态隔离**（ADR-126 P5-B2）：真源是 `registerYsmModelSchema(sessionId)` 内的 per-scene 闭包 `sessionActiveComponent`（不再读全局状态层）；预览 dispose 时 `unregisterSchema` 注销 + 关闭钩子清理；`resetActiveComponent()` 复位模块级 `_activeComponent = -1`，防跨预览陈旧下标越界
- **截图能力守卫**：`screenshotFn === null`（MMD 无活跃 renderer）→ `shotButtonNodes` 返回 `[]`；`=== undefined`（YSM ctx 可选字段缺省）→ 仍返回 6 按钮，走 `saveScreenshot` 的 `renderMultiAngle` fallback
- **截图幂等**：`makeShotAction` 内 `let saving=false` 防连点；`saveScreenshot` 对空返回抛错（陷阱 #3：异步失败须可观测），上层 catch 后 toast
- **3D 关闭语义**（ADR-057 §2.5）：用户主动关闭（ESC/✕/返回键）→ `setPrefer3D(false)`；切模型自动关层 → 保留 `_prefer3D`
- **截图灯光"所见即所得"**（ADR-126 P5）：`toScreenshotLights` 从预览 `LightCapability` 提取；三点全关 = 用户刻意暗场景，截图必须保持暗；cap 缺失时才回退标准灯
- **`render.bloom=false` 只做总闸关闭**（低档保性能），`=true` 不强制打开——尊重 per-type 门禁
- **存储必须走 `safeGet`/`safeSet`**（ADR-044 隐私模式红线），不得裸调 `localStorage`

## 相关

- [app-preview](./app-preview.md) — 预览面板组件入口
- [preview_core](./preview_core.md) — 3D 预览核心外壳
- [preview-controls](./preview-controls.md) — 3D 控制器（截图按钮/材质/播放）
- [export](./export.md) — 截图导出功能链路
- [utils-export](./utils-export.md) — 截图/缓存工具函数层
