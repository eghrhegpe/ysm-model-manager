---
kind: preview_3d_migration
name: preview-3d 领域根迁移
tier: leaf
category: feature
source_files:
  - scripts/pre-push-gate.ts
  - scripts/check-dynamic-import.ts
auto_fields:
  symbols_with_lines: []
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 整目录搬家、领域根提升、相对引用修复
  - cmd 命令行限制、目录归置
quick_risk_lines:
  - preview-3d 目录重排必须走 pre-push-gate / check-dynamic-import 校验，禁止手动改相对引用
pitfalls:
  - 手动改相对引用 → 漏改、构建报错；必须经 check-dynamic-import 自动修复
  - 重排不跑 pre-push-gate → 回归未检出；必须在 push 前跑 pre-push-gate

use_when:
  - 整目录搬家
  - 领域根提升
  - 相对引用修复
  - cmd 命令行限制
  - 目录归置
status: snapshot
---

# preview-3d 领域根迁移

## 概览

ADR-129 第三刀：把 `frontend/src/utils/3d/`（227 文件）整编搬迁到 `frontend/src/preview-3d/`。纯改名、收益最低、但暗礁最多。三刀顺序不可逆：第一刀正类型（依赖倒置修复）→ 第二刀降墙（preview-menu 收子目录）→ 第三刀正名（整编搬迁）。

## 三个暗礁（ADR-129 风险表漏掉的）

### 1. 跨层相对引用（最大暗礁）

`utils/3d` 并非自包含——36 个文件用 `../../dom/`、`../../safe-error-msg.ts` 等相对路径藕断丝连地引着 `utils/` 层兄弟目录（dom / debug / resource / animation / core / safe-error-msg）。父目录从 `utils/` 换成 `features/` 后，这些跨层引用全断、typecheck 报 36+ 条 TS2307。

**解法**：不手数层数，写一次性 Node 脚本做「原位置解析 → 真实目标 → 新位置反推」：
1. 把 `preview-3d/X` 逻辑映射回 `utils/3d/X` 的原目录；
2. 对每个相对 import 在原目录 resolve，若落在 `src/utils/`（非 3d）且文件存在 → 用新目录反推相对路径重写；
3. 规则本质：原 `k 个 ../ 到 utils`，变成 `k+1 个 ../ 再进 utils/`。

### 2. 转义路径漏网

正则/字符串里的 `utils\/3d`（反斜杠转义）躲过 `utils/3d`（正斜杠）的批量替换。git grep 正斜杠搜不到转义形式。

**解法**：额外 grep `utils\\/3d` 转义形式补刀。本次命中两处：`tests/test_check_diff_coverage.mjs` 的断言正则，与 `scripts/check-dynamic-import.ts` 的死排除（utils/3d 已不存在，直接删）。

### 3. cmd.exe 8K 命令行墙（pre-push-gate 存量 bug）

门禁 `--files` 传大文件列表经 `shell:true` 走 cmd.exe，受 8191 字符上限。整目录搬家 334 文件 1.7 万字符 → check-redlines 进程起不来 → fail-closed 报「输出解析失败」误阻推。

**解法**：门禁脚本改数组直传（`procRun('node', args)` 无 shell），走 Windows CreateProcess 32767 上限。已在 `scripts/pre-push-gate.ts` 留注释档。

## 验证清单（整目录搬家必跑）

- `cd frontend && npm run typecheck`（跨层 import 唯一可靠报错源）
- `npx vitest --run`（全量；注意 app-modules.boot.test.ts 有 flaky 时序，单独重跑可绿）
- `node scripts/check-doc-drift.ts`（架构树基线；archive 里报告型文档的路径索引需同步）
- `node scripts/check-deadcode-baseline.ts --update-baseline` 与 `check-redlines.mjs --json --update-baseline`（搬移必震基线）
- `npx vite build`

## 与其他子系统关系

- utils/ 搬迁后剩 9 个纯工具子目录（animation / async / cache / core / debug / dom / format / icon / resource），3d 渲染域彻底脱离 utils。
- 活路径（编译/门禁/归属/活指路文档）改，历史快照（ADR / novel / archive 决策叙事）留真；但 archive 里「架构树路径索引」会被 check-doc-drift 强制要求有效，需同步。

## 相关

- ADR-129-preview-3d-domain-root
- preview_core / preview_state / preview_panel_declarative（三刀改动的知识卡）