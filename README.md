# 🧱 YSM 模型管理器

> 类似 Mod Organizer 2 的 Minecraft [Yes Steve Model](https://www.mcmod.cn/class/8616.html) 模型管理器。

灵感来自 LytVPK mod-manager。

**技术栈**：Go (Wails v2) + 原生 HTML/CSS/JS (Web Components + Shadow DOM)

---

## 🖥️ 界面预览

左侧导航 → 右侧主区域，共 6 个功能模块：

| 导航          | 功能                          |
| ------------- | ----------------------------- |
| 🎮 整合包管理 | 版本列表、同步状态、快捷安装  |
| 📦 模型仓库   | 树形浏览、启用/禁用、搜索排序 |
| ⬇️ 下载与更新 | 预告中                        |
| 🗑️ 回收站     | 列出/恢复/删除/清空           |
| 🛠️ 诊断与冲突 | 操作日志、模型去重、冲突检测  |
| ⚙️ 设置       | 路径配置、链接模式、主题切换  |

---

## ✅ 功能

### 📦 模型仓库

- 扫描 `.ysm` / `.zip` / `.7z` 模型文件（按 SHA256 去重）
- 树形文件夹浏览 + 拖拽移动
- 搜索高亮 + 多字段排序（名称 / 大小 / 日期）
- 文件大小颜色：<1MB 绿色，1~3MB 默认，>3MB 红色
- 日期美化（今天显示时间，今年显示月日，往年显示完整日期）
- 启用 / 禁用切换（`.ban` 后缀），复选框批量操作
- 文件夹开关（全部启用 / 全部禁用 / 混合翻转）
- 右键菜单：禁用/启用、模型详情、打开文件夹

### 🎮 整合包管理

- 自动列出版本实例（`.minecraft/versions/`）
- 检测 YSM 模组（支持 `mods.toml` + `neoforge.mods.toml`）
- 四类同步状态：
  - ✅ **已同步的模型列表** — 仓库有且已安装
  - ⬇️ **待同步的模型列表** — 仓库有但未安装
  - ⚠️ **已禁用** — 仓库已禁用但已安装
  - 📤 **可加入仓库的模型列表** — 整合包有但仓库无
- 每行模型文件：`● 文件名 大小 [⬇️ 安装]`
- 批量安装缺失 + 单个安装按钮
- 卡片展开/折叠持久化（`localStorage`）
- 搜索 + YSM 模组筛选，有 YSM 优先
- 右键菜单：从仓库导入、复制模型清单、清空整合包

### 🔄 同步与安装

- 三种安装模式：📋 复制 / 🔗 硬链接 / 🔗 符号链接
- 批量安装缺失 / 全覆盖安装 / 上传新模型到仓库
- 状态同步：仓库启用/禁用 → 自动同步到所有整合包 custom 目录
- 禁用模型自动隐藏（不出现在缺失列表），已安装自动加 `.ban`
- 进度提示（Toast 通知 + 诊断日志）
- 硬链接跨分区自动降级为复制

### 🗑️ 回收站

- 去重文件自动移入 `.recycle`
- 安全性：符号链接直接删除、硬链接直接删除（nlink>1）、路径遍历防护
- 恢复 / 永久删除 / 清空（均带确认弹窗）
- 跨分区兼容（复制后删除）

### 🛠️ 诊断与冲突

- **操作日志**：所有安装/导入/删除操作 + 失败原因分行显示
- **模型去重**：仓库内按 SHA256 查重，保留一个其余入回收站
- **冲突检测**：扫描同名文件存在于多个整合包

### ⚙️ 设置

- 🎮 游戏根目录 — 📂 选择 / 🔍 自动搜索 `.minecraft`
- 📁 模型仓库路径 — 📂 选择
- 🔗 链接模式 — 复制 / 硬链接 / 符号链接
- 🌙 主题模式 — 💻 跟随系统 / 🌙 暗黑模式 / ☀️ 明亮模式
- 主题完整支持所有 Shadow DOM 组件（100+ 处 CSS 变量）
- 导航状态持久化（启动恢复上次页面）
- 窗口大小/位置记忆（运行时实时保存 + 关闭时保存）

### 🔒 安全

- **文件导入校验**：魔数（ZIP/7z）、文件大小上限 500MB、路径穿越防护
- **路径安全**：`isInsideRepo()` / `isInsideMinecraft()` 双重真实路径校验
- **回收站安全**：硬链接/符号链接识别 + 路径遍历防护

---

## 🏗️ 架构

```
ysm-model-manager/
├── app.go                  ← Wails Binding 入口（全部 35 个函数注册于此）
├── main.go                 ← Go 入口 + 窗口参数
├── wails.json              ← Wails 配置（绑定函数列表）
├── go/                     ← Go 工具包
│   ├── installer/          —— 模型安装（复制/硬链接/符号链接）
│   ├── recycle/            —— 回收站
│   ├── sync/               —— 整合包同步状态
│   ├── logs/               —— 操作日志
│   ├── types/              —— 共享类型（AppConfig, ModelEntry, etc）
│   └── ysm/                —— YSM 模型解析 + 摘要提取
├── frontend/               ← 前端源码
│   ├── index.html
│   ├── css/
│   │   ├── variables.css   —— CSS 变量（深色/浅色两套主题）
│   │   ├── components.css
│   │   └── layout.css
│   └── js/
│       ├── bus.js           —— 事件总线（ESM + window.bus 兼容）
│       ├── app-modules.js   —— 全局入口 + 右键菜单 + 窗口状态
│       ├── utils/           —— fmt.js / dom.js / icon.js
│       └── components/      —— 6 个 Web Components
│           ├── app-nav/     —— 左侧导航菜单
│           ├── app-content/ —— 主内容区（页面路由 + 全局事件处理）
│           ├── app-tree/    —— 模型仓库树
│           ├── app-sidebar/ —— 整合包列表
│           ├── app-preview/ —— 预览面板 + 模型详情
│           ├── app-toast.js —— Toast 通知
│           └── context-menu.js —— 右键菜单
└── docs/                   ← 文档
    ├── architecture.md     —— 前端架构规范
    ├── roadmap.md          —— 路线图
    ├── bug-chronicle.md    —— 问题排查记录
    ├── dev-notes.md        —— 开发笔记
    └── postmortem-20250604.md —— 重构复盘
```

### 组件规范

每个组件目录遵循 MVC 分离：

```
app-xxx/
  index.js       # 生命周期编排
  tpl.js         # HTML 模板
  data.js        # 数据逻辑（纯函数）
  render.js      # 渲染逻辑
  events.js      # 事件绑定
  utils.js       # 工具函数
```

---

## 🚀 开发

```bash
# 安装依赖
cd frontend && npm install

# 开发模式（前端热重载）
wails dev

# 仅构建前端
cd frontend && npx vite build

# 编译 Go
go build .

# 完整构建
wails build
```

**注意**：修改 Go 文件后必须 `go build .` 并重启程序。前端修改刷新浏览器即可。

---

## 📖 文档索引

| 文档                                                                 | 内容                                      |
| -------------------------------------------------------------------- | ----------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)                       | 前端架构规范 + 组件拆分指南               |
| [`docs/roadmap.md`](docs/roadmap.md)                                 | 路线图（P0 ~ P4）                         |
| [`docs/bug-chronicle.md`](docs/bug-chronicle.md)                     | 9 个详细 Bug 排查记录                     |
| [`docs/dev-notes.md`](docs/dev-notes.md)                             | 开发笔记 + 已知陷阱                       |
| [`docs/postmortem-20250604.md`](docs/postmortem-20250604.md)         | 2025-06-04 重构复盘                       |
| [`AI_INDEX.md`](AI_INDEX.md)                                         | AI 索引（后端绑定 + 事件总线 + 组件清单） |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | AI 行为规则 + 12 条痛苦教训               |
