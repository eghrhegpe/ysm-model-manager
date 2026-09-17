---
kind: ground_texture_gen
name: 程序化地面贴图生成 surface-pixels
tier: architecture
category: rendering
status: active
source_files:
  - frontend/src/preview-3d/caps/surface-pixels/index.ts
  - frontend/src/preview-3d/caps/surface-pixels/anti-repeat.ts
auto_fields:
  symbols_with_lines:
    - AntiRepeatDualOptions
    - AntiRepeatOptions
    - AntiRepeatStrategy
    - derandomize
    - derandomizeDual
    - generatePlainPixels
    - lowFreqMask
    - makeDecorrelatedVariant
    - maxSeamDiscontinuity
    - maxWrapSeamDiscontinuity
    - repetitionScore
    - SURFACE_PIXEL_GENERATORS
    - textureRepeatForDerepeat
    - tilePlain
tests:
  - frontend/src/preview-3d/caps/surface-pixels/anti-repeat.test.ts
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
  - 在生成器内对坐标做 2D 旋转来施加 angleRad → 破坏 4D 环面周期，平铺露接缝。angleRad 必须走 tiledFbm 的「环面相位偏移」（任意角度无缝）；整体旋转归 GPU texture.rotation
  - 把「4D 环面无缝」当成「无重复」——**4D 只治接缝，不治重复**。平铺后「每两米出现同一明星特征」是「无缝但有规律重复」，须用 `anti-repeat.ts` 的 macro/dual/stochastic 治理
  - anti-repeat 的输入 tile **必须本身无缝**（周期=S）；非无缝输入它不补接缝，只治重复。本项目的程序化材质（tiledFbm）与已平铺无缝的 PNG 满足
  - macro 的 `macroStrength=0` 必须退化为原平铺（factor=1 逐像素相等）——改 macro 时此回归用例（anti-repeat.test.ts）会锁死
quick_groups:
  - 地面材质
  - 程序化贴图
  - 噪声生成
quick_intents:
  # 注：值内的引号用中文「」而非 YAML 的 " "——以双引号开头会被当成 YAML 字符串定界符，
  #   闭合后的 `→ ...` 尾部即成非法内容（VitePress 报 bad indentation of a sequence entry，Pages 长期红）。
  - 「草为什么是圆斑不像纤维」→ 各向异性坐标拉伸（grass.ts 的 ANISO_X）
  - 「大理石没有脉络像团块」→ domain warping（marble.ts 的 sin(x + k·fbm)）
  - 「平铺后每隔约两米出现同一个明星特征」→ 无缝但有规律重复，用 anti-repeat.ts（macro/dual/stochastic 三选一或组合）
quick_risk_lines:
  - 改生成器算法前确认 surfaceSpecKey 不含像素字段（否则触发无谓重建）
invariant_anchors:
  - frontend/src/preview-3d/caps/surface-pixels/index.ts|SURFACE_PIXEL_GENERATORS
  - frontend/src/preview-3d/caps/surface-pixels/anti-repeat.ts|derandomize
  - frontend/src/preview-3d/caps/surface-pixels/anti-repeat.ts|derandomizeDual
  - frontend/src/preview-3d/caps/surface-pixels/anti-repeat.ts|repetitionScore
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
- `generateSurfacePixels` 确定性：种子化噪声（`hash2` / `hash4`），非 `Math.random`。
- 零 three 运行时 import（仅 `type`），保留 node 单测能力。
- **无缝**：噪声材质（marble/sand/grass）一律走 4D 环面噪声 `tiledFbm`（`noise.ts`），纹理自身 `RepeatWrapping` 无接缝。`angleRad` 是「环面相位偏移」（任意角度无缝），整体旋转归 GPU `texture.rotation`。

## 行业形状质量手法（2026-09-16 网页检索：unity / three / glsl）

- **草（各向异性）**：游戏行业多不用平铺贴图做草（InstancedMesh + 贝塞尔草叶 + 风噪声）；本场景是地面 albedo 平铺贴图，对应**各向异性坐标拉伸**（`ANISO_X = 0.35` 压缩 x 轴频率）或 **Gabor 噪声**（定向微细节）。
- **大理石（脉络）**：全网共识 `sin(x + k·fbm(p))`——正弦带被 fbm 湍流掰弯成脉络（domain warping，Inigo Quilez）。团块感源于缺这步。
- **平铺无缝（已落地）**：生成的 `DataTexture` 用 **4D 环面噪声** `(cos,sin,cos,sin)→4D noise` 采样，u=0 与 u=1 落回同点 → 严格周期 1 → 无接缝。验证见 `ground-surface-spec.test.ts` Suite 9（`tiledFbm(u,v) ≡ tiledFbm(u+1,v)`）。**注意：4D 只治接缝，不治重复**——「无缝 ≠ 无重复」的重复感由 `anti-repeat.ts` 治理（见下）。

## 反重复（anti-repeat）：治「无缝但有规律重复」

输入：一张**本身无缝**的 `S×S` RGBA 贴图（程序化材质 = tiledFbm 产物；或已平铺无缝的 PNG）。
输出：`outSize = tilesPerAxis * S` 的 `outSize²` RGBA，**仍无缝**（可继续 RepeatWrapping），但内部 `tilesPerAxis²` 子块彼此去相关 → 可见重复周期被放大 `tilesPerAxis` 倍。部署时纹理 `repeat` 须由基线 `R` 调为 `R / tilesPerAxis`（`textureRepeatForDerepeat`，保持每米密度不变）。

三解法（可单用或组合）：

| 解法 | 输入 | 机制 | 适用场景 |
|---|---|---|---|
| **macro** | 1 张 tile | 整张大图叠加低频明暗场（非周期 fbm2），相邻子块整体色调不同 | 最快、零额外生成；底层已够丰富时首选；只改明暗不 relocate 特征 |
| **dual** | 2 张不同变体 tile（A/B） | 低频 mask 把 A/B 软聚成「A 簇/B 簇」混合 | 自然材质两种真实形态可信混交（草/泥/沙）；最自然；2× 生成成本 |
| **stochastic** | 1 张 tile | 每子块随机朝向/翻转 + 边界羽化回 base 保无缝 | 英雄面、想要「看似随机铺就」；最强去相关 |

- 量化：`repetitionScore` = 相邻子块平均归一化 MAD（0=完全重复，越大去重复越强）；`maxSeamDiscontinuity` 验证未引入新缝。单测见 `anti-repeat.test.ts`（14 用例）。
- 单张 tile 想造「近似变体 B」可用 `makeDecorrelatedVariant`（旋转+通道微偏移），但**最佳效果请传两份真实不同种子的程序化结果**。
- 固有残差缝：4D 环面噪声在固定分辨率下，最高频 octave 在边界像素间有亚像素相位差（S=512 实际可忽略）；anti-repeat 契约是「不引入新缝」（输出缝 ≤ 源缝 max），不消除该固有残差。

## 相关

- ADR-254 §6（行业对标 + 拆分落地）
- `docs/knowledge/ground_surface_spec.md`（材质 spec 单一事实源）
