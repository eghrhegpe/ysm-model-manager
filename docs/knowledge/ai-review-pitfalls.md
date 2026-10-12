---
kind: ai-review-pitfalls
name: AI 审查器偏差与查证方法论（10 轮实战沉淀）
tier: architecture
category: core
status: active
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
    - effectiveParamsOf
    - generateOverlayPixels
    - GROUND_MAT_PARAMS
    - GROUND_MATERIAL_PRESETS
    - GROUND_SURFACE_MODES
    - GroundAxisMapping
    - GroundMaterialPreset
    - GroundMaterialPresetDef
    - GroundMatParam
    - groundMatSourceFromAxes
    - GroundOverlayParams
    - GroundOverlaySpec
    - GroundSurfaceAppearanceSpec
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
    - surfaceTextureToken
    - textureRepeat
    - TILE_WORLD_SIZE
use_when:
  - AI 审查器（code_review）finding 的取舍与查证流程
  - 新层/新范式落地后的回归审核
  - 子代理/审查报告的采信纪律
  - 去哪里找真缺陷（缺口定位法）
pitfalls:
  - 审查器 P1 级凭推断的断言必须实测——getClip API（r185 有公开方法）、缓存失效时序（现实调用序先于预热）两条都是「推断成立、实测打折扣」
  - 跑测试是审查器的能力边界——「测试与实现脱钩」类缺陷（拆轴后快照键/通知语义/嵌套错乱）只有 vitest 实测才暴露，审查器只读 diff 文本看不见
  - 新层/新范式必须与既有层行为矩阵对一遍——ADR-249 三轮 13 条真缺陷全是「新层与既有层口径不一致」（repeat/显隐门控/生命周期/订阅语义）
  - 审查报告的分级不可直接采信——第 10 轮三域审查的 P1/P2 抽验 3/3 不成立（2 项性质不符、1 项早已实现）；分级由「命中了模式」而非「实测确认」产生
  - 本仓注释默认是「已处理的历史」而非待办——顺「同族未治/已知限制」注释找缺口，9 条候选仅 1 条真是待办（其余是病历记录或刻意设计）
  - 只读单点代码找不到真缺陷——第 10 轮全部产出（7 批）都来自「跳出单一模块自检范围」的三类缺口
quick_groups:
  - 测试与验证
quick_intents:
  - 评估子代理/审查报告可信度（分级不可采信）
  - 查审查器假阳性/假阴性模式
  - 去哪里找真缺陷（高产出缺口类型 A/B/C）
  - 查拆轴/新增正交层的回归审核要点
  - 审查 finding 的基线新鲜度核对（audit-freshness）
quick_risk_lines:
  - 单一事实源矩阵被早退/局部 if 打破 = ADR-249 §2.4 红线
  - 审查报告分级不等于实测结论——P1/P2 抽验后方可采信
invariant_anchors:
  - docs/adr/ADR-249-ground-material-axis-split-layer-overlay.md|§2.4 生效矩阵
---

# AI 审查器偏差与查证方法论（10 轮实战沉淀）

## 概览

10 轮 AI 审查器（code_review deep / 子代理分区审查）实战沉淀：~57 条 finding 中真缺陷 15 处、假阳性/已覆盖 ~31 条、留档 ~11 条；第 10 轮为 3 子代理分域审查（架构性能 / UI 视觉 / 渲染管线，50+ 项），主代理抽验 **3/3 不成立**、另**顺同族扩捕**出 6 处真缺陷（共 7 批提交）。本文记录审查器的系统性偏差模式与对应的查证方法论，供后续「审核产出」工作流直接命中。

## 四条核心方法论（经 10 轮检验）

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
| 拆轴字段（阶段 2） | 菜单改读 `cap.groundSourceKind`/`cap.groundCanvasStyle`，测试快照/订阅语义没跟上 |
| 叠加层 mesh（阶段 3） | `tex.repeat` 缺失（surface 有 `textureRepeat`）、`setVisible` 漏跟、`setEnabled` 未重算 visible、none 分支稳态重传 |

审查器抓这类问题的机理是**交叉对账**：读既有层实现（`applyGroundSurfaceAppearance`/`updateSurfaceVisible`）对照新层缺口，而非读单点代码。

**做法**：新增正交层（第二个 mesh/第二组状态字段/第二条渲染管线）时，逐项核对既有层的：材质参数落地路径、显隐门控（visible 由谁写）、生命周期（dispose/rebuild/重挂）、事件通知面。

### 4. 审查报告的分级 ≠ 实测结论（第 10 轮立）

