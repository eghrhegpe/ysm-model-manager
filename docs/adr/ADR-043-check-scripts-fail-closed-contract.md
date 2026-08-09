# ADR-043：检查脚本 fail-closed 三态契约（扫描不完整必须显式暴露，禁止假绿）

- **状态**：已采纳（Accepted）
- **日期**：2026-08-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-013 治理收敛 / ADR-020 脚本工具链 / AGENTS.md 致命陷阱 #12/#16`

---

## 1. 背景（Context）

2026-07-26 至 2026-08-09 共 18 轮全量 mjs 审核（覆盖 53 个脚本 + 5 个共享库）实证，「假绿」是本仓库检查脚本最危险且最高频的反模式——门禁类脚本在扫描不完整时用「空结果」代表「无问题」，导致 CI/doctor/pre-push 静默放行真实缺陷。代表性实例：

- `rgSafe` 在 rg 缺失/坏正则时返回 `[]`，消费者把它当作「无匹配」（治理扫描静默报全清）；
- `texture-golden` 的 `callMain` ExitStatus 非零被吞，损坏 .ysm 被记录为「成功空行」（0 组件/0 纹理、退出 0）；
- `gen-knowledge-h1` 读取失败 try/catch 吞掉后 `--check` 仍绿灯（未校验卡静默通过）；
- `pre-push-gate` 的 `2>/dev/null` 在 cmd.exe 下吞掉命令本身（merge-base 判断失效）；
- `check-diff-coverage` 的 `--threshold=abc` → NaN → `pct < NaN` 恒 false 全通过。

根因：各检查脚本对「扫描成功但无问题 / 扫描不完整 / 工具不可用」三种状态没有统一的机检契约，错误处理呈两极端——要么裸抛崩溃（单文件读失败毁整脚本），要么静默吞（失败当成功）。

## 2. 决策（Decision）

所有 `check-*` / 门禁类脚本（doctor / pre-push-gate 及其消费的检查器）统一三态输出契约：

1. **成功无问题**：`exit 0`，可输出 `_summary`；
2. **扫描不完整（工具缺失 / 解析失败 / IO 失败 / 参数非法）**：必须 `exit 1`，或在 `--json` 模式输出 `_summary.available: false` 显式标记 + stderr 说明原因——**禁止**用空结果数组代表「无问题」；
3. **发现问题**：`exit 1` + 明细。

配套硬规则：

- `--check` / `--json` 模式下任何 try/catch 吞掉的失败都必须计数并反映到退出码（gen-knowledge-h1 的 `failures` 数组为范式）；
- 参数校验（阈值 NaN、未知 flag、空路径、绝对路径）一律显式拒绝退出，不得落入「默认值继续跑」的假绿路径；
- 子进程失败按 `rg` 三态（无匹配 / 工具缺失 / 执行失败）分类传播，`rgSafe` 等容错封装只供「恒 exit 0」的提示工具使用，且失败必须打 stderr WARN（ripgrep.mjs 既有设计，固化执行）；
- 生成器（gen-*）写产物一律原子写（临时文件 + rename），防止半截产物被下游当完整文件消费。

## 3. 后果（Consequences）

**正面**：

- CI/doctor/pre-push 的可信度恢复：扫描不完整时「红」而不是「假绿」，AI 与人类不再被空结果误导；
- 统一契约后可机检：check-script-hygiene 扩展一条规则扫描「catch 吞错未反映退出码」与「available:false 缺失」；
- 与 AGENTS.md 致命陷阱 #16（doctor `[WARN] skip` 不得当通过）形成完整闭环。

**负面 / 成本**：

- 既有脚本需逐批迁移（约 10 个检查器），迁移期可能出现「扫描不完整→变红」的临时噪音，属预期代价；
- 严格退出码会让本地开发更早暴露环境问题（如 rg 未安装），需配合清晰的 stderr 指引文案。

**已知遗留**：

- `rgSafe` 语义维持不变（提示工具用），但后续可考虑加 `_summary.available` 字段让 JSON 消费者也能感知；
- `line-counter` 等纯统计工具不属门禁，不强制三态。

## 4. 数据溯源

- 18 轮审核实证（2026-07-26 至 2026-08-09）：`check-knowledge-drift` / `check-doc-drift` / `check-deadcode-baseline` / `check-adr-health` / `check-dynamic-import` / `comment-checker` / `check-circular(-go)` / `check-layering` / `check-script-hygiene` / `check-tpl-refs` / `check-boolean-naming` / `type-consistency` / `link-checker` / `adr-check` / `check-orphan-exports` / `check-diff-coverage` / `check-adr-health` / `gen-*` 系列 / `codemod` / `binding-check` / `release-notes-gen` / `ai-mistake-tracker` / `test-coverage-report` / `texture-golden` / `build-ysm-wasm` 等逐一审核记录（docs/adr/ 各轮提交 + git log）；
- 假绿实例文件级定位见各轮 code_review 复核记录（`rgSafe` 三态 / ExitStatus 吞错 / failures 计数 / cmd.exe 重定向 / NaN 阈值）；
- 范式实现：`gen-knowledge-h1.mjs` 的 `failures` 数组 + `check-circular(-go).mjs` 的 `maxCycles` 上限 + `parse-args.mjs` 的 `unknown` 数组拦截（均为本轮已落地代码）。

<!-- 文件名: check-scripts-fail-closed-contract.md → 实际文件 ADR-043-check-scripts-fail-closed-contract.md -->
