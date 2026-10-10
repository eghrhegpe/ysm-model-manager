# ADR-058：纯 exe 发布模型：数据编译期内嵌

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`embed.go / internal/app/bundled_data.go / internal/app/app_workshop.go`

---

## 1. 背景（Context）

ZIP 发布包长期附带 4 份社区数据文件（`creators.json` / `resource_types.json` / `workshop_sites.json` / `workshop-github.json`），带来三类问题：

- **分发冗余**：多文件交付，解压错位/缺文件即功能残缺，且与 exe 版本脱钩（数据文件与程序各自演进，旧数据配新程序）。
- **更新策略双轨复杂**：旧更新逻辑对 `resource_types.json`「总是覆盖为新版」、对 `creators.json` 等「仅在缺失时创建」——覆盖与否的判定依赖文件在 exe 旁存在与否，升级路径难推理，也容易覆盖用户手动修改过的数据。
- **单文件交付诉求**：用户希望下载单个 exe 即具备全部能力，便于分发与绿色运行。

## 2. 决策（Decision）

**纯 exe 发布：数据编译期内嵌，用户可编辑数据走用户目录。**

- **内嵌**：仓库根 `embed.go` 以 `//go:embed` 编译期内嵌 4 份数据 JSON（`creators.json` / `resource_types.json` / `workshop_sites.json` / `workshop-github.json`），随 exe 版本走；`internal/app/bundled_data.go` 的 `loadBundledData` 为唯一读取入口。
- **用户数据分离**：用户可编辑数据（creators / workshop 系列）落点迁移到用户配置根 `%APPDATA%\YSM-Model-Manager\`（`internal/app/app_workshop.go` 的 `workshopConfigPath`），加载顺序为**用户目录优先 + 内嵌 fallback**；旧位置数据自动迁移（`migrateWorkshopConfig`）。
- **不再读取 exe 旁/上级目录**：updater 不再覆盖 exe 旁数据文件，消除「覆盖 vs 保留」双轨策略。
- **CLI 随包**：`ysm-cli.exe` 与主程序打包，共享同一份内嵌数据（v1.13.0 起移除，见 ADR-059）。

## 3. 后果（Consequences）

**正面**：
- 单 exe 交付，ZIP 内不再附带数据文件；分发与升级路径大幅简化。
- 升级 exe 不覆盖用户数据；用户对创作者/工坊站点的自定义持续生效。
- 数据与程序同版本演进，杜绝旧数据配新程序的不一致。

**负面 / 注意**：
- 内嵌数据不再能被用户直接编辑文件覆盖（需通过程序内「更新配置」拉取社区源）。
- 发版构建必须保证 embed 数据与前端资产就位（Go `//go:embed` 编译期强校验，缺失即构建失败，属保护而非风险）。

**已知遗留**：
- 网页版（Web 端）仍以独立 JSON import 方式引用数据（`frontend/src/backend/browser-adapter.ts`），与桌面内嵌路径并存，见 ADR-049 / ADR-053。

**决策落地补充（2026-08-19，见 ADR-103）**：
- 本 ADR 第 2 条「**不再读取 exe 旁/上级目录**」在代码侧**长期未被执行**——`go/types/resource.go` 的 `loadRegistryBytes()` 仍保留 exe 旁/上级目录扫描分支（旧 zip 部署残党），且 `bin/resource_types.json` 这份无 `group` 字段的 stale 快照被该分支最先命中，静默遮蔽嵌入单源，导致用户多次主推分类/路由改动「不生效」。
- ADR-103 已移除该僵尸扫描分支、删除 `bin/resource_types.json`，使本 ADR 的「不再读取 exe 旁文件」决策**真正闭合**。本 ADR 的意图正确，缺口在于当年改 `loadRegistryBytes` 时未同步删除旧分支。

## 4. 数据溯源

- v1.12.0 发布说明（`docs/releases/v1.12.0.md`）：纯 exe 交付 + 用户数据分离 + CLI 共享内嵌数据。
- 实现：`embed.go`（`//go:embed creators.json resource_types.json workshop-github.json workshop_sites.json`）、`internal/app/bundled_data.go`（内嵌读取 + 用户目录优先注释）、`internal/app/app_workshop.go`（`workshopConfigPath` / `migrateWorkshopConfig`）。

<!-- 文件名: standalone-exe-embedded-data.md → 实际文件 ADR-058-standalone-exe-embedded-data.md -->
