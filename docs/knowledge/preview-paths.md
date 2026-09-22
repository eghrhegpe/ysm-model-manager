---
kind: preview-paths
name: 预览状态路径契约 preview-paths
tier: architecture
adr:
  - ADR-297
category: rendering
source_files:
  - frontend/src/preview-3d/state/preview-paths.ts
  - frontend/src/preview-3d/state/preview-state.ts
auto_fields:
  symbols_with_lines:
    - getStateValue
    - isPathAvailable
    - KNOWN_PATHS
    - PathInput
    - PathValue
    - previewSnapshot
    - PreviewSnapshot
    - PreviewStatePath
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

- **`KNOWN_PATHS`** — 已落地路径集合（清单以源码该常量为准，勿在卡内维护计数）。类型契约即运行时实现：`PreviewStatePath = (typeof KNOWN_PATHS)[number]`。（原含 `render.bloom` 与 `ui.activeComponent`，均已退场——前者的后处理开关归 `envState.ppEnabled`，[ADR-250]；原单键 `env.groundMatSource` 经 [ADR-249] §2.1 拆为来源/样式/叠加层三键；`env.fogMode` 为 2026-09 雾气锐评收口新增，供 fog 控件 `near/far` × `density` 互斥显隐。探针入册门槛见不变量段，[ADR-291]。）
- **`PreviewStatePath`** — 状态路径类型：已落地路径的联合。写未落地键编译报错——把「谓词读黑洞键静默假死」挡在编译期。
- **`PreviewSnapshot`** — 状态层快照类型：`{ [K in PreviewStatePath]: PathValue[K] }`（2026 锐评 P1：按路径精确值类型经 `PathValue` 映射声明，`unknown` 类型擦除已消灭），`visibleWhen` 谓词吃的快照形状。键位 = KNOWN_PATHS（全部有真实来源，无黑洞键）。

## 对外 API / 入口

- `KNOWN_PATHS: readonly [...]` — 已落地路径常量（清单以源码为准）
- `PreviewStatePath` — 状态路径类型（`(typeof KNOWN_PATHS)[number]`）
- `PathValue` — 路径 → 值类型映射（读侧精确输出域）：`getStateValue` / `PreviewSnapshot` 按此逐键精确
- `PathInput<K>` — 写侧输入域：`PathValue[K] | number | string | boolean`（泛型控件层可交付任意基元，binding 内部归一，仍比 unknown 严）
- `PreviewSnapshot` — 状态层快照类型（`{ [K in PreviewStatePath]: PathValue[K] }`，旧 `Record<PreviewStatePath, unknown>` 的结构超集——`Partial<PreviewSnapshot>` 消费方零改动）

## 与其他子系统关系

- **`preview-3d/state/preview-state.ts`** — 运行时实现：import `KNOWN_PATHS` 供 bindings 注册 / `previewSnapshot()` 遍历，并 re-export 三件套保既有公共面（menu/render.ts、perf-presets.ts、caps/*、adapters/* 的 import 不动）。
- **`preview-3d/caps/scene-capability.ts`** — 类型契约消费者：`import type { PreviewSnapshot }` 定义 `visibleWhen` 谓词签名。
- **`preview-3d/menu/`** — `renderMenu` / `dockGroupItemsFor` 谓词消费 `previewSnapshot()` 产出 `PreviewSnapshot`。

## 不变量

- **类型契约即运行时实现**：`PreviewStatePath` 类型 = `KNOWN_PATHS` 值域；未落地键在编译期即报错。
- **两步走扩展契约**：新增路径必须「扩 KNOWN_PATHS + 填 binding」两步走，缺一步编译不过。
- **cap 派生探针入册门槛（[ADR-291]）**：①判定输入须是 cap 态上浮值（模式/来源/开关类离散量），已在快照可达链上的键直接读、不建第二条桥；②三处登记一步不缺（KNOWN_PATHS / PathValue / bindings）+ 活体 `visibleWhen`/`subscribeSettings` 消费者守卫，零消费者键按即时删除退表；③控件基元归一与枚举守卫在 binding 内，谓词侧永拿 `PathValue` 精确类型。双轨（envState ↔ 快照探针）系铁律「谓词只吃快照」的设计内成本，合并/禁建均已被否。
- **零依赖叶子**：本文件无任何 import，避免 type 环（ADR-168 二期下沉的核心目的）。
- **re-export 保公共面**：`preview-state.ts` re-export 三件套，既有消费者（menu/render.ts、perf-presets.ts、caps/*、adapters/*）import 不动。

## 相关

- `docs/knowledge/preview-state.md`（运行时实现 + bindings 注册）
- `docs/knowledge/preview-menu.md`（visibleWhen 谓词消费）
- `docs/knowledge/scene_capability_registry.md`（cap 生态类型契约）
