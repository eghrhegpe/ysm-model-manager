---
kind: perception
name: 3D 感知系统 perception
tier: architecture
adr:
  - ADR-138
category: rendering
source_files:
  - frontend/src/preview-3d/perception/
auto_fields:
  symbols_with_lines:
    - AutoDanceOptions
    - BeatDetectorLike
    - BeatDetectorOptions
    - BlinkCallback
    - BlinkOptions
    - buildLipMorphIndices
    - createAutoDanceController
    - createBeatDetector
    - createBlinkController
    - createBreathController
    - createGazeController
    - createLipSyncController
    - isPerceptionPaused
    - LipSyncCallback
    - LipSyncOptions
    - MultiLipSyncCallback
    - setPerceptionPaused
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
  - 眨眼
  - 节拍检测
  - 模型感知
perf:
  - cpu-bound
invariant_anchors:
  - frontend/src/preview-3d/perception/autodance.ts|createAutoDanceController
  - frontend/src/preview-3d/perception/beat-detector.ts|createBeatDetector
  - frontend/src/preview-3d/perception/blink.ts|createBlinkController
status: active
---

# 3D 感知系统 perception
> **架构事实已迁移至 **[architecture.md#75-感知层程序化生命力](../architecture.md#75-感知层程序化生命力)。
> 本卡仅保留 frontmatter 机器字段（symbols/tests/quick_risk_lines），架构描述以 architecture.md 为准。

---

## 符号索引

> 符号列表见 frontmatter `auto_fields.symbols_with_lines`。
