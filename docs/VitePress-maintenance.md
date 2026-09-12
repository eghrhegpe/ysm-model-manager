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
| `docs/adr/` | 新决策走 `node scripts/new-adr.ts "标题"`（叫号 + 登记表占号 + 自动 adr-check）| `gen-docs-index.ts` |
| `docs/knowledge/` | 知识卡（ADR-019 体系）| `new-knowledge-card.ts` |
| `docs/guide/` | 用户指南 26 篇（ADR-018 体系）| `gen-docs-index.ts --guide` |
| `docs/releases/` | 发版说明（流程见 `docs/releases/` SOP）| `release-notes-gen.ts` |
| `docs/review-report.md` | 审计单元追加（AGENTS.md 五步法）| 手写 |
| `docs/VitePress-maintenance.md` | **本手册**（网站内容之一，VitePress 自动发布）| 手写 |

### 改文档后的检查（AGENTS.md「改完即验」映射）

| 改动类型 | 必跑检查 |
|----------|---------|
| 改 ADR | `adr-check.ts` + `check-adr-health.ts` + `gen-docs-index.ts` |
| 改普通文档 | `link-checker.ts`（断链）|
| 改知识卡 | `check-knowledge-drift.ts` |
| 全量自检 | `node scripts/doctor.ts`（改代码/发版前）；文档改动用 `node scripts/doctor.ts --docs`（轻量秒级） |

---

## 三、日常治理检查（提交前）

```bash
node scripts/doctor.ts --docs     # 改文档时用，轻量秒级（仅文档/ADR/索引检查，跳过 Go/前端编译与测试）
node scripts/doctor.ts            # 全量自检（编译 + 构建 + 文件 + 红线 + Git）
node scripts/check-redlines.ts            # 红线扫描（R1-R10 + W1/W2/W5-W7；W3/W4 在 comment-checker.ts）
node scripts/check-adr-health.ts  # ADR 状态机与登记表一致性
node scripts/link-checker.ts      # 文档断链
node scripts/check-deadcode-baseline.ts  # 死代码/重复代码门禁
```

---

## 四、本手册维护

- 本手册（`docs/VitePress-maintenance.md`，原 `docs/maintenance.md`）是网站内容之一（VitePress 自动发布），也是 AI 的维护入口。
- 新增维护流程 / 网站配置变更时：更新本手册，并同步 AGENTS.md 文档地图（如有入口）。

---

## 五、立项清单（独立待启动）

> 多轮子代理审计沉淀的结构性遗留项，均已裁决**独立立项、不在常规轮次内 rush**（参考 RenderSession 完整对象化立项模式）。
> 启动任一项前：先 Grep `docs/adr` 确认无重复实现；落地后在本节勾除并同步知识卡。

| # | 立项项 | 内容 | 来源 |
|---|--------|------|------|
| 1 | ~~**dnd 两套收集器收敛**~~ | ✅ 已落地（2026-08-14，ADR-060）：`import-dnd.ts` 从 `document` 级 `registerDnD` 收敛为 `bindTreeDnD` 组件内绑定；`collectEntry`/`collectFiles` 统一到 `features/dnd-collector.ts`；`#global-drop-overlay` 全局遮罩 + `app-modules.ts` capture 补丁一并删除；仓库页底部新增显式 drop hint 条（`tree-drop-hint`） | ~~2026-08-11 dnd 审计~~ → ADR-060 ✅ |
| 2 | **oversize 判定下沉 executor** | 导入页 drop 路径（import-queue routeCollected）无 100MB 过滤，与 import-dnd（已逐文件过滤）/ browser-adapter（MAX_IMPORT_BYTES）不一致；下沉到 import-executor 的 directImport/importFolder 统一执行，两入口自然对齐 | 2026-08-11 dnd 审计 |
| 3 | ~~**resource_types JSON↔registry 一致性守护**~~ | ✅ 已落地（2026-08-14，ADR-103 后演进）：`go/types/registry/resource_types_consistency_test.go` 在 `go test ./go/types/registry/...` 时逐字段比对根 `resource_types.json` 与 `LoadRegistry()` 结果，任一侧漂移即构建失败（原 `resource_types_embed.go` 手工副本已删，改走 `embed.go` 编译期内嵌） | ~~2026-08-11 resource 审计~~ |
| 4 | **schema 补 storageSubDir 必填** | `tests/test_resource_schema.ts` 的 REQUIRED_FIELDS 缺 `storageSubDir`/`scanDir`——新类型缺此字段可通过 schema，Go `StorageSubDir` 静默回退 rtype | 2026-08-11 resource 审计 |
| 5 | ~~**errors 正则表收尾（ADR-051）**~~ | ✅ 已解决（2026-08-11）：`frontend/src/utils/dom/errors.ts` 删除正则兜底表，`friendlyError` 只消费结构化 `AppError.Code`；`errors.test.ts` 同步 16 类断言，"too many open files" 口径与 Go 端一致 | ~~2026-08-11 utils-errors 审计~~ |
| 6 | **esc 统一入口收尾** | modal.ts re-export 双入口 + 3 处手写部分转义旁路（app-content/index.ts:321、site/render.ts:69、site/events.ts:149）+ 3 处测试内联 3-replace mock——统一从 `utils/dom/html.ts` 导入并修正测试 mock | 2026-08-11 utils-errors 审计（已备案） |
| 7 | **拖拽到 exe 启动（drop-on-executable）** | 已调研未落地（2026-08-13）：文件管理器拖文件到 exe 图标 → Windows 以路径作参数启动（`os.Args[1:]`，多文件一次启动）；已运行场景 Wails v3 `SingleInstanceOptions{UniqueID, OnSecondInstanceLaunch}` 自动把第二实例参数（含拖入路径）转发给第一实例，第二实例锁检测后退出。接入点：main.go 启动读 args + 单实例回调 → 复用 installer.Install 路径导入链路。操作形态建议：低副作用优先（解压 .ysm 内容到指定目录 / 提取纹理 / 解码校验），避免无确认写入型（拖入即入库的误拖风险）；或优先做文件关联双击打开（同一套 args 基础设施，更自然、零学习成本）。决策：**暂不落地**——价值最大化伴随误操作风险，待有明确高频场景再立项 | 2026-08-13 能力调研 |
| 8 | **断点续传（含 WithRetry 接线 + 信任 partial 校验链）** | `go/download` 已具备 `WithRetry`（提交 14c0bf42，默认休眠未接线）。立项时一次接对：① 把「WithRetry 接入下载队列（每源先续传再放弃）」并入设计；② 新建「安全信任 partial 响应」校验链（核对 `bytes N-total/total` 且 N=本地已收字节）——现有 BUG-HTTP-2 防线（download.go 拒绝一切 `Content-Range`，`ErrPartialResponse`）与续传所需 206 接受逻辑方向相反，动此防线是安全语义变更须单独立项；③ 顺带修 `isRetryableError` 覆盖不一致：`TruncationError`（优雅断流→提前 EOF）不可重试而 abrupt RST（`net.OpError`）可重试。跨源续半截风险由既有 `expectedSHA256` 装盘前校验兜底（哈希不符即弃掉整下），难点已降级。 | 2026-08-24 四环节分析（性能优化）|
| 9 | **CLI 连带初始化 watcher（资源浪费）** | CLI 模式经 `DispatchCommand` → `saveConfigFn` 触发 `restartWatcher`，连带起 watcher 等 GUI 组件；CLI 纯命令行场景用不到文件监听。修复涉及 app 启动生命周期，有回归风险，留待专项评估 | 2026-08-24 四环节分析 |
