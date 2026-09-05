---
kind: preview-paths
name: 预览状态路径契约 preview-paths
tier: architecture
category: rendering
source_files:
  - frontend/src/preview-3d/state/preview-paths.ts
  - frontend/src/preview-3d/state/preview-state.ts
auto_fields:
  symbols_with_lines:
    - getStateValue
    - isPathAvailable
    - KNOWN_PATHS
    - previewSnapshot
    - PreviewSnapshot
    - PreviewStatePath
    - resetActiveComponent
    - resetSettingsListeners
    - setPreviewUiMode
    - setSceneCapabilityLookup
    - setStateValue
    - subscribeSettings
    - toStatePath
tests:
  - frontend/src/preview-3d/state/preview-state.test.ts
quick_groups:
  - 预览状态层契约
quick_intents:
  - KNOWN_PATHS 状态路径
  - PreviewStatePath 类型契约
  - PreviewSnapshot 快照类型
  - 两步走路径扩展
pitfalls:
  - 新增路径必须「扩 KNOWN_PATHS + 填 binding」两步走，缺一步编译不过
  - 未落地键在编译期即报错（不再恒 undefined 静默假死）
  - 直接写未落地路径（如 ui.mode / env.sky）编译报错——类型契约即运行时实现
use_when:
  - 预览状态路径
  - KNOWN_PATHS 扩展
  - PreviewStatePath 类型
  - 状态层快照契约
invariant_anchors:
  - frontend/src/preview-3d/state/preview-paths.ts|KNOWN_PATHS
  - frontend/src/preview-3d/state/preview-paths.ts|PreviewStatePath
  - frontend/src/preview-3d/state/preview-paths.ts|PreviewSnapshot
status: active
---

# 预览状态路径契约 preview-paths

## 概览

预览状态层的路径契约叶子（ADR-168 二期下沉产物）。零依赖叶子：`KNOWN_PATHS`（值）+ `PreviewStatePath` + `PreviewSnapshot`（类型）。自 `preview-state.ts` 下沉——该文件原持三件套，被 `caps/scene-capability.ts` 以 `import type { PreviewSnapshot }` 反向引用构成纯 type 环；下沉后本文件无任何 import，环消。

血统：ADR-125 P1 收编六项横切设置 → ADR-126 P4-A 升格为 `KNOWN_PATHS` 命名 → ADR-129 第一刀类型归位 state → ADR-168 二期契约独立叶子（本文件）。

## 核心职责

- **`KNOWN_PATHS`** — 已落地路径集合（render.frustumCull / render.maxFps / render.maxPixelRatio / render.bloom / render.wireframe / env.pmrem / env.waterMode / env.groundMatSource / ui.activeComponent / ui.mode / env.skyGroundCap）。类型契约即运行时实现：`PreviewStatePath = (typeof KNOWN_PATHS)[number]`。
- **`PreviewStatePath`** — 状态路径类型：已落地路径的联合。写未落地键编译报错——把「谓词读黑洞键静默假死」挡在编译期。
- **`PreviewSnapshot`** — 状态层快照类型：`Record<PreviewStatePath, unknown>`，`visibleWhen` 谓词吃的快照形状。键位 = KNOWN_PATHS（全部有真实来源，无黑洞键）。

## 对外 API / 入口

- `KNOWN_PATHS: readonly [...]` — 已落地路径常量（11 项）
- `PreviewStatePath` — 状态路径类型（`(typeof KNOWN_PATHS)[number]`）
- `PreviewSnapshot` — 状态层快照类型（`Record<PreviewStatePath, unknown>`）

## 与其他子系统关系

- **`preview-3d/state/preview-state.ts`** — 运行时实现：import `KNOWN_PATHS` 供 bindings 注册 / `previewSnapshot()` 遍历，并 re-export 三件套保既有公共面（menu/render.ts、perf-presets.ts、caps/*、adapters/* 的 import 不动）。
- **`preview-3d/caps/scene-capability.ts`** — 类型契约消费者：`import type { PreviewSnapshot }` 定义 `visibleWhen` 谓词签名。
- **`preview-3d/menu/`** — `renderMenu` / `dockGroupItemsFor` 谓词消费 `previewSnapshot()` 产出 `PreviewSnapshot`。

## 不变量

- **类型契约即运行时实现**：`PreviewStatePath` 类型 = `KNOWN_PATHS` 值域；未落地键在编译期即报错。
- **两步走扩展契约**：新增路径必须「扩 KNOWN_PATHS + 填 binding」两步走，缺一步编译不过。
- **零依赖叶子**：本文件无任何 import，避免 type 环（ADR-168 二期下沉的核心目的）。
- **re-export 保公共面**：`preview-state.ts` re-export 三件套，既有消费者（menu/render.ts、perf-presets.ts、caps/*、adapters/*）import 不动。

## 相关

- `docs/knowledge/preview-state.md`（运行时实现 + bindings 注册）
- `docs/knowledge/preview-menu.md`（visibleWhen 谓词消费）
- `docs/knowledge/scene_capability_registry.md`（cap 生态类型契约）
