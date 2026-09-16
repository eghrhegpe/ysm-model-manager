---
kind: preview-controls
name: 3D 预览控制器（声明式菜单节点）
tier: architecture
adr:
  - ADR-127
  - ADR-132
  - ADR-253
category: feature
source_files:
  - frontend/src/views/app-preview/mmd-controls.ts
  - frontend/src/views/app-preview/vrm-controls.ts
  - frontend/src/views/app-preview/ysm-controls.ts
  - frontend/src/views/app-preview/detail-3d.ts
  - frontend/src/views/app-preview/view-shell.ts
  - frontend/src/views/app-preview/siblings.ts
  - frontend/src/preview-3d/infra/camera-controls.ts
  - frontend/src/preview-3d/infra/schema-registry.ts
auto_fields:
  symbols_with_lines:
    - addOpLog
    - CameraControlBridge
    - getSchema
    - hasSchema
    - listSchemas
    - makeYsmModelSchemaId
    - MmdBottomNavCtx
    - mmdModelInfoNodes
    - MmdPlayBridge
    - mmdShotNodes
    - playNodes
    - readFileBytes
    - registerSchema
    - registerYsmModelSchema
    - resetSchemas
    - resolveFbxSiblings
    - resolveMmdSiblings
    - resolveMorphSiblings
    - resolveSceneSiblings
    - resolveSiblingsByType
    - resolveSiblingsForRoute
    - resolveStageSiblings
    - SchemaBuilder
    - showFbxPreview
    - showMmdPreview
    - showMorphPreview
    - showScenePreview
    - showStagePreview
    - showVrmMeta
    - unregisterSchema
    - VrmMaterialControlBridge
    - vrmModelInfoNodes
    - vrmShotNodes
    - YSM_MODEL_SCHEMA_ID
    - YsmControlsContext
    - ysmShotNodes
  tests:
    - frontend/src/views/app-preview/mmd-controls.test.ts
    - frontend/src/views/app-preview/vrm-controls.test.ts
    - frontend/src/views/app-preview/ysm-controls.test.ts
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 3D 控制器、MMD 播放、VRM 材质 / YSM schema
  - 截图按钮、相机控制、模型切换
  - multiModelSelectNode / preview menu node
  - 3D 入口 / nav-fab / siblings 兜底 / entry 通道
quick_risk_lines:
  - 相机操作已归核心声明式根菜单，底部导航弹窗已删除；adapter 项必须经 setAdapterItems 注入核心根菜单，禁止内联
  - 3D 入口统一为左下角 nav-fab（ADR-253 D7）；详情卡内已无 3D 按钮，opener 必须转发 opts 否则 siblings/entry 被静默丢弃
pitfalls:
  - 新加相机按钮 → 直接注入 mmd-controls → 切类型时按钮消失；必须走 setAdapterItems 注入核心根菜单
  - YSM schema 未走 registerYsmModelSchema 注册 → schema 变更不同步到菜单；必须经 schema-registry
  - registerReRoute opener 写成 (path) 或 (path, siblings) → 路由层算出的 candidates/entry 被静默丢弃；必须 (path, opts) => createXxx3D(path, opts)
  - 想在详情卡加 3D 按钮 → 与 ADR-253 D7 冲突（3D 已收敛到 nav-fab）；需要容器内指定模型请用 openModel3DFullscreen(path, { entry })

use_when:
  - 3D 控制器
  - MMD 播放
  - 截图按钮
  - 相机控制
  - 模型切换
  - 3D 入口
  - nav-fab
  - siblings
  - 容器内模型
  - 资源包模型直达
invariant_anchors:
  - frontend/src/views/app-preview/ysm-controls.ts|registerYsmModelSchema
  - frontend/src/views/app-preview/mmd-controls.ts|playNodes
  - frontend/src/preview-3d/infra/camera-controls.ts|CameraControlBridge
  - frontend/src/preview-3d/menu/core.ts|setAdapterItems
  - frontend/src/views/app-preview/siblings.ts|resolveSiblingsForRoute
  - frontend/src/views/app-preview/preview-library.ts|openModel3DFullscreen
status: active
---

# 3D 预览控制器（声明式菜单节点）

## 概览

> ⚠️ **重要前提（ADR-076 v2 Phase 2 重构后）**：相机操作已收编进**核心声明式根菜单**（⚙️ 按钮 → `mountPreviewRootMenu` 的 `camera` 项），底部导航弹窗已删除。现存的 `mmd/vrm/ysm-controls` 三文件主要职责是**产出声明式菜单节点（`PreviewMenuNode[]`）和受控 schema 注册**，由对应适配器在 build 阶段经 `ctx.menu.setAdapterItems` 注入核心根菜单。