第 10 轮 3 子代理分域审查输出 50+ 项（含 P1 六项）。主代理抽验 **3/3 不成立**：

| 子代理结论 | 核实结果 | 根因 |
|---|---|---|
| 「FAB 缺 `aria-label`，屏幕阅读器不可达」（P3） | **早已实现**：`fab.ts|createIconButton` 设了 `aria-label`，且有专测守护 | 未读目标函数体，凭通用经验外推 |
| 「`resolveGpuLoadLimits` 每帧 JSON 解析，热路径 anti-pattern」（P2） | **性质不符**：只在**窗口结算帧**（每 30 帧）调用；源码注释已论证开销可接受 | 命中「localStorage + rAF 附近」即报热路径，**未数调用频率** |
| 「`cap.update` 每帧遍历 10+ cap 应筛列表」（P2） | **性质不符**：同文件既有注释已论证该判据**恒真且语义错误**，刻意不做 | 未读**紧邻的既有权衡注释** |

**做法**：报告到手先跑 `node scripts/audit-freshness.ts --base <基线> --files ...`（既有工具，见下「审查器偏差速查」），再对 P1/P2 **逐条抽验**——**抽验不是抽查，是采信前置条件**。分级由「命中了模式」产生，不由「实测确认」产生。

## 高产出缺口类型（第 10 轮：7 批提交全部来自此处）

第 10 轮的实证：**在已被审计覆盖的区继续扫，产出趋零**（换区扫 `views/app-content` 1935 次改动 / 158 文件，9 个候选全部「已修或已正确守卫」）。真缺陷集中在**不属于任何单一模块自检范围**的三类缺口：

### 类型 A：跨模块隐性契约（命中 4+3 处）

某处代码的**正确性依赖另一模块的实现细节**，而该细节未被类型或文档编码。

- **实证**：`wasm-decode.ts` 四处 Blob 构造用 `bytes.buffer`，正确性依赖「`FS.readFile`/`base64ToBytes` 恰好返回占满底层 buffer 的数组」——上游一旦改零拷贝视图即**静默损坏**（纹理花屏/VPD 姿态文件坏，不报错）。首轮修 4 处，次轮**顺同族扩捕**又得 3 处（含 `blobUrlToImageData` 的 `ImageData.data.buffer`，实测注入偏移视图后送出 12 字节而非 4）。
- **找法**：搜 `.buffer`、`as ArrayBuffer`、`new Blob([`、`postMessage(..., transfer)`；对每处问「这个前提由谁保证？那个模块改了我会不会静默坏？」
- **判据**：**同一文件/同一族内两种写法并存即债**（不必等真实故障）。

### 类型 B：上游库的真实行为（命中 2 处）

我们**以为**库会做的事，与源码实际做的事不符。

- **实证**：① `SSRPass.dispose()` 释放 7 个 RT + 7 个材质，**唯独漏掉主 `ssrMaterial`**（持全部 uniforms/textures）→ 每次拆链漏一个 ShaderMaterial；② `SSRPass` 本就提供 `resolutionScale`（默认 1）且 `setSize` 内 `MAX_STEP = √(w²+h²)`（步进 ∝ 屏幕对角线）——**本仓从未启用**，即上游已给的性能旋钮闲置。
- **找法**：读 `node_modules/<lib>` 源码（本仓惯例：`water.md` 的 three r186 释放取证、`preview-core.md` 的 wails 上游取证）。**对「我们依赖的库行为」不要靠记忆。**
- **副产品**：读上游常直接给出更好的解——`resolutionScale` 比「全屏降分辨率」精准得多（只缩 SSR 自己的缓冲，主渲染不受影响）。

### 类型 C：帧时序 / 执行顺序（命中 2 处）

「谁先谁后」的语义，**没有任何类型系统或单模块测试能守**。

- **实证**：① 水面倒影 RT 挂在 `cap.update()`，而该钩子在 rAF 每帧的**前段**——早于 perFrame 骨骼动画 ⇒ 动画模型倒影**恒滞后一帧**（源码注释早已记录此限制并标「另议」，第 10 轮落实）；② `restoreOutputSettings` 以「sky 在场」整块跳过 → 用户选非 aces 色调映射时**残留第三种状态**。
- **找法**：读帧循环（`render-host|animate` 等）的**调用序**，对每个 hook 问「它读的状态在此刻是本帧的还是上一帧的？」；对「谁在场就跳过」型判据问「在场 = 持有吗？」

### 附带方法：变异验证才知「判别力」

