# 创意工坊 UI 架构日记

> 2026-06-07 记录。创意工坊从"站点列表+内嵌浏览器"到"GitHub 仓库模型管理器"的演进。

## 📜 演变史

### Phase 0: 最初的创意工坊

最早就是两栏布局：

```
┌──────────────┬──────────────────────────────┐
│  站点列表     │  点击站点后内嵌浏览器           │
│  ────────    │  iframe 显示对应网站            │
│  B站         │  右键弹出二级菜单               │
│  爱发电      │  ├ ↗ 浏览器打开                │
│  GitHub      │  └ 🔍 内嵌浏览                 │
│  MC百科      │                              │
│  ...         │                              │
└──────────────┴──────────────────────────────┘
```

**问题**：

- iframe 受 X-Frame-Options 限制，大部分站点无法内嵌
- 用户几乎只用"浏览器打开"，内嵌浏览形同虚设
- 没有"浏览 GitHub 仓库模型"的能力

### Phase 1: 创作者管理

加了创作者列表，按站点分组：

```
┌──────────────┬──────────────────────────────┐
│  站点列表     │  🎨 活跃创作者                  │
│              │  ┌──────────────────────────┐  │
│              │  │ 🎨 碎de帆                │  │
│              │  │   东方project系列         │  │
│              │  │                   ↗     │  │
│              │  ├──────────────────────────┤  │
│              │  │ 🎨 Almeta_owx           │  │
│              │  │   原创角色、碧蓝档案      │  │
│              │  │                   ↗     │  │
│              │  └──────────────────────────┘  │
└──────────────┴──────────────────────────────┘
```

**问题**：

- GitHub 类型的创作者显示的是仓库名（如 `eghrhegpe/YSM-Model-Workshop`）
- 点击 ↗ 只是打开 GitHub 链接，没有集成感

### Phase 2: 📦 浏览按钮

给 GitHub 类型的创作者加了个「📦 浏览」按钮：

```
┌──────────────┬──────────────────────────────┐
│  站点列表     │ 🎨 活跃创作者                  │
│              │                              │
│  GitHub      │ eghrhegpe/YSM-Model-Workshop │
│              │ YSM-Model-Manager 整合仓库    │
│              │ ┌──────────┐                 │
│              │ │ 📦 浏览  │  ← 新增          │
│              │ └──────────┘                 │
└──────────────┴──────────────────────────────┘
```

点击后读取 `raw.githubusercontent.com/{repo}/main/index.json`，渲染模型列表。

### Phase 3: 当前架构（v1.0.4）

```
┌──────────────┬──────────────────────────────┐
│  站点列表     │ 📦 eghrhegpe/YSM-Model-Workshop  raw  141 个模型
│              │ ⬇️103  ⬇️下载缺失  📁仅显示缺失
│              │ ┌──────────────────────────┐  │
│              │ │ 🔍 搜索模型名称           │  │
│              │ ├──────────────────────────┤  │
│              │ │ [Almeta_owx]【ATRI】亚托莉│  │
│              │ │                      ✅已有│  │
│              │ │ [Almeta_owx]【OC】Trissy │  │
│              │ │                     ⬇️   │  │
│              │ └──────────────────────────┘  │
└──────────────┴──────────────────────────────┘
```

## 🏗️ 核心数据流

```
点击 📦 浏览
  ↓
tryFetchModels(mirror)
  ├─ raw.githubusercontent.com (5s)  ← 按镜像策略排序
  ├─ cdn.jsdelivr.net (5s)            ↗
  └─ api.github.com (5s)            三种源，策略决定顺序
  ↓
showRepoModels(repo, models, source)
  ├─ 加载本地文件列表 (ScanModelEntries)
  ├─ 渲染标题栏（repo + source 标签 + 计数）
  ├─ 渲染搜索框
  ├─ 渲染模型列表（比对本地 ✅/⬇️）
  ├─ 绑定返回、搜索、右键菜单事件
  └─ 绑定下载事件（单文件 + 批量）
```

## 🧩 组件职责

| 层级 | 文件                         | 职责                                                          |
| ---- | ---------------------------- | ------------------------------------------------------------- |
| 模板 | `tpl.js` `workshopHTML()`    | 左右栏 + 内嵌浏览器 + 弹出菜单的 HTML 骨架                    |
| 编排 | `index.js` `_initWorkshop()` | 生命周期：加载数据 → 渲染卡片 → 绑定事件                      |
| 数据 | `index.js`（闭包变量）       | `currentSite`, `allCreators`, `repoAuthors`, `repoModelCache` |
| 渲染 | `showRepoModels()`           | 将 models 数组渲染为带交互的 HTML 列表                        |
| 业务 | `tryFetchModels()`           | 三层回退 + 进度条 + 倒计时                                    |
| 缓存 | `repoModelCache{}`           | 会话级内存缓存，避免重复 fetch                                |

