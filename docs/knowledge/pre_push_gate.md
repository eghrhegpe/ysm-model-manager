---
kind: pre_push_gate
name: 推送前门禁 pre-push-gate
tier: architecture
category: utils
source_files:
  - scripts/pre-push-gate.ts
  - .githooks/pre-push
  - scripts/_lib/gate-blocks/static-tools.ts
  - scripts/_lib/gate-config.ts
  - scripts/_lib/gate-ctx.ts
  - scripts/_lib/gate-parse.ts
  - scripts/_lib/gate-report.ts
  - scripts/gate-audit-reconcile.ts
auto_fields:
  symbols_with_lines:
    - ALL_STATIC_TOOLS
    - buildScanVerdict
    - createGateCtx
    - DOC_EXTRA_SCRIPTS
    - DOC_STATIC_TOOLS
    - ExecResult
    - firstErrors
    - formatFailSummary
    - FRONTEND_STATIC_TOOLS
    - GATE_TIMEOUT_MS
    - GateCtx
    - GateResult
    - GateResultItem
    - GateTool
    - GO_STATIC_TOOLS
    - ParsedToolOutput
    - parseToolOutput
    - RecordOpts
    - reportPathFor
    - requireSummaryField
    - requireSummaryOk
    - runScopedDocDrift
    - runTools
    - SCRIPTS_TYPECHECK
    - tryParseJson
    - tryParseSummary
    - WARNS_TOP_N
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
  - 判定字段必须写进 _summary（用 buildScanVerdict），写顶层 ok 会被解析器短路
