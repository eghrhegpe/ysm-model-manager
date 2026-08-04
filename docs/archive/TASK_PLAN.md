# YSM 模型管理器 — AI 任务计划

> 本文件为 AI 代理提供可执行的任务清单。每个任务包含：目标、涉及文件、验证方式、依赖关系。
> 执行前**必须先阅读** `AGENTS.md` 和 `docs/architecture.md`。

---

## 任务总览

| # | 任务 | 优先级 | 预估 | 状态 | 依赖 |
|---|------|--------|------|------|------|
| 1 | ~~术语表落地 — Toast/按钮/tooltip 文案统一~~ | — | — | ✅ 完成 (2026-06-17) | — |
| 2 | ~~术语表落地 — UI 专有名词替换~~ | — | — | ✅ 完成 (2026-06-17) | — |
| 3 | Overlay UX 微调 | **中** | 中 | ✅ 已完成（P2-8/P2-9 代码已存在） | 无 |
| 4 | ~~发版 v1.8.0~~ | — | — | ✅ 完成（v1.8.9/v1.8.10 已发） | — |
| 5 | 前端测试扩展 | **低** | 中 | ⬜ 待开始 | 无 |
| 6 | Go 测试扩展 | **低** | 中 | ✅ 完成 (v1.9.0) | — |
| 7 | 列表/网格视图切换 | **低** | 高 | ✅ 完成 (v1.9.0) | 无 |
| 8 | **3D 骨骼渲染攻关** | **高** | 高 | ✅ 完成 | — |
| 9 | **3D 模块重构** | **中** | 中 | ✅ 完成 | — |
| 10 | **加载路径大统一** | **高** | 高 | ✅ 完成 (v1.8.11, 2026-06-17) | 无 |

> 📌 任务 #8 详见 [3D-RENDERING-PLAN.md](../3D/3D-RENDERING-PLAN.md)：多 AI 分工流程 + 提示词 + 已知陷阱
> 📌 开发报告：[3d-rendering-report.md](../3D/3d-rendering-report.md)

---

## 任务 1：术语表落地 — Toast/按钮/tooltip 文案统一

**目标**：按 `docs/TERMINOLOGY.md` 的文案修剪表，统一所有 Toast 和 tooltip 文案。

**参考文档**：
- `docs/TERMINOLOGY.md` — 完整对照表
- `docs/DEPRECATED_NAMES.md` — 废弃别名

### 1.1 Toast 文案统一

| 文件 | 行号 | 旧文案 | 新文案 |
|------|------|--------|--------|
| `frontend/js/core/handler-sync.js` | 24, 219 | "请先设置游戏路径" | "请先配置游戏目录" |
| `frontend/js/core/handler-sync.js` | 38 | "请先设置该资源类型的目录" | "请先配置 {类型} 目录" |
| `frontend/js/core/handler-other.js` | 22, 107 | "请先设置游戏路径" | "请先配置游戏目录" |
| `frontend/js/views/app-tree/instance-actions.js` | 36 | "请先设置游戏路径" | "请先配置游戏目录" |
| `frontend/js/views/app-content/community-diagnostics.js` | 366 | "请先设置游戏路径" | "请先配置游戏目录" |
| `frontend/js/features/oldest-models.js` | 42 | "请先设置该资源类型的目录" | "请先配置 {类型} 目录" |
| `frontend/js/core/context-menus.js` | 380 | "请先设置游戏根目录" | "请先配置游戏目录" |
| `frontend/js/features/community/download-queue.js` | 485 | "请先在设置中配置仓库目录" | "请先配置仓库目录" |
| `frontend/js/views/app-tree/toolbar-events.js` | 389 | "请先在设置中配置文件存储路径" | "请先配置存储路径" |
| `frontend/js/features/import-queue.js` | 350 | "请先在设置中配置文件存储路径" | "请先配置存储路径" |

### 1.2 按钮 / tooltip 缩短

| 文件 | 行号 | 旧 | 新 |
|------|------|-----|-----|
| `frontend/js/views/app-tree/tpl.js` | 7 | `title="高级筛选（骨骼/立方体/纹理）"` | `title="高级筛选"` |
| `frontend/js/views/app-tree/tpl.js` | 28 | `title="点击选择仓库目录"` | `title="配置仓库目录"` |
| `frontend/js/views/app-sidebar/tpl.js` | 38 | `title="点击选择游戏目录"` | `title="配置游戏目录"` |
| `frontend/js/dialogs/batch-rename.js` | 251 | 预设芯片 "去除年份 (2025-08)" | "去除年份" |

### 验证方式

```powershell
# 确认旧文案已全部替换
rg "请先设置游戏路径" frontend/js/ --include="*.js"
rg "请先设置游戏根目录" frontend/js/ --include="*.js"
rg "请先在设置中配置" frontend/js/ --include="*.js"
rg "点击选择仓库目录" frontend/js/ --include="*.js"
rg "点击选择游戏目录" frontend/js/ --include="*.js"

# 构建验证
cd frontend ; npx vite build 2>&1 | Select-String error
```

---

## 任务 2：术语表落地 — UI 专有名词替换

**目标**：统一诊断页/仓库元老页的专有名词。

**参考文档**：`docs/TERMINOLOGY.md` § UI 专有名词

