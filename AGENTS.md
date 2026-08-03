# YSM 模型管理器 — AI 入口

> 你是本项目的 AI 代理，与人类架构师 Jieling 协同。回复**简洁精准**：能用 1 句不说 2 句，
> 结论先行、给 `文件:行号`、表格优先于段落。
> 项目哲学是**「信任但验证」**：信任本机改动（提交有契约测试 + CI + PR review 兜底，别怕错误），
> 但改完立即构建验证。**保持进度，不过度谨慎。**

## 硬约束

> 只读 §一 文档地图列出的文件；**地图没有的目录 = 不存在**（`docs/archive/` 为冻结区，需追溯旧设计时才读）。
> 大文件（`bug-chronicle.md` 1369 行）先 `grep` 关键词，再读匹配段落，不整文件灌上下文。
> 新文档：先过 `docs/core/NAMING_GUIDELINES.md` 命名检查，再确认归属目录（文档地图外不建新 md）。
> 改完即验：Go → `go build`；前端 → `vite build`；文档 → `link-checker`；ADR → `adr-check`。
> 必须通过 `tests/` 下所有契约测试（测试文件是宪法基石，禁止修改）。
> 失败熔断：同一命令连续失败 2 次 → 停手进 Plan 分析原因，不无脑重试。
> 预定义 subagent skill 可直接调起（说 skill 名即可）：
>   `release-notes-gen` / `review` / `doctor` / `ultrawork` / `comment-checker` /
>   `event-audit` / `bug-search` / `link-checker` / `type-consistency` / `binding-check` / `deep-init`

## 跨目录引用自检

**任何 Markdown 链接写完后，必须确认目标文件存在。** 断链 = 任务失败，因为下一个 AI 会被误导。

```
# ✅ 正确：目标存在
链接文本 → `docs/frontend/Design.md`（存在）

# ❌ 错误：目标不存在（目录已改名/文件已移动）
链接文本 → `docs/3D-RENDERING/3d-rendering-report.md`（不存在）
```

> 完整命名规范见 `docs/core/NAMING_GUIDELINES.md`

---

## 一、文档地图

### 1.1 目录用途

| 目录 | 用途 |
|------|------|
| `docs/core/` | ✅ 核心规范（术语、治理规则、命名规范） |
| `docs/architecture/` | 🏗️ 架构 + 项目元信息（架构、现状、路线图、Bug 记录、逻辑下沉），含 `adr/`（ADR 决策记录 — 写前先占号） |
| `docs/frontend/` | 🎨 前端专属（设计规范、动画、待清理、废弃名） |
| `docs/knowledge/` | 🧠 模块知识卡（bus / Wails 桥接 / Go 包）— 索引自动生成于 `knowledge/index.md` |
| `docs/tasks/` | 📋 任务管理（任务清单、会话交接、每日计划） |
| `docs/3D/` | 🎮 3D 渲染（攻关计划、开发报告） |
| `docs/release-notes/` | 📦 版本发布说明（按 vX.Y.Z.md 命名，索引见 `release-notes/README.md`） |
| `docs/tactics/` | 🎯 产品愿景 |
| `docs/novel/` | 📖 衍生小说（与项目开发无关） |
| `docs/archive/` | 🧊 冻结区（历史归档，需追溯旧设计时才读） |
| `docs/preview/` | 🖼️ UI 截图 |
| `tests/` | 🔒 契约测试（Node .mjs）— 禁止修改，必须通过 |
| `scripts/` | Node 工具脚本（治理/生成器），被 `.agents/skills/` 调用 |
| `.agents/skills/` | Reasonix Skill 定义 |

契约测试明细（`tests/`，Node 零依赖）：

| 测试文件 | 校验内容 |
|---------|---------|
| `test_resource_schema.mjs` | resource_types.json 格式校验 |
| `test_workshop_schema.mjs` | workshop_sites.json 结构校验 |
| `test_creators_schema.mjs` | creators.json 必填字段校验 |
| `test_config_defaults.mjs` | AppConfig 字段类型/值域校验 |
| `test_config_syntax.mjs` | wails.json + go.mod 语法校验（reasonix.toml 为本地 AI 终端配置，不入库不校验） |
| `test_html_integrity.mjs` | frontend/index.html 引用完整性校验 |

脚本分组（`scripts/`）：

