# ADR-023：测试体系

- **状态**：🔄 部分采纳（L1 Go 单测 / L2 契约测试现行；L3 Vitest 已落地运行并接入质量门禁——20 文件 / 302 用例 + v8 覆盖率基线 + 阈值红线；pre-push-gate / doctor / CI 均跑）
- **日期**：2026-08-03（初定），2026-08-04（L3 落地 + 覆盖率基线 + 进门禁/CI + 阈值红线 + 补测报告脚本）
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`tests/*.mjs`（契约测试）/ `go/` 各包单测 / `frontend/package.json`（vitest 依赖已装）/ `frontend/vite.config.js`（vitest + v8 coverage 配置 + thresholds）/ `scripts/test-coverage-report.mjs`（补测发现）/ ADR-014 P5 / ADR-020 / 联邦 MikuMikuAR（Vitest 4328 测试实证）

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
| L3 前端单测 | Vitest（jsdom） | 纯函数（utils/）+ 功能/交互层（features/core/components） | ✅ 现行（20 文件 / 302 用例） |

### 2.2 引入节奏（渐进，不做全量重写）

- **P0** ✅：`frontend/package.json` 已含 vitest 依赖 + jsdom 环境（`test: vitest run`）——地基已铺；
- **P1** ✅：**纯函数层**（`utils/`）全覆盖——display/fmt/dom/icon/summarize/extensions/resource-types/stagger/mc-format/animation/model2d/errors；
- **P2** ✅：功能/交互层落地——`features/community/data.ts`（tryFetchModels 并发竞速）、`core/context-menus.ts`（异步 handler）、`download-queue.ts`（STATE + 事件流）、`app-tree` utils/data、`components/context-menu`；
- **P3** ✅：`vitest run` 已接入质量门禁——`scripts/pre-push-gate.mjs`（前端域变更时跑）+ `scripts/doctor.mjs`（全量自检）+ `.github/workflows/ci.yml`（CI 独立 job）。与契约测试并轨（不取代 review，补齐自动化盲区）。

### 2.3 边界

- **不引入重型框架**：保持 Web Components + Shadow DOM，Vitest 只做行为验证；
- **契约测试是宪法**：`tests/*.mjs` 禁止修改，L3 与其互补不重叠；
- **测试覆盖维度**：仍以「核心 Go 逻辑有单测 + 契约测试全过」为底线（AGENTS.md 审核维度），L3 是增量红利。

### 2.4 覆盖率基线（v8）

- **配置**：`frontend/vite.config.js` test 块加 `coverage: { provider: "v8", reporter: ["text","html","json"], include: ["js/**/*.ts","js/**/*.js"], exclude: ["js/**/*.test.js","js/wasm/**"] }`；
- **脚本**：`npm run test:coverage`（`vitest run --coverage`）；依赖 `@vitest/coverage-v8@0.34.6`（**必须与 vitest 0.34.6 同版本**，装 latest 4.x 触发 ERESOLVE peer 冲突）；
- **阈值（防回退）**：`coverage.thresholds` 设全局门槛——statements 85 / lines 85 / functions 82 / branches 70（低于基线 90.29% 留 ~5pt 缓冲，防正常迭代被卡；跌破即 `test:coverage` 失败，红灯提示回补）。不设 perFile 门槛，避免拖死未触达的 UI 重灾区（download-queue 77% / debug 67%）。
- **基线**：整体语句覆盖率 90.29%；薄弱区回填后——errors.ts 100% / community/data.ts 99% / context-menus.ts 86% / model2d.ts 94% / display.ts 100% / download-queue.ts 77%；
- **补测发现闭环**：`scripts/test-coverage-report.mjs` 读 `coverage/coverage-final.json`（v8 json reporter 产物），按语句覆盖率升序输出「未覆盖行 + 未覆盖函数」清单，AI/人工据此决定下一批补测对象（接入方式见 §2.5）；
- **产物不入库**：根 `.gitignore` 加 `frontend/coverage/`。