第 10 轮每项修复都做**变异验证**（把修复改回去，确认测试转红）。**关键收获**：`encodeToKTX2` 那处改动**变异未被捕获**——因为上游修好后两条路径结果相同，它是**纵深防御**而非载荷修复。

**做法**：**改动量 ≠ 判别力**。申报成果时须区分「真正修掉缺陷的改动」与「顺手的纵深防御」，不得混为一谈；对每项修复执行「还原 → 测试应红」，未红者如实标注为纵深防御。

## 审查器偏差速查

- **孤立 commit 快照**：finding 基于该 commit 时的代码，不核后续提交是否已修（门禁三连 10 条中 6 条假阳性；overlaySize 死控件在审前已被 `24be598e8` 修掉）。**实测**：ADR-253 D5 审核中 5 条 P1/P2 全部指向「3 个 FAB 回归测试假信心」——但那些测试随 D7（删除 3D FAB）已被后续提交移除，HEAD 现状零残留。**结论：审计 commit 前先 `git log` 看该 commit 之后是否有同源后续提交，finding 涉及的文件若已被改写则整组降权**。**已工具化**（2026-10-09 锐评第四刀）：`node scripts/audit-freshness.ts --base <审计基线> --files <finding 涉文件逗号分隔>` 逐文件三分类——🟢stable（基线后未动，值得逐条实证）/🟠rewritten（已被改写，降权并附证据提交）/🗑deleted（失效）；基线不可解析 exit 2 fail-closed（「判不了」绝不冒充「全部 stable」）。先跑它再决定哪些 finding 值得查证，把本条从散文记忆变成一条口令。
- **测试断言矩阵值而非渲染行为**：矩阵测试锁期望值，矩阵本身错了测试照样绿——须有另一条「矩阵 vs 渲染真实行为」的 Suite 交叉护栏（ADR-249 Suite 2 模式）。
- **维度未完成时降权**：`Failed dimensions: correctness, tests_contracts` 等标注说明该维度跑挂了，finding 覆盖不可靠，须自查补位。
- **横切机制必须盘点所有写入来源**（方法论第 4 条）：新增全局写入中间件/AOP/全局订阅时，同一 commit 里必须盘点所有写入方并显式分类豁免——ADR-254 的「手改即 custom」中间件只想到拦用户 setter，loadState 恢复路径被误伤（用户预设重启恒显 custom），probe 实测锤实。
- **⚠️ 本仓注释默认是「已处理的历史」，不是待办**（第 10 轮实证，**省时优先读**）：本仓注释惯例是「记病 + 修法 + 守卫位置」，读上去极像未修项。第 10 轮顺「同族未治/已知限制/另议/暂不改」注释找缺口，**9 条候选仅 1 条真是待办**：
  - 假待办三种形态：①**病历记录**（`pack-model-adapter` 注释详述「唯一不注册 frustum 根」之病，紧接着 L342 `registerModelRoot(group)` 已修）；②**刻意设计**（`mount-session|disposeAll` 仅最后会话拆的守卫）；③**已裁决**（`mmd-ktx2-basis` 的 P3-9「暂不改」给出了完整的风险/收益论证）。
  - **判据**：读注释要**读到段落末尾**（修法往往在正文后半）；看到「已修/已收口」直接跳过；看到「另议/待定」再查是否有对应 ADR 或知识卡条目——**有论证的「不做」是决策，不是债**。
  - **高价值例外**：注释说「真要做须 X（另议）」的**结构性调整**（如 `water-reflect` 的「须把 RT 渲染移到相机输入之后」）——那是**已定位的缺口**，只要 X 可做就是真待办（第 10 轮据此修掉倒影滞后一帧）。

## 相关

- `docs/adr/ADR-249-ground-material-axis-split-layer-overlay.md`（§2.4 矩阵单一事实源——第 9 轮方法论的最大实证场）
- `docs/adr/ADR-109-code-review-checklist.md`（人工审核流水线，与本文 AI 审查器偏差互补）
- `skills/pitfalls.md`（致命陷阱手册——事故教训，本文为审查方法论）
- `docs/knowledge/3d-patterns.md`（3D 区的审核驱动开发 + §7.x 多轮审核误报规律；本文是其跨域上位方法论）
- `scripts/audit-freshness.ts`（finding 涉文件的基线后三分类：stable / rewritten / deleted）
- 第 10 轮产出的具体修复与不变量：`docs/knowledge/model3d.md`（Blob 视图语义族、SSRPass.dispose 补丁、空转短路、帧末钩子、worker 池语义）、`docs/knowledge/water.md`（倒影帧时序）、`docs/knowledge/export.md`（阴影入截图）
