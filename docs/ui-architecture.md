# UI 架构与功能区命名规范

> 建立日期: 2026-06-10
> 用途: 统一沟通中的术语，便于快速定位问题

## 总体布局

```
┌──────────────┬─────────────────────────────────────────┐
│  导航栏       │              主内容区                    │
│  (app-nav)   │  (app-content)                          │
│              │  ┌─────────────────┬─────────────────┐  │
│              │  │  侧栏/左面板     │  预览面板        │  │
│              │  │  (sidebar)      │  (preview)      │  │
│              │  │                 │                 │  │
│              │  │  文件树/版本列表  │  模型详情/统计   │  │
│              │  │                 │                 │  │
│              │  └─────────────────┴─────────────────┘  │
└──────────────┴─────────────────────────────────────────┘
```

## 组件与区域命名

| 中文名 | 英文名 | 组件标签 | CSS 文件 | JS 入口 |
|---|---|---|---|---|
| **导航栏** | Nav Bar | `<app-nav>` | 内联 | `app-nav.js` |
| **主内容区** | Content Area | `<app-content>` | `content-css.js` | `app-content/index.js` |
| **侧栏/左面板** | Sidebar / Left Panel | `<app-sidebar>` / `<app-tree>` | `sidebar-css.js` / `app-tree-styles.js` | `app-sidebar/index.js` / `app-tree/index.js` |
| **预览面板** | Preview Panel | `<app-preview>` | `preview-css.js` | `app-preview/index.js` |

## 各页面布局

| 页面（导航项） | route | 左面板内容 | 右面板内容 | 模板函数 |
|---|---|---|---|---|
| 🎮 整合包管理 | `instances` | 版本列表 (version list) | 统计面板 (stats panel) | `instancesHTML()` |
| 📦 模型仓库 | `repository` | 文件树 (file tree) | 详情面板 (detail panel) | `repositoryHTML()` |
| 🧩 创意工坊 | `workshop` | 站点列表 (site list) | 搜索/作者视图 (search/creator view) | `workshopHTML()` |
| 🛠️ 诊断与冲突 | `diagnostics` | 诊断菜单 (diag menu) | 诊断面板 (diag panel) | `diagnosticsHTML()` |
| ⚙️ 设置 | `settings` | — | 设置表单 (settings form) | `settingsHTML()` |

## 仓库多标签架构（未来）

```
📦 模型仓库
  ├─ 📁 文件树 tab     — 左: 文件树   右: 详情面板
  ├─ ⬇️ 导入 tab       — 左: 拖拽区   右: 导入日志
  ├─ 🗑️ 回收站 tab     — 左: 回收列表  右: 文件信息
  └─ 🔗 去重 tab       — 左: 去重结果  右: 选定详情
```

## 常见问题的排查路径

| 症状 | 可能的问题域 | 应检查的文件 |
|---|---|---|
| 导航点击没反应 | 事件总线 / 导航组件 | `app-nav.js` → `bus.emit("nav:change")` → `app-content/index.js` |
| 侧栏不显示数据 | 数据加载 / Go 后端 | `app-sidebar/loader.js` → `go/sync/sync.go` → `ListVersions` |
| 文件树为空 | 仓库路径 / 扫描逻辑 | `app-tree/loader.js` → `app.go` `ScanModelEntries` |
| 预览面板不显示 | 模型解析 / 组件初始化 | `app-preview/index.js` → `_showModelDetail` |
| CSS 样式失效 | Shadow DOM 隔离 | 对应组件的 `*-css.js` vs `components.css` |
| 配置文件不保存 | Go 端写文件逻辑 | `app.go` `SaveAppConfig` / `configPath()` |
