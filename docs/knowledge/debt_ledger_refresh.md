---
kind: debt_ledger_refresh
name: 技术债账本刷新与盘点方法论
tier: leaf
category: config
status: active
source_files:
  - scripts/check-doc-drift.ts
  - scripts/check-deadcode-baseline.ts
  - scripts/baseline/doc-drift-baseline.json
  - docs/architecture.md
use_when:
  - 想知道仓里现在还能发现多少技术债
  - 刷新 / 收紧 7 本债务账本（redlines / deadcode / design-tokens / i18n-unused / doc-drift / jscpd-go / layering）到今日实数
  - 多 AI 并行会话期改动被 worktree reset 冲掉
pitfalls:
  - 误判「文件数变多 = 债恶化」——须读内容判是合理扩展还是失控（见「数文件数 ≠ 债」）
  - check-deadcode-baseline 默认模式会自动收编写基线，只读务必带 --json
  - check-doc-drift 的 ARCH_DOCS 若指向已删文档 → archText 空 → unregistered 虚报全部模块
  - 架构树引用的构建产物（dist/*.wasm、*.exe）在干净检出里不存在——未豁免 git 忽略项即 CI 恒红
  - 有未治新债时误用 --update-baseline 会把债冻结进账本
quick_groups:
  - 门禁与脚本
quick_intents:
  - 盘点当前技术债并刷新 7 本账本
quick_risk_lines:
  - 未提交改动在多 AI 并行期会被 worktree reset 冲掉——改账本 / 文档后必须立即 --files 提交锁定
invariant_anchors:
  - scripts/check-doc-drift.ts|CODE_PATH_RE
  - scripts/check-doc-drift.ts|checkArchRefs
  - scripts/check-doc-drift.ts|isGitIgnored
  - scripts/check-doc-drift.ts|collectSourceModules
  - scripts/check-doc-drift.ts|checkArchCoverage
  - scripts/check-doc-drift.ts|checkAgentsTree
  - scripts/_lib/contract-tests.ts|collectContractTests
last_verified: 2026-10-08
---

# 技术债账本刷新与盘点方法论

## 概览

技术债在本仓是**受控存量**：baseline 账本只减不增、门禁不阻断存量债、新增零容忍。因此「还能发现多少债」分三层答——**已记账存量**（7 本 baseline）、**裸露代码标记**（TODO/FIXME）、**账本外盲区**（测试真空 / 踩红线 / 架构 ADR open）。本卡给刷新与盘点的可复用方法。

## 核心职责

### 7 本债务账本 + 刷新命令（只读报告 vs 收紧 vs 冻结）

| 账本（scripts/baseline/） | 刷新实数（只读） | 收紧 / 冻结 | 备注 |
|---|---|---|---|
| redlines-baseline.json | `check-redlines --json` | `--update-baseline` | 全 19 规则候选 ≠ 账本「债务型 6 规则」，口径别混 |
| deadcode-baseline.json | `check-deadcode-baseline --json` | `--update-baseline` | **默认模式会「自动收编」写基线，只读必须 `--json`** |
| design-tokens-baseline.json | `check-design-tokens` | `--update-baseline` | ADR-256 后仅 doctor 报告 / 收债排期，不参与门禁判定 |
| i18n-unused-baseline.json | `check-i18n-unused --json` | `--update-baseline` | dead + testOnly 合计 = 账本 count |
| doc-drift-baseline.json | `check-doc-drift` | `--fix` | 架构树「未登记模块」；假象坑见不变量 |
| jscpd-go-baseline.json | `jscpd-go --json` | `--update` | 看 `added`/`fixed`/`drifted`，`added=0` = 无新债 |
| docs/.layering-baseline.json | `check-layering` | `--update` | 前端分层反向边，只减不增 |

**纪律**：刷新 = 只读报告（左列），收紧 / 冻结 = 右列。有**未治新债**时误用收紧会把债写进 baseline（AGENTS.md「--update 会冻结当前状态」），须先治理再冻结。

### 判断「还能发现多少债」

1. **存量**：读 7 本账本 `count` + 各 check 只读实数（今日 vs 冻结）。`errors=0` / `added=0` = 无账本外隐藏新债冒出来。
2. **裸露**：分域 `grep TODO|FIXME|HACK`，剔除误报（Go `context.TODO()`、测试数据 `"HACKED"`、`new-knowledge-card` 模板占位 `TODO`）。
3. **盲区**：零测试文件/包、踩 ADR-040 400 行红线、跨平台 CI 零覆盖、可访问性、性能预算。
4. **架构 open**：ADR 决策矩阵里标「待处理」的项（多为历史快照，须回源码核验是否已还，勿照抄）。

## 对外 API / 入口

- 盘点入口：`node scripts/doctor.ts --docs`（文档闸，秒级）/ `doctor.ts`（全量）
- 各账本 check 脚本的 `--json` 只读模式（`_summary` 给 count / errors / added）

## 与其他子系统关系

- 账本 = 门禁（pre-push / doctor）的存量债度量；gate 只在 hard 档阻断，debt 档只记录（见 `check-threshold-scanners`）。
- `docs/architecture.md` 是活架构文档（单一权威视图）；`check-doc-drift` 架构树维度比对它，模块全路径须在其正文出现（§3.6 索引，`collectSourceModules` 扫描 `frontend/src` + `go` + `internal` 顶层子目录）。

## 不变量 / 已知坑（实证 2026-10-05）

- **数文件数 ≠ 债，要读内容**：ADR-091 曾把 `*-3d.ts`「5→10 个文件」「download-queue 3→4」判为失控膨胀。读码实证：`*-3d.ts` 已是 `PREVIEW_HANDLERS` 注册表驱动的 thin entry（新增资源类型本就该长），download-queue 拆分遵守 ADR-040 400 行红线 + 契约 re-export、`-web` 是桌面/Web 双路径——**均为健康扩展而非失控**。判债必读内容，勿数文件个数。
- **多 AI 并行期 worktree 会被 reset 冲掉未提交改动**：实证本会话连续 3 次把 §3.6 / 账本改动做完、`doctor` 已绿，`git diff HEAD` 却突然全空（被并行会话 / 钩子 reset 回 HEAD）。**改账本 / 文档后须立即 `commit-with-check --files` 锁定**，勿攒批。「`git diff HEAD` 全空但行为刚变过」= 被冲信号。
- **AGENTS.md 目录树闸「认块不认章节号」**（2026-10-08 根治，`checkAgentsTree`）：旧实现锚定「§4.2 前端」标题——AGENTS.md 瘦身重排后该章节消失，匹配恒 miss 只发 INFO「跳过」，闸门**静默空转却一眼绿**（与 `check-biome --changed` 空转同形态：文档结构一动，锚死结构的闸即失焦）。新口径 = 正文任一围栏代码块含 `frontend/src/` 即视为目录树、逐行验真（行首为树字形 `├└│─` 者跳过，不误判段名）；无树块 = 瘦身后健康态仅记 INFO（手写树由 check-knowledge-drift 检查4 拦截，不会回潮）。验闸通电用幽灵探针：临时塞一段含不存在目录的树块，确认 WARN 只点幽灵段。**推论：散文里勿硬编码计数**——AGENTS.md 口令表曾硬写契约测试条数，tests 增删后数字与实况脱节数日无人发现（本会话对账实证）；现改「全量枚举 tests/*.ts」无数口径，发现者 `collectContractTests` 本为 readdir 全量枚举，无数字措辞可恒真、有数字措辞必腐。
- **check-doc-drift 假象**：`ARCH_DOCS` 若指向已删除文档（曾指三份归档），`archText` 为空 → `checkArchCoverage` 把 `collectSourceModules()` 全判 unregistered（虚报全部顶层模块）。比对对象必须是活文档 `docs/architecture.md`。
- **`CODE_PATH_RE` 只匹配「反引号 + `frontend/`/`go/`/`internal/`/`scripts/` 前缀」的路径**：文档里裸文件名（`web.html`）/ 树行无反引号**不触发** `checkArchRefs`；写「已删除的旧路径」时勿用全路径反引号（会报引用漂移），改说「旧 X 已废，现 root `resource_types.json` 单源」。
- **架构树引用「构建产物」必须豁免 git 忽略项，否则 CI 结构性恒红**（2026-10-07 根因修，`checkArchRefs`）：`docs/architecture.md` 合法登记产物路径（`frontend/dist/wasm/YSMParser.wasm`、`go/updater/ysm-updater-helper.exe`、`frontend/src/wasm/ysm-wasm-data*.js`），它们被 `.gitignore` 排除、**从不入 git** ⇒ 干净检出（CI 全新 clone）里必然不存在 ⇒ 原实现一律 `fs.existsSync` 报 ERROR。**形态是「本地绿 CI 红」且与改动无关**：开发机跑过 build 故文件在、恒绿；CI 全新 clone 恒红。实证 2026-10-04 `2ee0d7fd8` 起连红多轮（含两轮先于本次推送）——本地 `contract-tests` 122/122 绿、CI 却挂 `tests/test_gate_static_tools.ts` 第 8 组（`runScopedDocDrift` 传不存在文件要求 `matched=0` 合法 PASS）。修法：交 git 裁决（`git check-ignore -q -- <ref>`，命中即视为「产物未构建」记 INFO 而非 ERROR），勿手抄 glob（忽略规则散在 `.gitignore` 多行，必漂移）。**复现手法**：`git worktree add --detach <dir> HEAD` 建干净检出再跑 `node scripts/contract-tests.ts`——本机工作树因残留产物而掩盖此病。

## 相关

- `check-threshold-scanners`（三档阈值扫描器 gate debt 档）
- `pre-push-gate`（blockPolicy / 归属标签 / `--files` 判决域 ≠ 提交域）
- `scripts-jscpd-go`（Go 重复账本独立演进）
- `docs/architecture.md` §3.6（模块全路径索引，`check-doc-drift` 架构树维度事实源）
