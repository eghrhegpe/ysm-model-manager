---
kind: pre_push_gate
name: 推送前门禁 pre-push-gate
tier: architecture
category: utils
source_files:
  - scripts/pre-push-gate.ts
  - .githooks/pre-push
  - scripts/_lib/gate-config.ts
  - scripts/_lib/gate-ctx.ts
  - scripts/_lib/gate-parse.ts
  - scripts/_lib/gate-report.ts
auto_fields:
  symbols_with_lines:
    - ALL_STATIC_TOOLS
    - createGateCtx
    - DOC_EXTRA_SCRIPTS
    - DOC_STATIC_TOOLS
    - ExecResult
    - firstErrors
    - formatFailSummary
    - FRONTEND_STATIC_TOOLS
    - GateCtx
    - GateResult
    - GateResultItem
    - GateTool
    - GO_STATIC_TOOLS
    - ParsedToolOutput
    - parseToolOutput
    - RecordOpts
    - reportPathFor
    - SCRIPTS_TYPECHECK
    - tryParseJson
    - tryParseSummary
    - writeGateReport
use_when:
  - 推送门禁
  - 质量门禁
  - 门禁阻断
  - 域级检查
  - go build
  - vite build
  - 契约测试
  - 工具输出解析
quick_groups:
  - 提交与钩子
quick_intents:
  - 推送被门禁阻断怎么办
  - 门禁检查项有哪些
  - 改门禁并行结构
quick_risk_lines:
  - 门禁并行 async IIFE 必须带调用括号，漏 () 会静默跳过整域检查
  - 推送门禁失败先看 FAIL 块，禁止无脑 git push --no-verify 绕过
  - FAIL 归属标签靠 blockPolicy 落库，record 漏存即全部误标「本次引入」
pitfalls:
  - 改 Promise.all 并行结构漏写 () → 域级检查静默不跑（8/17 起 13 项失效实证）
  - push 被拒直接 --no-verify → 绕过不留审计；应修 FAIL 项或 git pull 整合
  - 「门禁全绿」只证明清单内检查通过——仓库 32 个 check-*.ts 中有 3 个无任何自动化入口（check-complexity / check-params / check-type-safety），须手动跑；审核/锐评下结论必须附「跑了哪些 + N/32」覆盖率，不可外推为「仓库无风险」
  - record() 只把 blockPolicy 用于判定 blocked、不写进 results → gate-report.policyTag 读到 undefined，**所有 FAIL 的归属标签退化为「本次引入」**（debt 存量债冒充本次引入，AI 会去修不属于自己的问题）。2026-09-13 修复并加行为契约（test_gate_ctx.ts 第 5/9 组）
status: active
invariant_anchors:
  - scripts/pre-push-gate.ts|ALL_STATIC_TOOLS
  - scripts/_lib/gate-config.ts|ALL_STATIC_TOOLS
---

# 推送前门禁 pre-push-gate

## 概览

`.githooks/pre-push`（薄壳）→ `scripts/pre-push-gate.ts`（调度器）：本地质量门禁核心，**CI 红之前本地先红**。按变更域（Go / 前端 / 数据 / 文档）裁剪检查，硬错误（编译/测试/契约/链接）阻断推送，基线债务（红线新增、死代码）只报告不阻断——推送后修，发布前全量 doctor 兜底。

## 核心职责

### 模式（stdin 驱动默认）

| 模式 | 触发 | 行为 |
|------|------|------|
| 推送门禁 | `.githooks/pre-push`（无参数透传 stdin） | 逐行解析 `<local ref> <local oid> <remote ref> <remote oid>`，多 ref 按文件集并集计算变更域 |
| `--all` | doctor 默认全量 | 所有域 + 全部静态工具，等价 doctor |
| `--docs` | doctor --docs | 仅文档/ADR/索引/静态文档工具 |
| `--files` | commit-with-check | 按 staged files 真按域裁剪 |

### 变更域分析（`resolveChanges`）

- 相对被推送的 localOid（非当前 HEAD）——推非当前分支时 HEAD 与推送对象不一致
- remoteOid 全 0（新分支）→ merge-base 链 `origin/<分支> → origin/HEAD → origin/main → origin/master` → 最近提交 → 首个提交
- 解析彻底失败返回 null → **阻断推送**（fail-closed，不静默空跑放行）

