---
kind: multi_model_select
name: 多模型选择菜单原语 multiModelSelectNode
tier: architecture
adr:
  - ADR-132
category: ui
source_files:
  - frontend/src/preview-3d/menu/multi-model.ts
  - frontend/src/views/app-preview/mmd-controls.ts
  - frontend/src/preview-3d/adapters/pack-model-adapter.ts
  - frontend/src/preview-3d/adapters/litematic-adapter.ts
  - frontend/src/views/app-preview/litematic-3d.ts
  - internal/app/container_entries.go
  - go/litematic/voxel.go
tests:
  - frontend/src/preview-3d/adapters/pack-model-adapter.test.ts
  - frontend/src/preview-3d/menu/multi-model.test.ts
  - frontend/src/views/app-preview/mmd-controls.test.ts
  - frontend/src/preview-3d/adapters/litematic-adapter.test.ts
  - frontend/src/views/app-preview/litematic-3d.test.ts
  - internal/app/container_entries_test.go
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 多模型选择、多组件 / 多 entry
  - zip 多模型、多候选、蓝图 zip、litematic zip
  - multiModelSelectNode
quick_risk_lines:
  - 容器内多模型必须经 multiModelSelectNode 声明式菜单选择，禁止 adapter 直接遍历 entry 数组渲染
pitfalls:
  - adapter 直接遍历 entry 数组 → 容器内多模型顺序不稳定、缺用户选择点；必须走 multiModelSelectNode
  - litematic zip 多 nbt 未走 select → 默认取第一个，用户无法换选；必须复用 multiModelSelectNode

use_when:
  - 多模型
  - 模型选择
  - select
  - zip 多模型
  - 多 entry
  - ADR-132
status: active
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
  entries: Array<{ id: string; label: string }>;  // 候选（id = 切换目标完整路径/下标字符串）
  activeId: () => string;                          // 当前选中（per-scene 闭包；非法值回退首项）
  onSelect: (id: string) => void;                  // 切换副作用（switchTo / showModelGroup）
  labelKey?: string;                               // 缺省 "preview.component"
  fallback?: string;                               // 缺省 "模型"
  nodeId?: string;                                 // 缺省 "multi-model-select"
  refreshOnChange?: boolean;                       // 切档后 menu.refresh() 重渲染面板（YSM 组件 select 语义）
}): PreviewMenuNode | null
```

消费者：

- **MMD zip**（`mmd-controls.ts` `mmdModelInfoNodes`）：候选 = `zipModelCandidates`（虚拟路径，mmd-adapter.ts:392 暴露）；get 保持 basename 匹配（`modelName` = 虚拟路径 basename）；set → `ctx.switchTo(虚拟路径)`
- **资源包**（`pack-model-adapter.ts` `buildPackScene`）：候选 = `modelEntries`（pack-3d.ts 经 `ListPackModels` 枚举注入）；get 读 build 入参 entryPath；set → `ctx.switchTo(entryPath)`
- **蓝图/litematic zip**（`litematic-adapter.ts` `buildLitematicScene` + `litematic-3d.ts` `createLitematic3D`，ADR-132 遗留 1）：`.zip` 容器先 `ListContainerEntries` 枚举（`.nbt,.litematic,.schematic` 白名单）→ 装配 adapter（`containerPath` + `modelEntries` + `entryExt`）→ build 的 path 即容器内 entry（虚拟路径）；候选 = `modelEntries`，get 读 build 入参 entryPath，set → `ctx.switchTo(entryPath)`；容器内 voxelCall 走 `GetVoxelDataInContainer(containerPath, entry, ext)`（修复原「zip 被当 gzip 打开」坏预览）。**ext 按 entry 逐条派生（审核修复，2026-08-30）**：voxelCall 按 entry 路径算自身 ext（未知扩展名回退捕获的 `entryExt`）——mixed-format 容器（`.nbt`+`.schematic`）切换各走自身 Go builder，不再沿用首项 ext。单 entry/空容器退化无 select（裸路径零回归）
- **YSM/maid**（`skeleton-fill-panel.ts` `buildYsmModelSchema`）：候选 = `-1`（All，label「全部组件」）+ 组件下标 `0..N`；get/set 走 `sessionActiveComponent` per-scene 闭包；`refreshOnChange: true`（切档后 stats/纹理行按新会话态重建）；**显式 `mgCount > 1` 守卫**（「-1 = All」恒选项使 entries 恒 ≥2，不能依赖原语单候选 null 判断——单组件不显示 select，对齐旧语义）

## 与其他子系统关系

- `preview-menu/node-types.ts`：返回 `PreviewMenuNode`（kind: "select"，`control.options/get/set` 装配好）
- `mount-preview-core.ts`：`PreviewScene.menuItems` 出口（pack 首次接入）；`PreviewBuildCtx.switchTo` 是切换副作用宿主
- `preview-state.ts`：**不扩展** `PreviewStatePath` 模板串域（`bindings: Record<typeof KNOWN_PATHS[number]>` 要求字面量全覆盖，模板串破坏 Record）；会话态走闭包
- `scene-registry.ts` / `switch-preview.ts`：switchTo 重建链路（切模型复用外壳）；**buildSwitchContent 注入的 `ctx.switchTo` 是延迟闭包**（指向当前会话 `handle.switchTo`，与 mount3D 初次 build 同款，2026-08-29 审核修复）——重建后的 menuItems select 节点 onSelect 仍能触发后续切换（此前传 `undefined`，pack select 会话内只能生效一次，第二次点击静默 no-op）
- `mmd-zip-overlay.ts`：zip 多模型候选的解析源（`resolveMmdZipConfig` / `modelCandidates`）

## 不变量

- 单候选/空候选 → 返回 null（无「选择」语义，调用方不注入）
- `get` 返回必在 entries 内（activeId 非法时回退首项）
- `set` 只调 onSelect 合法 id（不在 entries 的 id 静默忽略）
- 状态真源 = 调用方闭包（per-scene），不落全局状态层、不落盘
- 切换语义 = switchTo 重建（复用外壳），不是同台追加（同台是 ADR-093 范围）
- **切换闭包跨重建存活（审核修复回归）**：select 的 `onSelect` → `ctx.switchTo`（延迟闭包经会话 handle 解析），switch 重建后依然可切——`switch-preview.test.ts` 覆盖「连续两次切换」；原语 `get`/`set` 用预计算 id Set 判存在（O(1)，不做全量线性扫）

## 相关

- `docs/adr/ADR-132-multi-model-select-menu-primitive.md`（本原语决策）
- `docs/knowledge/preview_panel_declarative.md`（声明式面板 P4/P5 + zip 多 pmx 论述）
- `docs/adr/ADR-093-multi-model-scene-core.md`（多模型同框引擎，同台语义）
- `docs/adr/ADR-080-pack-model-adapter.md`（资源包模型适配器）
- `frontend/src/preview-3d/menu/multi-model.test.ts`（原语契约测试）
