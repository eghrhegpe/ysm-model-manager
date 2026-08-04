# 项目维护手册

> 面向项目维护者（人类 + AI）的操作指南：文档网站构建发布、文档体系维护、日常治理检查。
> 网站方案见 ADR-022（Jekyll + just-the-docs；原决策 VitePress，方案漂移已记录）。
> **AI 注意：项目有文档网站（GitHub Pages），改 docs/ 涉及网站可见内容时需知网站存在与构建方式。**

---

## 一、文档网站

项目以 Jekyll + just-the-docs 构建文档站点（GitHub Pages 项目页）。

> **当前状态（2026-08-04）**：网站**尚未构建发布**——`docs/_site/` 不存在、GitHub Pages 未启用；构建需 Ruby/bundle 环境（本机可能未装，此时构建留给 GitHub Pages / 并行会话）。**当前以 `docs/_config.yml` 配置为准**（Jekyll + just-the-docs 为唯一方案，无方案歧义）。

| 项 | 值 |
|----|-----|
| 框架 | Jekyll + just-the-docs（`docs/_config.yml`，`remote_theme: just-the-docs/just-the-docs`）|
| 配置 | `docs/Gemfile` / `Gemfile.lock` / `_config.yml` / `_sass/` |
| 站点路径 | GitHub Pages 项目页，`baseurl: /ysm-model-manager` |
| 决策 | ADR-022（🔄：配置已就绪，构建/发布待验证）|

### 构建与发布

```bash
cd docs
bundle install           # 首次安装依赖
bundle exec jekyll build # 本地构建 → 产物 docs/_site/
```

- 构建产物 `docs/_site/` 不入库（检查 .gitignore）。
- GitHub Pages 发布：仓库 Settings → Pages → Source 选分支 + `/docs` 目录 → 推 main 自动构建发布（Jekyll 原生支持）。
- 站点内容 = docs/ 下所有 Markdown（**exclude 除外**，见下）。

### 网站内容规范

- **冻结区不发布**：`docs/archive/`（历史归档）已在 `_config.yml` 的 `exclude` 中——改归档文件不影响网站。
- **生成产物不发布**：`funcmap.md` / `project-map.md`（同 exclude）。
- **frontmatter**：guide 类文档带 `title/description`（VitePress 时代兼容字段，Jekyll 忽略无碍）。

---

## 二、文档体系维护

| 分区 | 维护方式 | 生成器 |
|------|---------|--------|
| `docs/adr/` | 新决策走 `node scripts/new-adr.mjs "标题"`（叫号 + 登记表占号 + 自动 adr-check）| `gen-docs-index.mjs` |
| `docs/knowledge/` | 知识卡（ADR-019 体系）| `new-knowledge-card.mjs` |
| `docs/guide/` | 用户指南 26 篇（ADR-018 体系）| `gen-docs-index.mjs --guide` |
| `docs/releases/` | 发版说明（流程见 `docs/releases/README.md` SOP）| `release-notes-gen.mjs` |
| `docs/review-report.md` | 审计单元追加（AGENTS.md 五步法）| 手写 |
| `docs/MAINTENANCE.md` | **本手册**（网站内容之一，Jekyll 会发布）| 手写 |

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

- 本手册（`docs/MAINTENANCE.md`）是网站内容之一（Jekyll 自动发布），也是 AI 的维护入口。
- 新增维护流程 / 网站配置变更时：更新本手册，并同步 AGENTS.md 文档地图（如有入口）。
