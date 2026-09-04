# ADR-184：滞留机器区 diff 自动收编：gen-stage 按行内容判定追回 stage，人工策展区保持并发隔离

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/_lib/gen-stage.ts` / `scripts/_lib/machine-diff.ts` / `.githooks/pre-commit` / ADR-151 / ADR-087 / tests/test_machine_diff.ts

---

## 1. 背景（Context）

pre-commit 钩子每次 commit 跑 GEN_CMDS（写模式）同步生成物，gen-stage.ts 以
「stage = 快照变化 − gen 前 dirty」做并发隔离（ADR-151）：gen 前已 dirty 的文件一律
视为并行会话半成品排除，防卷带（实证 fbx-cli-pipeline.md / frontend_test_audit.md
卷进 e96b47e3）。

该判定存在死角：**纯机器区 diff 一旦错过「刷出当次提交」就永久滞留**。gen 幂等刷完
的卡（如 auto_fields.symbols_with_lines 符号增删），若当次提交是 `--only` 路径限定
（只带走自己的文件）或当时无人提交，diff 滞留在工作区；之后任何 commit 开始时它已是
dirty → 被当作「并行半成品」排除 → 永远自动 stage 不进去（实证：event-graph.md
行号漂移版 8a03beaa 后滞留；frontend_repo_audit 的已删符号残留数月）。

「防卷带」与「自动收编生成物」由此冲突：前者需要 dirty 即排除，后者需要纯自动产物
可收编。一刀切排除 = 自动同步机制对滞留 diff 形同虚设；一刀切收编 = 吞并行手改。

## 2. 决策（Decision）

**按 diff 行内容区分机器区与人工策展区，机器区滞留可自动收编，人工策展区保持排除。**

新增 `scripts/_lib/machine-diff.ts`（单一事实源，契约测试守护），对 gen 前已 dirty 的
快照域文件（docs / locales / completions）追加判定：

- **生成物整文件**（GEN_WHOLE_OUTPUTS 清单 + 前缀）：内容 = 全体输入的纯函数，无人工
  策展区 → 无条件收编。`project-map.md` 刻意排除出清单：其 GEN 区用途表是人工知识
  （loadUsageFromDoc 读回），无条件收编会吞并行手改；`routes.md`/`routes-quick.md`
  在清单内：描述列源在卡片 frontmatter（gen-routes 读回），自身无人工维护区。
- **知识卡**（knowledge/ 与 adr/ 下手写卡）：`git diff` 变更行**全部**匹配机器区行模式
  （`auto_fields:` / `symbols:` / `symbols_with_lines:` 键行 + 缩进列表项）→ 纯机器区，
  收编；任一变更行落在人工策展区（正文 prose / use_when / pitfalls / 表格等）→ manual
  排除，并发隔离不放松。
- 空 diff / 非快照域路径 → 不收编（防御）。

接入点：gen-stage.ts CLI 在 computeStageList 之后追回 strandedStageList，pre-commit
保留其 stderr（收编提示与 fail-closed 告警可见）。逃生阀 `YSM_SKIP_GEN_STAGE=1`
恢复旧行为全排除。

## 3. 后果（Consequences）

**正面**：
- 纯机器区滞留 diff（auto_fields / symbols 符号增删、生成物全量态）下次 commit 自动
  stage 收编，不再永久滞留；
- 人工策展区（正文/use_when/pitfalls/表格）dirty 仍排除——ADR-151 卷带红线不放松；
- 判定下沉脚本 + 契约测试（15 用例），行为可测可回归。

**负面 / 已知遗留**：
- 行内容模式匹配是启发式：正文里恰好以「缩进 + `- 符号`」开头的行会被误判为机器区
  （罕见；契约测试已锁「表格/正文列表 → manual」的典型形态）；
- 生成物整文件清单需人工维护（新增 gen 产出文件时补 GEN_WHOLE_OUTPUTS，与
  gen-config.ts SNAP_TARGETS 同责）；
- project-map.md 的用途表人工区滞留仍需手动提交（刻意保留）。

## 4. 数据溯源

来源（工作区实证）→ 判定：
- frontend_repo_audit.md auto_fields 残留 addClearRow/buildDepthMap/buildPresetChipGroup
  （b91f21fd 已删）→ 机器区列表项，收编后 gen 增量清理（8e888d83）；
- go-types.md auto_fields 新增 IsRenderableTextureExt/IsTextureExt（纯机器区）→ machine 收编；
- project-map.md 用途表人工区 diff → manual 排除（不误收编）；
- gen-stage.ts 注释实证 event-graph.md 8a03beaa 滞留案例 → 收编机制覆盖。

<!-- 文件名: diff-gen-stage-stage.md → 实际文件 ADR-184-diff-gen-stage-stage.md -->
