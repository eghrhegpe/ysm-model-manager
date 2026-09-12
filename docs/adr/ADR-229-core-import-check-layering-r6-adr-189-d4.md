# ADR-229：check-layering R6 —— core 测试文件 import backend 兜底，收窄测试豁免盲区

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-12
- **决策人**：Jieling（人类首席架构师）、AI 代理（鲸鱼架构师）
- **相关**：
  - 关联代码：`scripts/check-layering.ts`（R6 规则 + 专用扫描循环）、`tests/test_check_layering.ts`（R6 零违规契约断言）、`AGENTS.md`（L43/L44 表述同步）
  - 前置规则：ADR-189 D4（core 准入准则）/ ADR-190 D2 + ADR-208 D1（features/views→backend seam，check-layering R5）
  - 反向引用：[ADR-189](./ADR-189-frontend-core-backend-utils-core-feedback.md)（core 断环 + 准入三准则的原始决策）

---

## 1. 背景（Context）

ADR-189 D4 立 core 准入准则：「core 是引擎无关内核，依赖方向只许别人引它」。但 check-layering 的 `SCAN_OPTS.skipFile` 对**所有** `.test.ts`/`.spec.ts` 整体豁免（`/\.(d|test|spec)\.tsx?$/`），这条豁免是为 R5（features/views 测试合法 import `backend/app.ts`，经 `*-deps.ts` seam 或 vi.mock）服务的——**副作用是 R0/R6 的红线在测试文件里形同虚设**。

实证病灶（2026-09-12 core 测试回归红线收口会话）：`frontend/src/core/error-diary.test.ts` 曾 `import { installGlobalErrorListeners } from "@/backend/global-error-listeners.ts"`，把 backend 装配层拉进 core 测试——违反 ADR-189 D4「无 Wails 也能单测」第③条（type 感知亦违约），且靠**人工眼检**抓出，门禁零拦截。病灶已被物理删除（同会话 `5e8d9346`），但门禁盲区未补——下次还会有人犯。

AGENTS.md L44 原表述「禁止 core 直接 `import backend/*`（回归红线，pre-commit 有 `check-redlines` 兜底）」与门禁现实不符：`.githooks/pre-commit` 无 check-redlines 调用（实际挂 pre-push），且 check-redlines 是 rg 模式扫描（无层判定能力，`@/backend/` 在 rg 下字面匹配，无法区分来源文件在 `core/` 还是 `features/`）。

## 2. 决策（Decision）

### D1 R6 零容忍规则（采纳）

`check-layering.ts` 新增 **R6**：`core/**` 测试文件（`.test.ts`/`.spec.ts`）不得 import `backend/*`（**运行时或 type-only**——「无 Wails 也能单测」对 type 感知同样不成立，type 越层亦违规）。

### D2 实现：专用扫描循环，不动 skipFile（采纳）

**不**收窄 `SCAN_OPTS.skipFile`（让所有测试文件参与主循环）——那会把 features/views 测试卷进 R5 扫描造成误伤（features 测试经 vi.mock 或 `*-deps.ts` 合法 import `backend/app.ts`）。

改为：保留主循环现有 skipFile 豁免语义（R1/R2/R3/R4/R5 不变），**单独走一遍** `walk(SRC_ROOT, { skipFile: /\.d\.[tj]sx?$/ })`（仅豁免声明文件，测试文件不豁免），在循环里按 `fromLayer === "core" && /\.(test|spec)\.[tj]sx?$/.test(srcRel)` 过滤出 core 测试文件，命中 `target.startsWith("backend/")` 即 R6 违规。

理由：R6 是「层对层」结构判定，归属 check-layering 而非 check-path-hygiene（词法引擎，规则域错位）或 check-redlines（rg 模式，无层判定）。独立循环避免污染主循环的 `viewsOnlyR5` 等分流逻辑，性能代价可忽略（core/** 体量小，多走一遍 walk）。

### D3 级别与范围（采纳）

| 维度 | 定档 | 理由 |
|------|------|------|
| 级别 | FAIL（零容忍区，进 `rZero`，与 R1/R2/R0/R5 同档） | 回归红线（AGENTS.md L44「禁止 core import backend/*」），与 R0 同语义档位 |
| 范围 | 仅 `core/**` 下的 `.test.ts`/`.spec.ts` | backend 是 check-layering 公理豁免层（「import 它们不违规」），features/views 测试经 seam 或 vi.mock 直引 backend 有既有合法形态；全测试范围会误伤。core 是唯一「引擎无关内核」，测试越层无合法例外 |
| type-only | 一并 FAIL | 「无 Wails 也能单测」对 type 感知不成立（core 对绑定零感知） |
| 豁免通道 | 无 | ADR-189 D4 三条准入全满足才可入 core，测试越层无合法形态；如需豁免走 `docs/.mock-path-exempt.json` 同级治理，另立决策 |

### D4 契约测试锁（采纳）

`tests/test_check_layering.ts` 新增断言：当前仓库 `zero_tolerance_violations` 中 `rule === "R6"` 计数 = 0（与既有 R5 零违规断言同型，防 R6 退化空转）。

### D5 文档同步（采纳）

AGENTS.md L43/L44 表述订正：
- L43「依赖方向只许别人引它，check-layering R0 机制兜底」→「utils/dom 越层走 check-layering R0、backend 越层走 check-layering R6（含 core 测试文件）机制兜底」
- L44「pre-commit 有 check-redlines 兜底」→「check-layering R6 兜底；测试文件越层 2026-09 补齐后无盲区」

## 3. 后果（Consequences）

**正面**
- core 测试越层 import 从「靠人眼」升级为「门禁 FAIL 阻断」，回归红线有机制兜底
- R6 负例实证（canary 文件 `core/_r6_canary.test.ts` import backend → rc=1 阻断）确认非空转
- 不动 skipFile 语义，R5 对 features/views 测试的既有豁免不受影响（零回归）

**负面 / 成本**
- core/** 测试文件多走一遍 `walk`（体量小，毫秒级，可忽略）
- check-layering 契约测试 +1 断言（R6 零违规），维护面微增
- AGENTS.md 表述与 check-layering 规则文本需保持同步（drift 风险靠 check-knowledge-drift 兜底，check-layering.ts 不在任何知识卡 `source_files` 内，drift 风险低）

**已知遗留**
- R6 只拦「来源在 `core/` 且目标在 `backend/`」的测试文件 import；若未来 core 拆分出子目录（如 `core/i18n/` 已有）且其测试文件 import backend，R6 的 `srcRel.startsWith("core/")` 天然覆盖（`core/i18n/*.test.ts` 命中前缀）
- check-redlines 不做纵深防御（rg 无层判定，硬塞会误伤 features 测试合法 import backend）——单点 check-layering 已够，不双保险

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `grep -rn "backend" frontend/src/core/*.test.ts` | P0 修复后 0 条运行时 import（仅头注释 4 处合规声明） |
| `node scripts/check-layering.ts --json`（R6 上线后） | `zero_tolerance=0`，契约测试 R6 断言通过 |
| canary 负例 `core/_r6_canary.test.ts`（临时，已删） | `[R6] core/_r6_canary.test.ts:1 → backend/global-error-listeners.ts`，rc=1 |
| `node tests/test_check_layering.ts` | 全绿（10 断言含新 R6） |
| `node scripts/check-biome-lines.ts` | 无 staged frontend TS → 行级闸跳过（存量 non-null 断言非本次引入） |
| `node scripts/new-adr.ts` | 最大编号 228 → 占号 ADR-229 |
