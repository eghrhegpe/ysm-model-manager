---
kind: ysm-anim-pipeline
name: YSM (Bedrock) 动画管线
category: utils
tier: architecture
source_files:
  - frontend/src/preview-3d/ysm-animation-player.ts
  - frontend/src/preview-3d/adapters/ysm-adapter.ts
  - frontend/src/utils/animation/molang.ts
  - frontend/src/utils/animation/animation.ts
auto_fields:
  symbols_with_lines:
    - AnimationClip
    - BoneChannels
    - BoneHierarchyNode
    - BoneTransform
    - buildYsmScene
    - compileMolang
    - createYsmAnimPlayer
    - evaluateClip
    - evaluateKeyframes
    - executeTimeline
    - foldMolangConstant
    - Keyframe
    - makeYsmAdapter
    - MolangAxes
    - MolangFn
    - parseBedrockAnimationJSON
    - setMolangScope
    - TimelineEvent
    - Vec3
    - YsmAdapterOptions
    - ysmAnimClipLabels
    - YsmAnimPlayer
    - ysmMenuItems
    - YsmMenuItemsOpts
    - YsmPreloadedModel
  tests:
    - frontend/src/preview-3d/ysm-animation-player.test.ts
    - frontend/src/utils/animation/animation-controller.test.ts
    - frontend/src/utils/animation/animation.test.ts
    - frontend/src/utils/animation/molang.test.ts
  related_adrs:
    - ADR-061-3d (含勘误记录)
    - ADR-100 (YSM 骨骼动画)
    - ADR-113 (Molang 表达式支持)
tests:
  - frontend/src/preview-3d/ysm-animation-player.test.ts
  - frontend/src/utils/animation/animation-controller.test.ts
  - frontend/src/utils/animation/animation.test.ts
  - frontend/src/utils/animation/molang.test.ts
use_when:
  - YSM 动画
  - 基岩动画
  - molang
  - 动画管线
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - YSM 动画管线、基岩动画
  - ysm-animation-player、molang
  - 动画解析 / 求值 / 渲染注入
quick_risk_lines:
  - YSM 动画必须走 ysm-anim-pipeline 的解析-求值-注入三段，禁止前端手写动画解析
pitfalls:
  - 手写动画解析 → 与基岩版 animation.json 语义不一致；必须经 ysm-animation-player
  - Molang 求值未缓存 → 每帧重复求值、性能差；必须缓存 Molang 表达式
created: 2026-08-xx
updated: 2026-08-xx
description: YSM (Bedrock) 模型在 3D 预览中的动画解析、求值与渲染注入管线
related_adrs:
  - ADR-061-3d (含勘误记录)
  - ADR-100 (YSM 骨骼动画)
  - ADR-113 (Molang 表达式支持)
perf:
  - cpu-bound
status: active
---

# YSM (Bedrock) 动画管线

## 概述

YSM 模型的动画并非硬编码在渲染核心 `model3d.ts` 中，而是由**适配器层 (`ysm-adapter.ts`)** 托管的独立玩家对象 `YsmAnimPlayer` 驱动。这种设计解耦了渲染与动画逻辑，使得 Bedrock 动画与 MMD (VMD) 动画各走各的通道。

## ⚠️ 认知纠偏 (重要)

- **误区**：搜索 `model3d.ts` 寻找 `playAnimation` 或 `evaluateClip`。
- **真相**：`model3d.ts` 仅负责渲染循环（相机移动、光照、Draw）。动画控制权在 `adapter` 手里。
- **依据**：详见 [ADR-061-3d.md](../adr/ADR-061-3d.md) §🚨 现状勘误与认知纠偏。

## 调用链真相

