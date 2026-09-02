---
kind: source-graph
name: 源码符号提取共享层 source-graph.ts
tier: architecture
category: utils
source_files:
  - scripts/_lib/source-graph.ts
use_when:
  - 符号提取
  - 导出符号
  - 顶层声明
  - api-break
  - audit-split
  - rollback-impact
  - bloat-history
  - 依赖图
status: active
---
# 源码符号提取共享层 source-graph.ts

> **设计模式**：单一内核 + 分发层（"一个正则两套口径"），支撑 Go + JS/TS 双栈符号提取。6 个审计/检测工具共用，避免各自内联导致逐步分叉。

## 位置

- 共享层：`scripts/_lib/source-graph.ts`（338 行）
- 依赖：`_lib/to-posix.ts`（Windows 路径归一）+ `_lib/scan-files.ts` 的 `walk`

## 背景

项目早期各脚本（api-break / audit-split / rollback-impact / bloat-history 等）各自内联符号提取逻辑（tsTopDecls / goTopFuncs 等多份拷贝）。2026-08-31 审核发现分叉 bug：

| Bug | 症状 | 修复 |
|-----|------|------|
| `goTopFuncs` 注释承诺 func/type/const/var/分组块 五类，实际只提取 func | audit-split / rollback-impact 追踪迁移去向时把搬走的 type/const 误判为「已删除」 | commit `536a19e8` 重构，统一 `goDecls` / `tsDecls` 单一内核 |
| 两组正则结果拼接序未排序 | api-break 报告顺序不稳定 | 收敛后加 `.sort()` |
| 注释里的 `// func Ghost(` 被当真符号 | 误报 | 块注释剥离 + 行首锚定正则 |

本次重构（536a19e8）把 7 个脚本的符号提取逻辑上收到 `_lib/source-graph.ts`，净减 107 行（`-229/+122`），并建立"单一内核 + 分发层"的防御范式。

## 设计：两圈架构

```
                 ┌─────────────────────────────────┐
                 │        第一圈：分发层           │
                 │  (外部调用入口，带业务语义名)    │
                 └───────────────┬─────────────────┘
                                 │ import
                                 ▼
  ┌──────────────────────────────────────────────────────┐
  │              第二圈：单一内核                          │
  │    goDecls(text, exportedOnly)  ← Go 正则             │
  │    tsDecls(text, exportedOnly)  ← TS/JS 正则          │
  │  核心原则：两份正则各自自洽，不再各自内联              │
  └──────────────────────────────────────────────────────┘
```

### 第一圈：分发层（对外 API）

按「导出 vs 顶层」和「语言」两个正交维度提供 6 个导出函数：

| 函数 | 语义 | 实现 |
|------|------|------|
| `getExportedSymbols(fp, text?)` | JS/TS 导出符号（首字母过滤） | `tsDecls(text, true)` |
| `getGoExportedSymbols(fp, text?)` | Go 导出符号（首字母过滤） | `goDecls(text, true)` |
| `getExportedSymbolsAny(fp, text?)` | 自动分发：.go → Go，其余 → TS | 扩展名路由 |
| `goTopFuncs(text)` | Go 顶层声明全量（含私有） | `goDecls(text, false)` |
| `tsTopDecls(text)` | TS/JS 顶层声明全量 | `tsTopDecls(text, false)` |
| `topDeclsAny(path, text)` | 自动分发顶层声明全量 | 扩展名路由 |
| `searchName(sym)` | Type.Method → Method 裸名 | 文本后处理 |
| `countLines(text)` | 换行计数（与 line-counter 一致） | 公式 |

调用方按需挑选——**审计类**（api-break / audit-split / rollback-impact）需「导出 vs 全量」双口径对比，**统计类**（bloat-history / gen-knowledge-symbols）只需单口径。

### 第二圈：单一内核

`goDecls` / `tsDecls` 各带 `exportedOnly` 开关，使「导出符号」与「顶层声明（导出 + 私有）」两套口径共用同一份正则，**杜绝分叉**：

- **Go 侧**：`func (receiver) Method()` 记为 `Type.Method`（方法符号）；支持 func/type/const/var 四类 + `const (...)` 分组块。
- **TS/JS 侧**：function/class/interface/type/enum + const/let/var（含解构）+ `export { a, b as c }` 重新导出 + `export default Name`。
- **共性**：两种语言都输出 `Set<string>` + 最终 `.sort()`，保证确定性顺序（api-break 报告稳定）。

## 调用方（6 个）

