---
kind: ysm-anim-pipeline
name: YSM (Bedrock) 动画管线
category: utils
tier: architecture
source_files:
  - frontend/src/features/preview-3d/ysm-animation-player.ts
  - frontend/src/features/preview-3d/adapters/ysm-adapter.ts
  - frontend/src/utils/animation/molang.ts
  - frontend/src/utils/animation/animation.ts
tests:
  - frontend/src/features/preview-3d/ysm-animation-player.test.ts
  - frontend/src/utils/animation/animation-controller.test.ts
  - frontend/src/utils/animation/animation.test.ts
  - frontend/src/utils/animation/molang.test.ts
created: 2026-08-xx
updated: 2026-08-xx
description: YSM (Bedrock) 模型在 3D 预览中的动画解析、求值与渲染注入管线
related_adrs:
  - ADR-061-3d (含勘误记录)
  - ADR-100 (YSM 骨骼动画)
  - ADR-113 (Molang 表达式支持)
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
// 1. 加载阶段
loader/adapter → createYsmAnimPlayer(timeline, boneMapping)

// 2. 驱动阶段 (每帧 rAF)
adapters[0] = mdApAdvanceTimeAndController() // 推进时钟 + 状态机
              ↓
              molang-bridge 求值             // @variable.time 等变量实时计算
              ↓
mdApApplyPose(boneGroupMap)                 // 覆盖 THREE.Group.position/quaternion

// 3. 渲染消费
rAF 循环消费动态 Spec → Three.js 画面随时间轴动起来
```

## 核心模块职责

| 模块 | 文件路径 | 职责 |
|------|---------|------|
| **动画玩家** | `features/preview-3d/ysm-animation-player.ts` | 完整的状态机：时间推进、Clip 切换、控制器管理。导出符号 `createYsmAnimPlayer`。 |
| **Molang 求值器** | `utils/animation/molang-bridge.ts` | 表达式解析与执行。处理如 `math.sin(@variable.time)` 等公式。 |
| **插值引擎** | `utils/animation/animation.ts` | `parseBedrockAnimationJSON`, `evaluateClip`。使用 Catmull-Rom 样条插值。 |
| **适配器桥接** | `features/preview-3d/ysm-adapter.ts` | 将解码数据喂入 Player，并挂载到 `renderModel3D` 实例。 |

## 关键接口

### `createYsmAnimPlayer(timeline, boneMapping)`
- **用途**：创建动画播放器实例。
- **参数**：
  - `timeline`: Bedrock 原始时间轴 JSON 结构。
  - `boneMapping`: 骨骼路径 (`/bones/body`) 到 Three.js `Object3D` 实例的映射。

### `mdApApplyPose(boneGroupMap)`
- **用途**：将当前时间的骨骼变换结果应用到 Three.js 场景图。
- **注意**：直接修改 `position` / `quaternion`，需在后续调 `updateMatrixWorld()`。

## 避坑指南

1. **不要在 `model3d.ts` 里找动画代码**：那里只有纯渲染逻辑。
2. **性能关注点**：`applyPose` 遍历骨骼数组是 CPU 密集操作。低端 Android WebView 需监测 rAF 掉帧，必要时引入跳帧策略。
3. **坐标系口径**：Bedrock (Y-up) 与 Three.js (Y-up) 一致，但旋转通道的正负号在历史提交 `86c6a178` 中经历过校正（弧度/角度混合问题）。