pitfalls:
  - 改 Promise.all 并行结构漏写 () → 域级检查静默不跑（8/17 起 13 项失效实证）
  - push 被拒直接 --no-verify → 绕过不留审计；应修 FAIL 项或 git pull 整合
  - 判定字段写错位置 → 门禁静默假绿：`parseToolOutput` 的 `parsed._summary || parsed` 使「`_summary` 存在但无 ok/errors」时短路，**永不回读顶层 `ok`**。三脚本曾把 ok 放顶层且 rc 恒 0（情报型）→ 门禁恒判通过；判定必须写进 `_summary`（`buildScanVerdict`）
  - 「门禁全绿」只证明清单内检查通过——32 个 check-*.ts 与清单项非一一对应（差额走 pre-commit / CI 旁路，或只挂前端域）。三档位扫描器（complexity / params / type-safety）2026-09-13 才接 FRONTEND_STATIC_TOOLS（debt + --files），`--all` / `--docs` 路径仍不跑；审核/锐评下结论必须附「跑了哪些 + N/32」覆盖率，不可外推为「仓库无风险」
  - 「只挂 pre-commit 的闸 = 单点防线」`check-design-tokens` 曾长期只挂 pre-commit 硬阻断③，pre-push / CI 均无排查项——而 pre-commit 可被 `git commit --no-verify` 一条命令绕过（CI `--static` 模式的立项目的正是补这一层）。2026-09 补进 FRONTEND/ALL_STATIC_TOOLS（`--baseline` + debt + scopedFiles），与 `css-layer-check` 同等三重防护。**新增「只减不增」型闸一律双挂**（pre-commit 拦提交 + gate-config 拦推送/CI），勿只挂其一
  - record() 只把 blockPolicy 用于判定 blocked、不写进 results → gate-report.policyTag 读到 undefined，**所有 FAIL 的归属标签退化为「本次引入」**（debt 存量债冒充本次引入，AI 会去修不属于自己的问题）。2026-09-13 修复并加行为契约（test_gate_ctx.ts 第 5/9 组）
  - 「增量裁剪边界」把「过滤后为空」当错误、把空 --files 静默当全库 → 前者让改一版文档/Go 就阻断推送，后者让存量债淹没本次变更；正确口径：scope 目录不存在或无可扫文件 = 用法错误 exit 1，过滤后 0 文件 = 合法 PASS，且 _summary.scopeFilter 须留痕以区分「全库干净」与「不在扫描范围」
  - 「--changed 的边界」它走 git diff 故不含未跟踪新文件 → 权威清单走 --files（门禁侧一律传，见 check-redlines / check-doc-drift 先例）；--changed 仅作本地便利，新文件先 git add 或改传 --files
  - 「scopedFiles 声明与实现」清单声明 scopedFiles:true 但脚本未接 _lib/changed-scope.ts → 双向失真：未识别 --files 报未知参数（exit 1 误阻断），或静默忽略继续全扫（存量债淹没本次变更、接线无声失效）；一致性由 test_gate_config.ts 断言，勿只改清单
  - 「逃生阀审计不对称」`YSM_SKIP_GATE=1` 与 `git push --no-verify` 并列作紧急绕过，但后者零痕迹（钩子不执行）。2026-09-13（锐评 P1）改为**留痕逃生**：钩子 SKIP 路径把待推 ref 写入 `.git/gate-audit.log`（SKIPPED 行），gate 每次 push 运行也追加 PUSH 行（oid+判定+N/M）——审计日志连续性使「无 gate 记录的推送」事后可回溯。`--no-verify` 客户端仍无法检测（git 语义边界），系统性兜底 = CI 同跑 gate 互证。**2026-09-14 已接线**：test.yml 新增「静态治理门禁」步骤跑 `node scripts/pre-push-gate.ts --static --json`（实测 32 项 / 全绿约 18s），补上此前 19 项 hard 静态工具在远端的 0 覆盖；用 `--static` 而非 `--all` 是因为后者会重跑 vite build / vitest / go build+test，而这三件 CI 已各自独立承担，接入即时长翻倍
  - 「审计对账有工具了」2026-09-13（锐评 P1 #6 落地第一刀）：`node scripts/gate-audit-reconcile.ts [--days 30] [--json]` 以远端跟踪分支 reflog 的 `update by push` 条目为推送事件锚点，对照审计日志 PUSH/SKIPPED 行——缺口即 `--no-verify`/写入失败候选，退出码 1 供 doctor/CI 消费。边界：审计日志与 reflog 均随 .git 生命周期/过期策略衰减，换机历史不可对账
  - 「审计对账消费位」2026-09-13（三锐评 #一 收口）：读侧例行消费位 = **本地 `node scripts/doctor.ts --audit-check [--days 30]`**（委托 reconcile，缺口非零即红）。**刻意不接 CI**——对账两侧数据源（远端跟踪 reflog + .git 审计日志）都只在开发机存在，fresh clone 的 CI 上 pushEvents 恒 0、对账恒空转；「跨机可查」的系统性兜底 = CI 同跑 gate 本体互证（ci.yml 既有门禁 job 覆盖推送内容本身），reconcile 与 CI 是互补而非同一环
  - 「多 ref 审计同构」2026-09-13（三锐评 #四2）：多 ref 推送的 reflog 是每 ref 一条 `update by push`，gate 审计必须逐 ref 一行（pre-push-gate pushedRefs 循环 append）——只记 pushed[0] 会让其余 oid 被 reconcile 误判为缺口；审计行 oid 位可为 `none`（formatEntry 空 localOid 兜底），reconcile 不计「none」为已审计
  - 「判定口径 A/B/C 收口完成」2026-09-13（三锐评 #二）：A=parseToolOutput 宽容链仅限静态工具段、B=requireSummaryOk 域块专用（frontend-domain 3/3 收编）、C=requireSummaryField 计数字段单一实现（data-docs-domain type-consistency/link-checker 2/2 收编）；两套收编均有源码扫描断言锁死（test_gate_parse_output 尾部），域块新增判定不得再手写
  - 「--json 契约真实现」2026-09-13（四锐评 #1）：此前 bools 声明但零消费——doctor --json 透传静默 no-op、hygiene 的 hasJsonFlag 靠注释假绿。现语义：--json 时人读文本流静默（logPush 只写 push-log，console.log 走 say() no-op），判定终态在三个 post-ctx 出口输出结构化 JSON（`_summary{ok,blocked,dryRun,counts,domainSummary,report}` + `results`）到 stdout；**边界：ctx 创建前的硬失败（stdin 解析/用法错误）仍为文本**——无判定即无 JSON 契约对象。`_summary.ok` 语义 = !blocked 即「检查是否通过」，dryRun 下是**预测值**而非「已放行」，消费方判「真放行」须 ok && !dryRun（五锐评 #3 澄清）；`[MAP]` 后台刷新提示走 stderr（main().then 段无 say 作用域，console.log 会跟在 JSON 后使 stdout 非法——五锐评 #2）。test_gate_coverage 源码扫描断言「声明与消费必须共存」
  - 「--all 刻意不跑三档扫描器」2026-09-13（四锐评 #3 显式化）：complexity/params/type-safety 是「全库阈值 + 增量裁剪」（scopedFiles），--all 无 --files 上下文，全量跑 = 301 条 debt 刷屏 + check-params 59.4s；baseline 比对落地后才有资格进 --all。覆盖尾行已按「刻意旁路(pre-commit/CI) vs 未接入」分组点名（gate-coverage.BYPASS_CHECKS），防把设计旁路当漏接去补接
  - 「reconcile 的 SKIPPED oid 容差」2026-09-13（四锐评 #2）：SKIPPED 行记钩子触发时刻的 HEAD 快照，SKIP 后 commit 再推 → oid 与 reflog 锚点不一致是正常时序；对账对 SKIPPED 行采用 ±10 分钟时间窗匹配（同一次推送会话即算留痕），消除假阳性缺口
  - 「_lib 注释死链回扫」2026-09-13（四锐评 #4）：gate-config 头注释的「scripts/脚本名.mjs」与 knowledge-common 引用的「hooks/knowledge-affected-hint.mjs」两处 .mjs 死链已随 .ts 迁移修正——迁移脚本/模块时头注释必须回扫，死链注释在契约文化里等于假路标
  - 「sh/shAsync 执行语义已对齐」2026-09-13（锐评 P2 #5）：同步 `sh` 此前缺 `timedOut` 透传与 1MB 输出 cap（procRun 超时 rc=-2 未映射），同一 ExecResult 契约两条路径形状漂移。现 sh 超时 → `timedOut:true` + 原因追加进 out，输出统一 1MB 尾部 cap（OUT_CAP 同源）；行为断言 test_gate_ctx.ts 第 10 组
  - 「sh/shAsync 调用点安全不变式已落成契约」2026-09-13（锐评 P1 #4）：`tests/test_gate_sh_invariants.ts` 扫描全部 gate 源码的 ctx.sh/shAsync 实参——①禁入 push-stdin 派生标识符（localRef/localOid/…，出现即 FAIL）；②动态命令冻结清单（新增动态实参必须登记插值来源与安全依据）。注释不变式升级为可执行检查；含外部输入的执行仍必须数组化 procRun
  - 「严格判定单一实现」2026-09-13（锐评 P1 #1 收编）：menu-health / ctx-menu-i18n / binding-usage 三处手写 `rc===0 && _summary.ok===true` 游离在 parseToolOutput 优先级链外，收敛为 `gate-parse.requireSummaryOk(out, rc)`（fail-closed：ok 缺失/非 true/解析失败一律 FAIL），契约 test_gate_parse_output.ts 锁死。新增「必须显式 ok」的域检查一律走它，勿再手写
  - 「多 ref 推送的 fail-closed 耦合」：`git push origin a b` 时任一 ref 的 resolveChanges 返回 null（解析失败）→ **整体阻断**（exit 1），不做 per-ref 放行——这是刻意的 fail-closed 选择而非缺陷；改契约测试前勿假设可 per-ref 豁免。多 ref 的文件集按并集去重算变更域，ctx 持有首个 ref 的 oid（golangci-lint 基线用）
  - 「PULL_HINT 带 remote-name」2026-09-13（锐评 #10）：push 模式的 pull 指引为 `git pull <远端名>`（多 remote 裸 pull 默认远端可能不对），非 push 模式退回裸 `git pull` 文案
  - 「判定口径 A/B/C 收口」2026-09-13（重锐评 #一）：体系内三套判定口径并存——A=parseToolOutput 宽容链（静态工具段，容忍情报型 rc 恒 0 工具）；B=requireSummaryOk 严格链（域检查块专用，缺 _summary.ok 一律 FAIL）；C=认特定计数字段的真特例（type-consistency issues===0 / link-checker links_broken===0，保留手写但 fail-closed）。menu-health / ctx-menu-i18n / binding-usage 三处已全量收编进 B，**新增域块判定一律走 B，禁止手写同形判定**（test_gate_parse_output.ts 尾部源码扫描断言锁死）
  - 「goTestCmd 数组化」2026-09-13（重锐评 #二②）：go 域 go test 分段执行改数组式 procRun（-race 段 + 普通段顺序执行，任一非零即 FAIL）——otherPkgs 来自 go list 输出（运行期数据），拼进 shell 命令违反 gate-ctx「禁入运行期数据」不变式（与旧 gofmt 拼串同模式递梯子）；goTestCmd 字符串仅作 label 展示
  - 「autoFix 写盘语义」2026-09-13（重锐评 #三）：static-tools 的 autoFix 是 pre-push-gate 唯一写仓库文件的执行点（gen 产物 FAIL 时写盘刷新后重验）。刻意不受 --dry-run 限制（commit-with-check 走 --files --dry-run，不刷新会阻断提交流）；写盘发生在 pre-push 钩子内，**被推送 oid 是刷新前快照——刷新产物不进本次推送、push 后工作树 gen 产物呈脏态属预期**，钩子内严禁 amend/git add（amend 不变式）
  - "「覆盖尾行」2026-09-13（锐评 P2）起门禁输出固定尾行 `覆盖口径: x/M 项 check-* 已接入门禁（未接入: …）—— 全绿 ≠ 仓库无风险`（数据源 `_lib/gate-coverage.ts`，动态枚举 scripts/check-*.ts 防分母写死过期）。当前 29/32，未接入 3 项均为 pre-commit/doctor/CI 旁路检查"
  - 「check-deadcode-baseline 的瞬态 FAIL」~~已修复~~（2026-09-13 P0）：jscpd 报告原写**固定路径** `frontend/report/jscpd-report.json` 且读完即删、无 pid 无锁，并行会话同跑门禁互相删读（同提交第一次红第二次绿）。现改为每进程独立 `mkdtemp` 临时目录（`os.tmpdir()/jscpd-gate-*`）承载报告，扫描 pattern 用绝对路径指回 `frontend/src`，`finally` 整目录清理——报告生命周期完全私有化，与 jscpd-go.ts 的 tmpdir 先例对齐。教训留存：**工具产物落盘共享路径 = 隐性进程间耦合**，任何检查项新增落盘产物时必须私有化路径或加锁