| 脚本组 | 用途 |
|--------|------|
| `review.mjs` / `doctor.mjs` / `line-counter.mjs` / `ultrawork.mjs` | 治理/诊断用 |
| `funcmap.mjs` / `link-checker.mjs` / `type-consistency.mjs` | 一致性/映射 |
| `comment-checker.mjs` / `event-audit.mjs` / `bug-search.mjs` | QA 检查 |
| `release-notes-gen.mjs` / `binding-check.mjs` / `inspect_ysm.mjs` / `adr-check.mjs` | 工具 |
| `gen-routes.mjs` / `gen-knowledge-index.mjs` / `check-knowledge-drift.mjs` / `new-knowledge-card.mjs` | 生成器（knowledge 体系） |

Skill 分组（`.agents/skills/`）：

| Skill | 用途 |
|-------|------|
| `review` / `doctor` / `ultrawork` | 诊断 skill（runAs: subagent） |
| `release-notes-gen` / `comment-checker` | 生成/QA skill（runAs: subagent） |
| `event-audit` / `bug-search` | 审计 skill（runAs: subagent） |
| `link-checker` / `type-consistency` / `binding-check` | 一致性 skill（runAs: subagent） |
| `deep-init` | 项目初始化（runAs: subagent） |
| `line-counter` / `funcmap` | 统计/映射 skill（普通调用） |
| `build` / `release` / `3d-debug` | 工作流 skill |

### 1.2 关键文件速查

| 场景 | 读哪些文件 |
|------|-----------|
| **每次会话起步** | 本文件 + `.github/copilot-instructions.md`（致命陷阱） |
| **查模块知识卡** | `docs/knowledge/routes.md`（AI 路由表）+ `docs/knowledge/index.md`（索引） |
| **新建文档 / 命名** | `docs/core/NAMING_GUIDELINES.md` |
| **写 UI 文案 / 变量名** | `docs/core/TERMINOLOGY.md`（末尾有 AI 缩写版） |
| **改 Go 逻辑** | `docs/architecture/architecture.md` + `bug-chronicle.md`（先 grep 再读，1369 行禁止全量） |
| **改前端 / CSS** | `docs/frontend/Design.md` + `pending-cleanup.md` + `animations.md` |
| **接新任务** | `docs/tasks/TASK_PLAN.md` + `SESSION_HANDOFF.md` + `DAILY_PLAN.md` |
| **3D 渲染开发** | `docs/3D/3D-RENDERING-PLAN.md` + `3d-rendering-report.md` |
| **发版 / 总结** | `docs/release-notes/README.md` → 最新版本 .md |
| **选 AI 模型干活** | `docs/architecture/AI-MODEL-MATRIX.md` |
| **了解项目全貌** | `docs/architecture/PROJECT_STATUS.md` |
| **查产品方向** | `docs/tactics/vision.md` + `docs/architecture/ANNUAL_ROADMAP.md` |
| **查找废弃命名** | `docs/frontend/DEPRECATED_NAMES.md` |
| **查版本兼容性** | `docs/architecture/pack-format-versions.md` |
| **续写小说** | `docs/novel/SKELETON.md` |
| **查项目意义（给用户看）** | `docs/architecture/用户指南.md` + `项目意义.md` |
| **查函数签名 / 全量映射** | `node scripts/funcmap.mjs -o funcmap.md` |
| **查逻辑下沉方案** | `docs/architecture/logic-sinking.md` |
| **查 ADR 索引 / 写 ADR** | `docs/architecture/adr/README.md` — 编号取最大号 +1，**先占号再写文件**（防并行撞号） |
| **查所有脚本用法** | `scripts/脚本体系全景.md` |
| **写发版说明** | 说 "release-notes-gen" 派子代理自动生成 |
| **查断链** | 说 "link-checker" 扫描所有 md 链接 |
| **查资源类型一致性** | 说 "type-consistency" 比对 JSON ↔ Go ↔ JS |
| **查事件注册位置** | 说 "event-audit" 扫描 EventsOn/bus.on |
| **搜历史 bug** | 说 "bug-search <关键词>" 查 bug-chronicle |
| **跑契约测试** | `for f in tests/*.mjs; do node "$f"; done` |

### 1.3 检查指令速查（文档与检查成对，改完对应文档/体系必跑）

> 每个文档体系配一条检查命令，防文档漂移与静默腐烂。

