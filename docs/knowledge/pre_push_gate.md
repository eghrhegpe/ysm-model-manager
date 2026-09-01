---
kind: pre_push_gate
name: 推送前门禁 pre-push-gate
tier: architecture
category: utils
source_files:
  - scripts/pre-push-gate.ts
  - .githooks/pre-push
  - scripts/_lib/gate-config.ts
use_when:
  - 推送门禁
  - 质量门禁
  - 域级检查
  - 门禁阻断
  - go build
  - vite build
  - 契约测试
  - Promise.all
quick_groups:
  - 提交与钩子
quick_intents:
  - 推送被门禁阻断怎么办
  - 门禁检查项有哪些
  - 改门禁并行结构
quick_risk_lines:
  - 门禁并行 async IIFE 必须带调用括号，漏 () 会静默跳过整域检查
  - 推送门禁失败先看 FAIL 块，禁止无脑 git push --no-verify 绕过
pitfalls:
  - 改 Promise.all 并行结构漏写 () → 域级检查静默不跑（8/17 起 13 项失效实证）
  - push 被拒直接 --no-verify → 绕过不留审计；应修 FAIL 项或 git pull 整合
---

# 推送前门禁 pre-push-gate

## 概览

`.githooks/pre-push`（薄壳）→ `scripts/pre-push-gate.ts`（调度器，681 行）：本地质量门禁核心，**CI 红之前本地先红**。按变更域（Go / 前端 / 数据 / 文档）裁剪检查，硬错误（编译/测试/契约/链接）阻断推送，基线债务（红线新增、死代码）只报告不阻断——推送后修，发布前全量 doctor 兜底。

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

### 域级检查（Go ∥ 前端，Promise.all 并行）

**Go 域**（plan.go）：updater helper 前置构建（go:embed 依赖）→ `go build ./go/...` → `go test -race ./go/... ./internal/app/ -count=1 -timeout 60s` → `go vet` → gofmt 只读检出 → `binding-check`

**前端域**（plan.frontend）：`check-layering`（R1/R2 零容忍 + R3/R4 基线）→ `check-path-hygiene`（ADR-146：反桶/深度/上跳/跨边界冻结/双写一致性）→ `check-menu-health`（ADR-085：菜单表 id/labelKey/i18n/dockGroup/kind/render·run 完备）→ `check-ctx-menu-i18n`（tr() key 必须存在于 zh-CN 基准包）→ npm 三件套并行（`vite build` ∥ `tsc --noEmit`）→ `vitest run --maxWorkers 8` 串行在后

**数据域**（plan.data）：`type-consistency`（resource_types.json ↔ extensions.js 一致）

**文档域**（plan.docs）：`link-checker`（断链）→ `release-notes-gen --check`（git tag 单一事实源）→ `gen-docs-index --check`（docs/adr 变更时）

**红线域**（plan.redlines）：`check-redlines --baseline` + `--files` 变更域过滤（仅本次变更文件内的违规计入新增阻断；`--all/--docs` 全库比对）。**扫描不可用（rg 缺失/fail-closed）必须阻断**——扫描没跑成不等于债务

**ADR 域**（plan.adr）：`adr-check`

**契约测试**（按域裁剪，2026-09 #2）：`_lib/contract-tests.ts` 的 `selectContractTests(变更域)` 选子集——`--all` 全量；`--files`/push 按 `byDomain` 键集命中 `CONTRACT_TEST_DOMAINS` 映射（go/frontend/data/docs 各跑相关子集，mixed 跨端契约任一端变更都触发）；改 scripts/tests（域 `tests`）→ 全量（工具自身改动影响面大）。映射表事实来源 `docs/contract-tests-audit.md`，规则锁定 `tests/test_contract_domain_select.ts`

### 静态工具（`runTools`，串行）

- 清单单一事实来源 = `_lib/gate-config.ts`（`ALL_STATIC_TOOLS` 26 项 / `DOC_STATIC_TOOLS` / `DOC_EXTRA_SCRIPTS` / `FRONTEND_STATIC_TOOLS` / `GO_STATIC_TOOLS`）；gate 只调度不改清单
- 审计类工具退出码不可靠（恒 0），必须解析 `--json` 的 `_summary` 判定（`s.ok` / `s.errors`）
- autoFix 项（如 `event-graph --check`）FAIL 时自动跑写盘版刷新后重验
- `check-go-diff-coverage` 在文件驱动模式加 `--staged`（只查本次暂存区，否则把 origin/main 之后所有未推送改动误算进覆盖门禁）
- 静态工具段不并行（回退 ADR-088：spawn 开销吃掉 sub-second 工具收益）

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
- `scripts/_lib/domain-classify.ts`：`planFromFiles` / `groupByDomain` / `domainSummaryText`
- `scripts/_lib/contract-tests.ts`：契约测试并行执行器
- `scripts/_lib/proc.ts`：`procRun`（超时/错误分类契约；数组参数直走 CreateProcess 避 cmd.exe 8191 限制）
- `scripts/_lib/log-push.ts`：结果日志
- `scripts/gen-doc-next-steps.ts`：PASS 后后台刷新待补地图

## 不变量

- **IIFE 必须带调用括号**（2026-09-01 实证，commit `fd3d0431`）：Promise.all 里的 `(async () => {...})()` 漏 `()` 会导致 async 函数**静默不执行**——8/17 起 `go build/test`、`vite build/vitest`、`check-layering` 等 13 项域级检查从未执行，门禁成了「静态工具串行 + 契约测试」的假重（commit `1e4aa81d` 引入）。改门禁并行结构后必须 dry-run 验证各域真的跑了
- **严禁在 pre-push 内 commit --amend**：git push 在调用钩子前已快照要推送的 oid，钩子里 amend 只改本地 HEAD，推送的仍是旧 oid → 本地与远端分叉、二次 push 必被拒（2026-08-12 实测：gofmt amend 3291cb16 假成功，实际推送 b644e96b）
- **link-checker / type-consistency 退出码恒 0**，必须用 `--json` 解析 `_summary` 判定，不得依赖退出码
- **红线扫描不可用（rg 缺失）必须阻断**（fail-closed）；基线债务（红线新增）不阻断，推送后修
- **变更集解析失败必须阻断**，不静默空跑放行（fail-closed）
- Windows 下 npx 是 npx.cmd，node spawn 需 `shell: true`
- git 数组参数直走 `procRun`（无 shell 拼接）：ref 允许 `$`/backtick 等元字符，拼字符串经 shell 会构成命令注入（pre-push stdin 的 localRef 可被攻击者控制）

## 相关

- ADR-146 — 路径卫生门禁（check-path-hygiene）
- ADR-085 — 菜单表健康门禁（check-menu-health）
- ADR-088 — 静态工具并行回退（spawn 开销吃掉收益）
- ADR-145 — cli 解耦 app（check-go-diff-coverage --staged 实证）
- ADR-149 / ADR-150 — pre-commit 兜底收窄（对照）
- [pre-commit-hook](./pre-commit-hook.md) — 提交前钩子（互补：pre-commit 快同步，pre-push 全量阻断）
- [auto_import_split](./auto_import_split.md) — auto-import 挂载于 ALL_STATIC_TOOLS
- `docs/cli-commands.md` — doctor 命令（gate/--all/--docs 入口）