status: active
invariant_anchors:
  - scripts/_lib/gate-config.ts|ALL_STATIC_TOOLS
  - scripts/_lib/gate-blocks/schedule.ts|ALL_STATIC_TOOLS
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
| `gofmtCheck` 字符串拼 shell | 与 `git()` 的「数组防注入」哲学同文件分裂（锐评 P1：给后续 sh 调用方递梯子） | 2026-09-13 数组化 `procRun("gofmt", ["-l", ...files])`；`sh`/`shAsync` 升格显式不变式——**禁入运行期用户可控输入**（stdin ref/CLI 参数），只收开发者常量命令，含外部输入的执行一律数组化 |

**blockPolicy 必须落库**（2026-09-13 修复 P1 归因 bug）：`record()` 原先只用 `blockPolicy` 判定是否阻断，**不写进 `results` 条目**——而 `gate-report.policyTag()` 恰恰读 `item.blockPolicy` 生成 FAIL 明细的归属标签。漏存导致所有 FAIL（含 debt 存量债）一律显示 `[本次引入]`，AI 据此把存量债当成自己引入的回归去修。实证：`check-deadcode-baseline`（声明 debt）在 baseline 输出里被标成 `[本次引入]`。现 `GateResult` 与 `gate-report.GateResultItem` 收敛为同一形状（后者退化为 `type GateResultItem = GateResult` 别名，报告层不再持有第二份定义）。归属标签的端到端链路（record → results → `formatFailSummary`）由 `tests/test_gate_ctx.ts` 第 5/9 组行为断言锁死（源码 grep 式断言只能证明「字符串在」，不能证明「行为对」）。