### 执行上下文收敛（GateCtx，ADR-206 阶段 1 已落地）

`pre-push-gate.ts` 曾内联 `record()` / `sh` / `shAsync` / `git` / `gofmtCheck` 与 `blocked` / `results` 闭包变量。2026-09-13 完成接线：执行管道统一由 `scripts/_lib/gate-ctx.ts` 的 `createGateCtx()` 承载（在模式分流**之后**创建，注入已定型的 plan / files / byDomain / push refs），调用段一律经 `ctx.*` 消费。此前该模块已写好却无人 import（`check-lib-adoption` 报 `users: 0`），接线后 `users: 4`、`unusedLibs: 0`。

接线顺带修掉内联副本的三个缺陷（`_lib` 版本更健壮）：

| 缺陷 | 后果 | 修复 |
|------|------|------|
| `gofmtCheck([])` 不早退 | 裸 `gofmt -l` 无参读 stdin → 门禁挂死到 300s 超时 | 空列表早退 |
| `shAsync` 无输出上限 | go test/vite 刷屏输出在 gate 进程内无界膨胀 | 1MB cap（保尾部） |
| `shAsync` 超时不可辨 | 超时被杀进程 `code=null` → 与「编译 FAIL」同形，被误报成编译错误 | `ExecResult.timedOut` + out 追加超时原因（tail 可见） |

**blockPolicy 必须落库**（2026-09-13 修复 P1 归因 bug）：`record()` 原先只用 `blockPolicy` 判定是否阻断，**不写进 `results` 条目**——而 `gate-report.policyTag()` 恰恰读 `item.blockPolicy` 生成 FAIL 明细的归属标签。漏存导致所有 FAIL（含 debt 存量债）一律显示 `[本次引入]`，AI 据此把存量债当成自己引入的回归去修。实证：`check-deadcode-baseline`（声明 debt）在 baseline 输出里被标成 `[本次引入]`。现 `GateResult` 与 `gate-report.GateResultItem` 收敛为同一形状（后者退化为 `type GateResultItem = GateResult` 别名，报告层不再持有第二份定义）。归属标签的端到端链路（record → results → `formatFailSummary`）由 `tests/test_gate_ctx.ts` 第 5/9 组行为断言锁死（源码 grep 式断言只能证明「字符串在」，不能证明「行为对」）。

**剩余阶段**（ADR-206 阶段 2-7 未做）：域块搬 `gate-blocks/*`（static-tools → data-docs → redlines → schedule → go/frontend 域）、`parseToolOutput` 的 `okMustBeTrue` 加法扩展。`pre-push-gate.ts` 现 **1010 行**（目标态 ~400 行）。注意 `tests/test_gate_iife_correctness.ts` 目前用**硬编码缩进 + 字面量**匹配 Go/前端域 IIFE（`"(async () => {\n      if (!plan.go) return;"`），搬域块前须先把它改成宽松正则，否则会误伤合法重构。

### 域级检查（Go ∥ 前端，Promise.all 并行）

**Go 域**（plan.go）：updater helper 前置构建（go:embed 依赖）→ `go build ./go/...` → `go test -race ./go/... ./internal/app/ -timeout 60s`（默认吃官方 test cache，源码未变 → (cached) 秒回；`YSM_FRESH_GO_TEST=1` 强制 `-count=1` 新鲜跑，2026-09-04 恢复缓存）→ `go vet` → **`golangci-lint run --new-from-rev=<base> ./...`**（ADR-205：补 Go 静态分析真空面；只跑增量，全量会撞 736 条存量债；未安装/无基线 → 降级 debt 跳过）→ gofmt 只读检出 → `binding-check`

**前端域**（plan.frontend）：`check-layering`（R1/R2 零容忍 + R3/R4 基线）→ `check-path-hygiene`（ADR-146：反桶/深度/上跳/跨边界冻结/双写一致性）→ `check-menu-health`（ADR-085：菜单表 id/labelKey/i18n/dockGroup/kind/render·run 完备）→ `check-ctx-menu-i18n`（扫右键菜单文件里字面量 `tr("key")` 须存在于 zh-CN 基准包；tr() 双入口随 ADR-210 D3 根除后现 0 命中恒绿——休眠闸，防 tr() 回潮才重新咬人）→ `check-mock-paths`（ADR-224：vi.mock 路径静态校验，M1 内部 spec 失效硬拦、M2 裸包漂移默认 WARN、M3 .js→.ts 兜底 INFO）→ npm 三件套并行（`vite build` ∥ `tsc --noEmit`）→ `vitest run --maxWorkers 8` 串行在后

