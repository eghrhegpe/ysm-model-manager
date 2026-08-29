---
kind: multi_model_select
name: 多模型选择菜单原语 multiModelSelectNode
tier: architecture
category: ui
source_files:
  - frontend/src/utils/3d/adapters/preview-menu/multi-model.ts
  - frontend/src/views/app-preview/mmd-controls.ts
  - frontend/src/utils/3d/adapters/pack-model-adapter.ts
use_when:
  - 多模型
  - 多组件
  - 模型选择
  - select
  - zip 多模型
  - 多 entry
  - 多候选
  - ADR-132
---

# 多模型选择菜单原语 multiModelSelectNode

## 概览

跨资源类型的「多模型选择」声明式 select 菜单原语（ADR-132）。收编了此前三套并存的
多模型选择实现（MMD zip 手写 select / 资源包 topBar 切换 / YSM maid 状态层 select）中的
前两者，任何 adapter 一行调用即得声明式 `kind:"select"` 节点，零手写 DOM。

## 核心职责

- **统一原语**：`multiModelSelectNode(opts)` → `PreviewMenuNode | null`（单候选/空候选返回 null，调用方不注入）
- **会话态闭包**：`activeId()` / `onSelect(id)` 由调用方注入（per-scene 会话态，对齐 6b080b33 Bug B 范式——不落全局状态层）
- **切换语义**：复用「虚拟路径 + basename」模式（MMD zip 已验证）——select 的 value 即完整切换目标，`set` → `onSelect(虚拟路径)` → core `switchTo` 重建内容层，**不改 `PreviewAdapter.build` 签名**
- **i18n 复用**：`preview.component` / `preview.allComponents`（三语言包已就位，零新增键）

## 对外 API / 入口

```ts
multiModelSelectNode(opts: {
  entries: Array<{ id: string; label: string }>;  // 候选（id = 切换目标完整路径）
  activeId: () => string;                          // 当前选中（per-scene 闭包；非法值回退首项）
  onSelect: (id: string) => void;                  // 切换副作用（switchTo / showModelGroup）
  labelKey?: string;                               // 缺省 "preview.component"
  fallback?: string;                               // 缺省 "模型"
  nodeId?: string;                                 // 缺省 "multi-model-select"
}): PreviewMenuNode | null
```

消费者：

- **MMD zip**（`mmd-controls.ts` `mmdModelInfoNodes`）：候选 = `zipModelCandidates`（虚拟路径，mmd-adapter.ts:392 暴露）；get 保持 basename 匹配（`modelName` = 虚拟路径 basename）；set → `ctx.switchTo(虚拟路径)`
- **资源包**（`pack-model-adapter.ts` `buildPackScene`）：候选 = `modelEntries`（pack-3d.ts 经 `ListPackModels` 枚举注入）；get 读 build 入参 entryPath；set → `ctx.switchTo(entryPath)`

## 与其他子系统关系

- `preview-menu/node-types.ts`：返回 `PreviewMenuNode`（kind: "select"，`control.options/get/set` 装配好）
- `mount-preview-core.ts`：`PreviewScene.menuItems` 出口（pack 首次接入）；`PreviewBuildCtx.switchTo` 是切换副作用宿主
- `preview-state.ts`：**不扩展** `PreviewStatePath` 模板串域（`bindings: Record<typeof KNOWN_PATHS[number]>` 要求字面量全覆盖，模板串破坏 Record）；会话态走闭包
- `scene-registry.ts` / `switch-preview.ts`：switchTo 重建链路（切模型复用外壳）
- `mmd-zip-overlay.ts`：zip 多模型候选的解析源（`resolveMmdZipConfig` / `modelCandidates`）

## 不变量

- 单候选/空候选 → 返回 null（无「选择」语义，调用方不注入）
- `get` 返回必在 entries 内（activeId 非法时回退首项）
- `set` 只调 onSelect 合法 id（不在 entries 的 id 静默忽略）
- 状态真源 = 调用方闭包（per-scene），不落全局状态层、不落盘
- 切换语义 = switchTo 重建（复用外壳），不是同台追加（同台是 ADR-093 范围）

## 相关

- `docs/adr/ADR-132-multi-model-select-menu-primitive.md`（本原语决策）
- `docs/knowledge/preview_panel_declarative.md`（声明式面板 P4/P5 + zip 多 pmx 论述）
- `docs/adr/ADR-093-multi-model-scene-core.md`（多模型同框引擎，同台语义）
- `docs/adr/ADR-080-pack-model-adapter.md`（资源包模型适配器）
- `frontend/src/utils/3d/adapters/preview-menu/multi-model.test.ts`（原语契约测试）
