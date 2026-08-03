# ADR-020：脚本体系

- **状态**：✅ 已采纳
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/`（约 40 个 .mjs）/ `scripts/_lib/scan-files.mjs` / `scripts/README.md` / `tests/*.mjs` / ADR-013 / ADR-014 / 联邦 MikuMikuAR（工具链适配来源）

---

## 1. 背景（Context）

项目治理与静态分析依赖大量脚本，但在统一为 `.mjs` 之前存在四类系统性痛点（本 ADR 的决策动机）：

| # | 痛点 | 表现 | 后果 |
|---|------|------|------|
| 1 | **Python/Node 双运行时分裂** | `check_*.py` / `fix_*.py` / `validate_data.py` 与 `*.mjs` 并存，跨语言调用需切换解释器 | 新人/AI 无法统一入口；`scripts/README.md` 分类表被撕裂 |
| 2 | **一次性脚本堆积** | `compare-*.py`、`restore_nico.py`、`transform_creators.py` 等历史使命完成后滞留 | 死代码基线噪音；无法判断哪些可删、哪些仍被 CI/文档引用 |
| 3 | **无共享层** | 每个脚本内联自己的 `walk()` / `resolveImport()` / ROOT 样板 | 同一逻辑在多个脚本重复实现，修一处漏多处；Windows 反斜杠/CRLF 处理不一致 |
| 4 | **无 `--json` 契约** | 工具输出格式随意，AI 子代理无法稳定消费 | 治理脚本无法接入 CI/自动化；doctor 等聚合器难解析 |

**约束**：脚本必须零第三方依赖（仅 node 内置），跨 Windows/macOS 可跑，能被 AI 子代理稳定调用。

## 2. 决策（Decision）

**决策**：统一脚本体系为 **Node `.mjs` 零依赖工具链**，收敛共享层、契约与生命周期。

### 2.1 统一运行时（消灭双运行时）

- 所有治理/生成/检查脚本迁移为 `.mjs`（2026-08-03 全量迁移，Python 脚本随迁移清理）；
- 契约测试同步为 `tests/*.mjs`（Node 零依赖）；
- 单一入口：`node scripts/<tool>.mjs`。

### 2.2 共享层（`scripts/_lib/`）

- `scan-files.mjs`：`walk()`（.js/.ts 收集）、`resolveImport()`（补全 .ts/.js/index）、`toPosix()`、`readText()`（BOM/CRLF 容错）、`SRC_DIR` / `ROOT` 常量；
- `frontmatter.mjs`：frontmatter 解析（ADR-019 知识卡体系复用）；
- 各治理脚本 import 共享层，删除内联样板（ADR-013 治理收敛的执行层）。

### 2.3 输出契约

- 检查类脚本支持 `--json`（结构化为 AI/CI 可消费的 JSON）；
- 退出码语义：`0` = 通过 / `1` = 发现问题（`--strict` 收紧）；
- `doctor.mjs` 聚合：编译 + 单测 + 前端构建 + tsc + 文件 + 红线 + 静态分析（含 auto-import，见提交 47d44aa）。

### 2.4 生命周期管理

- 脚本入库（取消 `scripts/` 全局忽略，提交 54d3063）；
- 死代码基线 `check-deadcode-baseline.mjs`（knip+jscpd）监管新增；一次性命中历史使命后标记删除；
- `README.md` 作为脚本索引（分档：生产级/实用级/治理检查/生成器）。

## 3. 后果（Consequences）

### 正面

- 单一运行时消灭双语言切换，AI/新人统一 `node scripts/...` 入口；
- 共享层收敛重复实现（walk/resolveImport/ROOT 单点维护）；
- `--json` 契约让工具链可编程接入（doctor 聚合、CI、子代理消费）；
- 死代码基线 + 全景索引让脚本生命周期可审计；
- 与联邦工具链对齐，可双向搬运（check-consumers / check-circular / codemod，ADR-014 P5 预告）。

### 负面

- 纯 Node 正则级分析，无法达到 TS AST 级精度（已知，ADR-014 P5 再升级）；
- 零依赖约束限制了解析能力（如无 `typescript` 包时无法做完整类型分析）；
- 迁移初期存量 Python 脚本需人工确认废弃（`README.md` 已列已删除清单）。

### 已知遗留

- `check-doc-drift.mjs` / `check-deadcode-baseline.mjs` 使用 `scripts/baseline/` 基线文件，刷新需 `--fix` / `--update-baseline`；
- 部分脚本（gen-* 生成器）非检查类，无 `--json` 输出（设计使然，不强制）。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `scripts/` 目录扫描 | 约 40 个 .mjs，覆盖检查/生成/脚手架三类 |
| `scripts/_lib/scan-files.mjs` | 共享层：walk / resolveImport / toPosix / readText / SRC_DIR |
| `scripts/README.md` | 分档索引 + 「已删除（2026-08-03 Python 迁移）」清单 |
| `tests/*.mjs` | 契约测试 Node 化（test_config / test_schema / test_scripts_lib 等） |
| ADR-013 | 治理收敛 Phase 1：文档宪法对账 + 联邦基线对齐 |
| ADR-014 | P5 预告「工具链质变（独立 ADR）」——本 ADR 承接执行层 |
| 提交 54d3063 / 47d44aa | scripts/ 入库 / auto-import 接入 doctor |

<!-- 文件名: script-toolchain.md → 实际文件 ADR-020-script-toolchain.md -->