**数据域**（plan.data）：`type-consistency`（resource_types.json 单一事实来源派生守卫：extensions.ts 必须派生自 JSON，禁手写 RESOURCE_EXTS 副本；ADR-204 收敛，JSON↔JS 字面量比对已不可达废弃）

**文档域**（plan.docs）：`link-checker`（断链）→ `release-notes-gen --check`（git tag 单一事实源）→ `gen-docs-index --check`（docs/adr 变更时）

**红线域**（plan.redlines）：`check-redlines --baseline` + `--files` 变更域过滤（仅本次变更文件内的违规计入新增阻断；`--all/--docs` 全库比对）。**扫描不可用（rg 缺失/fail-closed）必须阻断**——扫描没跑成不等于债务

**ADR 域**（plan.adr）：`adr-check`

**契约测试**（按域裁剪，2026-09 #2）：`_lib/contract-tests.ts` 的 `selectContractTests(变更域)` 选子集——`--all` 全量；`--files`/push 按 `byDomain` 键集命中 `CONTRACT_TEST_DOMAINS` 映射（go/frontend/data/docs 各跑相关子集，mixed 跨端契约任一端变更都触发）；改 scripts/tests（域 `tests`）→ 全量（工具自身改动影响面大）。映射表事实来源 `docs/contract-tests-audit.md`，规则锁定 `tests/test_contract_domain_select.ts`

### 静态工具（`runTools`，串行）

- 清单单一事实来源 = `_lib/gate-config.ts`（`ALL_STATIC_TOOLS` 26 项 / `DOC_STATIC_TOOLS` / `DOC_EXTRA_SCRIPTS` / `FRONTEND_STATIC_TOOLS` / `GO_STATIC_TOOLS`）；gate 只调度不改清单
- 审计类工具退出码不可靠（恒 0），必须解析 `--json` 的 `_summary` 判定——**判定语义收敛到 `_lib/gate-parse.ts`**（2026-09 锐评三刀 #3）：`parseToolOutput(out, rc, tool?)` 统一实现「`_summary.ok` → `errors===0` → 退回 rc」优先级链，`tryParseSummary` / `tryParseJson` 供域检查块/特殊块取字段；契约测试 `tests/test_gate_parse_output.ts` 锁死判定与 fail-closed 回退（非 JSON 输出 note 必须明示「回退 rc 判定」，不许静默假绿）
- autoFix 项（如 `event-graph --check`）FAIL 时自动跑写盘版刷新后重验（重验判定同样走 `parseToolOutput`）
- `check-go-diff-coverage` 在文件驱动模式加 `--staged`（只查本次暂存区，否则把 origin/main 之后所有未推送改动误算进覆盖门禁）
- 静态工具段不并行（回退 ADR-088：spawn 开销吃掉 sub-second 工具收益）

### FAIL 明细与报告落盘（2026-09 锐评「输出运行过程而非返回信息」）

AI 只读末尾 ~25 行 stderr，旧 tail 是 `slice(-12)` 的原始输出尾巴——JSON 输出末尾是 `}`，错误详情全被截掉，AI 不知道错在哪、是不是自己的问题，思维链被存量债堵死。现行机制（`_lib/gate-report.ts`，契约测试 `tests/test_gate_report.ts`）：

- **record 保留 raw**：每个检查点存工具原始输出（cap 64KB 尾部），首错结构化提取的事实源；完整 results 含 raw 落盘报告
- **FAIL 明细三行块**（贴结论放，保证落在尾部阅读窗口；OK 明细在前供人扫读——旧「FAIL 前置」被取代）：`[FAIL][归属] 命令  pass/total 通过 耗s note` / `→ 首错（≤120 字符）` / `复现: 命令`
- **归属标签语义**：`debt→存量债`、`failClosed→失守`、`hard→(push/files 模式)本次引入｜(全扫 --all/--docs)待归因`——全扫无法归因，不冒充「本次引入」（实证：docs 模式曾把并行会话留下的存量债标成本次引入，误导归因）
- **报告落盘**：`.git/gate-report-<ts>.json`（mode/blocked/results 含 raw），stderr 只给相对路径指针——深挖读报告（无行数限制），验证抄复现命令

