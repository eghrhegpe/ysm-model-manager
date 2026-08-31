# ADR-141：大脚本拆分基线

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-31
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-040 架构规模治理 / scripts/auto-import.mjs`

---

## 1. 背景（Context）

ADR-040 为前端/Go 立了规模红线（拆分后每文件 ≤400 行），但**脚本体系 `scripts/*.mjs` 没有对应的拆分基线**。2026-08-31 探查审计（实跑）发现：

| 脚本 | 行数 | 角色 |
|------|------|------|
| `auto-import.mjs` | 802 | 最大单点，未拆过 |
| `pre-push-gate.mjs` | 712 | 聚合派发器（可辩护） |
| `check-redlines.mjs` | 607 | 聚合派发器（可辩护） |
| `codemod.mjs` | 574 | 大分析工具 |
| `line-counter.mjs` | 573 | 大分析工具 |

痛点：
- **单文件职责混杂**：auto-import 一个文件里词法（tokenize 188 行）/ 符号提取（161 行）/ 检测（71 行）/ 修复（67 行）四层全挤在一起，改一处要通读全文件。
- **可测性差**：纯函数未导出，只能整脚本黑盒跑，路径覆盖薄（锐评：auto-import/codemod 只有 guard 级测试）。
- **共享层复用无法实证**：`_lib/source-graph.mjs` 的 `getExportedSymbols` 与 auto-import 的 `extractExports` 疑似重复，但没有机制验证能否替换。

## 2. 决策（Decision）

### 2.1 脚本拆分层级

**决策**：大脚本按「词法 / 符号 / 检测 / 修复 / 入口」五层拆，每文件 **≤400 行**（与 ADR-040 对齐），主入口保留原文件名（doctor/pre-push 挂载点零改动），各层以 `auto-import-<layer>.mjs` 命名平铺在 `scripts/` 下。

拆分判定阈值：单脚本 >500 行且含 ≥2 个职责层 → 拆；聚合派发器（如 pre-push-gate 这种把检查清单当数据编排的）可保留，但其中内联的可独立逻辑块仍应抽文件。

### 2.2 parity 验证协议（等行为重构铁律）

**决策**：拆分是**等行为重构**，必须三重 parity 验证通过才算完成，否则回退：

1. **全量基线**：拆分前 `--json` 存基线 → 拆分后 `--json` **逐字节一致**（如 auto-import 的 726 文件 scanned=726/missing=0）。
2. **有缺失 fixture**：构造引用真实导出符号但不 import 的临时文件，拆分前后建议**逐字节一致**（验证检出路径真实执行）。
3. **--fix 写回**：同一 fixture 分别 `--fix`，写入的 import 行与插入位置**逐字节一致**（验证幂等写回）。

### 2.3 共享层复用须实证

**决策**：拆出的模块是否复用 `_lib/` 既有能力，**先跑对比实证、结果一致才接入**，不凭"看起来像"判断。

ADR-141 落地实证（726 文件）：`source-graph.getExportedSymbols` 与 `extractExports` **结论 = 不复用**——
- 711/726 文件结果一致，15 个差异全是**同一形态**：`export { X } from "./y"` 的 re-export（转发）符号。
- source-graph 把转发符号也算本文件导出；auto-import 的 `EXPORT_BLOCK_RE` 用 `(?!\s*from)` 故意排除（转发名不是本文件定义，候选应指向真正定义处）。
- 若接入，`--fix` 可能建议 `from "./转发层"` 而非 `from "./真正定义处"`，破坏 parity。

## 3. 后果（Consequences）

正面：
- 可维护性：每文件 ≤400 行，职责单一，改词法不碰检测。
- 可测试性：各层导出纯函数，契约测试直达（auto-import 拆分后 13 项测试覆盖 tokenize/extract/checkFile/applyFixes）。
- 共享层边界清晰：领域专属逻辑不入 `_lib/`（共享层只放跨脚本复用能力）。

负面：
- **不是性能优化**：拆分不改变逻辑，pre-push 门禁耗时不变（auto-import 仍占 ~8.3s）。
- 新模块文件需登记 README（check-readme-index 守护）+ 过 check-script-hygiene（文件头 5 字段）。

已知遗留：
- `pre-push-gate`（712）/ `check-redlines`（607）为聚合派发器，本次不拆，留待各自域内重构时按本基线办理。
- 性能优化（符号表缓存 / 并行扫描）另立专项，不在本 ADR 范围。

## 4. 数据溯源

| 来源 | → 结果 |
|------|--------|
| 2026-08-31 探查审计（行数排行 Top12） | → 确认 5 个 >500 行胖子，auto-import 802 最大 |
| `node scripts/auto-import.mjs --json`（拆分前基线） | → scanned=726, missing=0 |
| 拆分后 `--json` / 有缺失 fixture / `--fix` 三重对比 | → 逐字节一致（parity 通过） |
| 726 文件 source-graph vs extractExports 对比 | → 15 文件差异均为 re-export 形态，**结论不复用** |
| `tests/test_auto_import.mjs` | → 13 项契约测试全过 |

<!-- 文件名: large-script-split-baseline.md → 实际文件 ADR-141-large-script-split-baseline.md -->