| 检查 | 命令 | 覆盖 |
|------|------|------|
| 契约测试 | `for f in tests/*.mjs; do node "$f"; done` | JSON/配置/HTML 引用完整性（CI 已接） |
| 文档断链 | `node scripts/link-checker.mjs` | 所有 md 内部链接（改文档后必跑） |
| ADR 登记一致性 | `node scripts/adr-check.mjs` | adr/README.md 登记表 vs 磁盘文件（防撞号/漏登/幽灵） |
| 知识卡漂移 | `node scripts/check-knowledge-drift.mjs` | knowledge/ 卡与源码一致性 |
| 红线审查 | `node scripts/review.mjs` | 13 条治理红线（R1-R9 + W1-W5） |
| 类型一致性 | `node scripts/type-consistency.mjs` | resource_types.json ↔ extensions.js |
| 事件审计 | `node scripts/event-audit.mjs` | EventsOn/bus.on 注册位置 |
| 注释质量 | `node scripts/comment-checker.mjs` | AI 废话/TODO 无编号/调试残留 |
| 绑定一致性 | `node scripts/binding-check.mjs` | Go 导出函数 ↔ wailsjs |
| 函数映射 | `node scripts/funcmap.mjs -o funcmap.md` | 注释 → 函数表（改签名后重跑） |
| 全量自检 | `node scripts/doctor.mjs` | 编译 + 构建 + 文件 + 红线 + Git 状态 |

> **检查优先级**：改文档 → `link-checker`；改 ADR → `adr-check`；改资源类型 → `type-consistency`；改前端 → `review` + `comment-checker`；提交前 → `doctor`。

---

## 二、工作流规则

### 2.1 确认当前状态

```bash
git log --oneline -5
```

### 2.2 改前读文件

**禁止基于记忆修改。** 每次改前先确认最新状态：

- `read_file` — 读文件内容
- `grep` — 搜索关键词
- `code_index` — 查符号定义
- `node scripts/funcmap.mjs` — 生成全项目函数映射表（含注释摘要）

**灵活处理**：
- 小文件 / 近期刚看过 → 直接改
- 不确定是否变更 → 先用 `read_file` 确认
- 搜索没找到 → 不报错，先尝试修改看构建结果
- **核心原则**：保持进度，不过度谨慎
- **逻辑下沉优先**：能放 `go/` 包不放 `app_*.go`。改逻辑时先改 `go/xxx/xxx.go`（可 `go test`），再改 `app_xxx.go`（薄壳绑定层）
- `ultrawork.mjs` 默认只显示最后 10 行错误。若 `tail=10` 未包含明确错误类型（如 `undefined` / `import cycle`），可扩大读取范围至 50 行

### 2.3 改完立即构建

```powershell
# Go 改了
go build ./go/... 2>&1 | Select-String error

# 前端改了
cd frontend ; npx vite build 2>&1 | Select-String error
```

不攒多个修改。一个改一个 build。

### 2.4 构建失败处理

1. **立即回滚** → 用 `/undo` 撤销修改
2. **诊断原因** → 读完整错误信息：
   - import 路径/语法错误
   - 类型不匹配（Go）
   - 未定义变量/import 缺失（JS）
   - 依赖缺失
3. **修复后重试** → 小步修改，每次构建验证

---

## 三、致命陷阱

| # | 陷阱 | 表现 | 规则 |
|---|------|------|------|
| 1 | Go 改后未重建 | 前端调用没反应 | 改 Go 文件必须 `wails build` 或 `go build .` + 重启 |
| 2 | 全局事件放错组件 | 切页后 handler 消失 | 全局 handler 必须放 `app-content/index.js` 的 `_registerGlobalHandlers()` |
| 3 | 按钮异步后卡死 | 操作失败后按钮灰掉 | `finally` 里 emit 完成事件，不放 try 末尾 |
| 4 | `const` TDZ | 静默失败 | `const fn = () => {}` 不提升，先定义再调用 |
| 5 | Go Binding 函数名写错 | 前端调用 undefined | 先用 grep 在 `internal/app/` 确认函数名 |
| 6 | 下载进度 99% 卡死 | Content-Length=-1 | 锁定 99%，2s 后转菊花；`stuckGuardReset()` 清全部状态 |
| 7 | 三入口各自注册 | 事件重复/遗漏 | 单击/多选/全选都走 `enqueueDownloadTasks()`，只注册一组 Wails EventsOn |
| 8 | 回收站误删 | 硬链接数据丢失 | 符号链接→直接删，硬链接(nlink>1)→直接删，普通→移 `.recycle`，跨分区→复制后删 |
| 9 | `public/` 下放 JS | Vite dev 优先加载 | 新 JS 放 `frontend/js/`，ES module → `app-modules.js` 加 import |
| 10 | 回调 API 未 Promise 化 | DnD 数据读不到 | `entry.file(callback)` → `new Promise(resolve => entry.file(resolve))` |