### 静态工具执行器（gate-blocks/static-tools.ts，ADR-206 阶段 2 已落地）

`runTools` / `runScopedDocDrift` 两段（原 ~120 行）已从 main 闭包搬入 `scripts/_lib/gate-blocks/static-tools.ts`，签名统一 `runXxx(ctx, ...)`：`runTools(ctx, tools)`、`runScopedDocDrift(ctx)`。搬出后本文件只剩「何时跑哪张清单」，模块管「怎么跑」。

| 要点 | 说明 |
|------|------|
| 清单类型 | `runTools` 的入参由 `any[]` 收紧为 `readonly GateTool[]`（gate-config 的必填 blockPolicy 契约现在真正约束到执行侧） |
| 超时单一来源 | `GATE_TIMEOUT_MS` 由 gate-ctx 导出，gate-blocks/* 与 pre-push-gate 的数组式 `procRun` 共用——`300_000` 不再散成多份 |
| 可测的缝 | `ctx.sh` 是可替换属性，于是判定链（label/note/tail/blockPolicy→blocked/autoFix 三态）可在**零子进程**下验证，见 `tests/test_gate_static_tools.ts`（8 组） |
| scoped 送达判别 | 该测试用「传不存在文件 → matched=0 → 合法 PASS」作判别式：`check-complexity` 全库此刻 301 条 errors，若 `--files` 丢失必红——**具备证伪力，非恒真式** |

搬移期唯一实质改动：autoFix 重验的 `parseToolOutput(re.out, re.rc)` 补回第三入参 `tool`（此前漏传，解析失败时 note 丢失工具名）。

**剩余阶段**（ADR-206 阶段 7 收尾未做）：全量契约测试 + 三模式 dry-run 像素级验收（阶段 6 的 `go-domain.ts` / `frontend-domain.ts` 已于 2026-09-13 落地：二执行器自守卫，调度侧 `Promise.all([runGoDomain(ctx), runFrontendDomain(ctx)])`；`pre-push-gate.ts` 达成 ~400 行目标态——ADR-162 精神，行数不锁坐标，符号存在性由 check-readme-index 机检）。`tests/test_gate_iife_correctness.ts` 已于阶段 5 **硬化为结构性判定**（不锁缩进/换行/数量，锁「每个 async IIFE 必有 `)()` 调用」的事故语义 + 内联域 IIFE 须包 `Promise.all`）。剩余可选项：`parseToolOutput` 的 `okMustBeTrue` 加法扩展。

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
- 生产端配对（2026-09-13）：扫描器用同模块的 `buildScanVerdict(errors, warnLines)` 把 `ok`/`errors`/`warns_list` 写进 `_summary`。**判定字段必须落在 `_summary` 内**——`parseToolOutput` 首行 `parsed._summary || parsed` 会在 `_summary` 存在时短路，写顶层 `ok` 一律读不到（实证：三脚本顶层 `ok` + rc 恒 0 → 门禁恒判通过）。`_summary.degraded===true` 时 note 追加 `degraded`，「扫描跳过」不得与「扫描通过」同形
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
| `check-complexity` | ✅ 2026-09-13 接 `FRONTEND_STATIC_TOOLS`（debt + `--files`） | 认知复杂度档位（🟥红 / 🟧橙 / 🟨黄）+ 嵌套深度 |
| `check-params` | ✅ 同上 | 长参数列表 / 布尔陷阱打分 |
| `check-type-safety` | ✅ 同上 | `any` / `@ts-ignore` / `!` 非空断言计数 |

核实口径（2026-09-13 首查）：`_lib/gate-config.ts` 五个清单 + `.githooks/pre-commit` + `.github/workflows/*` + `Taskfile.yml` 均无调用点（仅 `tests/test_check_*.ts` 导入其纯函数做契约测试）——三者当时确为「无守护债务」。**现已接门禁**（见下节），但**只挂 `FRONTEND_STATIC_TOOLS`**：`--all` / `--docs` 模式 `files` 为空 → 走全库分支，等价于未接线，全量守护理应留待 baseline 化后补齐。

**2026-09-13 契约修复**：三个脚本已补 `_summary.ok/errors/warns_list` + `--strict`（JSON 模式不再往 stderr 写文本——gate 用 `shAsync` 合并 stdout+stderr，混入文本会让 `JSON.parse` 失败、退化为 rc 判定），门禁判定链现能读到真实结论。实测：`check-type-safety` 生产域 `ok=true / errors=0`（唯一现在就能硬挂的）；`check-complexity` `errors=301`、`check-params` `errors=54` 仍是存量规模，FAIL 时 tail 直出 Top-20 明细。

**2026-09-13 增量裁剪**：三者已补 `--files <换行分隔列表>`（与 `check-redlines` / `check-doc-drift` 同约定，即门禁侧传参形态）与 `--changed`（本地自动取「相对默认分支合并基线」的变更文件），实现收敛在 `scripts/_lib/changed-scope.ts`（契约测试 `tests/test_changed_scope.ts`）。语义：`--files` 优先 → `--changed` 自解析 → 全库（两 flag 皆缺，向后兼容既有调用）；命中先收敛到变更文件再计数，`_summary.scopeFilter{mode,requested,matched,total}` 留痕——**「0 命中」必须能区分「全库干净」与「变更文件压根不在扫描范围」**。实测（本仓 `--changed` 解析出 213 个变更文件 → 前端域 55 个进入扫描）：`check-complexity` 命中 301→65、`check-params` 54→18；耗时同口径下降 **2.4s→0.9s / 59.4s→7.9s / 0.3s→0.3s**。注意 `check-params` 的成本随进入扫描的文件数近似线性（55 文件 7.9s、单文件 0.4s）——**它全库 59.4s 的墙钟是接线成本的关键项**，接线必须依赖增量路径（口径提醒：报耗时务必注明是否增量，单文件数字与 55 文件数字差一个量级）。

**2026-09-13 接线**：三者已挂 `FRONTEND_STATIC_TOOLS`，`blockPolicy: "debt"` + 新增清单字段 `scopedFiles: true`——`runTools` 对声明该字段的工具改走**数组式 `procRun` 传 `--files <本次变更文件集>`**（shell:false 避开 cmd 8K 墙，同 `check-redlines` / `runScopedDocDrift` 先例；`--all` / `--docs` / push 模式 `files` 为空时退回全库）。脚本侧按自身 `--scope` 过滤非本域文件，故 gate 侧传全量变更集即可（改纯 Go/文档 → `matched=0` → 合法 PASS）。

**为何 debt 而非 hard（本轮实测自证）**：它们是**全库阈值 + 增量裁剪**——`--files` 只收敛扫描范围，**被触碰的文件若本就超阈值仍计入命中**。门禁 dry-run `--files frontend/src/views/app-tree/index.ts` 时 `check-complexity` 即报 `[FAIL][存量债] errors=1`（`app-tree/index.ts:507 _onKeyArrowNav 认知35`，仅因该文件在变更集内）。若为 hard 则「轻触碰存量红档」即误阻断。对比 `check-file-lines` 可 hard：它是显式规则表（1 个受控文件），无存量债冒充问题。**升 hard 的前置是 baseline「仅新增违规」口径**（同 `check-redlines --baseline`）；`check-type-safety` 生产域 `errors=0`，观察一轮后可单独升 hard。

**双重不变量守护**（`tests/test_gate_config.ts`）：① 声明 `scopedFiles: true` 的脚本必须在源码里调用 `_lib/changed-scope.ts` 的 `resolveChangedScope`——否则 `--files` 发过去要么报未知参数（exit 1 误阻断）、要么被静默忽略继续全扫（接线失效且无声）；② 三扫描器在 baseline 落地前必须为 `debt`（防误升 hard）。

**2026-09-15 空变更集 fail-closed**（`_lib/changed-scope.ts`，修 CI 连续两笔同点红）：`--changed` 的解析结果**为空也必须报 error**，不得退化成「空 scope」。根因是一个只在 CI 显形的死角——CI 在 push **之后**跑，`origin/main` 已推进到本次提交 → `merge-base HEAD origin/main` = HEAD → `git diff --name-only` 必空 → `resolveLocalChanged()` 曾返回 `[]`，后果双向：① `tests/test_changed_scope.ts` 的「非 null 时不应为空数组」直接红（**与本次改动无关的假红**，本地因 HEAD 领先远端而恒绿，故极易误判为偶发）；② 若放过，则 `resolveChangedScope` 产出空 scope → 三扫描器扫 0 文件**恒绿**（正是本模块头第 4 条纪律要防的假绿形态）。修法：抽纯函数 `parseGitNameOnly(stdout)` —— 空输出 → `null`（真空串与仅换行两种形态都覆盖；纯函数故可在任意环境确定性断言），`resolveLocalChanged` 改用它。**复现手法**（专治「本地绿、CI 红」）：`git update-ref refs/remotes/origin/main <HEAD>` 把基线推到 HEAD，且**工作树必须干净**（`git diff <base>` 含未提交改动，脏树会掩盖空 diff）→ 跑 `node tests/test_changed_scope.ts` 复现同形 AssertionError，验完立即 `update-ref` 还原原值。代价（已知并接受）：本地无改动 / 已推送状态下裸跑 `--changed` 会 fail-closed 报错而非静默 PASS——**自动化入口不受影响**（`pre-push-gate` 只传 `--files`；`check-biome --changed` 是 Biome 自身 VCS 模式，与本模块无关）。

实测（门禁 dry-run `--files frontend/src/views/app-tree/index.ts`，共 27 项）：`check-complexity` 0.4s / `check-params` 0.7s / `check-type-safety` 0.1s，三者 note 均带「--files 裁剪：本次变更 1 文件」；complexity FAIL 的标签为 `[存量债]`、结论仍 **PASS**（debt 不阻断），FAIL 明细 tail 直出「文件:行 函数 认知分」。对照全库口径：complexity 2.4s（301 命中）/ params **59.4s**（54 命中）——增量不只是防误红，也是 params 可挂门禁的前提。

**推论**：门禁全绿 = 「清单内静态工具 + 域检查 + 契约测试」全绿，**不等于**「仓库无风险」。审计/锐评下结论前须逐项确认覆盖，并报告「跑了哪些 + N/32」——只跑子集（如 5/32）极易漏掉 `check-complexity` 这类成规模问题（实证：views 域 10 个 🟥 可复现，交叉复核见 `git show bf0ab60c7:deliverables/views-review-crosscheck-2026-09-13.md`——该报告已随 `deliverables/` 目录退出工作区，正文改引提交以便复核，不再依赖磁盘路径）。三档位扫描器接门禁后已在前端域被拦（debt 告警、不阻断），但 `--all` 全量路径仍不跑——覆盖率口径照旧须报告。

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
- `scripts/_lib/gate-blocks/static-tools.ts`：静态工具执行器 `runTools(ctx, tools)` / `runScopedDocDrift(ctx)`——判定链（label/note/tail/blockPolicy→blocked/autoFix）的执行侧唯一实现。`ctx.sh` 为可替换属性，故该链可零子进程单测（`tests/test_gate_static_tools.ts`）。ADR-206 阶段 2（2026-09-13）
- `scripts/_lib/gate-blocks/data-docs-domain.ts` / `redlines.ts`：数据/文档/ADR/索引守护与红线执行器（自守卫，调度侧无条件按序调用）；红线保留 failClosed 特例与 --files 数组式传参。ADR-206 阶段 3-4（2026-09-13）
- `scripts/_lib/gate-ctx.ts`：执行上下文 `createGateCtx()`——`record` / `sh` / `shAsync` / `git` / `gofmtCheck` 的唯一实现，兼 `blocked` 活值 getter 与 `setBlocked`（failClosed 特例用），并导出 `GATE_TIMEOUT_MS` 作子进程超时单一来源。ADR-206 阶段 1 接线完成（2026-09-13）
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
- **菜单闸 kind 白名单分两层**（2026-09-15）：`check-menu-health` 根项走 `{panel,action,divider}`（可 dock 约定，无类型可推）；叶子节点走 `PreviewMenuNodeKind` 派生集（`menu-node-types.ts` 单一事实来源，含 `field/row/sectionTitle/card/controls…`）。**根项判据 = `const X: PreviewMenuNode[] = [...]` 数组元素 ∪ `X.push({...})` 实参**，其余一律叶子（独立 const 叶子、`children:[]` 内联字面量、工厂返回值）。id 唯一 / dockGroup / panel 渲染通道 / labelKey 必存在四条**只对根项生效**；叶子仅查 kind 白名单 + 已声明 labelKey 的 i18n。
  教训：旧版把「含 `id:`+`kind:` 的对象块」当根项代理 → `vrm-adapter.ts` 的独立 const 叶子 `VRM_PLAY_EMPTY_NODE`（`kind:"field"`，法定 `PreviewMenuNodeKind`）被按根白名单校验，令全仓 `commit-with-check`（前端域 hard block + `tests/test_check_menu_health.ts` 契约断言双路）假红 1 小时余。**判据要挂在容器归属上，别挂在对象块字段上**——后者是代理假设，一类新写法即破。
- **门禁红灯的杀伤点在 push 而非 commit**：`.githooks/pre-commit` 不跑 `check-menu-health`/域级检查（只有 gen 同步 / 知识漂移 / 行级 biome），故前端域红灯期间本地 commit 照落（2026-09-15 实证：21:52、21:55 两笔在红灯下正常提交），真正拦截发生在 `pre-push-gate.ts` 的域块与 `node scripts/commit-with-check.ts`。CI 尚未同跑 gate ⇒ 本地钩子是唯一防线。排查「闸红了为什么还能提交」时先看这两条路径，别怀疑钩子没装（`core.hooksPath=.githooks`）。
- **红线扫描不可用（rg 缺失）必须阻断**（fail-closed）；基线债务（红线新增）不阻断，推送后修
- **`record()` 必须把 `blockPolicy` 一路落进 `results`**（2026-09-13 修复）：它不只是「是否阻断」的输入，更是 FAIL 明细归属标签（存量债／失守／本次引入）的事实源。漏存 → 所有 FAIL 被误标「本次引入」
- **阻断矩阵：只有 `hard`（及未声明策略）置 `blocked`；`debt` / `failClosed` 一律不阻断**（`_lib/gate-ctx.ts:188`：`if (!ok && blockPolicy !== "debt" && blockPolicy !== "failClosed") blocked = true`）。故**「FAIL 列表非空」≠「推送被卡」**：`check-deadcode-baseline` / `check-complexity`（实测 85 条）/ `check-params`（16 条）三项恒报存量为 `debt`，结论行照写「53/56 通过」却是 `PASS ✅ 放行推送`。判读顺序 = 先逐项看 `[归属]` 标签：`[存量债]`=debt 放行，`[本次引入]`／`[待归因]`=hard 才须修。2026-09-15 实证：89 笔一次性推送，6 项 FAIL 里只 3 项 hard（go test 计时 flaky + golangci-lint 4 条 + check-file-lines 破线），修完即 PASS——**别把存量债当自己的回归去清零**
- **性能退化门禁（`compareSingleBenchBaseline`）必须有**两层**噪声保护**（2026-09-15 补齐第 2 层，`go/cli/bench_concurrent.go`）：① `base` 与 `now` 双双 ≤ `benchNoiseFloorMs`(1ms) → 跳过；② **绝对增量** `now-base` ≤ 下限 → 跳过。只留 ① 是**不对称保护**——`base` 亚毫秒作分母时，`now` 只要刚过下限（0.5 → 1.4ms）相对百分比即被放大成 +180% 假退化，**pre-push 与 vitest 并跑时 `go/cli` 整包必 FAIL**（实测报「7 个阶段相对基准退化超过 50%」，而该测试单跑 3/3 PASS——典型负载 flaky）。真实退化不受影响（0.001 → 50ms 增量 49.999ms，仍被拦）。测试锚点：`bench_concurrent_test.go` 的 `TestRunSingleBenchJSON_SaveAndCompareRoundTrip` 同时守住两侧（亚毫秒+小增量不报 / 0.001→50ms 必报），改判定逻辑别把任一侧断言删掉
- **`ctx.blocked` 必须是活值**：实现为 getter，值快照会恒 false → 失败检查静默放行（fail-open）。改 GateCtx 时不得退回 `blocked,` 式值拷贝
- **变更集解析失败必须阻断**，不静默空跑放行（fail-closed）
- Windows 下 npx 是 npx.cmd，node spawn 需 `shell: true`
- git 数组参数直走 `procRun`（无 shell 拼接）：ref 允许 `$`/backtick 等元字符，拼字符串经 shell 会构成命令注入（pre-push stdin 的 localRef 可被攻击者控制）

## 相关

- ADR-206 — pre-push-gate 收敛分拆为 gate-blocks（阶段 1-7 全部落地，2026-09-13）
- ADR-146 — 路径卫生门禁（check-path-hygiene）
- ADR-085 — 菜单表健康门禁（check-menu-health）
- ADR-224 — mock 路径守卫（check-mock-paths；[mock_path_guard](./mock_path_guard.md)）
- ADR-088 — 静态工具并行回退（spawn 开销吃掉收益）
- ADR-145 — cli 解耦 app（check-go-diff-coverage --staged 实证）
- ADR-149 / ADR-150 — pre-commit 兜底收窄（对照）
- [pre-commit-hook](./pre-commit-hook.md) — 提交前钩子（互补：pre-commit 快同步，pre-push 全量阻断）
- [auto_import_split](./auto_import_split.md) — auto-import 挂载于 ALL_STATIC_TOOLS
- `docs/cli-commands.md` — doctor 命令（gate/--all/--docs 入口）
