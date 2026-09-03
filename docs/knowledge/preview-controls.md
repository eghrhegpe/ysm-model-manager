---
kind: preview-controls
name: 3D 预览控制器（声明式菜单节点）
tier: architecture
adr:
  - ADR-127
  - ADR-132
category: feature
source_files:
  - frontend/src/views/app-preview/mmd-controls.ts
  - frontend/src/views/app-preview/vrm-controls.ts
  - frontend/src/views/app-preview/ysm-controls.ts
  - frontend/src/views/app-preview/detail-3d.ts
  - frontend/src/views/app-preview/view-shell.ts
  - frontend/src/views/app-preview/mmd-siblings.ts
  - frontend/src/preview-3d/adapters/camera-controls.ts
  - frontend/src/preview-3d/adapters/schema-registry.ts
auto_fields:
  symbols_with_lines:
    - addOpLog
    - buildCameraControls
    - CameraControlBridge
    - getSchema
    - hasSchema
    - listSchemas
    - makeYsmModelSchemaId
    - MaterialControlBridge
    - MmdBottomNavCtx
    - mmdModelInfoNodes
    - MmdPlayBridge
    - mmdShotNodes
    - playNodes
    - readFileBytes
    - registerSchema
    - registerYsmModelSchema
    - resetSchemas
    - resolveMmdSiblings
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
    - YsmContentHandle
    - YsmControlsContext
    - YsmModel
    - ysmShotNodes
  tests:
    - frontend/src/views/app-preview/mmd-controls.test.ts
    - frontend/src/views/app-preview/vrm-controls.test.ts
    - frontend/src/views/app-preview/ysm-controls.test.ts
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
quick_risk_lines:
  - 相机操作已归核心声明式根菜单，底部导航弹窗已删除；adapter 项必须经 setAdapterItems 注入核心根菜单，禁止内联
pitfalls:
  - 新加相机按钮 → 直接注入 mmd-controls → 切类型时按钮消失；必须走 setAdapterItems 注入核心根菜单
  - YSM schema 未走 registerYsmModelSchema 注册 → schema 变更不同步到菜单；必须经 schema-registry

use_when:
  - 3D 控制器
  - MMD 播放
  - 截图按钮
  - 相机控制
  - 模型切换
invariant_anchors:
  - frontend/src/views/app-preview/ysm-controls.ts|registerYsmModelSchema
  - frontend/src/views/app-preview/mmd-controls.ts|playNodes
  - frontend/src/preview-3d/adapters/camera-controls.ts|CameraControlBridge
  - frontend/src/preview-3d/menu/core.ts|setAdapterItems
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
- **材质 bridge**：`MaterialControlBridge` / `VrmMaterialControlBridge` 显隐/透明度，逻辑下沉到 `mmd-materials.ts` / `vrm-materials.ts`
- **模型切换**：zip 内多 pmx/pmd 候选 `multiModelSelectNode`，跨类型走 `switchExternal`

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
| `showVrmMeta/showMmdPreview/showFbxPreview/showScenePreview/showMorphPreview/showStagePreview` | detail-3d.ts | 3D 入口卡，各含 FAB 进 3D |
| `readFileBytes(path)` / `addOpLog(scope, op, msg, status, err?)` | view-shell.ts | Wails 桥 / 环形日志诊断 |

**bus 事件**：`model:select`（兄弟列表/舞台项切换）、`toast:show`（morph/stage FAB 反馈）

## 与其他子系统关系

```
app-preview/  (入口层)
  ├─ detail-3d.ts     → 入口卡 + FAB；FAB.onclick → createXxx3D(path, {siblings})
  ├─ mmd-siblings.ts  → 委托 resolveSiblingsByType(MMD)
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
