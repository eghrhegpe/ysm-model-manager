# ADR-002：项目全面评估与改进方向

- **状态**：已采纳（Accepted）
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理（评审方）
- **类型**：项目评估 / 技术债盘点
- **相关**：architecture.md / logic-sinking.md / app_*.go / frontend/src / scripts/ / tests/python/

---

## 1. 背景（Context）

项目 YSM Model Manager 进入 39,490 行规模（Go 15,153 行 / 前端 JS 22,736 行 /
CSS 1,419 行 / HTML 182 行），前端 + 后端 + 工具脚本三侧均有明确债务累积。
本文档作为一次全面健康检查，记录评估结果与优先级排序，作为后续改进决策的基准。

评估数据全部来自现场执行命令（`go build` / `vite build` / `line-counter.py` /
6 项 Python 契约测试），非纸上分析。

---

## 2. 评估结果（Assessment）

### 2.1 硬数据

| 指标 | 值 | 评价 |
|------|-----|------|
| 总代码量 | 39,490 行 | 中型单体 |
| Python 契约测试 | **6/6 全绿** | 配置 / 资源 / HTML 完整性，全过 |
| Go build | **干净** | 零编译错误 |
| Vite build | **干净** | 零前端编译错误 |
| 工具脚本 | **38 个** | 生产级 5，实用级 9，一次性/调试 **25**，半成品 **1** |
| 治理文档 | 核心 10+ 个 | 含 `bug-chronicle.md` 1,369 行 |

### 2.2 大文件违规（来自 `line-counter.py`）

| 级别 | 文件 | 行数 | 说明 |
|------|------|------|------|
| 🔴 RED | `go/litematic/block_ids_data.go` | 3,477 | 自动生成，豁免 |
| 🔴 RED | `frontend/src/views/app-content/community/site-view.js` | **1,268** | **评估时点快照（2026-08）**：该文件已拆除——现 `site-view.ts` 为 114 行薄壳，`site/` 子模块（`drag/edit/events/render/types.ts`）承接逻辑，最大单文件 `edit.ts` 487 行且配独立测试，RED 级风险已消除 |
| 🟡 YELLOW | `frontend/src/views/app-content/index.js` | 921 | **已迁移**：`index.ts` 231 行（入口聚合精简）；`content-css.js`→`content-css.ts` 18 行；`import-queue.js`→`features/import-queue/` 模块化；`settings.js`→`community/settings/` 子模块。评估时点列出的 `.js` 大文件已全部清偿 |
| 🟡 YELLOW | `frontend/src/views/app-content/content-css.js` | 919 | 同上，已迁移清偿（见上） |
| 🟡 YELLOW | `frontend/src/features/import-queue.js` | 835 | 同上，已模块化清偿（见上） |
| 🟡 YELLOW | `frontend/src/views/app-content/community/settings.js` | 733 | 同上，已子模块化清偿（见上） |

### 2.3 架构维度评级

| 维度 | 评级 | 说明 |
|------|------|------|
| 前端分层 | **A** | 三层解耦 + 组件目录规范执行到位，契约明确 |
| 前端依赖方向 | **A** | 单向依赖，bus.js 解耦良好，无循环 |
| 后端依赖方向 | **A-** | 单向 `internal/app/ → go/`，无包级循环 |
| 后端分层 | **B-** | 已分 package，但 `App` struct 仍是单体 god-object（100+ 方法） |
| 循环依赖 | **A-** | 仅 1 处同包内对象级循环（`DownloadQueue ↔ App`） |
| Binding 层重量 | **B-** | 核心下沉已完成（下载器 P0 / 头像提取 P1 / 哈希对比 P1.5 / 安装 P1 / 扫描 P1）；`app_install.go` 原 1,315 行债务**已还**——现瘦身为 10 行薄壳，逻辑迁至 `app_install_instance.go`（537 行）。`app_scan.go`（691 行）核心已下沉 `go/scanner`，691 行为 Binding 门面方法 + helper，非未还债 |
| 测试覆盖 | **B** | 契约测试 6/6 全过；Go 核心业务包（installer / sync / download）测试薄弱 |
| 工具脚本健康度 | **A** | Python→Node 全量迁移已完成（`295ac07e`），25 个一次性 `*.py` 脚本随迁移清理，`safe-edit-service.py` 半成品已删除；当前 78 个 `.mjs` 统一运行时（详见 `scripts/README.md`「已删除」段） |

---