### 门禁覆盖边界：清单外的 check 脚本（2026-09-13 核实）

`scripts/check-*.ts` 共 **32** 个，`ALL_STATIC_TOOLS` 只列 **26** 项，差额不是笔误——部分脚本走 pre-commit / commit-with-check / CI 等旁路，另有 3 个**无任何自动化入口**，只能手动跑：

| 脚本 | 自动化入口 | 内容 |
|------|-----------|------|
| `check-complexity` | ❌ 无 | 认知复杂度档位（🟥红 / 🟧橙 / 🟨黄）+ 嵌套深度；存量规模大，未纳入阻断 |
| `check-params` | ❌ 无 | 长参数列表 / 布尔陷阱打分 |
| `check-type-safety` | ❌ 无 | `any` / `@ts-ignore` / `!` 非空断言计数 |

核实口径：`_lib/gate-config.ts` 五个清单 + `.githooks/pre-commit` + `.github/workflows/*` + `Taskfile.yml` 均无调用点（仅 `tests/test_check_*.ts` 导入其纯函数做契约测试）。

**推论**：门禁全绿 = 「清单内静态工具 + 域检查 + 契约测试」全绿，**不等于**「仓库无风险」。审计/锐评下结论前须逐项确认覆盖，并报告「跑了哪些 + N/32」——只跑子集（如 5/32）极易漏掉 `check-complexity` 这类成规模问题（实证：views 域 10 个 🟥 可复现，见 [views-review-crosscheck](../../deliverables/views-review-crosscheck-2026-09-13.md)）。

### 其他

- **退出码**：0 = 通过放行；1 = 阻断推送；2 = 用法错误
- **PULL_HINT**：git 报 rejected/non-fast-forward 时先 git pull 整合再重推
- **逃生阀**：`YSM_SKIP_GATE=1 git push` 或 `git push --no-verify`（慎用，绕过不留审计）
- **门禁 PASS 后**：后台 spawn（detached+unref）刷新 `docs/.doc-next-steps.md`（AI 待补地图，非阻断）

## 对外 API / 入口

```bash
# 由 .githooks/pre-push 调用（透传 remote-name remote-url + stdin）
node scripts/pre-push-gate.ts <remote-name> <remote-url>
node scripts/pre-push-gate.ts --dry-run <remote-name> <remote-url>   # 只检查不修改
node scripts/pre-push-gate.ts --all [--dry-run]                      # 全量（等价 doctor 默认）
node scripts/pre-push-gate.ts --docs [--dry-run]                     # 文档模式（等价 doctor --docs）
node scripts/pre-push-gate.ts --files "<file1>\n<file2>..." [--dry-run]  # 文件驱动（commit-with-check）
```

## 与其他子系统关系

- `.githooks/pre-commit`：提交时自动 gofmt 修复 + stage；pre-push 对未格式化**只读检出即阻断**（防 `--no-verify` 绕过 pre-commit 的自动修复）
- `scripts/doctor.ts`：`--gate/--all/--docs` 的单一实现源头（2026-08-14 合并）
- `scripts/commit-with-check.ts`：走 `--files --dry-run` 模式按 staged 文件裁剪门禁；commit 成功后自己打印横幅（`--no-banner` 抑制）
- `scripts/_lib/gate-config.ts`：工具清单单一配置层
- `scripts/_lib/gate-ctx.ts`：执行上下文 `createGateCtx()`——`record` / `sh` / `shAsync` / `git` / `gofmtCheck` 的唯一实现，兼 `blocked` 活值 getter 与 `setBlocked`（failClosed 特例用）。ADR-206 阶段 1 接线完成（2026-09-13）
- `scripts/_lib/gate-report.ts`：FAIL 明细渲染与报告落盘（`GateResultItem` 为 `gate-ctx.GateResult` 的类型别名，形状单一事实源在 gate-ctx）
- `scripts/_lib/gate-parse.ts`：工具输出统一解析（`parseToolOutput` / `tryParseSummary` / `tryParseJson`）——2026-09 收敛前 gate 内联 11 处 `JSON.parse`，runTools / runScopedDocDrift / 5 个域检查块 / issues / broken / 红线块各自手写一套 try/parse，判定口径漂移即门禁结论不可复现；收敛后全部走共享层，契约测试锁死优先级链
- `scripts/_lib/domain-classify.ts`：`planFromFiles` / `groupByDomain` / `domainSummaryText`
- `scripts/_lib/contract-tests.ts`：契约测试并行执行器（双层防线防 Windows spawn 饱和 flaky：spawn 层「进程未启动」重试 + 整文件层**有界并发 8 worker 池 + 失败串行复跑 1 次**——真回归复跑必二次失败不掩盖，负载瞬态复跑转绿，2026-09-04 加固）
- `scripts/_lib/proc.ts`：`procRun`（超时/错误分类契约；数组参数直走 CreateProcess 避 cmd.exe 8191 限制）
- `scripts/_lib/log-push.ts`：结果日志
- `scripts/gen-doc-next-steps.ts`：PASS 后后台刷新待补地图