> 完整版见 `.github/copilot-instructions.md`（18 条）。

---

## 四、三条治理红线

### 4.1 零 `window.__*` 全局变量

| ❌ 禁止 | ✅ 替代 |
|---------|--------|
| `window.__currentPage` | `PageStore.currentPage` (`core/page-store.js`) |
| `window.go.main.App.*` | `getApp()` (`wails/app.js`) |

### 4.2 Wails 调用统一走 `getApp()`

```js
// ✅ 正确
import { getApp } from "../wails/app.js";
const App = await getApp();
const result = await App.SomeBinding();

// ❌ 禁止
const { SomeBinding } = window.go.main.App;
```

### 4.3 UI 安全

- 所有 `innerHTML` 拼接必须用 `esc()` 转义
- 所有 CSS 值走 CSS 变量（`var(--txt)`, `var(--bg)`），无硬编码颜色
- 禁止 `display: none/block` 做动画切换，用 `opacity` / `transform`
- 所有异常路径必须有 toast 反馈
- 所有 UI 文件名必须走 `renderDisplayName()`

> 完整 9 条规则 + 自动检测命令见 `docs/core/CLEANUP_RULES.md`。

---

## 五、项目速查

### 5.1 Go 端

```
go/installer/  — 模型安装       go/sync/     — 整合包同步
go/recycle/    — 回收站管理     go/ysm/      — YSM 解析+摘要
go/watcher/    — 文件监听       go/updater/  — 自动更新
go/paths/      — 路径安全       go/types/    — 共享类型+注册表
go/logs/       — 导入日志       go/version/  — 版本号
go/threejs/    — 3D 骨骼计算    go/importer/ — 导入策略
internal/app/  — Wails Binding 入口（app.go / resource_bindings.go 已下沉至此）
main.go        — 程序入口（薄壳）
```

### 5.2 前端

```
frontend/js/
  bus.js                 — 事件总线
  app-modules.js         — 组件入口 + 右键菜单映射
  components/            — Web Components (app-tree/sidebar/preview/content/nav)
  features/              — 业务功能 (import-queue/recycle-bin/version-updater/community)
  dialogs/               — 弹窗 (modal/rename/batch-rename/tag-editor)
  pages/                 — 页面渲染 (repository)
  core/                  — 基础设施 (buttons/global-handlers/theme/context-menus)
  utils/                 — 工具函数 (display/fmt/dom/icon/summarize/model3d)
  services/registry.js   — 服务注册
  wails/                 — Wails 桥接 (app.js + runtime.js)
```

### 5.3 组件拆分规范

```
app-xxx/index.js     — 生命周期编排
app-xxx/tpl.js       — 布局 HTML 模板
app-xxx/row-tpl.js   — 节点级模板（可选）
app-xxx/data.js      — 数据逻辑（纯函数）
app-xxx/render.js    — 渲染逻辑（输入→HTML）
app-xxx/events.js    — 事件绑定
app-xxx/utils.js     — 组件工具（可选）
app-xxx/xxx-css.js   — Shadow DOM 样式
```

### 5.4 注册表优先

所有资源类型定义以 `resource_types.json` 为单一事实来源。**不要在 Go/Frontend 中手写 `StorageSubDir` / `specificRoot` / `ResourceExts` 的新条目**。先在 `resource_types.json` 加，一致性测试会自动校验。

---

## 六、沟通风格

- 简洁：能用 1 句话不说 2 句
- 精确：给行号、文件路径、函数名
- 结构化：表格 > 段落
- 不废话：不做无谓的「总的来说」「总结一下」
- 不改不拆：发现不够改的问题先问「要修吗」
- 有观点：不模棱两可，给推荐项置首

---

## 七、环境提示

- **Shell**：优先用 pwsh（PowerShell），不是 cmd
- **路径分隔符**：统一正斜杠 `/`
- **调试日志用完即删**：`console.log` / `fmt.Print` 测试完后**必须请示用户确认**再删，不可自行决定
- **禁止安装软件**：缺依赖提示用户手动装
- **发版**：用 `wails build -clean`，流程见 `docs/release-notes/README.md`