## 3. 发现的问题（Issues）

### 3.1 后端：god-object 尚未拆除

`App` struct（`internal/app/`）挂载 **100+ 方法**，分散在 21 个文件中（评估时点 17 个，随拆分推进略增）。
逻辑下沉计划已完成下载器（P0）、头像提取（P1）、哈希对比（P1.5），
**最大单笔债务 `app_install.go` 已还债**：原 1,315 行、50+ 方法（含 import / relink / sync 系列）已下沉至 `go/installer/` 与 `app_install_instance.go`（537 行，对象化、独立可测），`app_install.go` 现为 10 行薄壳。
**`app_scan.go` 核心逻辑已下沉 `go/scanner`**（扫描/哈希/缓存/作者提取/索引生成），其 691 行实为 Wails 绑定门面方法（28 个 `func (a *App)`）+ 纯函数 helper，并配套 950 行 `app_scan_test.go` + `go/scanner` 1300 行单测——**非未还债，无需进一步下沉**。Binding 层 god-object 拆分主线（逻辑下沉 + 循环打断）实质已收口，残余 100+ 方法为门面层固有体量。

`DownloadQueue ↔ App` 循环引用**已打破**：`DownloadQueue` 不再持有 `*App`，改为构造时注入 `downloadFn / emitFn / logFn` 三个回调（`NewDownloadQueue(...)` 签名见 `app_download.go:51`），`App` 单向持有 `queue *DownloadQueue`（`app.go:34`）。`internal/app/app_download_test.go` 已有 3 处 `NewDownloadQueue(...)` 独立单测，`DownloadQueue` 已能脱离 `App` 测（**P1 已完成**）。

### 3.2 前端：`site-view` 拆分已完成

`site-view`（原 1,268 行 `community/site-view.js`）**已拆分完成**：现 `site-view.ts` 为 114 行薄壳（仅 `renderSiteView` 纯函数 + 接口），业务逻辑分散至 `site/` 子模块的 `drag.ts`(129) / `edit.ts`(487) / `events.ts`(340) / `render.ts`(357) / `types.ts`(40)，每个均有独立 `.test.ts` 配套。RED 级别风险已消除。
原评估时点列出的其余 `.js` 大文件（`index.js` / `content-css.js` / `import-queue.js` / `settings.js`）也已随 `.ts` 化迁移全面清偿，当前前端手写代码无 >400 行未拆分文件。

### 3.3 工具脚本：Python→Node 迁移已完成（原 §3.3 债务已清偿）

> **状态更新（2026-08-23 复核）**：原评估时点（2026-08-18）记录的「25 个一次性 Python 脚本未清理 + `safe-edit-service.py` 半成品」**已于 `295ac07e` 全量迁移清理**，当时 `scripts/README.md` 已同步「已删除」段，仅 ADR-002 滞后。当前 `scripts/` 零 `.py` 文件、78 个 `.mjs` 统一运行时。

历史快照（评估时点，仅作归档参考，非当前状态）：
- 当时 38 个 Python 脚本中：生产级 5 个、实用级 9 个、一次性/调试 25 个、半成品 1 个（`safe-edit-service.py`）。
- 风险点：`inspect_ysm5.py` 曾被 `inspect_ysm.py` 合并替代——该问题随 Python 脚本整体迁移至 `inspect_ysm.mjs` 已根治。

当前治理健康度已由 `check-script-hygiene.mjs` / `check-deadcode-baseline.mjs` 等自动化护栏守护（见 `scripts/README.md` 治理检查段），无需人工清点一次性脚本。

### 3.4 测试：只有合同测试，没有逻辑测试

6 个 Python 测试全部通过，内容均为"合同层"验证（JSON schema / HTML 引用 / 配置格式）。
Go 端有 17 个 `_test.go`，但核心业务包（`avatar` / `download` / `sync` / `installer`）
的单元测试覆盖薄弱——重构 `installer.go` 时没有安全网。

### 3.5 治理：从"防呆"向"防人"滑移

`AGENTS.md` 是一份高质量治理文档，但其尺度已开始从"防止 AI 做蠢事"
转向"防止 AI 做任何事"（禁止 ls、禁止子代理、创建文件需先查命名规范）。
下一步不应再加规则，而是审视哪些规则可以放宽或删除。

---

## 4. 改进优先级（Action Items）

