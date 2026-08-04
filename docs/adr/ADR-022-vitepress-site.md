# ADR-022：VitePress 建站

- **状态**：🔄 部分采纳（内容体系已就绪；VitePress 迁移完成——首页 home layout 无导航，构建/发布待验证，见 §3）
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/guide/`（26 篇）/ `docs/adr/` / `docs/knowledge/` / `docs/Gemfile` / `docs/_config.yml` / ADR-018 / 联邦 MikuMikuAR（VitePress 站点对标）

---

## 1. 背景（Context）

项目文档以 Markdown 仓库形态存在，AI 友好但人类阅读体验有限：

- **无统一站点**：文档分散于 docs/ 各分区，无导航、无全文检索、无版本化阅读入口；
- **网站化储备已就绪**：AGENTS.md 文档地图将 `docs/guide/` 标注为「用户向文档（用户指南、项目意义，网站化储备）」，ADR-018 已建立 26 篇用户指南内容体系；
- **联邦有成熟先例**：MikuMikuAR 已用 VitePress 建站（`.vitepress/` + 28 篇 guide + 全站导航），工具链与内容结构可直接对标；
- **并行推进中**：VitePress 站点搭建由并行 AI 实施（`docs/Gemfile` / `docs/_config.yml` 已在工作区出现），本 ADR 记录决策供立档。

## 2. 决策（Decision）

**决策**：采用 VitePress 作为文档站点框架，将 docs/ 内容（guide / adr / knowledge / releases）发布为静态网站。

### 2.1 内容来源

- **用户指南**：`docs/guide/` 26 篇（ADR-018 体系），frontmatter（title/description/outline）原生被 VitePress 消费；
- **决策记录**：`docs/adr/`（20+ 篇）按状态分组展示；
- **知识卡**：`docs/knowledge/`（ADR-019 体系）供技术阅读；
- **发布说明**：`docs/releases/`。

### 2.2 站点结构（对标联邦）

- 导航栏按 guide / adr / knowledge / releases 分组；
- `index.md` 作为用户指南入口（gen-docs-index.mjs `--guide` 生成，ADR-018 机制）；
- 全站检索（VitePress LocalSearch）。

### 2.3 分工

- **内容体系**：由 AI/人工持续维护（ADR-018/019/020 机制）；
- **站点搭建**：并行 AI 负责 `.vitepress/` 配置、主题、构建流水线；
- **索引**：生成器统一产出，站点只消费不手改。

## 3. 后果（Consequences）

### 正面

- 人类可读入口（导航 + 检索）补全 AI-only 仓库形态；
- 26 篇指南 / 20+ ADR / 18 知识卡一次性获得站点呈现；
- 与联邦站点结构对齐，主题/插件可搬运。

### 负面

- 文档与站点构建双轨（内容在 md，站点在 vitepress），需保证构建不漂移；
- 部分文档为生成产物（GEN 区），站点构建需排除或同步。

### 已知遗留

- **方案漂移（2026-08-04 核实）**：原决策 VitePress，实际落地 **Jekyll + just-the-docs**（`docs/_config.yml` 已入库：`remote_theme: just-the-docs/just-the-docs`、`baseurl: /ysm-model-manager`、`heading_anchors: true`、jekyll-seo-tag；`.vitepress/` 不存在，`docs/Gemfile` + `Gemfile.lock` + `_sass/` 为 Jekyll 生态）。理由（源自 _config.yml 注释）：GitHub Pages 原生支持 Jekyll 零构建配置，just-the-docs 提供原生侧边栏 + 站内搜索，观感对齐 MikuMikuAR VitePress 站点浅色基调。**收敛指引：以 Jekyll + just-the-docs 为当前唯一方案，VitePress 不作为候选（废弃确认中，无需 AI/维护者处理）。**
- **迁移回 VitePress（2026-08-04）**：Jekyll + just-the-docs **首页强制左侧导航（无 home 布局特例）**，docs/ 全量 255+ 文档链接挤占主站宣传能力；迁移回 VitePress（回归本 ADR 原决策，对标 MikuMikuAR）——`docs/.vitepress/config.mjs` + `docs/package.json` + `docs/index.md` 改 `layout: home`（hero + features 卡片，**首页无导航**）+ 显式 `sidebar` 导航收敛（只列用户向内容）。Jekyll 配置（`_config.yml` / `Gemfile` / `_sass`）已移除。
- 站点部署目标（GitHub Pages 项目页，baseurl 已配置）待构建发布验证；
- 本 ADR 状态随建站进度更新（🔄 → ✅）。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 联邦 MikuMikuAR `.vitepress/` | 站点框架 / 导航结构 / LocalSearch 对标 |
| `docs/guide/`（26 篇，ADR-018） | 用户指南内容来源（frontmatter 兼容） |
| `docs/adr/` / `docs/knowledge/` / `docs/releases/` | 站点其余内容分区 |
| `docs/Gemfile` / `docs/_config.yml` | 并行 AI 建站产物（工作区可见） |

<!-- 文件名: vitepress-site.md → 实际文件 ADR-022-vitepress-site.md -->
