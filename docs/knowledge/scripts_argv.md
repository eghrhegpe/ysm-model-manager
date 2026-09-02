---
kind: scripts_argv
name: 脚本 argv 规范与已知豁免 parse-args.ts
tier: architecture
category: config
source_files:
  - scripts/_lib/parse-args.ts
use_when:
  - 脚本参数
  - argv
  - parseArgs
  - 手写参数解析
  - positional
  - 未知 flag
  - 脚本卫生
  - hygiene
status: snapshot
---

# 脚本 argv 规范与已知豁免 parse-args.ts

## 概览

`scripts/*.mjs` 的命令行参数解析**统一走共享层 `scripts/_lib/parse-args.ts`**，禁止手写 `process.argv` 解析。核心动机（2026-08-04 全量审核 + 2026-08-30 收敛）：手写 `argv.includes('--flag')` 无法拦截拼错的 flag——`--jso` 会被静默忽略并走进默认行为（audit-split 曾中招：`--jso` 拼错照常写盘）。

## 核心职责

- **统一解析**：`parseArgs(argv, { bools, strings, defaults })` 支持 bool/string flag、`--flag=value`、`--` 分隔符、`--help`/`-h`。
- **unknown 白名单拦截**：拼错的 flag 进 `result.unknown`，调用方必须 `if (args.unknown.length) { 报错 + 退非 0 }`——这是本规范的**硬性要求**，`check-script-hygiene` 检查「import parseArgs 但未消费 unknown」。
- **positional 收集**：裸参数进 `result._`，消费时取 `_[0]` 等，取代手写 `argv.find(a => !a.startsWith('--'))`。
- **门禁**：`pre-push-gate.mjs` 以 `check-script-hygiene --strict` 挂载，脚本卫生问题（含未走 parse-args 的 positional 消费、未消费 unknown）**阻断推送**。

## 对外 API / 入口

```js
import { parseArgs } from './_lib/parse-args.ts';
const args = parseArgs(process.argv.slice(2), {
  bools: ['check', 'json', 'strict'],
  strings: ['scope'],
  defaults: { threshold: 30 },
});
// → { _: [], check: false, ..., unknown: [], help: false }
if (args.unknown.length) { console.error(`❌ 未知参数: ${args.unknown.join(', ')}`); process.exit(2); }
```

- `unknown` 消费两种合法形态（hygiene 都认）：属性访问 `args.unknown.length` 或解构 `const { unknown } = parseArgs(...)`。
- 退出码约定：用法错误（含 unknown）退 2 是业界惯例，但**历史脚本保留各自原退出码**（inspect_ysm / test-decode-from-memory 退 1，其余退 2），迁移时不得为统一而改语义。

## 与其他子系统关系

- `scripts/check-script-hygiene.ts`：检查口径五条——① 退出码失效（裸 `main();`）② 共享层内联（含内联 parseArgs）③ `--json` 契约 ④ 文件头 5 字段 ⑤ **positional 须走 parse-args**。默认 WARN 不阻断，`--strict` 下 `warns>0` 退 1。
- `scripts/pre-push-gate.ts`：ALL_STATIC_TOOLS / DOC_STATIC_TOOLS 均挂 `check-script-hygiene --strict`。
- `docs/knowledge/` 内其他卡：`check-knowledge-drift --affected` 会在本卡 source_files（parse-args.ts）变更时提示复核。

## 不变量

- **positional 必拦截**：消费 positional 的脚本必须走 parse-args 并消费 unknown，否则 hygiene WARN（`--strict` 阻断）。
- **hooks/ 目录豁免**：`scripts/hooks/*.mjs` 消费的是 git 钩子协议参数（prepare-commit-msg 的 $1/$2、pre-push stdin），参数语义由 git 约定固定、非 CLI 用户输入——hygiene 的 `collectScripts` 跳过 hooks/ 目录，**不适用** positional 口径。
- **只收 bool 的脚本豁免**：`process.argv.includes('--check')` 这类只收 bool flag、不消费 positional 的脚本（doctor.mjs、check-* 系列），拼错 flag 会静默忽略但无吞文件参数危害，优先级低，**不强制迁**。
- **已知保留的手写解析**：`commit-with-check.mjs` 的 `-m <msg>` 单字符带值 flag，parse-args 不支持（只支持 `--flag value` / `--flag=value`），保留手写是**正确设计**，勿迁。
- **风险面统计口径**（2026-08-31 实核）：89 个 `scripts/*.mjs` 中 22 个 import parse-args；59 个手写 argv 但其中多数只收 bool；真正「手写 argv + 消费 positional」的已全部迁移清零。

## 相关

- `scripts/_lib/parse-args.ts`（本卡 source）
- `scripts/check-script-hygiene.ts`（检查口径）
- `scripts/pre-push-gate.ts`（门禁挂载）
- `scripts/commit-with-check.ts`（已知豁免示例：`-m` 单字符带值）