> 三种模型 3D 交互覆盖：模型信息面板、播放/动作控制、截图面板、材质控制、模型切换、相机控制（已归核心）、YSM 受控 schema 注册。

## 核心职责

- **产出 `PreviewMenuNode[]`**：各 controls 文件导出命名空间节点函数（`mmdModelInfoNodes` / `playNodes` / `mmdShotNodes` 等），适配器组装后注入核心根菜单
- **受控 schema 注册**：`registerYsmModelSchema` 注册 `buildYsmModelSchema` 到 per-scene 键 `ysm-model-{sessionId}`
- **截图能力桥接**：向截图面板提供 `screenshotFn`（MMD/YSM 六角度，VRM 仅 current）
- **材质 bridge**：`MaterialControlBridge` / `VrmMaterialControlBridge` 显隐/透明度，逻辑下沉到 `mmd-materials.ts` / `vrm-materials.ts`（[ADR-180] 骨架收编 `materials-shared.ts`——list/setVisible/setOpacity/detail 骨架共享，格式差异参数化）
- **模型切换**：zip 内多 pmx/pmd 候选 `multiModelSelectNode`，跨类型走 `switchExternal`；siblings 三壳（mmd/fbx/stage）已合并为 `siblings.ts` 单文件（`resolveSiblingsByType` 统一入口 + 各格式 `resolve*` 薄封装）
- **siblings / entry 单一出口（ADR-253）**：候选由 3D 入口 `openModel3DFullscreen` 在调用方未传时按 routeKey 自算（`resolveSiblingsForRoute`），详情卡 FAB 不再手算；opener 签名为 `(path, opts?: OpenerOptions)`，**必须转发 opts**（含 `siblings` 与 `entry`），否则路由兜底白算。`entry` 是资源包专用通道（映射 `createPack3D` 的 `startEntry`），详情页「包内模型清单」点击经此直达。

## 三控制器对比

| 维度 | MMD | VRM | YSM |
|------|-----|-----|-----|
| 模型信息 | 名称 + 骨骼/材质/表情计数 + zip 多模型 select | 名称 + 骨骼/材质计数（无表情） | 受控 schema 注册驱动（组件选择 + 骨骼面板 + 纹理） |
| 播放/动作 | `playNodes`：toggle 播放暂停 + 多 clip select + 空态重新扫描 | 复用 MMD `playNodes` | 复用 MMD `playNodes` |
| 截图 | 六角度（`screenshotFn null` → 不注入） | **仅 current**（离屏管道不支持 VRM） | 六角度（undefined 走 fallback，面板常驻） |
| 材质 | `MaterialControlBridge` | `VrmMaterialControlBridge` | 经 schema 注册 |
| 骨骼/组件 | — | — | `YsmContentHandle`（showModelGroup/setBoneVisible/onBoneSelect） |
| 相机 | 保留 `cameraControls` 兼容字段 | 同 | 保留 `cameraControls` + `onTextureChange` |
| 调试 | — | — | F 键切换 normal/pivot/bone 三种模式 |

## 核心 API / 函数

| 导出 | 文件 | 职责 |
|------|------|------|
| `mmdModelInfoNodes(ctx) → PreviewMenuNode[]` | mmd-controls.ts | 模型名称 field + 骨骼/材质/表情计数 + zip 多模型 `multiModelSelectNode` |
| `playNodes(bridge) → PreviewMenuNode[]` | mmd-controls.ts | 空态提示+重新扫描 / 正常态 toggle+clip select+animDir |
| `mmdShotNodes(ctx, screenshotFn)` | mmd-controls.ts | 六角度（`screenshotFn null` → 返回空数组） |
| `vrmModelInfoNodes(ctx) → PreviewMenuNode[]` | vrm-controls.ts | 名称 + 骨骼/材质计数 |
| `vrmShotNodes(screenshot, modelPath)` | vrm-controls.ts | 仅 `shot-current` |
| `ysmShotNodes(ctx)` | ysm-controls.ts | 六角度（undefined 走 fallback，面板常驻） |
| `registerYsmModelSchema(ctx, sessionId?) → () => void` | ysm-controls.ts | 注册 schema 到 per-scene 键，返回 off 注销函数 |
| `showVrmMeta/showMmdPreview/showFbxPreview/showScenePreview/showMorphPreview/showStagePreview` | detail-3d.ts | 格式入口卡（**ADR-253 D7 起不含 3D FAB**，3D 走 nav-fab） |
| `readFileBytes(path)` / `addOpLog(scope, op, msg, status, err?)` | view-shell.ts | Wails 桥 / 环形日志诊断 |