### 2.5 质量门禁接入（P3 落地）

L3 测试「写了要跑、坏了要红」——接入三处守护，防止测试漂移：

| 入口 | 触发时机 | 行为 |
|------|---------|------|
| `scripts/pre-push-gate.mjs` | 前端域（`frontend/**`）变更时本地 push | `cd frontend && npx vitest run`，失败阻断推送 |
| `scripts/doctor.mjs` | 手动 `node scripts/doctor.mjs` 全量自检 | `checkFrontendTest()` 并入，失败置退出码非 0 |
| `.github/workflows/release.yml`（主 CI） | push main / PR（windows-latest） | `npm ci` + tsc 后 `npx vitest run`，失败阻断合并 |

设计取舍：
- **不塞进 `pages-deploy.yml`**：该 job 是纯文档站 Jekyll 部署，无 node_modules 环境；vitest 归主 CI job，职责分离。
- **复用现有 CI 而非新建**：主 CI（`release.yml`）已有 setup-node + `npm ci` + tsc，vitest 是增量一步，不另起 workflow。
- **门槛是「全量跑 + 覆盖率红线」**：三处守护保证 302 用例随改动回归；覆盖率阈值（§2.4）随 `test:coverage` 生效防回退，`test-coverage-report.mjs` 提供补测发现闭环。设计取舍：门禁跑的是快速全量（无 coverage 开销），深度覆盖率由手动 `test:coverage` 承担，避免 CI 耗时膨胀。
- **与契约测试并轨**：L2（数据/文档完整性）+ L3（前端行为）各自独立，`pre-push-gate` 前端域同时触发两者。

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
- 覆盖率全局阈值已设（§2.4），但未设 perFile 门槛——UI 重灾区（download-queue 77% / debug 67%）暂靠报告脚本人工排期补齐，不强制。
- **测试「长治久安」三支柱**（2026-08-04 固化）：(1) 进了就跑——vitest 接入 pre-push-gate / doctor / CI；(2) 坏了要红——覆盖率阈值防回退；(3) 补有依据—— `test-coverage-report.mjs` 输出未覆盖清单，杜绝「凭感觉补测」。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `frontend/package.json` | vitest ^0.34 + jsdom 已装，`test: vitest run` 脚本就绪；新增 `test:coverage` + `@vitest/coverage-v8@0.34.6` |
| `frontend/vite.config.js` | test.coverage（v8 provider，include js/**，exclude *.test.js + wasm/**）；新增 thresholds（stmts/lines 85、functions 82、branches 70）+ json reporter |
| `npm run test:coverage` | 20 文件 / 302 用例全过；整体语句覆盖率 90.29%（errors 100% / data 99% / context-menus 86% / model2d 94% / display 100% / download-queue 77%） |
| `scripts/test-coverage-report.mjs` | 读 coverage-final.json → 未覆盖行/函数清单（升序 + --json） |
| `scripts/pre-push-gate.mjs` | 前端域变更时 `npx vitest run`（P3 落地，见 §2.5） |
| `scripts/doctor.mjs` | `checkFrontendTest()` 并入全量自检（P3 落地） |
| `.github/workflows/release.yml` | 主 CI（windows-latest）`npm ci` + tsc 后 `npx vitest run`（P3 落地；不塞入 pages-deploy） |
| `tests/*.mjs` | 契约测试现行清单（test_config / test_schema / test_scripts_lib 等） |
| `go/` 各包 | Go 单测覆盖（installer/recycle/watcher/ysm 等） |
| ADR-014 P5 | 「评估 Vitest」工具链质变预告 |
| 联邦 MikuMikuAR | TS + Vitest 4328 测试实证（ADR-014 数据溯源） |
| AGENTS.md 审核维度 | 测试覆盖底线（Go 单测 + 契约测试） |

<!-- 文件名: test-framework.md → 实际文件 ADR-023-test-framework.md -->