```typescript
// 1. 加载阶段（适配器层 ysm-adapter.ts 的 build() 内）
loader/adapter → createYsmAnimPlayer(boneByName, clips, boneHierarchy, clipLabels?)

// 2. 驱动阶段（Player.apply(dt) 每帧 rAF 调，内部串接两步）
mdApAdvanceTimeAndController(dt, state, ctx)  // 推进时钟 + 控制器状态机
                                              // 内含 setMolangScope(controllerVariables) 完成 @variable.time 等变量求值
              ↓
mdApApplyPose(dt, state, ctx)                 // 覆盖 THREE.Group.position/quaternion
                                              // 内部调 evaluateClip(clip, state.elapsed, ctx.boneHierarchy, true) 拿插值结果

// 3. 渲染消费
rAF 循环 → Player.apply(dt) → Three.js 画面随时间轴动起来
```

## 核心模块职责

| 模块 | 文件路径 | 职责 |
|------|---------|------|
| **动画玩家** | `preview-3d/ysm-animation-player.ts` | 完整的状态机：时间推进、Clip 切换、控制器管理。导出符号 `createYsmAnimPlayer`。 |
| **Molang 作用域桥** | `utils/animation/molang.ts` | 内嵌 molangjs 表达式求值器。`setMolangScope(vars)` 注入 `@variable.time` 等变量，由 `mdApAdvanceTimeAndController` 在每帧推 clock 时调用；见 animation-system.md。 |
| **插值引擎** | `utils/animation/animation.ts` | `parseBedrockAnimationJSON`, `evaluateClip`。使用 Catmull-Rom 样条插值。由 `mdApApplyPose` 内部在每帧调 `evaluateClip(clip, elapsed, boneHierarchy, true)` 拿当前时刻的变换序列。 |
| **适配器桥接** | `preview-3d/ysm-adapter.ts` | 将解码的 YSM 骨骼/动画/clip 数据喂入 `createYsmAnimPlayer`（在 `build()` 内），并注册到会话生命周期。 |

## 关键接口

### `createYsmAnimPlayer(boneByName, clips, boneHierarchy, clipLabels?)`
- **用途**：创建 YSM 动画播放器实例。
- **参数**：
  - `boneByName: Map<string, THREE.Object3D>`：骨骼名称 → 已创建 THREE.Group 节点的映射（适配器 `build()` 阶段生成）。
  - `clips: AnimationClip[]`：Bedrock 动画切片列表（`parseBedrockAnimationJSON` 输出）。
  - `boneHierarchy: BoneHierarchyNode[]`：骨骼层级结构（父子关系 + 索引）。
  - `clipLabels?: string[]`：clip 可读名（缺省用 clip 索引）。
- **返回**：`YsmAnimPlayer` 对象，含 `apply(dt)` / `dispose()` / `toggle()` / `isPlaying` / `selectClip` / `currentIndex` / `clips()` / `clipCount` / `getDuration` / `getTime` 等方法和只读访问器。

### `Player.apply(dt: number)`
- **用途**：每帧由 rAF 循环调用，串接两步：`mdApAdvanceTimeAndController(dt, state, ctx)`（推时钟 + Molang 求值 + clip 切换判断）→ `mdApApplyPose(dt, state, ctx)`（`evaluateClip` 取变换 → 覆盖 `position` / `quaternion`）。

### `mdApApplyPose(dt, state, ctx)`
- **用途**：将当前时间的骨骼变换结果应用到 Three.js 场景图。
- **注意**：内部调 `evaluateClip(clip, state.elapsed, ctx.boneHierarchy, true)` 拿插值后的变换；直接修改 `position` / `quaternion`，需在后续调 `updateMatrixWorld()`。

## 避坑指南

1. **不要在 `model3d.ts` 里找动画代码**：那里只有纯渲染逻辑。
2. **性能关注点**：`applyPose` 遍历骨骼数组是 CPU 密集操作。低端 Android WebView 需监测 rAF 掉帧，必要时引入跳帧策略。
3. **坐标系口径**：Bedrock (Y-up) 与 Three.js (Y-up) 一致，但旋转通道的正负号在历史提交 `86c6a178` 中经历过校正（弧度/角度混合问题）。