## 不变量

- **IIFE 必须带调用括号**（2026-09-01 实证，commit `fd3d0431`）：Promise.all 里的 `(async () => {...})()` 漏 `()` 会导致 async 函数**静默不执行**——8/17 起 `go build/test`、`vite build/vitest`、`check-layering` 等 13 项域级检查从未执行，门禁成了「静态工具串行 + 契约测试」的假重（commit `1e4aa81d` 引入）。改门禁并行结构后必须 dry-run 验证各域真的跑了
- **严禁在 pre-push 内 commit --amend**：git push 在调用钩子前已快照要推送的 oid，钩子里 amend 只改本地 HEAD，推送的仍是旧 oid → 本地与远端分叉、二次 push 必被拒（2026-08-12 实测：gofmt amend 3291cb16 假成功，实际推送 b644e96b）
- **link-checker / type-consistency 退出码恒 0**，必须用 `--json` 解析 `_summary` 判定，不得依赖退出码（判定走 `_lib/gate-parse.ts` 的 `parseToolOutput`，优先级链 `_summary.ok` → `errors===0` → 退回 rc）
- **红线扫描不可用（rg 缺失）必须阻断**（fail-closed）；基线债务（红线新增）不阻断，推送后修
- **`record()` 必须把 `blockPolicy` 一路落进 `results`**（2026-09-13 修复）：它不只是「是否阻断」的输入，更是 FAIL 明细归属标签（存量债／失守／本次引入）的事实源。漏存 → 所有 FAIL 被误标「本次引入」
- **`ctx.blocked` 必须是活值**：实现为 getter，值快照会恒 false → 失败检查静默放行（fail-open）。改 GateCtx 时不得退回 `blocked,` 式值拷贝
- **变更集解析失败必须阻断**，不静默空跑放行（fail-closed）
- Windows 下 npx 是 npx.cmd，node spawn 需 `shell: true`
- git 数组参数直走 `procRun`（无 shell 拼接）：ref 允许 `$`/backtick 等元字符，拼字符串经 shell 会构成命令注入（pre-push stdin 的 localRef 可被攻击者控制）

## 相关

- ADR-206 — pre-push-gate 收敛分拆为 gate-blocks（阶段 1 已落地，2-7 未做）
- ADR-146 — 路径卫生门禁（check-path-hygiene）
- ADR-085 — 菜单表健康门禁（check-menu-health）
- ADR-224 — mock 路径守卫（check-mock-paths；[mock_path_guard](./mock_path_guard.md)）
- ADR-088 — 静态工具并行回退（spawn 开销吃掉收益）
- ADR-145 — cli 解耦 app（check-go-diff-coverage --staged 实证）
- ADR-149 / ADR-150 — pre-commit 兜底收窄（对照）
- [pre-commit-hook](./pre-commit-hook.md) — 提交前钩子（互补：pre-commit 快同步，pre-push 全量阻断）
- [auto_import_split](./auto_import_split.md) — auto-import 挂载于 ALL_STATIC_TOOLS
- `docs/cli-commands.md` — doctor 命令（gate/--all/--docs 入口）
