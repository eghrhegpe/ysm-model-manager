---
kind: ai-review-pitfalls
name: AI 审查器偏差与查证方法论（9 轮实战沉淀）
tier: architecture
category: core
status: draft
source_files:
  - frontend/src/preview-3d/caps/ground-surface-spec.ts
tests:
  - frontend/src/preview-3d/caps/ground-surface-spec.test.ts
auto_fields:
  symbols_with_lines:
    - applyGroundSurfaceAppearance
    - applyGroundSurfaceStructural
    - applyOverlayMaterial
    - buildGroundOverlaySpec
    - buildGroundSurfaceSpec
    - DEFAULT_GROUND_SURFACE_PARAMS
    - effectiveParamsOf
    - generateOverlayPixels
    - GROUND_CANVAS_STYLES
    - GROUND_MAT_PARAMS
    - GROUND_MATERIAL_PRESET_IDS
    - GROUND_MATERIAL_PRESETS
    - GROUND_OVERLAY_STYLES
    - GROUND_SOURCE_KINDS
    - GROUND_SURFACE_MODES
    - GroundAxisMapping
    - GroundCanvasStyle
    - GroundMaterialParams
    - GroundMaterialPreset
    - GroundMaterialPresetDef
    - GroundMatParam
    - groundMatSourceFromAxes
    - GroundOverlayParams
    - GroundOverlaySpec
    - GroundOverlayStyle
    - GroundSourceKind
    - GroundSurfaceAppearanceSpec
    - GroundSurfaceMode
    - groundSurfaceNeedsRebuild
    - GroundSurfaceSpec
    - GroundSurfaceStructuralSpec
    - LEGACY_CANVAS_PATTERNS
    - LEGACY_GROUND_MAT_SOURCES
    - LegacyGroundMatSource
    - migrateGroundMatSource
    - OVERLAY_TEX_SIZE
    - overlayNeedsRebuild
    - overlaySpecKey
    - paramIsEffective
    - surfaceSpecKey
    - textureRepeat
    - TILE_WORLD_SIZE
use_when:
  - AI 审查器（code_review）finding 的取舍与查证流程
  - 新层/新范式落地后的回归审核
pitfalls:
  - 审查器 P1 级凭推断的断言必须实测——getClip API（r185 有公开方法）、缓存失效时序（现实调用序先于预热）两条都是「推断成立、实测打折扣」
  - 跑测试是审查器的能力边界——「测试与实现脱钩」类缺陷（拆轴后快照键/通知语义/嵌套错乱）只有 vitest 实测才暴露，审查器只读 diff 文本看不见
  - 新层/新范式必须与既有层行为矩阵对一遍——ADR-249 三轮 13 条真缺陷全是「新层与既有层口径不一致」（repeat/显隐门控/生命周期/订阅语义）
quick_groups:
  - 审查 finding 取舍
  - 测试脱钩
  - 范式回归
quick_intents:
  - 查审查器假阳性/假阴性模式
  - 查拆轴/新增正交层的回归审核要点
quick_risk_lines:
  - 单一事实源矩阵被早退/局部 if 打破 = ADR-249 §2.4 红线
invariant_anchors:
  - docs/adr/ADR-249-ground-material-axis-split-layer-overlay.md|§2.4 生效矩阵
---

# ai-review-pitfalls

## 概览

9 轮 AI 审查器（code_review deep）实战沉淀：~57 条 finding 中真缺陷 15 处、假阳性/已覆盖 ~31 条、留档 ~11 条。本文记录审查器的系统性偏差模式与对应的查证方法论，供后续「审核产出」工作流直接命中。

## 三条核心方法论（经 9 轮检验）

### 1. P1 级凭推断的断言必须实测

审查器对 third-party API 与调用时序的断言常凭记忆/推断：

| 案例 | 审查器声称 | 实测 |
|------|-----------|------|
| `three r185 AnimationAction.clip` | 「无公开访问器，须读私有 `_clip`」 | **有公开方法 `getClip()`**（@types/three 查证）——弃私有读法 |
| `SetSessionFilesRoot` 缓存失效 | 「stale 根清单 = P2 回归」 | 现实触发面为零：唯一调用点在 dispatch 最早期、先于缓存预热；失效方向 fail-closed——**防御纵深补两行 Clear 即可，非紧急回归** |