| 脚本 | 用途 | 调用的出口 | 状态 |
|------|------|-----------|------|
| `api-break.mjs` | 破坏性变更检测 | `getExportedSymbolsAny` / `topDeclsAny` / `searchName` / `countLines` | ✅ 一线，pre-push --check |
| `audit-split.mjs` | refactor 提交主动审计 | `getExportedSymbolsAny` / `topDeclsAny` / `countLines` | ✅ 一线，manual + doctor |
| `rollback-impact.mjs` | revert 影响面分析 | `getExportedSymbolsAny` / `topDeclsAny` / `searchName` | ✅ 一线，manual |
| `bloat-history.mjs` | 单文件膨胀轨迹 | `getExportedSymbolsAny` / `topDeclsAny` / `countLines` | ✅ 一线，manual |
| `gen-knowledge-symbols.mjs` | 知识卡 symbols 字段同步 | `getExportedSymbolsAny` + `EXCLUDE_DIRS` | ✅ 一线，pre-commit GEN_CMDS |
| `check-lib-adoption.mjs` | _lib 采用率检查 | 只在 RULES 表里列 `advice` 字符串 | ⚠️ 并行会话未提交 |

**杠杆率**：审 source-graph.ts 1 行 ≈ 审这 6 个调用方各 1 行的正确性。2026-09 孤儿审计②判定"同模板复制铁证"的类比在这里也成立——**审共享层比审调用方更高效**。

## 与其他子系统关系

- `scripts/_lib/scan-files.ts` 的 `walk`：source-graph 借用它做源码文件收集（`.ts/.tsx/.js/.jsx` 扩展名），但符号提取本身不依赖 walk。
- `scripts/_lib/to-posix.ts`：Windows 路径归一（`C:\foo` → `C:/foo`），symbol 提取结果里路径统一正斜杠。
- `scripts/check-lib-adoption.ts`：采用率闸门——检测「手搓了某模块能覆盖的能力却未 import」。source-graph 的 `getExportedSymbolsAny` / `topDeclsAny` 在其 RULES 表里已有 `advice` 条目（见 check-lib-adoption.mjs L63）。
- `docs/adr/ADR-141-large-script-split-baseline.md`：2026-08-31 审计实证 source-graph 与 auto-import.extractExports 在 re-export 处理上存在 15 文件差异，结论「不复用」——这是**差异化设计不是复制**（source-graph 把转发符号也算本文件导出，auto-import 故意排除转发名）。
- `tests/test_scripts_lib.mjs`：契约测试，当前覆盖 scan-files / ripgrep / to-posix / parseRgLine，**尚未覆盖 source-graph**——这是待补缺口。

## 不变量

- **单一内核**：goDecls / tsDecls 是唯一的声明提取实现。新增正则必须同时改两处，或用统一参数化。
- **导出与顶层分两路**：`exportedOnly=true`（getExported*）和 `exportedOnly=false`（top*）必须严格分开调用，不可混用——混合会产生语义污染。
- **排序契约**：所有导出函数返回排序后的数组（Set → [...].sort()）。调用方不得假设原始顺序，也不得自行再排（会掩盖 bug）。
- **空文本容错**：`getExportedSymbols(filePath, null)` 与 `getExportedSymbolsAny(filePath, null)` 均退化为 `fs.readFileSync(filePath)`，不因 null 崩溃。
- **文本覆盖（textOverride）**：所有导出函数支持第二个参数 `textOverride`，供 rollback-impact / api-break 跨 ref 传历史源码文本（避免把历史 blob 落盘再读盘的双重开销）。

## 修复历史

| 日期 | 提交 | 问题 | 修复 |
|------|------|------|------|
| 2026-08-31 | `536a19e8` | goTopFuncs 只提取 func，漏 type/const/var/分组块 | 统一 goDecls 支持四类 + 分组块 |
| 2026-08-31 | `536a19e8` | 多份内联正则逐步分叉 | 上收到 source-graph.ts 单一内核 |
| 2026-08-31 | `536a19e8` | 结果拼接序未排序导致 api-break 报告不稳定 | 统一 `.sort()` |
| 2026-09-xx | 本卡 | 缺乏设计模式文档 | 新建知识卡 |

## 相关

- `scripts/_lib/source-graph.ts`（本卡 source）
- `scripts/api-break.ts`（破坏性变更检测，主力调用方）
- `scripts/audit-split.ts`（refactor 提交审计，主力调用方）
- `scripts/rollback-impact.ts`（revert 影响面分析，主力调用方）
- `scripts/bloat-history.ts`（单文件膨胀轨迹，主力调用方）
- `docs/adr/ADR-141-large-script-split-baseline.md`（2026-08-31 审计基线，含 source-graph 复用实证）
- `docs/knowledge/script_shared_cores.md`（共享核登记卡）
