# 项目维护手册

> 面向项目维护者（人类 + AI）的操作指南：文档网站构建发布、文档体系维护、日常治理检查。
> 网站方案见 ADR-022（VitePress + home layout；曾漂移 Jekyll 后迁移回，见 ADR-022 §3）。
> **AI 注意：项目有文档网站（GitHub Pages），改 docs/ 涉及网站可见内容时需知网站存在与构建方式。**

---

## 一、文档网站

项目以 VitePress 构建文档站点（GitHub Pages 项目页，对标 MikuMikuAR）。

> **当前状态（2026-08-04）**：VitePress 迁移完成（`.vitepress/config.mjs` + `index.md` home layout）；由 GitHub Actions workflow `pages-deploy.yml` 构建并发布到 GitHub Pages（base `/ysm-model-manager/`）。构建需 Node 环境（`docs/` 下 `npm install && npm run build`）。**以 `.vitepress/config.mjs` 配置为准**（VitePress 为唯一方案）。

| 项 | 值 |
|----|-----|
| 框架 | VitePress（`docs/.vitepress/config.mjs`）|
| 配置 | `docs/package.json` / `docs/.vitepress/config.mjs` |
| 站点路径 | GitHub Pages 项目页，`base: /ysm-model-manager/` |
| 决策 | ADR-022（✅：VitePress 为唯一方案，已构建发布）|

### 构建与发布

```bash
cd docs
npm install    # 首次安装依赖
npm run build  # 构建 → 产物 docs/.vitepress/dist/
npm run dev    # 本地预览开发
```

- 构建产物 `docs/.vitepress/dist/` 不入库。
- GitHub Pages 发布：GitHub Actions workflow（`pages-deploy.yml`）构建 + 部署 Pages。
- 站点内容 = 导航配置（nav/sidebar）列出的分区；内部治理文档（adr/knowledge/novel/app 等）**不进导航**（文件保留，URL 可直达）。

### 网站内容规范

- **首页宣传门户**：`index.md` 用 `layout: home`（hero + features 卡片，**无左侧导航**）——主站宣传不被导航挤占。
- **导航收敛**：`sidebar` 显式配置只列用户向内容（guide / releases / maintenance）；内部文档不列导航。
- **冻结区不发布**：`docs/archive/`（历史归档）不进导航（同内部文档处理）。
- **frontmatter**：guide 类文档带 `title/description`。

---

## 二、文档体系维护

| 分区 | 维护方式 | 生成器 |
|------|---------|--------|
| `docs/adr/` | 新决策走 `node scripts/new-adr.mjs "标题"`（叫号 + 登记表占号 + 自动 adr-check）| `gen-docs-index.mjs` |
| `docs/knowledge/` | 知识卡（ADR-019 体系）| `new-knowledge-card.mjs` |
| `docs/guide/` | 用户指南 26 篇（ADR-018 体系）| `gen-docs-index.mjs --guide` |
| `docs/releases/` | 发版说明（流程见 `docs/releases/` SOP）| `release-notes-gen.mjs` |
| `docs/review-report.md` | 审计单元追加（AGENTS.md 五步法）| 手写 |
| `docs/maintenance.md` | **本手册**（网站内容之一，VitePress 自动发布）| 手写 |

### 改文档后的检查（AGENTS.md「改完即验」映射）

| 改动类型 | 必跑检查 |
|----------|---------|
| 改 ADR | `adr-check.mjs` + `check-adr-health.mjs` + `gen-docs-index.mjs` |
| 改普通文档 | `link-checker.mjs`（断链）|
| 改知识卡 | `check-knowledge-drift.mjs` |
| 全量自检 | `node scripts/doctor.mjs` |

---

## 三、日常治理检查（提交前）

```bash
node scripts/doctor.mjs            # 全量自检（编译 + 构建 + 文件 + 红线 + Git）
node scripts/review.mjs            # 红线扫描（R1-R10 规则 + W1-W6 警告）
node scripts/check-adr-health.mjs  # ADR 状态机与登记表一致性
node scripts/link-checker.mjs      # 文档断链
node scripts/check-deadcode-baseline.mjs  # 死代码/重复代码门禁
```

---

## 四、本手册维护

- 本手册（`docs/maintenance.md`）是网站内容之一（VitePress 自动发布），也是 AI 的维护入口。
- 新增维护流程 / 网站配置变更时：更新本手册，并同步 AGENTS.md 文档地图（如有入口）。