## 💡 设计决策

### 1. 为什么不用 Web Component？

创意工坊的复杂度介于"简单页面"和"独立组件"之间。用 `_initWorkshop()` 闭包管理状态比拆成独立 WC 更轻量：

- 状态都在闭包里（`currentSite`, `allCreators`, `repoModelCache`）
- 无需 Shadow DOM 隔离（样式已经用 CSS 变量控制）
- 重构时只需改一个函数，不用跨文件追踪

### 2. 为什么模型列表不放在 Shadow DOM 里？

模型列表是动态 HTML，放 Shadow DOM 里反而麻烦：

- 事件绑定需要 `this.shadowRoot.querySelector`，而列表在 `searchResults` 里
- 用 `innerHTML` + 事件委托比 Shadow DOM 的事件重定向更直接

### 3. 为什么下载按钮的 URL 前缀前端决定？

因为前端知道 `mirror` 设置。但 Go 端也有完整的回退逻辑（读取 `LoadAppConfig().Mirror` 重试）。前端选 jsDelivr 时按钮 URL 直接指向 CDN，更快；后端作为保险。

### 4. 为什么缓存只存 models 不存 localMap？

`localMap`（本地文件列表）每次打开都重新加载，确保 ✅ 已有/⬇️ 状态实时准确。`models`（远程列表）才缓存，因为 index.json 在 session 内不会变。

## 🐛 踩过的坑

### 坑 1: iframe 安全策略

**问题**: 大部分站点设置 `X-Frame-Options: DENY`，iframe 内显示"拒绝连接"。

**解决**: 保留 iframe 作为可选方式，但给每个站点加了二级菜单：「↗ 浏览器打开」和「🔍 内嵌浏览」。用户自己选择。

### 坑 2: 右键菜单被隐藏

**问题**: `context-menu` Web Component 在 document 上注册了 `contextmenu` 监听器，任何右键事件到达 document 都会隐藏菜单。模型行的右键事件没有 `stopPropagation`，导致菜单闪一下消失。

**解决**: 在模型行右键 handler 里加 `e.stopPropagation()`。

### 坑 3: 搜索时右键索引错位

**问题**: 渲染时用 `filtered.map((m, i)` 的 `i` 作 `data-idx`。搜索过滤后索引是 filtered 数组的索引，但右键查找用的 `models[idx]` 是原始数组，搜过之后匹配不上。

**解决**: 改用 `data-name` 存储模型名，右键时 `models.find(x => x.name === name)` 查找。

### 坑 4: esbuild 不认 `//g`

**问题**: `_esc` 方法中的 `.replace(/>/g, "&gt;")` 被编辑操作吞了 `>` 变成 `.replace(//g, ">")`，`//` 被当作注释。

**解决**: 无——纯属手误，每次改完跑 `npx vite build` 验证。

### 坑 5: 多余的 `}` 导致 Parse Error 在文件末尾

**问题**: `const dlPrefix = ...;` 后面多了一个 `}`，提前关闭了 `showRepoModels` 函数体。esbuild 到文件末尾才报错，定位困难。

**解决**: 检查花括号匹配 + 每次改完立即构建验证。

## 📐 关键代码结构

```
_initWorkshop() 闭包中的持久变量：
├── currentSite       — 当前选中的站点
├── allCreators       — 所有创作者列表
├── repoAuthors       — 本地仓库作者列表
├── wsEditMode        — 编辑模式开关
└── repoModelCache{}  — { repo: { models, source } }

showRepoModels() 内部变量：
├── localMap          — { 文件名: hash } 本地文件映射
├── mirror            — 镜像策略
├── dlPrefix          — 下载 URL 前缀
├── showAll           — 显示全部/仅缺失切换
├── missingCount      — 缺失文件数
├── isMissing()       — 判断文件是否缺失（hash 优先→文件名回退）
└── renderList()      — 渲染模型列表（搜索过滤 + 缺失过滤）
```

## 📦 未来可扩展

- **多仓库浏览**: `repoModelCache` 已天然支持多个 repo 缓存
- **WebSocket 推送**: 缓存命中时后台静默更新，用户无感知
- **离线浏览**: `repoModelCache` + `localStorage` 持久化，无网也能看