| 优先级 | 任务 | 理由 |
|--------|------|------|
| **P0** | ~~`site-view.js` 拆分（1,268 → ≤400 行/文件）~~ **✅ 已完成** | 原 `community/site-view.js` 已拆为 `site-view.ts`(114 薄壳) + `site/` 子模块（drag/edit/events/render/types.ts），最大单文件 `edit.ts` 487 行且独立可测，RED 风险消除 |
| **P0** | ~~清理 25 个一次性脚本 → 归档至 `scripts/_archive/`~~ **✅ 已完成** | Python→Node 全量迁移（`295ac07e`）已清理 25 个 `*.py` 一次性脚本 + 删除 `safe-edit-service.py` 半成品；`scripts/README.md`「已删除」段已记，治理由 `check-script-hygiene.mjs` 等护栏守护 |
| **P1** | ~~`app_install.go` 逻辑下沉至 `go/installer/`~~ **✅ 已完成** | 原 1,315 行债务已还：`app_install.go` 瘦身为 10 行薄壳，逻辑迁至 `app_install_instance.go`（537 行）。`app_scan.go` 核心亦已下沉 `go/scanner`（见 §3.1） |
| **P1** | ~~打破 `DownloadQueue ↔ App` 循环引用~~ **✅ 已完成** | 已改 callback 注入模式（`downloadFn/emitFn/logFn`），`app_download_test.go` 独立单测就位，解锁独立测试 |
| **P2** | ~~为 `installer` / `sync` / `download` 补单元测试~~ **✅ 已完成** | 三包单测已就位（installer 4 / sync 9 / download 5 测试文件，全仓 151 个 go 测试文件）；`app_scan_test.go` 950 行 + `go/scanner` 1300 行 |
| **P2** | ~~修复 `line-counter.py` 的 `package_lines()` bug~~ **✅ 已完成（前提已消失）** | `line-counter.py` 已迁移为 `line-counter.mjs`（2026-08-03），逻辑逐点保真含 package_lines 行为，原 py 已废弃 |
| **P3** | ~~审视 AGENTS.md 治理规则，删除"创伤反应"式规则~~ **✅ 已完成** | 当前 AGENTS.md 已无"严禁/绝对不能"等过度防御表述（grep 实证） |

---

## 5. 后果（Consequences）

- **正面**：明确了项目当前健康状态和改进路线；优先级列表可直接转为 TASK_PLAN.md 条目。
- **负面**：评估本身不修复任何问题；真正的工作量在 P0-P1 任务中，预计需持续数周落地。

---

## 6. 受影响范围

- `frontend/src/views/app-content/community/site-view.js` → **已完成**拆分为 `site-view.ts`(薄壳) + `site/` 子模块（drag/edit/events/render/types.ts）
- `internal/app/app_install.go` → **已完成**业务下沉（`go/installer/` + `app_install_instance.go`），现为薄壳
- `internal/app/app_scan.go` → 核心已下沉 `go/scanner`，Binding 层门面方法保留，非待办
- `internal/app/app_download.go` → **已完成**打破 `DownloadQueue` 循环引用（回调注入模式）
- `go/installer/` / `go/sync/` / `go/download/` / `go/scanner/` → 单元测试已建立
- `scripts/` → **已完成** Python→Node 全量迁移（`295ac07e`），25 个一次性 `*.py` 清理 + `safe-edit-service.py` 半成品删除；详见 `scripts/README.md`「已删除」段
- `scripts/line-counter.py` → **已完成** 迁移为 `line-counter.mjs`（2026-08-03 保真迁移，含 package_lines 行为）
- `docs/architecture/logic-sinking.md` → 规划项，实际未创建（无文件可改）

---

## 7. 数据溯源

| 来源 | 命令 | 结果 |
|------|------|------|
| 代码量 | `node scripts/line-counter.ts` | Go 15,153 / JS 22,736 / CSS 1,419（评估时点，随版本漂移） |
| 大文件 | `line-counter.mjs` 内建阈值 | 2 RED + 4 YELLOW（评估时点） |
| 编译 | `go build ./go/...` | 干净，exit 0 |
| 前端构建 | `cd frontend; npx vite build` | 干净，零 error |
| 契约测试 | `for f in tests/*.ts; do node "$f"; done` | 6/6 全绿（评估时点，当前已迁移为 `.mjs` 契约测试） |
| 架构 | `docs/architecture/architecture.md` + `logic-sinking.md` | ADR 文档 + 源码验证 |
| 脚本 | `scripts/README.md` + 目录扫描 | 38 个，分类如 §2 表 |
