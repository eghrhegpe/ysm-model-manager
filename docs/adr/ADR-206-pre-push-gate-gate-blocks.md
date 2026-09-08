# ADR-206：pre-push-gate 收敛分拆为 gate-blocks

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-08
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/pre-push-gate.ts`、`scripts/_lib/gate-parse.ts`、`scripts/_lib/gate-resolve.ts`、`scripts/_lib/gate-config.ts`、`tests/test_gate_parse_output.ts`

---

## 1. 背景（Context）

`scripts/pre-push-gate.ts`（1093 行）长期承担「stdin 解析 → 多 ref 变更集 → merge-base fallback → 域分类 → 五个域检查块 → 静态工具 runTools → 契约测试 → 聚合/退出」全部职责。2026-09-08 脚本体系锐评 P0 指出：该文件作为「门禁调度器」拥抱了「构建系统」的体量，每次改动需通读上千行、跨域共享变量靠 main 闭包隐式耦合，是仓库里最重的 ent单文件。

此前治理已多次收敛同类问题：`gate-config.ts` 抽出工具清单、`domain-classify.ts` 消除 doctor/gate 双端漂移、`gate-parse.ts` 收敛 11 处 JSON 解析判定、`gate-resolve.ts` 收敛基线 fallback 链（本会话 R1–R4/R5）。P0 是把最后这块神对象按同一思路收尾。

## 2. 决策（Decision）

将 `pre-push-gate.ts` 按「可泛化的收敛 + 显式特例保留」分拆为独立模块，使其只剩调度骨架（~400 行）：

1. **新增 `scripts/_lib/gate-ctx.ts`**：唯一 `GateCtx` 上下文（含 record 闭包工厂、sh/shAsync/git/gofmtCheck 助手、plan/files/byDomain/push refs、setBlocked）。终结域块对 main 闭包变量的直连。
2. **新增 `scripts/_lib/gate-blocks/*`**：按域拆出执行器，签名统一 `runXxx(ctx: GateCtx)`：
   - `static-tools.ts`（runTools + runScopedDocDrift）
   - `data-docs-domain.ts`（数据/文档/ADR/gen-docs-index）
   - `redlines.ts`（failClosed 特例隔离）
   - `schedule.ts`（契约测试 + 静态调度 + scripts typecheck）
   - `go-domain.ts` / `frontend-domain.ts`（最大块最后做）
3. **`gate-parse.ts` 加法扩展**：新增 `parseToolOutput(out, rc, tool?, opts?: { okMustBeTrue?: boolean })` 覆盖选项，统一 menu/i18n/binding 三处"限定必 true"判定。**不改既有签名/优先级契约**（`test_gate_parse_output.ts` 已锁死），缺省行为完全一致。
4. **显式特例不塞进通用契约**：
   - 编译/测试块天然 rc 判定（go build/test/vite/tsc/vitest）；
   - `redlines` 的 failClosed（`scanHealthy=false` 才硬阻）保留 `tryParseJson` 手工解析 + `ctx.setBlocked(true)`；
   - 数据/文档域 `issues===0`/`links_broken===0` 为 fail-closed 语义，判定逻辑原样搬，仅加注释说明。
5. **每一域块的 `record()` 行为像素级不变**：label/note/tail/raw/blockPolicy/time 字面量原样搬动，ok 判定逻辑不改；退出码与 blockPolicy 语义不变。

不做的（防过度拆解）：不统一 failClosed/「限定必 true」成新通用契约；不拆聚合/退出段（保留在 main，仅作为调度骨架的一部分）。

## 3. 后果（Consequences）

- **正面**：pre-push-gate.ts 体量降至 ~400 行（纯调度骨架）；域块独立可测、可读；跨域共享变量经 `GateCtx` 显式传递；新增检查的样板降为「一个小模块 + 一次调度」，符合"门禁调度器"而非"构建系统"的定位。
- **负面**：新增 `_lib/gate-blocks/*` 多个模块会增加目录文件数；迁移期需保证 8 阶段每次 record/退出码无漂移（靠三模式 dry-run baseline diff 守护）。
- **已知遗留**：阶段 6 的 Go/前端大域块搬移工作量最大、风险最高，按计划放最后并逐字搬；加强后仍保留"编译/测试 rc 判定 + redlines failClosed"两类非通用判定作为显式特例。

## 4. 数据溯源

- 来源：2026-09-08 脚本体系锐评（P0：pre-push-gate 神对象；P2：BlockPolicy 语义歧义；P1：gate-parse 收敛未覆盖域块）。
- 分阶段落点：ADR-206 只记决策方向；阶段实施进度与每阶段验证（三模式 dry-run baseline diff + 契约测试 + 提交）记入知识卡 `pre_push_gate.md`。

<!-- 文件名: pre-push-gate-gate-blocks.md → 实际文件 ADR-206-pre-push-gate-gate-blocks.md -->