**做法**：P1/P2 且涉及 API 形状或时序的 finding，先 grep 消费方 + 读类型定义/实现 + 实测 API，再定真伪。

### 2. 跑测试是审查器的能力边界

审查器只分析 diff 文本，看不见「测试与实现脱钩导致的红」。ADR-249 阶段 2 拆轴后 3 处测试脱钩（矩阵快照仍喂旧键 `env.groundMatSource`、订阅通知语义 1→2、嵌套 `});` 错乱致 esbuild Transform 失败），审查器只报了 1 条，另 2 条靠 `npx vitest run` 实测暴露。

**做法**：审核任何「改契约/改状态字段名」的 commit，**必须跑该模块全量测试域**（如 `npx vitest run src/preview-3d/caps/`），不能只看审查器报告。

### 3. 新层/新范式必须与既有层行为矩阵对一遍

ADR-249 三轮审核的 13 条真缺陷**全部**属「新引入的正交层与既有层行为口径不一致」：

| 新层 | 与 surface 层的口径漂移 |
|------|------------------------|
| texture 来源（阶段 1） | `matScale`/`matRotationDeg` 对 `mat.map = customTex` 同样生效，却被 `mode === "texture"` 早退一并判死 |
| 拆轴字段（阶段 2） | 菜单改读 `env.groundSourceKind`/`env.groundCanvasStyle`，测试快照/订阅语义没跟上 |
| 叠加层 mesh（阶段 3） | `tex.repeat` 缺失（surface 有 `textureRepeat`）、`setVisible` 漏跟、`setEnabled` 未重算 visible、none 分支稳态重传 |

审查器抓这类问题的机理是**交叉对账**：读既有层实现（`applyGroundSurfaceAppearance`/`updateSurfaceVisible`）对照新层缺口，而非读单点代码。

**做法**：新增正交层（第二个 mesh/第二组状态字段/第二条渲染管线）时，逐项核对既有层的：材质参数落地路径、显隐门控（visible 由谁写）、生命周期（dispose/rebuild/重挂）、事件通知面。

## 审查器偏差速查

- **孤立 commit 快照**：finding 基于该 commit 时的代码，不核后续提交是否已修（门禁三连 10 条中 6 条假阳性；overlaySize 死控件在审前已被 `24be598e8` 修掉）。**实测**：ADR-253 D5 审核中 5 条 P1/P2 全部指向「3 个 FAB 回归测试假信心」——但那些测试随 D7（删除 3D FAB）已被后续提交移除，HEAD 现状零残留。**结论：审计 commit 前先 `git log` 看该 commit 之后是否有同源后续提交，finding 涉及的文件若已被改写则整组降权**。
- **测试断言矩阵值而非渲染行为**：矩阵测试锁期望值，矩阵本身错了测试照样绿——须有另一条「矩阵 vs 渲染真实行为」的 Suite 交叉护栏（ADR-249 Suite 2 模式）。
- **维度未完成时降权**：`Failed dimensions: correctness, tests_contracts` 等标注说明该维度跑挂了，finding 覆盖不可靠，须自查补位。
- **横切机制必须盘点所有写入来源**（方法论第 4 条）：新增全局写入中间件/AOP/全局订阅时，同一 commit 里必须盘点所有写入方并显式分类豁免——ADR-254 的「手改即 custom」中间件只想到拦用户 setter，loadState 恢复路径被误伤（用户预设重启恒显 custom），probe 实测锤实。

## 相关

- `docs/adr/ADR-249-ground-material-axis-split-layer-overlay.md`（§2.4 矩阵单一事实源——本轮方法论的最大实证场）
- `docs/adr/ADR-109-code-review-checklist.md`（人工审核流水线，与本文 AI 审查器偏差互补）
- `skills/pitfalls.md`（致命陷阱手册——事故教训，本文为审查方法论）
