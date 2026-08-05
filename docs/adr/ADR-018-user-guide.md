# ADR-018：用户指南体系

- **状态**：✅ 已采纳
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/guide/`（26 篇）/ `scripts/gen-docs-index.mjs`（guide 分区）/ 联邦 MikuMikuAR `docs/guide/`（28 篇对标）

---

## 1. 背景（Context）

用户文档长期只有单篇 `docs/guide/用户指南.md`（约 236 行，v1.4.x 时代），下载安装、首次配置、功能导航、FAQ、故障排查全部挤在一篇：

- **不可检索**：全文 236 行，读者定位单个功能需整篇滚动；
- **不可维护**：新功能只能往单篇里追加章节，篇幅持续膨胀；
- **与联邦脱节**：联邦 MikuMikuAR 已有 VitePress 建站 + 28 篇 `guide_*.md` 用户指南（frontmatter 结构），本项目的「网站化储备」（AGENTS.md 文档地图 `docs/guide/` 条目）没有对应内容基础。

同期并行 AI 正在搭建 VitePress 站点（`docs/Gemfile`、`docs/_config.yml`），用户文档内容体系成为建站的前置依赖。

## 2. 决策（Decision）

**决策**：建立 `docs/guide/` 用户指南体系——`index.md` 入口 + 按功能拆分的多篇指南，索引由 `gen-docs-index.mjs` 自动生成。

### 2.1 内容结构

- 每篇一个功能主题，frontmatter 携带 `title` / `description` / `outline`（与联邦 VitePress 风格对齐）；
- 正文统一「它能做什么 / 打开方式 / 操作步骤 / 常见问题 / 相关功能」五段式；
- `index.md` 为入口：篇目表格 + 「快速上手路径」导航表。

### 2.2 拆分策略

- **零删除**：旧 `用户指南.md` 保留为总览，功能详情迁至各分篇，不丢弃既有内容；
- **按功能拆分**：安装 / 首次配置 / 仓库 / 导入 / 预览 / 同步 / 资源包 / 创作者 / 工坊 / 元老 / 健康度 / 回收站 / 去重 / 主题 / 设置 / 更新 / 队列 / 快捷键 / 备份 / 重命名 / 标签 / 筛选 / FAQ；
- **源码核实**：篇目内容以 `frontend/src/` 类型化源码为事实来源（ADR-014 后 TS 化，防文档漂移）。

### 2.3 索引机制

- `gen-docs-index.mjs` 新增 `--guide` 分区（`GEN: guide-index` 标记区），从各篇 frontmatter 的 `title` / `description` 自动生成表格；
- 新增篇目只需写文件 + 跑 `node scripts/gen-docs-index.mjs --guide`，零手工维护索引；
- 断链由 `link-checker` 兜底。

## 3. 后果（Consequences）

### 正面

- 用户文档从单篇 236 行 → 26 篇结构化，可检索性、可维护性大幅提升；
- 与联邦 guide 风格对齐，VitePress 建站可直接消费；工具链可搬运；
- 索引自动生成，新增篇目零手工维护；
- 旧指南内容零丢失（保留为总览）。

### 负面

- 每新增一篇需跑一次 `gen-docs-index.mjs --guide`（依赖生成器，不能手改 GEN 区）；
- 篇目维护需要建档纪律（frontmatter 缺失时 title 回退为文件名）。

### 已知遗留

- VitePress 建站由并行 AI 负责（`docs/Gemfile` / `docs/_config.yml`），本 ADR 只定内容体系；
- `gen-docs-index.mjs` 的 guide 分区由并行 AI 实现（commit 19c1b18），后续维护需双方协同。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `docs/guide/用户指南.md`（旧总览 236 行） | 拆分素材，保留为总览 |
| `frontend/src/` 各功能模块（TS 化源码） | 26 篇内容的事实来源，逐篇核实 |
| 联邦 MikuMikuAR `docs/guide/`（28 篇） | 篇目风格 / index 表格 / frontmatter 结构对标 |
| `scripts/gen-docs-index.mjs`（commit 19c1b18） | guide 分区生成器（GEN: guide-index） |
| AGENTS.md 文档地图 `docs/guide/` 条目 | 「网站化储备」定位依据 |

<!-- 文件名: user-guide.md → 实际文件 ADR-018-user-guide.md -->
