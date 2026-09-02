# ADR-155：commit-with-check 重构为独立轻量提交校验（与重型 push 门禁解耦）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-02
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/commit-with-check.ts`、`scripts/_lib/commit-check.ts`、`scripts/pre-push-gate.ts`；ADR-086（验证+提交一站式）、ADR-151（临时索引白名单提交）

---

## 1. 背景（Context）

`commit-with-check` 原是 `pre-push-gate.ts` 的 thin wrapper（委托 `--files --dry-run`），即"提交阶段跑一遍重型 push 门禁"。
由此产生两个结构性问题：

- **双重付费**：`commit-with-check` 跑一遍重型门禁，随后 `git push` 的 pre-push 钩子再跑一遍同一门禁——同一次改动被验两次。
- **定位迷糊**：工具名"commit"却干"push 预演"的活，对 go/frontend 提交会触发 `go build`/`vite build`/`go test -race`/`vitest`，对 scripts 提交会触发全量契约测试（`contract-tests.ts` 中 `tests` 域 `return all`），轻量提交被重型校验拖垮。

用户对"改完直接 `git commit` + 靠 pre-push 兜底"的直觉更优：门禁只付一次（push 阶段），且 commit 阶段只答"我的 diff 干净吗"。

## 2. 决策（Decision）

将 `commit-with-check` 从"pre-push 薄封装"重构为**独立轻量提交校验**，职责清晰地与重型 push 门禁（pre-push 钩子）分离：

- commit 阶段只跑**按文件裁剪的廉价检查**（新建 `_lib/commit-check.ts`）：
  1. `check-redlines --files`（仅查变更文件内新增违规；`scanHealthy` fail-closed）
  2. `check-doc-drift --files` + `check-knowledge-drift --files`（仅查变更卡；跳未跟踪草稿）
  3. 变更域契约测试（`selectContractTests` 按域选子集、并行）
- **显式跳过**重型验证，交由 pre-push 钩子兜底：go build / go test -race / go vet、vite build / vitest、link-checker / type-consistency / release-notes、FRONTEND/GO/DOC 全量静态工具清单。
- `commit-with-check.ts` 改为调用 `runCommitChecks(paths)`，不再 `import`/`spawn` `pre-push-gate`（后者顶层 `main()` 自触发，不可复用）。
- `--docs` 模式：收集已变更的 `docs/` 文件作 `--files` 传入，同样按文件裁剪。

## 3. 后果（Consequences）

- ✅ 职责清晰：commit=我的 diff 干净吗（便宜）｜push=整域还建得起来吗（贵），无重复重型付费。
- ✅ go/frontend 提交不再在 commit 阶段跑 `go build`/`vite build`，感知明显变轻。
- ⚠️ **scripts 提交仍偏重**：`scripts/` 改动归 `tests` 域，`selectContractTests` 按策略 `return all`（工具改动影响面大，不可裁剪）。这是既有策略，本次不改；如需进一步瘦身可单独评估"按变更文件精确选契约测试"。
- ⚠️ commit 阶段不再编译校验 go/frontend——类型/构建错误改由 pre-push 钩子拦截；若希望更早 fail-fast，应主动在终端跑 `go build`/`vite build`，而非依赖 commit 工具。
- ✅ 重型门禁单一源头仍是 `pre-push-gate`，清单不双写（原子检查脚本复用，编排器不复用）。

## 4. 数据溯源

- 来源：用户复盘 `commit-with-check` 实用性 → 确认其 100% 委托 `pre-push-gate --files --dry-run`（耦合设计）+ scripts 提交触发全量契约测试（`contract-tests.ts:108`）。
- 结果：新建 `_lib/commit-check.ts` 独立轻量清单；`commit-with-check.ts` 改写委托；`typecheck:scripts` 全绿。

<!-- 文件名: commit-with-check-lightweight.md → 实际文件 ADR-155-commit-with-check-lightweight.md -->
