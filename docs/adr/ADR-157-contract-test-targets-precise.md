# ADR-157：契约测试 TARGETS 宽哨兵收敛为精确文件清单

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-02
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-155（commit-with-check 解耦为独立轻量提交校验）、ADR-156（契约测试按变更文件精确裁剪）、`scripts/_lib/contract-tests.ts`（`CONTRACT_TEST_TARGETS`）、`tests/test_scripts_json.ts`（`JSON_SCRIPTS`）

---

## 1. 背景（Context）

ADR-156 引入 `CONTRACT_TEST_TARGETS`（测试→保护源模块映射），将 `tests` 域从「全量回落」改为「按文件精确裁剪」。但首批收敛时，三个测试因"保护对象跨多个脚本"被登记为宽哨兵 `['scripts/']`：

- `test_scripts_json`：实际仅校验 `tests/test_scripts_json.ts:24-36` 的 `JSON_SCRIPTS` 枚举的 **11 个** `--json` 脚本。
- `test_codemod_guards`：仅 spawn `scripts/codemod.ts`（含 `go.mod` 模块名推导校验）。
- `test_sidebar_gen`：仅 spawn `scripts/gen-vitepress-sidebar.ts`。

宽哨兵 `['scripts/']` 使**任何** `scripts/` 改动都命中这三个测试，导致改 `_lib/commit-check.ts`、`_lib/contract-tests.ts` 等共享层文件时仍被拖入全量级测试集（实测 5 个），"轻量 commit 工具"目标未真正达成。

## 2. 决策（Decision）

将三个宽哨兵收敛为精确文件清单：

- `test_scripts_json` → 11 个具体脚本（`check-redlines` / `check-circular` / `check-orphan-exports` / `check-boolean-naming` / `check-adr-health` / `check-knowledge-drift` / `check-doc-drift` / `comment-checker` / `type-consistency` / `link-checker` / `adr-check`）。
- `test_codemod_guards` → `scripts/codemod.ts`。
- `test_sidebar_gen` → `scripts/gen-vitepress-sidebar.ts`。

并强化 `tests/test_contract_domain_select.ts` 回归断言，锁定"改 `_lib` 内部脚本不再被这三个测试拖拽"的收敛结果，防止宽哨兵被加回。

## 3. 后果（Consequences）

- **正面**：commit 阶段契约测试从 5 个降至 1–2 个。实测改 `contract-tests.ts` + `test_contract_domain_select.ts` 时，仅命中 `test_contract_domain_select` 一个测试，门禁耗时 **1.3s**（此前同类提交 6.7s / 15.4s）。
- **fail-safe 维持**：`CONTRACT_TEST_TARGETS` 未覆盖的改动（如新增 `_lib/*.ts` 且无登记测试）仍回落全量，杜绝静默零验证。
- **负面 / 已知遗留**：`test_scripts_json` 仅按"它直接 spawn 的 11 个脚本"建模，不追踪这些脚本的 `_lib/*` 共享依赖。改 `_lib/parse-args.ts` 等底层模块时，靠 fail-safe 回落全量兜底（非精确命中），属保守但安全的取舍。
- **维护约定**：未来新增 tests 域测试必须登记 `CONTRACT_TEST_TARGETS`；`test_contract_domain_select.ts` 的"精确化生效"断言会在回归时捕获漏登/宽哨兵回潮。

## 4. 数据溯源

- 来源：`test_scripts_json.ts` 的 `JSON_SCRIPTS` 枚举、两个 codemod/sidebar 测试的 spawn 目标。
- 工具验证：`npm run typecheck:scripts` 全绿；`node tests/test_contract_domain_select.ts` 177 组断言全过；`commit-with-check --check --files` 端到端 1.3s / 1 测试。

<!-- 文件名: contract-test-targets-precise.md → 实际文件 ADR-157-contract-test-targets-precise.md -->
