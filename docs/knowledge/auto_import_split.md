---
kind: auto_import_split
name: auto-import 拆分与缺失 import 检测
tier: architecture
category: config
source_files:
  - scripts/auto-import.mjs
  - scripts/auto-import-lexer.mjs
  - scripts/auto-import-symbols.mjs
  - scripts/auto-import-detect.mjs
  - scripts/auto-import-fix.mjs
use_when:
  - 缺失 import
  - auto-import
  - 导出符号
  - tokenize
  - 词法
  - 缺失导入
  - goimports
  - 大脚本拆分
---

# auto-import 拆分与缺失 import 检测

## 概览

`scripts/auto-import.mjs` 检测 TS/JS 缺失 import（goimports 轻量版，正则级非 AST 级，ADR-014 伴生）。原为 802 行单文件，2026-08-31 按 **ADR-141 大脚本拆分基线** 拆为五层模块（词法/符号/检测/修复/入口），主入口文件名不变（doctor/pre-push 挂载点零改动）。

原理：扫 frontend/src 提取全局导出符号表 → 对目标文件做词法剥离收集标识符 → 排除关键词/全局/本文件定义/已导入/属性访问 → 剩余标识符 ∩ 导出表 = 疑似缺失 import，输出建议（不写文件，`--fix` 才写）。

## 核心职责

- **词法层** `auto-import-lexer.mjs`：KEYWORDS/GLOBALS 白名单 + `tokenize(text)`——剥离注释/字符串/模板字面量/正则字面量（UTF-16 坐标，emoji 不破坏行号），收集代码状态标识符 token。
- **符号层** `auto-import-symbols.mjs`：`extractExports`（含 export type/block，**排除 re-export**）/ `extractDefined`（const/解构/函数/参数/方法）/ `extractImported`（命名/别名/默认/命名空间）+ 括号配对/逗号拆分/参数名工具。
- **检测层** `auto-import-detect.mjs`：`checkFile(file, symbolMap)`（去重/属性访问/对象 key/类字段判定）+ `buildSymbolMap` + `collectFiles` + `run`。
- **修复层** `auto-import-fix.mjs`：`applyFixes`（幂等写回，歧义跳过/聚合/CRLF 保留）+ `fmtText`/`fmtJson`。
- **入口** `auto-import.mjs`：CLI 解析 + `main` + `--watch`。

## 对外 API / 入口

```bash
node scripts/auto-import.mjs                      # 检测全部 .ts
node scripts/auto-import.mjs <file.ts>            # 单文件
node scripts/auto-import.mjs --include-js|--fix|--watch|--json|--strict
```

```js
import { tokenize } from './auto-import-lexer.mjs';
import { extractExports } from './auto-import-symbols.mjs';
import { checkFile } from './auto-import-detect.mjs';
import { applyFixes } from './auto-import-fix.mjs';
```

## 与其他子系统关系

- `scripts/pre-push-gate.mjs`：ALL_STATIC_TOOLS 挂 `auto-import.mjs --strict`（有缺失建议阻断推送），doctor 全量模式并入。
- `scripts/check-script-hygiene.mjs`：五口径扫 scripts/（含 auto-import 系列，文件头/共享层内联/parse-args），拆分后各模块须过。
- `scripts/check-readme-index.mjs`：auto-import 系列须登记 scripts/README.md（ADR-141 拆分后新增 4 个模块已登记）。
- `scripts/_lib/source-graph.ts`：`getExportedSymbols` 与 `extractExports` 疑似重复，**实证结论 = 不复用**——source-graph 把 re-export 符号也算本文件导出（726 文件中 15 个差异全为此形态），接入会破坏 --fix 候选指向。
- `docs/knowledge/scripts_argv.md`：姊妹治理卡——argv 规范；本卡负责 auto-import 拆分与缺失 import 检测。

## 不变量

- **parity 铁律（ADR-141）**：拆分是等行为重构，三重验证——全量 `--json` 逐字节一致 / 有缺失 fixture 逐字节一致 / `--fix` 写回逐字节一致。实测 726 文件 scanned=726、missing=0，OLD vs NEW 全过。
- **re-export 排除**：`export { X } from "./y"` 的 X 不算本文件导出（转发名不是本文件定义，候选应指向真正定义处）——这是不复用 source-graph 的核心理由。
- **模板插值不分析**：`${foo}` 内符号不检测（已知局限，漏报可接受）。
- **歧义不自动写**：`--fix` 对多候选符号跳过，不猜测来源。

## 相关

- `scripts/auto-import.mjs` + 4 个 `auto-import-*.mjs`（本卡 source）
- `docs/adr/ADR-141-large-script-split-baseline.md`（拆分基线）
- `scripts/pre-push-gate.mjs`（门禁挂载）
- `tests/test_auto_import.mjs`（13 项契约测试）
- `docs/knowledge/scripts_argv.md`（姊妹治理卡）
