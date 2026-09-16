---
kind: ground_texture_gen
name: 程序化地面贴图生成 surface-pixels
tier: architecture
category: rendering
status: active
source_files:
  - frontend/src/preview-3d/caps/surface-pixels/index.ts
auto_fields:
  symbols_with_lines:
    - generatePlainPixels
    - SURFACE_PIXEL_GENERATORS
tests:
  - frontend/src/test-utils/index.test.ts
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-sync-manager/index.branches.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/index.extra.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 修改地面材质（草/大理石/沙）的像素形状，或新增材质时
  - 排查地面贴图重建频率、平铺重复、接缝问题时
pitfalls:
  - 在生成器里 import three 或 DOM → 破坏 node 单测与 src/core 隔离边界
  - 改像素算法却不更新 ground-surface-spec.test.ts（确定性/非均匀/跨材质差异用例）
  - 误以为 surface-pixels 管 spec/key —— 那些仍在 ground-surface-spec.ts
quick_groups:
  - 地面材质
  - 程序化贴图
  - 噪声生成
quick_intents:
  - "草为什么是圆斑不像纤维" → 各向异性坐标拉伸（grass.ts 的 ANISO_X）
  - "大理石没有脉络像团块" → domain warping（marble.ts 的 sin(x + k·fbm)）
quick_risk_lines:
  - 改生成器算法前确认 surfaceSpecKey 不含像素字段（否则触发无谓重建）
invariant_anchors:
  - frontend/src/preview-3d/caps/surface-pixels/index.ts|SURFACE_PIXEL_GENERATORS
---

# 程序化地面贴图生成 surface-pixels

## 概览

`caps/surface-pixels/` 是 ground 地面材质（plain / marble / sand / grass）的纯像素生成器目录，从 `ground-surface-spec.ts` 的 `generateSurfacePixels` 内联 `switch(mode)` 下沉而来。每材质一个文件 + 共享 noise 原语，**零 three 运行时依赖、零 DOM，node 可测**。

## 核心职责

- 把 `GroundSurfaceStructuralSpec` 投影为 `SurfacePixelInput`（`surface-pixels/types.ts`），查表分发到对应生成器，产出 `sizePx²` RGBA `Uint8Array`。
- `marble`：domain warping `sin(x + k·fbm(p))` → 脉络（非团块）。
- `grass`：各向异性坐标拉伸（`ANISO_X = 0.35`，x 轴压缩频率）→ 定向纤维（非圆形斑块）。
- `sand`：高频低对比噪声；`plain`：纯色填充（solid/plain 共用 `generatePlainPixels`）。

## 对外 API / 入口

- `generateSurfacePixels(st, sizePx)`：在 `ground-surface-spec.ts`，退化为 dispatcher，spec/key/apply 不动。
- `SURFACE_PIXEL_GENERATORS`：`Record<SurfaceCanvasStyle, SurfacePixelGenerator>` 调度表（`index.ts`）。
- 调用方：`ground-capability.ts` 的 `makeGeneratedTexture` 把产物包成 `DataTexture`（`RepeatWrapping`）。

## 与其他子系统关系

消费 `GroundSurfaceStructuralSpec`（来自 `ground-surface-spec`）；输出供 `ground-capability.makeGeneratedTexture` 包成 `DataTexture`。本目录**只管像素算法**，spec 构建 / `surfaceSpecKey` / `apply*` 仍归 `ground-surface-spec.ts`。

## 不变量

- `surfaceSpecKey` 只序列化 structural 字段，与像素算法无关 → 重构/改算法不触发无谓重建。
- `generateSurfacePixels` 确定性：种子化噪声（`hash2`），非 `Math.random`。
- 零 three 运行时 import（仅 `type`），保留 node 单测能力。

## 行业形状质量手法（2026-09-16 网页检索：unity / three / glsl）

- **草（各向异性）**：游戏行业多不用平铺贴图做草（InstancedMesh + 贝塞尔草叶 + 风噪声）；本场景是地面 albedo 平铺贴图，对应**各向异性坐标拉伸**或 **Gabor 噪声**（定向微细节）。
- **大理石（脉络）**：全网共识 `sin(x + k·fbm(p))`——正弦带被 fbm 湍流掰弯成脉络（domain warping，Inigo Quilez）。团块感源于缺这步。
- **平铺无缝**：生成的 `DataTexture` 要真正无接缝，应采样 **4D 环面噪声** `(cos,sin,cos,sin)→4D noise`；且「无缝 ≠ 无重复」，需双变体混合/随机化/宏观叠加破重复（**留待后续增强，不影响当前正确性**）。

## 相关

- ADR-254 §6（行业对标 + 拆分落地）
- `docs/knowledge/ground_surface_spec.md`（材质 spec 单一事实源）
