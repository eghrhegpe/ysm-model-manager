# ADR-158：check-readme-index 增加描述过时断言（提及但说错可机检）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-02
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/check-readme-index.ts`、`tests/test_check_readme_index.ts`；前序 ADR-155（commit-with-check 解耦）/ ADR-156/157（契约测试精确裁剪）

---

## 1. 背景（Context）

`scripts/README.md` 自称「所有 Node 工具脚本的索引」「治理检查的唯一登记处」，但 `check-readme-index.ts` 原仅校验「脚本是否在 README 被提及（零提及→阻断）」——查不出「**提及了但说错了**」的漂移。

实证（2026-09-02）：ADR-155/156/157 重构后，`commit-with-check.ts` 已解耦为委托 `_lib/commit-check.ts`、契约测试 `tests` 域已按文件精确裁剪，但 README 仍写「验证全部委托 pre-push-gate（单一源头）」「tests 域仍全量」。这类描述过时现有门禁完全抓不到，靠人工巡检才发现。

## 2. 决策（Decision）

在 `check-readme-index.ts` 增加**描述过时断言**机制（ADR-158 核心）：

- 新增 `README_ASSERTIONS` 表（脚本→`mustInclude`/`mustNotInclude`/`note`），针对**已发生过漂移或关键的脚本**登记不可过时的断言。
- 新增纯函数 `findReadmeRow(readme, script)`（按表格 token 定位行）+ `assertionViolations(readme, assertions?)`（返回违规列表）。
- `main()` 同时校验「零提及」与「描述过时」，任一违规即阻断（JSON 模式新增 `assertionViolations` 字段）。
- 措辞策略：**宽松正向断言**（`mustInclude: ['_lib/commit-check']`）+ **针对已删除旧句的负向断言**（`mustNotInclude: ['验证全部委托 pre-push-gate']`），避免未来重构误报。
- 仅覆盖关键脚本（初版 2 条：commit-with-check / contract-tests），不广撒网，控制维护成本与脆弱性。

## 3. 后果（Consequences）

- 正面：`scripts/README.md` 的描述正确性从「人工巡检」变为「提交即机检」；我们刚修的 2 处漂移被锁死，回归将阻断。
- 负面 / 局限：断言表需随脚本重构人工增补（属文档同步的一部分）；`mustNotInclude` 用整句旧措辞匹配，未来若合法复用该句需同步更新断言。
- 已知遗留：`typecheck:scripts` 全仓仍有 2 处**既有**类型错误（`gen-stage.ts` 函数外裸 `return`、`commit-with-check.ts` 越界回退段 `rollback.exitCode` 属性缺失），与本 ADR 无关，需另开诊断清理。

## 4. 数据溯源

- 来源：人工巡检发现 README 与 ADR-155/156/157 实际状态不符 → 确认 `check-readme-index` 仅查零提及的盲区。
- 结果：`assertionViolations` 纯函数 + 2 条初版断言；`tests/test_check_readme_index.ts` 新增 4 段回归（含「回退旧措辞应被捕获」）；`node tests/test_check_readme_index.ts` 全过（0 违规 + 回退捕获生效）。

<!-- 文件名: readme-drift-assertions.md → 实际文件 ADR-158-readme-drift-assertions.md -->
