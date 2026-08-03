# ADR-013：治理体系收敛 — 文档宪法对账与联邦基线对齐

- **状态**：已采纳（Accepted）
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`AGENTS.md` §一 / `docs/adr/` / `docs/architecture/README.md` / `docs/knowledge/` / `.github/workflows/` / `PROJECT-INDEX.md` / `.agents/skills/review/SKILL.md` / `docs/release-notes/`

---

## 1. 背景（Context）

以联邦（MikuMikuAR）治理基线为参照，逐项核验本项目文档体系与治理现实。核验方式为「宪法断言 vs 磁盘事实」对账（trust but verify），共发现 **10 项差距，按影响分级：P1 × 4、P2 × 4、P3 × 2**。

### 1.1 差距清单

| # | 级别 | 差距 | 证据（已核实） | 影响 |
|---|------|------|----------------|------|
| 1 | 🔴 P1 | **ADR 体系未注册进宪法** | AGENTS.md §一 目录用途无 `adr/` 条目；磁盘 `docs/adr/` 已有 8 篇（ADR-001~008）。无编号/状态/生命周期规则 | 新 AI 从宪法出发感知不到 ADR 体系；ADR 沦为「写了的文档」而非治理机制 |
| 2 | 🔴 P1 | **文档地图与磁盘脱节** | `docs/knowledge/` 18 个文件（含独立 AGENTS.md / README.md / index.md + 3 个维护脚本），宪法地图零注册；违反宪法自身「没有的目录不存在」原则 | 宪法是「愿望清单」而非现实索引；知识库成第二治理体系 |
| 3 | 🔴 P1 | **断链 + 孤儿文档** | `docs/architecture/README.md:109` 引用 `../AI_INDEX.md`（不存在）；`:60` 与 AGENTS.md 速查表引用 `docs/release-notes/README.md`（不存在）；根目录 `PROJECT-INDEX.md` 停留在 v1.7.4（实际 v1.9.3） | 违反宪法「断链 = 任务失败」；过时索引误导 AI 与新人 |
| 4 | 🔴 P1 | **CI 名存实亡** | `.github/workflows/` 为空目录；AGENTS.md 与 PROJECT-INDEX.md 均声称 CI 跑 `go vet + go test + 构建打包` | 契约测试只本地人工跑，无线上回归；「必须通过」无强制载体 |
| 5 | 🟡 P2 | **ADR 编号格式漂移 + 并行撞号** | git `3cae9cb` 提交写「ADR-0001」，文件名为 `ADR-001-*`；**2026-08-03 当日实测：多会话并行写 ADR，009/010/012 三次撞号**（本文档初稿依次从 009 → 010 → 012 → 013） | 编号唯一性无强制规则且无占号机制，检索与引用易错，并行写作互相踩踏 |
| 6 | 🟡 P2 | **ADR 无状态汇总** | 8 篇 ADR 无总索引；无「进行中 ADR」清单（联邦有进行中表格 + gen:status） | 治理迭代方向不可追溯，ADR 之间关系不可见 |
| 7 | 🟡 P2 | **审查格式缺决策框架** | `.agents/skills/review/SKILL.md` 输出「逐规则违规清单+修复方案」；无总体结论、无 P1–P4 风险表、无类型安全/数据流追踪维度（联邦固定格式四件套） | 有审查工具但缺分级决策，无法判断「能合/不能合」 |
| 8 | 🟡 P2 | **发版说明未收敛** | release-notes/ 110 文件：v1.0.2~v1.5.x 为「主 + compare」双文件，v1.6.4+ 模式混杂（有的仅 compare、有的仅主文件） | 发版记录格式无单一事实来源，检索成本高 |
| 9 | 🟢 P3 | **根级文档未归位** | 根目录 7 个 md，除 AGENTS.md / README.md 外 5 个（PROJECT-INDEX / PUBLISH_GUIDE / RELEASE_NOTES_GITHUB / README-the-journey / SKILL.md）不在文档地图 | 宪法外存在持续累积，地图权威性被稀释 |
| 10 | 🟢 P3 | **契约测试覆盖窄** | tests/python/ 6 个测试全在 JSON/配置/HTML 层；无 go test 强制门槛、无前端静态检查（联邦有 tsc 零错误 + 契约测试 13/13） | 「构建通过」无法证明逻辑正确性 |

### 1.2 亮点（保留不动）

- ✅ `tests/python/` 6 个契约测试与 AGENTS.md 描述**完全一致**，宪法断言属实
- ✅ `.agents/skills/` 16 个 skill + `scripts/` 35 个脚本真实存在，工具链不虚
- ✅ 提交纪律已联邦化：`docs(adr)` / `chore(build)` / `refactor(app)` / `feat`（Conventional Commits + scope）
- ✅ 已吸收联邦实践：Taskfile 脚手架、`internal/app` 拆分（对应 ADR-102 精神）、Wails 3 迁移
- ✅ `bug-chronicle.md` 确实 1369 行，AGENTS.md「先 grep 再读」的约束有据

---

## 2. 决策（Decision）

**决策**：以「宪法对账 → 文档清理 → CI 复活 → 审查升级」四阶段收敛治理体系，使宪法与现实重新合一。每阶段独立验收、可单独合并。

### Phase 0 — 宪法对账（本 ADR 落地后立即执行）