### 替换清单

| 文件 | 旧文案 | 新文案 | 备注 |
|------|--------|--------|------|
| `frontend/js/features/oldest-models.js` | "仓库元老" | "资历最深" | Tab 标题、卡片标题 |
| `frontend/js/features/oldest-models.js` | "健康度" | "仓库评分" | 徽章标签 |
| `frontend/js/features/oldest-models.js` | "今日推荐" | "每日推荐" | 卡片标题 |
| `frontend/js/views/app-content/tpl.js` | 相关文案 | 同步更新 | 检查模板中的引用 |
| `frontend/js/views/app-nav.js` | 导航项文案 | 同步更新 | 如有"仓库元老"导航项 |

### 验证方式

```powershell
rg "仓库元老" frontend/js/ --include="*.js"
rg "健康度" frontend/js/ --include="*.js"
rg "今日推荐" frontend/js/ --include="*.js"

# 构建验证
cd frontend ; npx vite build 2>&1 | Select-String error
```

---

## 任务 3：Overlay UX 微调

**目标**：按第三方评审建议优化创作者详情 Overlay 的视觉/交互细节。

**参考文档**：`docs/ui-improvement-plan.md`

### 待办项

| # | 项目 | 状态 | 文件 |
|---|------|------|------|
| P2-8 | 预览面板宽度可调 | ✅ 完成（已存在 `_initPreviewResize()` + localStorage 持久化） | `app-content/index.js:143-178` |
| P2-9 | 文件树标签日期着色 | ✅ 完成（已在 app-tree-styles.js/preview-css.js/content-css.js 中着色） | `display.js:99-109` |

### 注意事项

- 所有 CSS 改动必须遵守 `docs/Design.md` 的变量/颜色规则
- 新增动画必须遵守 `.no-animations` 无障碍开关
- 不得引入新的 npm 依赖

### 验证方式

```powershell
cd frontend ; npx vite build 2>&1 | Select-String error
```

---

## ~~任务 4：发版 v1.8.0~~ ✅ 已完成

> 已发版 v1.8.9（2026-06-17）和 v1.8.10（2026-06-17）。
> 发版流程参见 `docs/release-notes/README.md`。

---

## 任务 5：前端测试扩展

**目标**：为关键模块增加单元测试。

**当前状态**：30 个测试（fmt/dom/data）

### 建议覆盖

| 模块 | 文件 | 测试重点 |
|------|------|----------|
| download-queue | `features/community/download-queue.js` | STATE 持久化、事件注册 |
| render | `features/community/render.js` | 空状态、数据渲染 |
| bus | `js/bus.js` | on/off/emit/once |
| errors | `utils/errors.js` | friendlyError 正则匹配 |

---

## 任务 6：Go 测试扩展

**当前状态**：11 包已测（dedup/fsutil/importer/installer/packs/recycle/sync/tags/types/watcher/ysm）

### 待补模块

| 模块 | 路径 | 测试重点 | 状态 |
|------|------|----------|------|
| ~~installer~~ | `go/installer/` | ~~复制/硬链接/符号链接/跨分区降级~~ | ✅ 已完成 |
| ~~importer~~ | `go/importer/` | ~~文件导入校验、路径安全~~ | ✅ 已完成 |
| ~~watcher~~ | `go/watcher/` | ~~fsnotify 事件处理~~ | ✅ 已完成 |
| updater | `go/updater/` | SHA256 校验、版本比较 | ⬜ 待补 |

---

## 任务 7：列表/网格视图切换

**目标**：仓库页支持紧凑列表视图。

### 方案

1. `app-tree/tpl.js` — 工具栏加 🗂/☰ 切换按钮
2. 新建 `app-tree/row-tpl-list.js` — 紧凑行模板
3. `app-tree/render.js` — 增加 `renderListView()` 模式
4. `localStorage` 持久化用户选择

### 注意事项

- 虚拟滚动（`virtual-scroll.js`）需兼容两种模式
- 选中状态在两种视图间保持一致

---

## ~~任务 8：3D 骨骼渲染攻关~~ ✅ 已完成

> v1.8.6-v1.8.8 完成。详见 [3D-RENDERING-PLAN.md](../3D/3D-RENDERING-PLAN.md) 和 [3d-rendering-report.md](../3D/3d-rendering-report.md)。

---

## ~~任务 9：3D 模块重构~~ ✅ 已完成

> v1.8.10 完成。改动：
> - `model3d.js` 拆分为 `model3d.js` + `model3d-loader.js` + `screenshot-renderer.js`
> - 删除 `preview-3d.js`（死代码，零引用）
> - `preview-skeleton.js` 改用 `preloadModel` + `renderModel3D` 调用链

---

## 执行规范

1. **改前读文件** — 禁止基于记忆修改，每次改前先 `grep` / `read` 确认最新状态
2. **改完立即构建** — Go 改 `go build ./go/...`，前端改 `npx vite build`
3. **不攒修改** — 每完成一个任务立即构建验证
4. **遵守术语表** — 所有 UI 文案参照 `docs/TERMINOLOGY.md`
5. **遵守治理规则** — 参照 `docs/CLEANUP_RULES.md` 的 9 条规则
6. **不引入新依赖** — 除非任务明确要求
