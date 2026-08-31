---
kind: preview_menu_session_key
name: preview-menu-session-key
tier: architecture
adr:
  - ADR-132
category: ui
source_files:
  - frontend/src/preview-3d/adapters/schema-registry.ts
  - frontend/src/views/app-preview/ysm-controls.ts
  - frontend/src/preview-3d/adapters/ysm-adapter.ts
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
  - frontend/src/preview-3d/adapters/switch-preview.ts
  - frontend/src/views/app-preview/skeleton-fill-panel.ts
tests:
  - frontend/src/preview-3d/adapters/__tests__/mount-preview-core.test.ts
  - frontend/src/preview-3d/adapters/schema-registry.test.ts
  - frontend/src/preview-3d/adapters/switch-preview.test.ts
  - frontend/src/views/app-preview/skeleton-fill-panel.test.ts
  - frontend/src/views/app-preview/ysm-controls.test.ts
use_when:
  - schema 注册
  - per-scene
  - 多模型同框
  - schema 键冲突
  - activeComponent
  - 组件选择
  - YSM maid 同台
  - ysm-model
  - sessionId
---

# preview-menu-session-key

## 概览

3D 预览面板的受控 schema 注册（`schema-registry.ts`）用「per-scene 唯一 key」保证多模型同台
（YSM + maid / 两个 YSM）时不互相覆盖。与 litematic 的 `litematic-slice-{n}` 同范式：
`YSM_MODEL_SCHEMA_ID`（`"ysm-model"`）保留为**兼容退化键**，真实注册走
`makeYsmModelSchemaId(sessionId)` → `"ysm-model-{sessionId}"`。

同时记录 Bug B 的收敛：组件选择 `activeComponent` 从全局状态层（`ui.activeComponent`）收敛为
`registerYsmModelSchema` 内 per-scene 闭包（对齐 litematic shell 闭包范式），根治跨预览泄漏。

## 核心职责

- **Bug A（schema 键冲突）**：固定全局键 `"ysm-model"` 被第二场景 build 静默覆盖——第一个模型的
  builder 闭包被第二个覆盖，旧面板的组件 select / 纹理行 / 统计全串数据。修复：mount 层生成
  per-mount 稳定 `sessionId`（`mount3D` 内 `_mountSessionSeq` 自增，`s{n}`），经
  `PreviewBuildCtx.sessionId` → 适配器 `sc.sessionId` → `registerModelSchema(ctx, sessionId)` 与
  `ysmMenuItems` 的 `schemaId` 同源注册/渲染；dispose 按同一 key 精准注销（不误伤同台他人）。
  `_mountSessionSeq` 随 `_resetSingletons()` 一起重置（测试钩子契约，2026-08-29 审核修复——
  否则跨用例单调递增，断言 per-scene key 形状的测试顺序依赖 flaky）。
- **Bug B（activeComponent 跨预览泄漏）**：`_activeComponent` 曾是模块级单值，maid generic 模式
  clamp 会误伤同台 YSM 的残留下标。修复：`registerYsmModelSchema` 持本地 `activeComponent` 闭包
  （`get`/`set`），`buildYsmModelSchema` 第三参 `sessionActiveComponent` 消费；不再
  `subscribeSettings("ui.activeComponent")`，不再 dispose 时 `resetActiveComponent()`。

## 对外 API / 入口

- `makeYsmModelSchemaId(sessionId: string): string` → `"ysm-model-{sessionId}"`（schema-registry.ts）
- `registerYsmModelSchema(ctx: YsmControlsContext, sessionId?: string): () => void`
  - sessionId 缺省 → 退化为旧全局键 `YSM_MODEL_SCHEMA_ID`（旧调用/测试兼容，带 deprecation 注释）
  - 返回 off：dispose 时注销 schema + 清 per-scene 会话闭包
- `buildYsmModelSchema(ctx, snapshot, sessionActiveComponent?: { get: () => number; set: (n) => void })`
  - 第三参缺省 → 回退读快照 `ui.activeComponent`（旧调用兼容）
  - select 控件不再 `bind: "ui.activeComponent"`，改 `get`/`set` 闭包读写会话态
- `mount3D` 每次新鲜 mount 生成 `sessionId`；`switchTo`（switch-preview）复用同一 id（会话内切换
  schema key 前后一致）；`buildSwitchContent` 注入的 `ctx.switchTo` 为延迟闭包（指向当前会话
  handle，2026-08-29 审核修复）——重建后的 select 节点（pack/MMD 多模型选择）仍可继续切换

## 与其他子系统关系

- `schema-registry.ts`：`registerSchema` / `unregisterSchema` / `getSchema` 的 key 现在分两族——
  旧全局键（兼容）与 `ysm-model-{sid}` per-scene 键（生产）。
- `preview-state.ts`：B2 后 `ui.activeComponent` binding 保留（不删——兼容旧消费者），但 YSM 面板
  不再读写它；`resetActiveComponent` 保留导出，无生产调用点（仅测试用）。
- `mount-preview-core.ts` / `switch-preview.ts`：sessionId 的生成与透传链。
- `litematic-adapter.ts`：per-scene key 范式的起源（`mdLiRegisterSliceSchema(sliceKey)`）。

## 不变量

- 注册 key 与 `schemaId` 必须同源（都用 `makeYsmModelSchemaId(sessionId)` 或都用旧全局键），
  否则渲染查不到注册 → 面板空渲染。
- dispose 注销的 key 必须与注册时一致（per-scene 精准清理，多模型同台零误伤）。
- `activeComponent` 真源 = 注册闭包（per-scene），不落全局状态层、不落盘。
- 新调用必须传 sessionId；省略 sessionId 仅兼容旧调用，多模型同台会复现 Bug A。

## 相关

- `docs/knowledge/preview_panel_declarative.md`（ADR-126 P5 受控 schema）
- `docs/knowledge/preview_state.md`（状态层与 cap 派生）
- `docs/knowledge/mount-preview-module-singleton-race.md`（mount 单例竞态）
- litematic 分层切片 `litematic-layer-controls.test.ts`（per-scene key 测试样板）
