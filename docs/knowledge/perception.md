---
kind: perception
name: 3D 感知系统 perception
tier: architecture
category: rendering
source_files:
  - frontend/src/preview-3d/perception/
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 3D 感知系统、自主动画、自动跳舞
  - 眨眼/呼吸/视线追踪/口型同步
  - 节拍检测、模型感知
quick_risk_lines:
  - 3D 感知必须走 perception 模块的控制器，禁止手写动画注入
pitfalls:
  - 手写动画注入 → 与感知系统控制器冲突、节奏不同步；必须经感知控制器
  - 节拍检测未缓存 → 每帧重复采样音频；必须经 beat-detector 的缓存策略

use_when:
  - 自主动画
  - 自动跳舞
  - 眨眼
  - 呼吸
  - 视线追踪
  - 口型同步
  - 节拍检测
  - 模型感知
  - 自动运动
perf:
  - cpu-bound
invariant_anchors:
  - frontend/src/preview-3d/perception/autodance.ts|createAutoDanceController
  - frontend/src/preview-3d/perception/beat-detector.ts|createBeatDetector
  - frontend/src/preview-3d/perception/blink.ts|createBlinkController
---

# 3D 感知系统 perception

## 概览

`preview-3d/perception/` 是实现模型「自主生命感」的感知层子系统：让 Minecraft 角色自动眨眼、呼吸、注视、对口型、随音乐律动。

## 核心职责

| 模块 | 文件 | 职责 |
|------|------|------|
| 自动跳舞 | `autodance.ts` | 模型随节拍/音频自动舞蹈，驱动骨骼动画 |
| 节拍检测 | `beat-detector.ts` | 从音频流中检测 BPM 与节拍，作为 autodance 的节奏输入 |
| 眨眼 | `blink.ts` | 周期性自动眨眼，模拟真人眼部微动 |
| 呼吸 | `breath.ts` | 模型胸/腹部的起伏呼吸动画 |
| 视线追踪 | `gaze.ts` | 模型头部/眼球追踪相机或关注点，提升交互真实感 |
| 口型同步 | `lipsync.ts` | 根据音频能量驱动嘴部骨骼动画（viseme） |

## 对外 API / 入口

**无全局注册器**。每个感知模块导出工厂函数（如 `createBreathController()`），闭包封装状态，返回含 `update`/`dispose` 的控制器；适配器（ysm/vrm/mmd）在 `build()` 内实例化控制器，把 `update` 并入内容层 `PreviewScene.update` 每帧驱动（宽容缺省：语义骨骼缺失时静默跳过）。

感知开关面板：`adapters/perception-controls.ts` 的 `buildPerceptionControls(list, state, caps)` 渲染开关行，作为适配器菜单项注入（state/caps 经 `PreviewScene.perception` 提供）。

## 与其他子系统关系

- **perception-controls**（`adapters/perception-controls.ts`）— 感知开关面板渲染（适配器菜单项）
- **semantic-bones**（`semantic-bones.ts`）— 语义骨骼映射（chest/spine/eyes/mouth…），感知驱动的主要骨骼来源
- **preview_core**（`mount-preview-core.ts`）— 统一预览核心持有会话；感知控制器由各适配器 build 内实例化，不直接依赖核心
- **model3d**（`model3d.ts` 类型枢纽）— 骨骼数据结构供感知控制器消费

## 不变量

- 感知层纯逻辑，零 DOM 依赖
- 所有感知模块可独立启用/禁用，互不依赖
- 无音频源时 autodance/lipsync 静默降级为无操作

## 相关

- [model3d](./model3d.md) — 3D 渲染会话
- [animation-system](./animation-system.md) — 骨骼动画系统
- [preview_core](./preview_core.md) — 统一预览核心