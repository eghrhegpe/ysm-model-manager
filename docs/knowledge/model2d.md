---
kind: model2d
name: 2D 预览渲染 model2d
tier: architecture
category: utils
source_files:
  - frontend/src/utils/3d/model2d.ts
tests:
  - frontend/src/utils/3d/model2d.test.ts
use_when:
  - 2D 预览
  - 骨骼图
  - Canvas 渲染
  - 前视图
  - 骨骼热区
  - 鼠标拾取
  - 线框图
---

# 2D 预览渲染 model2d

## 概览

Canvas 2D 渲染基岩版模型骨骼的线框/正交投影图（前视图 + 可选 Y 轴旋转），是预览面板的轻量视图；与 [model3d](./model3d.md) 共享同一套 Bedrock 几何口径。

## 核心职责

- 在 Canvas 上绘制骨骼 cube 的 2D 正交投影（前视图/侧视图、Y 轴旋转、纹理贴图可选）
- 计算骨骼屏幕热区（鼠标悬停拾取骨骼名）
- 小地图缩略视图绘制（drawMiniView）

## 对外 API / 入口

- 类型：`BedrockCube`（origin/size/pivot?/rotation?/uv?/faceUV?）、`BedrockBone`（name/cubes）、`BedrockModel`（bones，对应 Go `AnalyzeBedrockModel` 返回）、`Model2DOptions`（showLabels/zoom/rotation/boneTransforms）
- `renderModel2D(canvas, model, textureImg, opts): void` — 主渲染入口：骨骼/cube 无数据时直接返回；支持动画变换 `boneTransforms: Map<string, BoneTransform>`（来自 animation.ts）；canvas 上挂 `_hoverCleanup` 清理函数防重复绑定悬停监听
- `calcBoneHitZones(model, scale, ox, oy, isFront, cosA, sinA, boneTransforms): HitZone[]` — 每骨骼 8 顶点投影包围盒 → 屏幕矩形热区（含动画 position/rotation 变换后的坐标）
- 内部函数（未导出）：drawView（主视图绘制）、drawMiniView（小地图）

## 与其他子系统关系

- 唯一消费方：`app-preview/preview-skeleton.ts`（骨骼预览 2D 视图）
- 类型依赖 `utils/animation.ts` 的 `BoneTransform`（动画驱动 2D 姿态）
- 调试输出走 `utils/debug.ts` 的 dbg

## 不变量

- **致命陷阱 #11 同样适用**：2D 投影的坐标口径必须与 YSMViewer 一致（pivot X 取反、cube 旋转绕 pivot、屏幕 Y 轴翻转取反）；改本文件前先 grep `docs/archive/bug-chronicle.md`，改完用实际模型比对
- cube 无显式 pivot 时兜底取几何中心 `[x+sx/2, y+sy/2, z+sz/2]`
- 悬停监听通过 `canvas._hoverCleanup()` 清理，重绘前必须先调用旧清理函数，禁止累积监听
- CSS 颜色（骨骼线/标签）在调用方样式中走 CSS 变量

## 相关

- [model3d](./model3d.md) — 3D 预览（同一几何口径）
- [animation_system](./animation-system.md) — BoneTransform 来源
- [app_preview](./app-preview.md) — 预览面板消费方
- `frontend/src/utils/3d/model2d.test.js` — 单元测试（验证入口）
- AGENTS.md 致命陷阱 §二 #11
