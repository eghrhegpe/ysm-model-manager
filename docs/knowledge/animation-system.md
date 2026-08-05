---
kind: animation-system
name: 动画系统 animation
tier: architecture
category: utils
source_files:
  - frontend/src/utils/animation/animation.ts
  - frontend/src/utils/animation/animate.ts
  - frontend/src/utils/animation/stagger.ts
use_when:
  - 动画
  - 骨骼动画
  - 关键帧
  - 动画播放
  - Molang
  - 数字滚动
  - stagger 入场
  - 关闭动画
---

# 动画系统 animation

## 概览

前端动画体系分两层：**模型骨骼动画**（基岩版 animation.json 解析 + 关键帧插值求值）与 **UI 动效**（数字里程表滚动、stagger 入场延迟）。UI 层的 CSS 动画可被全局 `no-animations` 开关关闭。

## 核心职责

- 基岩版动画 JSON 解析（loop/animation_length/bones 三通道关键帧；Molang 表达式检测并跳过）
- 关键帧插值求值（线性/step）与骨骼层级变换传播（父级变换累积到子级）
- UI 数字滚动动画与列表 stagger 入场延迟计算

## 对外 API / 入口

`animation.ts`（解析 + 插值）：
- 类型：`Vec3`、`Keyframe`（time/post/pre/lerp）、`BoneChannels`（rotation/position/scale）、`AnimationClip`（name/loop/length/bones/hasMolang）、`BoneTransform`、`BoneHierarchyNode`
- `parseBedrockAnimationJSON(jsonStr): { clips, errors }` — 解析 .animation.json；JSON 错误/缺 animations 字段进 errors；任一关键帧含 Molang 字符串则 clip.hasMolang = true
- `evaluateKeyframes(keyframes, t): Vec3 | null` — 二分查找 + 线性插值（step 模式直接取当前帧 post）
- `evaluateClip(clip, time, boneHierarchy?, localOnly?): Map<string, BoneTransform>` — 整 clip 求值；循环动画时间取模；`localOnly` 只返回局部变换（Three.js 场景树自己传播时用），否则按拓扑排序把父级变换累积到子级

`animate.ts`：
- `animateNumber(el, to, duration=700): void` — 里程表式滚动进位（个位先转 → 十位 → 百位），替换元素文本中的首个数字串

`stagger.ts`：
- `stagger(index, step=30, max=300): number` — 入场动画延迟毫秒数 `min(index*step, max)`，用于 `animation-delay:${stagger(i)}ms`

## 与其他子系统关系

- `parseBedrockAnimationJSON` 消费方：`app-preview/preview-wasm.ts`（WASM 解码出的动画 JSON）
- `BoneTransform` 类型被 `utils/model2d.ts` 引用（动画驱动 2D 姿态）
- `animateNumber` 消费方：`app-tree/render.ts`、`app-sidebar/events.ts`（统计数字滚动）
- `stagger` 消费方：`app-content/index.ts`、`app-sync-manager/tpl.ts`、`dialogs/batch-rename.ts`、`features/community/render.ts` + `site-view.ts`（卡片入场）
- 全局开关：`app-modules.ts` 按设置切换 `document.documentElement` 的 `no-animations` class；CSS 侧对卡片/弹窗/主题动效统一 `animation: none !important`

## 不变量

- Molang 表达式不解释执行：检测到即标记 hasMolang 并跳过该值（避免 eval 任意表达式）
- evaluateKeyframes 对空数组/越界时间返回端点值或 null，不抛异常
- `no-animations` 开关作用于 CSS animation；JS 驱动的动画（模型动画求值/数字滚动）不受该 class 影响，属模型数据呈现而非装饰动效
- 播放循环（RAF）由消费方组件自行管理并须在卸载时 cancelAnimationFrame；曾有的 AnimationPlayer 封装类因长期无消费方已在死代码清理中移除，如需播放器请基于 evaluateClip 重建

## 相关

- [model3d](./model3d.md) / [model2d](./model2d.md) — 模型动画的呈现端
- [app_preview](./app-preview.md) — 动画解析消费方
- `frontend/src/utils/animation/animation.test.js`、`frontend/src/utils/animation/stagger.test.js` — 单元测试（验证入口）
