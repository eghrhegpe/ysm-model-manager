---
kind: 3d-oversize-file-codesplit-feasibility
name: 3D 层超大文件 code-split 可行性
tier: leaf
category: ui
perf:
  - cpu-bound
use_when:
  - code-split
  - 超大文件
  - mmd-adapter
  - 拆分可行性
source_files:
  - frontend/src/preview-3d/adapters/mmd-adapter.ts
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
  - frontend/src/preview-3d/caps/ground-capability.ts
auto_fields:
  symbols_with_lines:
    - _resetSingletons
    - buildMmdScene
    - cleanupPreview
    - DEFAULT_GROUND_PARAMS
    - GroundCapability
    - GroundParams
    - hasActivePreview
    - invalidatePreview
    - makeMmdAdapter
    - MmdAdapterDeps
    - MmdDataPort
    - mmdMenuItems
    - MmdMenuItemsOpts
    - MmdPanelHooks
    - mount3D
    - Mount3DOptions
    - PreviewAdapter
    - PreviewBuildCtx
    - PreviewHandle
    - PreviewScene
    - switchPreview
created: 2026-08-27
status: snapshot
---

# 3D 层超大文件 code-split 可行性

## 2026-09-03 复核（外部评审再点名 + mmd-adapter 已拆）

- **mmd-adapter.ts（原判不拆）→ 已被 [ADR-167](../adr/ADR-167-mmd-stage.md) 推翻并拆完**：旧判「唯一导出 interface、拆了断注册链」被证伪——壳 re-export 保兼容，零调用方改动。真正决定可拆性的是**结构而非行数**：mmd-adapter 是 stage 管线（顶层函数 + MdMmBuildCtx/Pick 收窄），有真缝；沿缝搬移为 9 文件（壳 74 行 + types/shared/load/parse/scene/anim/menu/result），64+565 测试全绿。本卡旧正文 mmd-adapter 段落已失效。
- **mount-preview-core.ts（维持不拆）**：现 983 行，`mount3D` L285-936 ≈ 652 行。§5 二次拆分已把 5 个 mp* 子函数全部外移（shared-infra/wasd-camera/unified-pick/unload-model/input-and-animation/switch-preview），实体逻辑全外置；剩余为**闭包接线编排器**，段落共享 15+ 闭包变量、无 stage 缝——强行拆 = 巨型参数化，与 mmd-adapter 不可类比。详见 [mount3d-584-giant](./mount3d-584-giant.md) 2026-09-03 复核节。
- **ground-capability.ts（维持不拆）**：能力单元制（caps/ 29 文件），559 行合理，未变。
- **判定准则更新**：「行数」不是拆分依据；先查**缝**（stage 顶层化 / Pick 收窄接口 / 独立生命周期边界），有缝才拆，无缝的闭包编排单体记「不拆」并留复核节。

## 背景

复用分析报告指出三个超大文件：mmd-adapter.ts(1366行)、mount-preview-core.ts(1202行)、caps/ground-capability.ts(559行)。用户问「要现在拆吗」，先摸清 symbol 分布 + 依赖链出可行性报告。

## 数据（2026-08-27 实测）

| 文件 | 行数 | symbol 数 | 导出 |
|------|------|-----------|------|
| mmd-adapter.ts | 1366 | 42 | `MmdDataPort` interface（唯一） |
| mount-preview-core.ts | 1202 | 36 | `PreviewBuildCtx` interface（唯一） |
| caps/ground-capability.ts | 559 | — | ground cap 实现 |

## 拆分建议：不拆

### mmd-adapter.ts（1366 行）

**不拆**。理由：
- 唯一导出 `MmdDataPort` interface——拆分意味着拆 interface，会断 adapter registry 注册链
- 1366 行看着大，但内部函数都是 MMD 解析/纹理/骨骼的紧耦合逻辑——拆成多个文件后 import 链反而更乱
- `mmd-ktx2-encoder.ts`(318) / `mmd-texture-decoder.ts`(303) 已经拆出去了，剩下的 1366 行是 MMD 适配器的核心逻辑，不宜再拆

### mount-preview-core.ts（1202 行）

**不拆**。理由：
- 与 mmd-adapter 同理——唯一导出 `PreviewBuildCtx` interface，拆 interface 会断契约链
- `switch-preview.ts`(442) / `preview-menu/settings.ts`(226) / `preview-menu/roles.ts`(310) 已经拆出去了
- 剩下的 1202 行是 mount-preview 的核心编排逻辑（场景注册 + 会话管理 + 资源加载），拆了会断生命周期链
- ⚠️ 注：`mount3D` 本体仍 604 行（L263-L866），已拆出 5 个 `mp*` 子函数（见 [mount3D 巨函数现状](./mount3d-584-giant.md)），但会话管理部分未外拆

### caps/ground-capability.ts（559 行）

**不拆**。理由：
- 每个 cap 是一个能力单元（ground/light/scene-registry），内部函数紧耦合
- caps/ 已经按能力拆分了（29 个文件），再拆会过细
- 559 行的能力单元是合理大小——Three.js 的 cap 实现天然偏大（材质/纹理/几何体/动画的编排）

## 核心判断

这三个超大文件的「大」不是「该拆没拆」的债，而是「核心逻辑紧耦合」的设计选择。已经拆出去的子文件（ktx2/texture-decoder/switch-preview/preview-menu）证明拆分策略是对的——但剩下的核心逻辑不宜再拆，否则会断契约链/生命周期链/能力链。

## 唯一有收益的方向

**mount-preview-core.ts 的 §4 会话管理（:572-740）拆出**——它有独立的 lifecycle 边界（session handle/gen/abort），拆成 `session-manager.ts` 不会断核心编排链。但这是 P3 级优化，ROI 不高。

## 决策

用户拍板「另开专项」。当前轮次不拆，保持现状。若将来要动，优先做 mount-preview-core §4 会话管理拆出（P3，ROI 低）。
