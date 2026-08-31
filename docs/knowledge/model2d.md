---
kind: model2d
name: 2D 预览渲染 model2d
tier: architecture
category: utils
source_files:
  - frontend/src/views/app-preview/model2d/model2d.ts
tests:
  - frontend/src/views/app-preview/model2d/model2d.test.ts
use_when:
  - 2D 预览
  - 骨骼图
  - Canvas 渲染
  - 前视图
  - 骨骼热区
  - 鼠标拾取
  - 线框图
invariant_anchors:
  - frontend/src/views/app-preview/model2d/model2d.ts|const cosA = Math.cos(angle)
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

- **致命陷阱 #11 同样适用**：2D 投影的坐标口径必须与 YSMViewer 一致（cube 旋转绕 pivot、屏幕 Y 轴翻转取反）；注意 **2D 管线与 3D 不同**——`pivot X 取反` 发生在 go/threejs spec 生成期（3D 专用），model2d 走原始坐标，两者差异已在知识卡明确，勿把取反误读到 2D
- cube 无显式 pivot 时兜底取几何中心 `[x+sx/2, y+sy/2, z+sz/2]`
- 悬停监听通过 `canvas._hoverCleanup()` 清理，重绘前必须先调用旧清理函数，禁止累积监听（实现为「先绑定新监听、后清理旧监听」，:65/:119 早退路径不清理——防累积语义成立，与知识卡「先」字表述有顺序出入）
- 骨骼热区（`calcBoneHitZones`）必须应用 cube 级 `c.rotation`（与 drawView 静态分支同口径），否则静态旋转 cube 的拾取命中域 ≠ 绘制形状（P2 修复；btx 仅含 scale/空对象时口径破裂，P3 观察）
- CSS 颜色（骨骼线/标签）在调用方样式中走 CSS 变量
- **`drawMiniView` 的 cosA/sinA 兜底仅对 undefined/NaN 生效**（P2 修复：原 `!cosA` 吞掉合法 0——90° 视图角 cos=0 被替换为 1，小地图失真）
- 消费方：`frontend/src/views/app-preview/skeleton.ts` 与 `zoom.ts`（知识卡旧称仅 skeleton.ts 已过时）；测试文件为 `model2d.test.ts`
- **P3 观察**：`textureImg` 参数全链路传递但零消费（幽灵参数）；自适应 bbox 忽略 c.rotation/boneTransforms（旋转 cube 可能超画布裁剪）；cube 级 `rotation[1]`（Y 旋转）在静态分支与热区均被忽略

## 相关

- [model3d](./model3d.md) — 3D 预览（同一几何口径）
- [animation_system](./animation-system.md) — BoneTransform 来源
- [app_preview](./app-preview.md) — 预览面板消费方
- `frontend/src/views/app-preview/model2d/model2d.test.ts` — 单元测试（验证入口）
- AGENTS.md 致命陷阱 §二 #11
