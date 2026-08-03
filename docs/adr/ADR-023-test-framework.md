# ADR-023：测试体系

- **状态**：🔄 部分采纳（Go 单测 + Node 契约测试现行；Vitest 前端单测评估中）
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`tests/*.mjs`（契约测试）/ `go/` 各包单测 / `frontend/package.json`（vitest 依赖已装）/ ADR-014 P5 / ADR-020 / 联邦 MikuMikuAR（Vitest 4328 测试实证）

---

## 1. 背景（Context）

项目测试覆盖存在层级缺口：

- **后端有单测**：`go/` 各包（installer/recycle/watcher/ysm 等）有 Go 单测；
- **契约测试现行**：`tests/*.mjs`（Node 零依赖）校验 JSON/配置/HTML 引用完整性，已接入 CI；
- **前端无单测框架**：120 个 JS（现 TS 化中）无自动化测试，B 类审查盲区 #1「原生 JS 无类型系统」虽由 ADR-014 类型化缓解，但行为测试仍靠 review 人工盘问；
- **联邦实证**：MikuMikuAR 为 TypeScript + Vitest 4328 测试，收益已验证；
- **ADR-014 P5 预告**：「评估 Vitest」列为工具链质变的独立 ADR——本 ADR 承接。

## 2. 决策（Decision）

**决策**：测试体系采用三层结构——Go 单测（后端逻辑）+ Node 契约测试（数据/配置/引用完整性）+ Vitest（前端组件/纯函数），分层渐进引入。

### 2.1 层级划分

| 层 | 技术 | 覆盖 | 状态 |
|----|------|------|------|
| L1 后端单测 | Go `go test ./go/...` | installer/recycle/watcher/ysm 等纯逻辑 | ✅ 现行 |
| L2 契约测试 | Node `tests/*.mjs` | JSON schema / 配置值域 / HTML 引用完整性 | ✅ 现行（CI 已接） |
| L3 前端单测 | Vitest（jsdom） | 纯函数（utils/）+ 组件行为（Web Components） | 🔄 评估中 |

### 2.2 引入节奏（渐进，不做全量重写）

- **P0**：`frontend/package.json` 已含 vitest 依赖 + jsdom 环境（`test: vitest run`）——地基已铺；
- **P1**：优先测**纯函数层**（`utils/`，ADR-014 P2 已全迁 TS，零 DOM 依赖最好测）——如 display/fmt/dom/icon/summarize；
- **P2**：Web Components 行为测试（挂载 → 交互 → 断言），挑高价值组件（download-queue / app-tree）；
- **P3**：`vitest run` 进 CI，与契约测试并轨（不取代 review，补齐自动化盲区）。

### 2.3 边界

- **不引入重型框架**：保持 Web Components + Shadow DOM，Vitest 只做行为验证；
- **契约测试是宪法**：`tests/*.mjs` 禁止修改，L3 与其互补不重叠；
- **测试覆盖维度**：仍以「核心 Go 逻辑有单测 + 契约测试全过」为底线（AGENTS.md 审核维度），L3 是增量红利。

## 3. 后果（Consequences）

### 正面

- 前端行为测试从「人工盘问」升级为「可回归自动化」；
- utils 纯函数层测试成本最低、收益最高（TS 化后无 DOM 依赖）；
- 与联邦 Vitest 工具链对齐，测试写法/工具可搬运；
- 三层测试各司其职：逻辑（Go）/ 数据（Node）/ 行为（Vitest）。

### 负面

- 引入前端单测框架 = 新增 devDependency 维护面（vitest + jsdom）；
- Web Components 测试需 Shadow DOM 兼容处理（jsdom 限制）；
- 测试覆盖到位需要时间，前期收益集中在 utils 层。

### 已知遗留

- jsdom 对 Shadow DOM / Web Components 支持有限，复杂组件可能需 happy-dom 或真实浏览器（Playwright）——P2 评估后决定；
- Vitest 进 CI 时间点待 P1 落地后定。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `frontend/package.json` | vitest ^0.34 + jsdom 已装，`test: vitest run` 脚本就绪 |
| `tests/*.mjs` | 契约测试现行清单（test_config / test_schema / test_scripts_lib 等） |
| `go/` 各包 | Go 单测覆盖（installer/recycle/watcher/ysm 等） |
| ADR-014 P5 | 「评估 Vitest」工具链质变预告 |
| 联邦 MikuMikuAR | TS + Vitest 4328 测试实证（ADR-014 数据溯源） |
| AGENTS.md 审核维度 | 测试覆盖底线（Go 单测 + 契约测试） |

<!-- 文件名: test-framework.md → 实际文件 ADR-023-test-framework.md -->
