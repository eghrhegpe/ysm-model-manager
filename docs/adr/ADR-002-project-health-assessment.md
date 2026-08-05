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
| 🔴 RED | `frontend/src/views/app-content/community/site-view.js` | **1,268** | 社区站点视图，未按规范拆分 |
| 🟡 YELLOW | `frontend/src/views/app-content/index.js` | 921 | 入口聚合，可接受 |
| 🟡 YELLOW | `frontend/src/views/app-content/content-css.js` | 919 | Shadow DOM 样式，免拆 |
| 🟡 YELLOW | `frontend/src/features/import-queue.js` | 835 | 业务逻辑与 UI 渲染混合 |
| 🟡 YELLOW | `frontend/src/views/app-content/community/settings.js` | 733 | 社区设置页 |

### 2.3 架构维度评级

| 维度 | 评级 | 说明 |
|------|------|------|
| 前端分层 | **A** | 三层解耦 + 组件目录规范执行到位，契约明确 |
| 前端依赖方向 | **A** | 单向依赖，bus.js 解耦良好，无循环 |
| 后端依赖方向 | **A-** | 单向 `internal/app/ → go/`，无包级循环 |
| 后端分层 | **B-** | 已分 package，但 `App` struct 仍是单体 god-object（100+ 方法） |
| 循环依赖 | **A-** | 仅 1 处同包内对象级循环（`DownloadQueue ↔ App`） |
| Binding 层重量 | **B-** | 已下沉约 35%（P0/P1/P1.5），`app_install.go`（1,315 行）仍未下沉 |
| 测试覆盖 | **B** | 契约测试 6/6 全过；Go 核心业务包（installer / sync / download）测试薄弱 |
| 工具脚本健康度 | **C** | 25 个一次性脚本未清理，1 个半成品（`safe-edit-service.py`，`do_GET` 内 `pass`） |

---

## 3. 发现的问题（Issues）

### 3.1 后端：god-object 尚未拆除

`App` struct（`internal/app/`）挂载 **100+ 方法**，分散在 17 个文件中。
逻辑下沉计划已完成下载器（P0）、头像提取（P1）、哈希对比（P1.5），
但最大的债务——`app_install.go`（1,315 行、50+ 方法，含 import / relink / sync 系列）——
仍在 Binding 层，未下沉至 `go/installer/`。

`DownloadQueue ↔ App` 存在对象级循环引用（`NewDownloadQueue(a)` 持有 `*App`），
导致 `DownloadQueue` 无法脱离 `App` 独立测试。

### 3.2 前端：`site-view.js` 是最大单点

`site-view.js`（1,268 行）是前端唯一的 RED 级别大文件。
社区功能是相对独立的模块，却浓缩在一个文件中。
按 AGENTS.md §五.3 的拆分规范，至少应拆为：
`index.js` + `render.js` + `events.js` + `data.js`。

### 3.3 工具脚本：25 个一次性文件是债务

38 个 Python 脚本中：
- 生产级（支持 `--json`）：5 个（`review.py` / `link-checker.py` / `type-consistency.py` / `release-notes-gen.py` / `bug-search.py`）
- 实用级：9 个
- 一次性 / 调试：25 个（`check_*.py` 11 个，`fix_*.py` 3 个，`inspect_*.py` 2 个等）
- 半成品：1 个（`safe-edit-service.py`，`do_GET` 备份逻辑为空的 `pass`）

25 个一次性脚本对 AI 代理构成误导风险：`inspect_ysm5.py` 已被 `inspect_ysm.py` 合并替代，
但文件名未改、代码未删，AI 代理可能误用已废弃版本。

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
| **P0** | `site-view.js` 拆分（1,268 → ≤400 行/文件） | 唯一 RED 级别前端大文件，违反 AGENTS.md §五.3 拆分规范 |
| **P0** | 清理 25 个一次性脚本 → 归档至 `scripts/_archive/` | AI 代理误导源，`safe-edit-service.py` 半成品应删除 |
| **P1** | `app_install.go` 逻辑下沉至 `go/installer/` | 最大 Binding 债务（1,315 行），与已完成的 P0/P1 形成不对称 |
| **P1** | 打破 `DownloadQueue ↔ App` 循环引用 | 改为 callback 模式，解锁独立测试 |
| **P2** | 为 `installer` / `sync` / `download` 补单元测试 | 重构前必须建立安全网 |
| **P2** | 修复 `line-counter.py` 的 `package_lines()` bug | 当前统计文件数而非行数 |
| **P3** | 审视 AGENTS.md 治理规则，删除"创伤反应"式规则 | 给新项目留呼吸空间 |

---

## 5. 后果（Consequences）

- **正面**：明确了项目当前健康状态和改进路线；优先级列表可直接转为 TASK_PLAN.md 条目。
- **负面**：评估本身不修复任何问题；真正的工作量在 P0-P1 任务中，预计需持续数周落地。
- **风险提示**：P1 任务（`app_install.go` 下沉）涉及大量绑定关系变更，
  应在 `go test` 覆盖建立后（P2）再执行，否则回归风险高。

---

## 6. 受影响范围

- `frontend/src/views/app-content/community/site-view.js` → 拆分为多文件
- `internal/app/app_install.go` → 业务逻辑下沉至 `go/installer/`
- `internal/app/app_download.go` → 打破 `DownloadQueue` 循环引用
- `go/installer/` / `go/sync/` / `go/download/` → 新增单元测试
- `scripts/` → 25 个一次性脚本迁移至 `scripts/_archive/`，半成品删除
- `scripts/line-counter.py` → 修复 `package_lines()` 统计逻辑
- `docs/architecture/logic-sinking.md` → 需同步更新 P2/P3 任务状态

---

## 7. 数据溯源

| 来源 | 命令 | 结果 |
|------|------|------|
| 代码量 | `python3 scripts/line-counter.py` | Go 15,153 / JS 22,736 / CSS 1,419 |
| 大文件 | `line-counter.py` 内建阈值 | 2 RED + 4 YELLOW |
| 编译 | `go build ./go/...` | 干净，exit 0 |
| 前端构建 | `cd frontend; npx vite build` | 干净，零 error |
| 契约测试 | `python3 tests/python/*.py` | 6/6 全绿 |
| 架构 | `docs/architecture/architecture.md` + `logic-sinking.md` | ADR 文档 + 源码验证 |
| 脚本 | `scripts/README.md` + 目录扫描 | 38 个，分类如 §2 表 |