| 动作 | 内容 | 验收 |
|------|------|------|
| 0.1 | AGENTS.md §一 目录用途补 `adr/`（ADR 归档）与 `knowledge/`（模块知识卡）条目 | 文档地图 = 磁盘现实，双向核对零遗漏 |
| 0.2 | AGENTS.md 补 ADR 使用规则：编号 = 现有最大号 +1（三位，如 ADR-013），文件名 `ADR-NNN-kebab-case.md`，禁止「ADR-000N」式前缀；**写文件前先在 `adr/README.md` 登记表占号**，防多会话并行撞号 | 新 ADR 编号唯一性有明文 + 有占号机制 |
| 0.3 | 建立 `docs/adr/README.md` 总索引：编号 / 标题 / 状态 / 日期 / 关联 ADR | 任一 ADR 可 30 秒定位上下文 |
| 0.4 | 修订 AGENTS.md 速查表：`docs/release-notes/README.md` 引用改为实际存在路径 | 断链清零 |

### Phase 1 — 文档清理（孤儿归位）

| 动作 | 内容 | 验收 |
|------|------|------|
| 1.1 | 修复 `docs/architecture/README.md:109` 的 `AI_INDEX.md` 断链（改为 `docs/knowledge/index.md` 或删除该行） | link-checker 扫描 0 断链 |
| 1.2 | `PROJECT-INDEX.md` 二选一：并入根 README.md 后删除，或重建为 v1.9.x 现状并纳入地图 | 根目录无宪法外文档 |
| 1.3 | PUBLISH_GUIDE / RELEASE_NOTES_GITHUB / README-the-journey / SKILL.md 按职能归位（如 release-notes-gen 输出 / docs/）或明确归档 | 根级 md 收敛为 AGENTS.md + README.md |
| 1.4 | 跑 `link-checker` 全量扫描 docs/，产出断链报告 | 报告入库，作为 Phase 1 完成凭证 |

### Phase 2 — CI 复活

| 动作 | 内容 | 验收 |
|------|------|------|
| 2.1 | 恢复 `.github/workflows/release.yml`：push/PR 跑 `tests/python/` 全量 + `go vet ./go/...` + `go test ./go/... -count=1`；tag v* 触发 Wails 构建 + ZIP 打包 | 任一 push 线上自动回归，红 = 阻断合并 |
| 2.2 | 将「契约测试必须通过」写入 PR 合并门槛（branch protection） | 宪法约束获得强制载体 |

### Phase 3 — 审查与发版升级

| 动作 | 内容 | 验收 |
|------|------|------|
| 3.1 | review skill 输出格式对齐联邦四件套：总体结论 → 亮点 → **风险表 P1–P4**（含影响/建议）→ 类型安全 → 数据流追踪 | review 报告可直接拍板「合/不合」 |
| 3.2 | release-notes 收敛为单文件规范（废弃 compare 双文件模式，统一 `vX.Y.Z.md` + README 索引表） | 新版本只产出一个发版说明 |

---

## 3. 后果（Consequences）

### 正面
- 宪法成为「现实索引」，AI 与新人按图索骥零迷路
- ADR 从文档升格为治理机制：编号、状态、索引闭环
- 契约测试获得 CI 强制载体，「必须通过」不再依赖自觉
- 审查报告可决策化，减少「改还是不改」的来回

### 负面
- Phase 0/1 涉及 AGENTS.md 与根目录文档变更，需逐项人工确认（宪法修改不可自动执行）
- Phase 2 CI 恢复需要 GitHub Actions 可用（当前 `workflows/` 空目录原因未考据，可能为本地仓库同步所致）
- 发版说明收敛会产生一次性迁移成本（~30 个历史 compare 文件）

### 已知遗留
- `docs/knowledge/` 与 `architecture.md` 职能重叠（模块知识卡 vs 架构规范）的边界声明，留待 Phase 3 后单独评估，本 ADR 不决策

---

## 4. 与 AGENTS.md 的关系

| AGENTS.md 条款 | 本 ADR 覆盖 |
|----------------|-------------|
| §〇 禁止操作 #5「禁止创建不在文档地图中的新 md 文件」 | Phase 0.1/0.3 — 把 adr/、knowledge/ 注册进地图，使该条款可执行 |
| §一 文档地图 | Phase 0.1/0.4 — 地图与现实对账 |
| §二 工作流「逻辑下沉优先」 | 本 ADR 即逻辑下沉到治理层：规则入文档而非散落会话 |
| 速查表「发版：见 docs/release-notes/README.md」 | Phase 0.4 — 修复断链 |

本文档本身即治理迭代的第一块基石：**用 ADR 记录治理，而非用对话记录治理**。

---

## 5. 数据溯源

| 来源 | 结果 |
|------|------|
| `AGENTS.md` §〇/§一 | 文档地图无 adr/、knowledge/ 条目；断链引用 release-notes/README.md |
| `docs/adr/` | ADR-001~008 共 8 篇存在，最新 ADR-008（2026-08-03） |
| `docs/knowledge/` | 18 个文件，含独立 AGENTS.md / README.md / index.md；scripts/ 有 gen-knowledge-index.mjs / check-knowledge-drift.mjs / new-knowledge-card.mjs |
| `docs/architecture/README.md` | :60 引 release-notes/README.md（不存在）；:109 引 AI_INDEX.md（不存在） |
| `PROJECT-INDEX.md` | 声称 v1.7.4 + .github/workflows/release.yml；实际 v1.9.3 + workflows/ 空目录 |
| `.github/workflows/` | 空目录，CI 声明与实现脱节 |
| `git log` | 3cae9cb 提交写「ADR-0001」；提交风格已 Conventional Commits + scope |
| `tests/python/` | 6 个契约测试与 AGENTS.md 描述完全一致（✅ 亮点） |
| `.agents/skills/` | 16 个 SKILL.md 全存在（✅ 亮点）；review 格式无 P1–P4 分级 |
| `docs/release-notes/` | 110 文件，v1.6.4+ 双文件模式混杂（仅 compare / 仅主文件并存） |
| 联邦基线（USER.md / 会话记录） | ADR 编号唯一取最大+1、审核四件套、tsc 零错误、契约测试 13/13、CI 线上回归 |
