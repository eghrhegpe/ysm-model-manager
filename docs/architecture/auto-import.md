# auto-import — TS/JS 缺失 import 检测与自动补全

> 零依赖 Node 工具（`scripts/auto-import.mjs`），ADR-014 前端 TS 化伴生工具。
> 本质是 **goimports 轻量版**：检测源码中「用了但没 import」的符号，给出建议或自动写入。

---

## 1. 解决的问题

TS 化迁移中（ADR-014），新写 `.ts` 文件时手写 import 容易：

- 忘记导入 `bus` / `PageStore` / `utils/*` 等高频符号；
- 不知道符号从哪个模块导出（跨模块搜索成本高）；
- 相对路径 + `.ts` 扩展名风格不一致。

本工具扫描全项目导出符号表，与当前文件「出现但未导入」的标识符求交集，输出建议。

> ⚠️ **绑定符号刻意不补**：`DetectZipType` 等 Wails 绑定不在 frontend/js 导出表内，
> 项目规范是走 `getApp()` 解构（ADR-012），禁止直连绑定 import。

---

## 2. 用法

```bash
node scripts/auto-import.mjs                      # 检测全部 .ts
node scripts/auto-import.mjs frontend/js/core/handler-other.ts   # 单文件
node scripts/auto-import.mjs --include-js         # 连存量 .js 一起扫
node scripts/auto-import.mjs --fix                # 自动写入缺失 import（歧义跳过）
node scripts/auto-import.mjs --watch              # 监听变化自动重扫
node scripts/auto-import.mjs --json               # JSON 输出（CI 用）
node scripts/auto-import.mjs --strict             # 有缺失 → 退出码 1
```

退出码：默认 `0`（提示工具）；`--strict` 且存在缺失建议 → `1`。
已接入 `doctor.mjs` 静态分析套件（`--json --strict`，作为第 7 个检查项）。

### --fix 规则

- **歧义跳过**：符号在多个模块导出时（如 `esc` 同时存在于 modal.ts / dom.ts），不猜测来源，仅提示；
- **同模块聚合**：多个符号来自同一模块合并为一行，值/类型分组；
- **幂等**：写入后重跑不再报告，可放心重复执行；
- **保留原行尾**：CRLF 文件写回不破坏行尾（`join(eol)`）；
- **插入位置**：文件头部注释块之后、第一个 import（或代码）之前。

---

## 3. 能力矩阵（实测验证）

| 能力 | 状态 |
|------|------|
| 补项目模块符号（bus/PageStore/utils） | ✅ |
| 类型符号建议 `import type`（interface/type/enum 导出） | ✅ |
| 同名符号多模块 → 列出候选并标歧义 | ✅ |
| 排除注释/字符串/模板字面量/正则字面量 | ✅ |
| 排除关键词、浏览器/JS 全局内置（window/document/Promise 等） | ✅ |
| 排除本文件定义（const/function/class/参数/解构/对象方法/类方法） | ✅ |
| 排除属性访问 `obj.prop`、对象字面量 key `{ bus: 1 }` | ✅ |
| 排除 re-export `export { a } from "./x"` | ✅ |
| 动态导入 `import("./x")` 不误报 | ✅ |
| `--watch` 监听（`fs.watch` recursive，Windows 支持） | ✅ |

### 已修复的真实误报模式（提交 09abdd6）

| 模式 | 例子 | 修复 |
|------|------|------|
| 对象字面量 key | `{ bus: 1 }` 的 `bus` | key 前 `{`/`,` 且后 `:` 判定为 key，非引用 |
| async 方法名 | `async clear(): Promise<void> {}` | METHOD_START_RE 支持 `(?:async\s+)?` 前缀 |
| CRLF 写回破坏 | `--fix` 后 CRLF 变 LF | 检测原文件 `\r\n`，写回保留 |
| re-export 误报 | `export { a } from "./x"` | 花括号区间内符号跳过 |
| 对象方法定义 | `clear(): void {` | 方法名收集进 defined 集合 |
| 嵌套括号参数 | `esc: (s: string) => string` | matchParen 括号配对 + 顶层逗号拆分 |
| 类方法定义 | `resume(): void {` | 同上方法名收集 |

---

## 4. 已知局限（正则级，非 AST）

| 局限 | 影响 | 缓解 |
|------|------|------|
| 模板字符串 `${}` 插值不检测 | 漏报 | 可接受；漏报不产生错误代码 |
| 方法体参数不收集 | 参数名撞导出名的极低频误报 | 导出符号多为专名（PageStore/ALL_EXTS），命中概率低 |
| 正则级非 TS AST | 局部变量与外部符号无法 100% 区分 | 靠「导出表命中才建议」把误报面压到最小 |
| 单行多定义/复杂泛型嵌套 | 偶发漏报或误报 | 100% 精确待 ADR-014 P5 联邦 TS AST codemod |

**设计取舍**：宁可漏报不可误报——漏报只是「没提示」，误报会写入错误 import。

---

## 5. 回归基线

| 项 | 结果 |
|----|------|
| 全量检测 | 96 个 .ts，0 条建议（存量代码 import 齐整，与 `tsc --noEmit` 口径一致） |
| 阳性对照 | 删掉 `bus` import → 检出 → `--fix` 补回 → 重跑 0 条（幂等）✅ |
| 边界测试集 | 10 场景全部符合预期（见 §3） |

---

## 6. 相关链接

- ADR-014（TS 渐进迁移）：`docs/adr/ADR-014-typescript-migration.md`
- ADR-012（Binding 调用一致性，getApp 模式）：`docs/adr/ADR-012-binding-call-consistency.md`
- 符号消费者审计（同类工具）：`scripts/check-consumers.mjs`
- 源码扫描共享层：`scripts/_lib/scan-files.mjs`
