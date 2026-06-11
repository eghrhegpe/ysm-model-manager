# 🧱 YSM 模型管理器

> 像 Steam 创意工坊一样，管理你的 Minecraft YSM 模型。导入、预览、分类、同步到整合包，一站完成。

**技术栈**：Go (Wails v2) + 原生 HTML/CSS/JS (Web Components + Shadow DOM) + Three.js + YSMParser WASM

**平台支持**：✅ Windows (amd64) · ⚠️ macOS (实验性) · ❓ Linux (待验证)

> 🌐 **产品主页**: [https://eghrhegpe.github.io/ysm-model-manager/](https://eghrhegpe.github.io/ysm-model-manager/) — 功能介绍、视频演示、截图展示

---

## ⚡ 快速开始

1. **下载**：前往 [GitHub Releases](https://github.com/eghrhegpe/ysm-model-manager/releases) 下载最新的 `YSM-Model-Manager_windows_amd64.zip`
2. **解压**：解压到任意目录（如 `D:\YSM-Model-Manager\`）
3. **首次配置**：启动程序 → 设置游戏根目录（`.minecraft` 文件夹）→ 设置模型仓库路径
4. **开始使用**：把模型文件放入仓库目录，或通过拖拽导入

> 📖 **详细说明见 [用户指南](docs/用户指南.md)**，包含 FAQ、故障排查、链接模式详解等。
> 🎨 **设计规范见 [Design.md](docs/Design.md)**，AI 开发时的 UI 约束指南。

---

## 🖥️ 功能一览

左侧导航 → 右侧主区域，共 7 个功能模块：

| 导航          | 功能                                       |
| ------------- | ------------------------------------------ |
| 📦 模型仓库   | 树形浏览、启用/禁用、搜索排序、3D 预览     |
| 🎮 整合包管理 | 版本列表、同步状态、快捷安装               |
| 🎨 创作者频道 | 站点浏览、创作者管理、预设搜索、内嵌浏览器 |
| 🧩 创意工坊   | GitHub 在线仓库列表、一键下载              |
| 👴 仓库元老   | 最早模型列表、批量安装                     |
| 🛠️ 诊断与冲突 | 操作日志、模型去重（可选保留）、冲突检测   |
| ⚙️ 设置       | 路径配置、链接模式（含警告）、主题切换     |

---

## ✅ 功能

### 📦 模型仓库

<p align="center"><img src="docs/preview/模型仓库.png" width="80%" alt="模型仓库"></p>

- 扫描 `.ysm` / `.zip` / `.7z` 模型文件（按 SHA256 去重）
- 树形文件夹浏览 + 拖拽移动
- 搜索高亮 + 多字段排序（名称 / 大小 / 日期）
- 文件大小颜色：<1MB 绿色，1~3MB 默认，>3MB 红色
- 日期美化（今天显示时间，今年显示月日，往年显示完整日期）
- 启用 / 禁用切换（`.ban` 后缀），复选框批量操作
- 文件夹开关（全部启用 / 全部禁用 / 混合翻转）
- 右键菜单：禁用/启用、模型详情、打开文件夹
- 📇 **生成 GitHub 索引**：扫描仓库生成 `index.json`，提交后即可在线浏览

### 🎮 整合包管理

<p align="center"><img src="docs/preview/整合包管理.png" width="80%" alt="整合包管理"></p>

- 自动列出版本实例（`.minecraft/versions/`）
- 检测 YSM 模组，无 YSM 的整合包显示 🚫 无YSM 但仍可管理
- 四类同步状态：
  - ✅ **已同步的模型列表** — 仓库有且已安装
  - ⬇️ **待同步的模型列表** — 仓库有但未安装
  - ⚠️ **已禁用** — 仓库已禁用但已安装
  - 📤 **可加入仓库的模型列表** — 整合包有但仓库无
- 批量安装缺失 + 单个安装按钮
- 卡片展开/折叠持久化（`localStorage`）
- 搜索 + YSM 模组筛选，有 YSM 优先
- 右键菜单：从仓库导入、复制模型清单、清空整合包

### 🔄 同步与安装

- 三种安装模式：📋 复制 / 🔗 硬链接（推荐） / 🔗 符号链接（不推荐）
- 批量安装缺失 / 全覆盖安装 / 上传新模型到仓库
- **文件监听器**（`fsnotify`）：仓库文件加/删 `.ban` 时自动同步到所有整合包，无需手动操作
- 状态同步：仓库启用/禁用 → 自动同步到所有整合包 custom 目录
- 禁用模型自动隐藏（不出现在缺失列表），已安装自动加 `.ban`
- 硬链接跨分区自动降级为复制
- 游戏运行时文件被锁定自动跳过，退出后下次触发自动重试

### 🎨 创作者频道

<p align="center"><img src="docs/preview/创作者频道.png" width="80%" alt="创作者频道"></p>

- **站点浏览**：B站、爱发电等平台的创作者列表浏览
- **创作者管理**：维护创作者数据库（87+ 位），按平台标签分类（bilibili / afdian / github）
- **预设搜索**：一键搜索 B站 YSM 免费模型 / YSM 模型分享、爱发电 YSM
- **内嵌浏览器**：反向代理绕过 X-Frame-Options，在应用内浏览网页
- **导入/导出**：站点和创作者 JSON 导入导出，支持合并和覆盖模式

### 🧩 创意工坊

<p align="center"><img src="docs/preview/创意工坊.png" width="80%" alt="创意工坊"></p>

- **GitHub 在线仓库**：读取远程仓库的 `index.json` 在线浏览模型列表
- **一键下载**：⬇️ 直接从 GitHub 下载模型到本地仓库
- **仓库管理**：支持添加/删除 GitHub 仓库源

### 👴 仓库元老

- **最早模型**：按文件修改日期排序，列出最古老的模型
- **批量安装**：一键安装所有元老模型到整合包

### 🔄 自动更新

- 启动时自动检查 GitHub Releases
- 检测到新版本提示下载，支持后台下载 + 解压覆盖更新

### 🛠️ 诊断与冲突

- **操作日志**：所有安装/导入/删除操作 + 失败原因分行显示
- **模型去重**：仓库内按 SHA256 查重，**逐组选择保留哪个副本**，其余入回收站
- **冲突检测**：扫描同名文件存在于多个整合包

### ⚙️ 设置

- 🎮 游戏根目录 — 📂 选择 / 🔍 自动搜索 `.minecraft`（检测 versions/assets 等特征）
- 📁 模型仓库路径 — 📂 选择
- 🔗 链接模式 — 复制 / 硬链接 ✅（需同分区） / 符号链接 ❌（YSM 不兼容）
- 🌙 主题模式 — 💻 跟随系统 / 🌙 赛博霓虹 / ☀️ 温暖木纹 / ⚪ 极简深邃
- 🗑️ 回收站 — 列出/恢复/删除/清空（符号链接直接删、硬链接直接删、普通文件移入 `.recycle`）
- 导航状态持久化（启动恢复上次页面）
- 窗口大小/位置记忆（关闭时 Go 端保存）

### 🔒 安全

- **文件导入校验**：魔数（ZIP/7z）、文件大小上限 500MB、路径穿越防护
- **路径安全**：统一 `paths.IsInside()` 用 `EvalSymlinks` 真实路径校验
- **回收站安全**：硬链接/符号链接识别 + 路径遍历防护
- **shutdown 保护**：关闭时 `defer recover()` 防止窗口尺寸读取 panic

---

## 🔬 技术原理：YSMParser 集成与 .ysm 格式

### .ysm 文件格式

`.ysm` 是 YSM 模组的专有模型格式，**不是标准 zip 压缩包**。其结构为：

```
┌──────────┬────────┬──────────┬──────────────────────────────┐
│ YSGP头   │ 版本号 │ MD5校验  │  AES-256 加密的模型数据       │
│ (4字节)  │ (4字节)│ (16字节) │  (模型JSON + 纹理 + 动画)    │
└──────────┴────────┴──────────┴──────────────────────────────┘
```

- 开源模型以标准 `.zip` 格式分发，内含明文 `minecraft:geometry` JSON
- 加密模型使用 YSGP 二进制格式 + AES 加密，需专用解析器解码

### YSMParser 集成

本工具集成 [YSMParser](https://github.com/OpenYSM/YSMParser) 作为 sidecar 解码加密模型：

- **解码流程**：`AnalyzeBedrockModel()` → 检测 `.ysm` → 调 `YSMParser.exe` 解密 → 读取 `models/*.json` → 解析骨骼 → Canvas 2D 渲染
- **兼容性**：支持数组 `[u,v]` 和对象 `{face:{uv,uv_size}}` 两种 UV 格式
- **隐私声明**：解码仅在本地进行，不联网、不存储、不导出模型文件

### 安装 YSMParser

从 [GitHub Releases](https://github.com/OpenYSM/YSMParser/releases) 下载 `YSMParser-x.x.x-windows-x64.zip`，将 `YSMParser.exe` 放到程序同目录即可。程序启动时自动检测。

---

```
ysm-model-manager/
├── app.go                     ← Wails Binding 入口
├── main.go                    ← Go 入口 + 窗口参数
├── wails.json                 ← Wails 配置
├── build-release.ps1          ← 构建+GitHub Release 脚本
├── go/                        ← Go 工具包
│   ├── installer/             —— 模型安装（复制/硬链接/符号链接）
│   ├── recycle/               —— 回收站
│   ├── sync/                  —— 整合包同步状态
│   ├── logs/                  —— 操作日志
│   ├── ysm/                   —— YSM 模型解析 + 摘要提取 + 头部扫描
│   ├── watcher/               —— 文件监听器（fsnotify 实时同步 .ban）
│   ├── updater/               —— 自动更新
│   ├── version/               —— 版本号（编译时注入）
│   ├── paths/                 —— 路径安全校验
│   └── types/                 —— 共享类型
├── frontend/                  ← 前端源码
│   ├── index.html
│   ├── css/
│   │   ├── variables.css      —— CSS 变量（4 套主题）
│   │   └── layout.css
│   └── js/
│       ├── bus.js              —— 事件总线
│       ├── app-modules.js      —— 全局入口 + 右键菜单映射
│       ├── components/         —— Web Components
│       │   ├── app-nav.js      —— 左侧导航菜单
│       │   ├── app-content/    —— 主内容区（页面路由 + 全局事件）
│       │   ├── app-tree/       —— 模型仓库树
│       │   ├── app-sidebar/    —— 整合包列表
│       │   ├── app-preview/    —— 预览面板 + 3D 渲染
│       │   ├── app-toast.js    —— Toast 通知
│       │   └── context-menu.js —— 右键菜单
│       ├── features/           —— 业务功能
│       ├── dialogs/            —— 弹窗（modal/rename/batch-rename）
│       ├── pages/              —— 页面渲染（repository）
│       ├── core/               —— 基础设施（buttons/global-handlers/theme）
│       ├── services/           —— 服务注册
│       ├── utils/              —— 工具函数（display/fmt/dom/icon/summarize/preview-cache）
│       └── wasm/               —— WASM 解码
└── docs/                      ← 文档
    ├── architecture.md        —— 前端架构规范
    ├── bug-chronicle.md       —— 问题排查记录
    ├── release-notes/         —— 版本发版说明
    └── postmortem-*.md        —— 复盘
```

### 组件规范

大组件按职责拆分：

```
app-xxx/
  index.js       # 生命周期编排
  tpl.js         # HTML 模板
  row-tpl.js     # 节点级模板（可选）
  data.js        # 数据逻辑（纯函数）
  render.js      # 渲染逻辑（输入→HTML）
  events.js      # 事件绑定
  utils.js       # 组件工具（可选）
```

小组件（app-nav / app-toast / context-menu）直接单个文件。

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
| [`docs/用户指南.md`](docs/用户指南.md)                               | **用户手册**：安装、配置、功能详解、FAQ   |
| [`docs/architecture.md`](docs/architecture.md)                       | 前端架构规范 + 组件拆分指南               |
| [`docs/roadmap.md`](docs/roadmap.md)                                 | 路线图（P0 ~ P4）                         |
| [`docs/bug-chronicle.md`](docs/bug-chronicle.md)                     | 23 个详细 Bug 排查记录                    |
| [`docs/dev-notes.md`](docs/dev-notes.md)                             | 开发笔记 + 已知陷阱                       |
| [`docs/postmortem-20250604.md`](docs/postmortem-20250604.md)         | 2025-06-04 重构复盘                       |
| [`docs/postmortem-20250605.md`](docs/postmortem-20250605.md)         | 2025-06-05 晚间复盘                       |
| [`AI_INDEX.md`](AI_INDEX.md)                                         | AI 索引（后端绑定 + 事件总线 + 组件清单） |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | AI 行为规则 + 痛苦教训                    |

---

## 🎯 灵感来源

本项目的诸多设计借鉴了以下优秀开源项目：

| 项目                                                                  | 用途                                                                                    | 作者          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------- |
| [LaoYutang/lytvpk](https://github.com/LaoYutang/lytvpk)               | L4D2 MOD 管理器 — **下载与更新**、项目结构、Wails 开发范式                              | LaoYutang     |
| [DrAbcOfficial/YSMViewer](https://github.com/DrAbcOfficial/YSMViewer) | YSM 模型查看器 — **3D 渲染算法**（YSMViewer 的 faceUV/expandBoxUV、骨骼层级、纹理映射） | DrAbcOfficial |
| [YSMParser.Core](https://github.com/OpenYSM/YSMParser)                | YSMParser — **.ysm 文件解析器**                                                         | OpenYSM       |
| Mod Organizer 2                                                       | **仓库 + 硬链接管理模型**的设计理念                                                     | Tannin        |

---

## 📄 许可证

本项目基于 [Apache-2.0](LICENSE) 许可证开源。
