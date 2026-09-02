# ADR-156：契约测试按变更文件精确裁剪（scripts 改动不再全量）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-02
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：待补（`docs/adr/` / 关联代码路径）

---

## 1. 背景（Context）

`commit-with-check` 经 ADR-155 从「pre-push 重型门禁 thin wrapper」解耦为独立轻量提交校验后，
commit 阶段的契约测试仍因 `selectContractTests` 的 `if (domains.has('tests')) return all`
（注释：「工具改动影响面大，不可裁剪」）而在任何 `scripts/**` 改动时跑**全量 47 个**契约测试
（`tests/` 与 `scripts/` 均被 `classify` 归 `tests` 域）。实测纯脚本提交需 14s+，与
「commit 阶段只回答我的 diff 干净吗」的轻量定位相悖。

## 2. 决策（Decision）

在 `_lib/contract-tests.ts` 引入 `CONTRACT_TEST_TARGETS`（测试 → 保护的源模块路径映射，
与既有 `CONTRACT_TEST_DOMAINS` 互补），并给 `selectContractTests` 增加可选 `changedFiles` 参数：

1. **未传 `changedFiles`**（pre-push / doctor / `--all`）→ 保持原行为：tests 域仍全量回落。
   向后兼容，重型场景不受影响。
2. **传 `changedFiles` 且变更含 `tests` 域**（commit 阶段）→ tests 域测试由「全量」
   改为**按文件精确裁剪**：仅 `CONTRACT_TEST_TARGETS` 命中变更文件的测试保留。
3. **fail-safe**：若变更文件未被任一 tests 域测试覆盖 → 回落全量，杜绝零验证漏检。
4. 少数宽敏感测试（`test_scripts_json` / `test_codemod_guards` / `test_sidebar_gen`）用
   `scripts/` 目录哨兵，确保「改任意 scripts」仍被保守保留——宁可多跑、不可漏检。

`commit-check.ts` 把 `paths` 透传给 `selectContractTests(domains, files)`，启用精确裁剪。

## 3. 后果（Consequences）

- **正面**：`scripts` 改动触发的契约测试从 47 → 按文件相关子集（典型提交 5 个），
  commit 阶段门禁耗时再减半（实测 15.4s → 6.7s）。
- **负面 / 成本**：`CONTRACT_TEST_TARGETS` 是与 `CONTRACT_TEST_DOMAINS` 并列的维护项，
  新增 tests 域测试须同步登记，否则精确模式下静默漏检（`test_contract_domain_select`
  已加断言兜底）。
- **已知遗留**：宽哨兵测试每次 scripts 改动仍跑（保守保留，属预期）；`test_scripts_json`
  可进一步按 `JSON_SCRIPTS` 清单精确化以再瘦身，留待后续评估。

## 4. 数据溯源

- 来源：`scripts/_lib/contract-tests.ts:108` 原 `domains.has('tests') → return all`；
  `scripts/_lib/commit-check.ts` 委托调用。
- 结果：实测 `commit-with-check --check --files <3 脚本文件>` → 契约测试 5 个、总耗时 6.7s（PASS）。

<!-- 文件名: contract-tests-precise-crop.md → 实际文件 ADR-156-contract-tests-precise-crop.md -->