**bus 事件**：`model:select`（兄弟列表/舞台项切换）、`toast:show`（通用反馈）
（ADR-253 D7 已删除 morph/stage 两个零订阅假 FAB——它们只发 toast 不执行操作）

## 与其他子系统关系

```
app-preview/  (入口层)
  ├─ detail-3d.ts     → 入口卡 + FAB；FAB.onclick → openModel3DFullscreen(path)（ADR-253：siblings 由路由兜底）
  ├─ siblings.ts      → resolveSiblingsByType 统一入口（mmd/fbx/stage 三壳已合并）+ resolveSiblingsForRoute（ADR-253 路由层出口）
  ├─ view-shell.ts    → readFileBytes / addOpLog（被多 xxx-3d.ts 复用）
  └─ mmd/vrm/ysm-controls.ts → 产出 PreviewMenuNode[] + 桥接口

preview-3d/adapters/  (适配器层，装配方)
  ├─ mmd/vrm/ysm-adapter.ts → build 阶段组装 panels{playNodes…}，经 ctx.menu.setAdapterItems 注入
  ├─ camera-controls.ts → CameraControlBridge + buildCameraControls
  └─ mount-preview-core.ts → camBridge + viewContainer 单例 + setAdapterItems

preview-3d/ 其他
  ├─ schema-registry.ts → registerSchema/unregisterSchema
  ├─ mmd-materials.ts / vrm-materials.ts → 材质逻辑层
  ├─ shot-panel-shared.ts → shotButtonNodes/makeShotAction
  ├─ skeleton-render.ts → saveScreenshot
  ├─ menu/core.ts → mountPreviewRootMenu + setAdapterItems（id 冲突守卫）
  └─ model3d.ts → Spec3D/BoneSelectInfo 类型
```

**层级红线**：controls 在 `views/` 层，适配器**不 import** controls；而是 controls 通过 `panels` 对象由适配器组装反向注入——R1「禁 utils→views 运行时依赖」的反向约束。

## 不变量

- **`registerYsmModelSchema` 必须成对注销**：返回的 off 函数在 ysm-adapter `dispose` 时调用；不清理会泄漏 WebGL 纹理集 + 陈旧 builder 闭包持有已销毁场景
- **`sessionId` 必须传**（ysm-controls / maid-3d）：多模型同框防互相覆盖；缺省退化为旧全局键 `YSM_MODEL_SCHEMA_ID`（`@deprecated`）
- **`setAdapterItems` id 冲突守卫**（ADR-085 S1）：适配器项之间重复 id、或与 `CORE_MENU_ITEMS` 冲突均抛错阻断
- **`camera` 已归核心根菜单 `camera` 项**：controls 文件中的 `cameraControls` 字段仅为兼容保留
- **VRM 截图只留 current**：离屏 `renderMultiAngle` 管道走不了 .vrm
- **`activeComponent` 为 per-scene 闭包**（Bug B 修复）：不再 `subscribeSettings("ui.activeComponent")` 全局广播
- **截图按钮能力缺失守卫**：MMD `screenshotFn null` → `mmdShotNodes` 返回空数组；YSM 相反（undefined 走 fallback）
- **`detailGen` 代际守卫**：detail-3d 各入口卡 await 后用 `detailGen.stale(gen)` 守卫，防用户切走后回写旧内容
- **dispose 清理链顺序**（ysm-adapter）：`rayCleanup` → `bonePanelRef.current?.()` → `unregisterModelRoot` → `removeFromScene` → 移除 keydown 监听 → `unregisterSchema` → `menu.unsubscribeState?.()` → `animPlayer?.dispose()` / `breath?.dispose()`

## 相关

- [preview_core](./preview_core.md) — 适配器统一外壳
- [model3d](./model3d.md) — 渲染核心（camera 已归核心根菜单）
- [dom-fab](./dom-fab.md) — FAB 按钮（相机控件走 createIconButton）
- [utils-export](./utils-export.md) — 截图链路（`saveScreenshot` 六角度）
- [export](./export.md) — 用户视角截图导出 feature 卡
