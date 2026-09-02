---
kind: auto_import_split
name: auto-import 拆分与缺失 import 检测
tier: architecture
category: config
source_files:
  - scripts/auto-import.ts
  - scripts/auto-import-lexer.ts
  - scripts/auto-import-symbols.ts
  - scripts/auto-import-detect.ts
  - scripts/auto-import-fix.ts
auto_fields:
  symbols_with_lines:
    - applyFixes
    - buildSymbolMap
    - checkFile
    - collectFiles
    - collectMethods
    - collectParams
    - extractDefined
    - extractExports
    - extractImported
    - fmtJson
    - fmtText
    - GLOBALS
    - KEYWORDS
    - matchParen
    - paramNamesOfSegment
    - relativeImportSpec
    - run
    - splitBlockEntries
    - splitTopLevelCommas
    - tokenize
  use_when:
    - 缺失 import
    - auto-import
    - 导出符号
    - tokenize
    - 词法
    - 缺失导入
    - goimports
    - 大脚本拆分
use_when:
  - 缺失 import
  - auto-import
  - 导出符号
  - tokenize
  - 词法
  - 缺失导入
  - goimports
  - 大脚本拆分
pitfalls:
  - "re-export 符号（export { X } from \".y\"）不算本文件导出，--fix 不会为其补 import"
  - "模板插值 ${foo} 内标识符不检测，属于已知漏报局限"
  - "歧义符号 --fix 跳过不写，需手动处理"
  - "source-graph 把 re-export 也算导出，不复用是有意设计"
  - "splitBlockEntries / splitTopLevelCommas 仅处理 import 块头部"
  - "属性访问 obj.prop 中的 prop 被排除，不会触发缺失建议"
quick_intents:
  - "检测缺失 import（只读报告）"
  - "自动修复缺失 import（--fix 写回，幂等）"
  - "CI/门禁：strict 模式阻断有缺失的推送"
  - "排查拆分后 parity 是否对齐"
status: active
---

# auto-import 拆分与缺失 import 检测

## 概览

`scripts/auto-import.ts` 检测 TS/JS 缺失 import（goimports 轻量版，正则级非 AST 级，ADR-014 伴生）。原为 802 行单文件，2026-08-31 按 **ADR-141 大脚本拆分基线** 拆为五层模块（词法/符号/检测/修复/入口），主入口文件名不变（doctor/pre-push 挂载点零改动）。

原理：扫 frontend/src 提取全局导出符号表 → 对目标文件做词法剥离收集标识符 → 排除关键词/全局/本文件定义/已导入/属性访问 → 剩余标识符 ∩ 导出表 = 疑似缺失 import，输出建议（不写文件，`--fix` 才写）。

## 核心职责

- **词法层** `auto-import-lexer.ts`：KEYWORDS/GLOBALS 白名单 + `tokenize(text)`——剥离注释/字符串/模板字面量/正则字面量（UTF-16 坐标，emoji 不破坏行号），收集代码状态标识符 token。
- **符号层** `auto-import-symbols.ts`：`extractExports`（含 export type/block，**排除 re-export**）/ `extractDefined`（const/解构/函数/参数/方法）/ `extractImported`（命名/别名/默认/命名空间）+ 括号配对/逗号拆分/参数名工具。
- **检测层** `auto-import-detect.ts`：`checkFile(file, symbolMap, cache?)`（去重/属性访问/对象 key/类字段判定）+ `buildSymbolMap` + `collectFiles` + `run`。
- **修复层** `auto-import-fix.ts`：`applyFixes`（幂等写回，歧义跳过/聚合/CRLF 保留）+ `fmtText`/`fmtJson`。
- **入口** `auto-import.ts`：CLI 解析 + `main` + `--watch`。
- **tokenize 单次缓存（2026-09-01，commit `fd3d0431`）**：`run()` 内 `buildSymbolMap` 与 `checkFile` 共享同一份 `Map<file, {stripped, tokens, text}>` 缓存——同一文件不再 readText+tokenize 两遍（全量 726 文件时检测总耗时近乎双倍）。`checkFile`/`buildSymbolMap` 第三个参数 `cache?` 跨调用复用；`run()` 显式传入，单文件模式符号表仍基于全量 walk 构建。

## 对外 API / 入口

```bash
node scripts/auto-import.ts                      # 检测全部 .ts
node scripts/auto-import.ts <file.ts>            # 单文件
node scripts/auto-import.ts --include-js|--fix|--watch|--json|--strict
```

```js
import { tokenize } from './auto-import-lexer.ts';
import { extractExports } from './auto-import-symbols.ts';
import { checkFile } from './auto-import-detect.ts';
import { applyFixes } from './auto-import-fix.ts';
```

## 与其他子系统关系

- `scripts/pre-push-gate.ts`：ALL_STATIC_TOOLS 挂 `auto-import.mjs --strict`（有缺失建议阻断推送），doctor 全量模式并入。
- `scripts/check-script-hygiene.ts`：五口径扫 scripts/（含 auto-import 系列，文件头/共享层内联/parse-args），拆分后各模块须过。
- `scripts/check-readme-index.ts`：auto-import 系列须登记 scripts/README.md（ADR-141 拆分后新增 4 个模块已登记）。
- `scripts/_lib/source-graph.ts`：`getExportedSymbols` 与 `extractExports` 疑似重复，**实证结论 = 不复用**——source-graph 把 re-export 符号也算本文件导出（726 文件中 15 个差异全为此形态），接入会破坏 --fix 候选指向。
- `docs/knowledge/scripts_argv.md`：姊妹治理卡——argv 规范；本卡负责 auto-import 拆分与缺失 import 检测。

## 不变量

- **parity 铁律（ADR-141）**：拆分是等行为重构，三重验证——全量 `--json` 逐字节一致 / 有缺失 fixture 逐字节一致 / `--fix` 写回逐字节一致。实测 726 文件 scanned=726、missing=0，OLD vs NEW 全过。
- **re-export 排除**：`export { X } from "./y"` 的 X 不算本文件导出（转发名不是本文件定义，候选应指向真正定义处）——这是不复用 source-graph 的核心理由。
- **模板插值不分析**：`${foo}` 内符号不检测（已知局限，漏报可接受）。
- **歧义不自动写**：`--fix` 对多候选符号跳过，不猜测来源。

## 相关

- `scripts/auto-import.ts` + 4 个 `auto-import-*.ts`（本卡 source）
- `docs/adr/ADR-141-large-script-split-baseline.md`（拆分基线）
- `scripts/pre-push-gate.ts`（门禁挂载）
- `tests/test_auto_import.ts`（13 项契约测试）
- `docs/knowledge/scripts_argv.md`（姊妹治理卡）
