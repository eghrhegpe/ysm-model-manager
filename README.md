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
| 🎨 创作者频道 | 创作者浏览、渐变头像、预设搜索、内嵌浏览器 |
| 🧩 创意工坊   | GitHub 在线仓库列表、一键下载              |
| 👴 仓库元老   | 健康度评分、资历最深、月度热力图、今日推荐 |
| 🛠️ 诊断与冲突 | 操作日志、模型去重（可选保留）、冲突检测   |
| ⚙️ 设置       | 卡片化设置、"关于"主页、主题与字体配置     |

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
- **渐变头像边框**：作品数越高边框越亮，conic-gradient 渐变 + 呼吸灯动画
- **预设搜索**：一键搜索 B站 YSM 免费模型 / YSM 模型分享、爱发电 YSM
- **内嵌/外链模式**：pill 式切换开关，tab 栏右侧
- **导入/导出**：站点和创作者 JSON 导入导出，支持合并和覆盖模式

### 🧩 创意工坊

<p align="center"><img src="docs/preview/创意工坊.png" width="80%" alt="创意工坊"></p>

- **GitHub 在线仓库**：读取远程仓库的 `index.json` 在线浏览模型列表
- **一键下载**：⬇️ 直接从 GitHub 下载模型到本地仓库
- **仓库管理**：支持添加/删除 GitHub 仓库源

### 👴 仓库元老

<p align="center"><img src="docs/preview/仓库元老.png" width="80%" alt="仓库元老"></p>

- **健康度评分**：综合禁用率和重复率计算（100 分制），conic-gradient 环形展示 + 呼吸动画
- **月度活动热力图**：一年 12 个月的活动分布一目了然
- **资历最深**：仓库中最早创建的 10 个模型
- **今日推荐**：每日随机推荐一个模型

### 🔄 自动更新

<p align="center"><img src="docs/preview/自动更新.png" width="80%" alt="自动更新"></p>

- 启动时自动检查 GitHub Releases（6 小时限频）
- 检测到新版本右下角 toast 提示，点击弹出更新确认
- 聚合显示所有跳过的版本更新日志
- Go 原生替换：os.Rename 备份 + 解压覆盖，无黑框

### 🛠️ 诊断与冲突

- **操作日志**：所有安装/导入/删除操作 + 失败原因分行显示
- **模型去重**：仓库内按 SHA256 查重，**逐组选择保留哪个副本**，其余入回收站
- **冲突检测**：扫描同名文件存在于多个整合包

### ⚙️ 设置

<p align="center"><img src="docs/preview/设置页.png" width="80%" alt="设置页"></p>

- **卡片化布局**：存储策略 & 下载镜像双栏并排，字体与布局三栏并排
- 🎮 游戏根目录 — 📂 选择 / 🔍 自动搜索 `.minecraft`（检测 versions/assets 等特征）
- 📁 模型仓库路径 — 📂 选择
- 🔗 链接模式 — 下拉菜单选择（复制 / 硬链接 ✅ / 符号链接 ❌），切换后自动重新链接
- 🌐 下载镜像源 — 直连 / jsDelivr CDN / GitHub API，切换时显示详细提示
- 🌙 主题模式 — 💻 跟随系统 / 🌙 赛博霓虹 / ☀️ 温暖木纹 / ⚪ 极简深邃
- 🗑️ 回收站 — 列出/恢复/删除/清空（符号链接直接删、硬链接直接删、普通文件移入 `.recycle`）
- 导航状态持久化（启动恢复上次页面）
- 窗口大小/位置记忆（关闭时 Go 端保存）

### ℹ️ 关于

<p align="center"><img src="docs/preview/关于.png" width="80%" alt="关于"></p>

- 卡片式展示项目定位、技术栈、资源链接
- **快速上手**五步指引：设置目录 → 拖入模型 → 自动归档 → 安装到整合包 → 加载资源包
- **灵感来源**：lytvpk（下载）、YSMViewer（3D 渲染）、YSMParser（解析）、Mod Organizer 2（仓库管理）

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

本工具集成 [YSMParser](https://github.com/OpenYSM/YSMParser) 用于解码加密 .ysm 模型：

- **解码流程**：优先通过 **内嵌 WASM** 直接在浏览器中解码（`YSMParser.wasm` + 胶水代码），失败时降级调用 CLI `YSMParser.exe` 子进程
- **WASM 内嵌**：WASM 二进制以 base64 编码打包在 `ysm-wasm-data.js` 中，无需额外下载，启动即加载
- **兼容性**：支持数组 `[u,v]` 和对象 `{face:{uv,uv_size}}` 两种 UV 格式
- **隐私声明**：解码仅在本地进行，不联网、不存储、不导出模型文件

> 💡 v1.0.9+ 已默认内嵌 WASM，无需额外下载 YSMParser.exe。CLI 仅作为开发调试的 fallback，发版包不再包含。

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
│   ├── threejs/               —— 3D 骨骼数据构建
│   ├── watcher/               —— 文件监听器（fsnotify 实时同步 .ban）
│   ├── updater/               —— 自动更新
│   ├── version/               —— 版本号（编译时注入）
│   ├── paths/                 —— 路径安全校验
│   └── types/                 —— 共享类型
├── frontend/                  ← 前端源码
│   ├── index.html
│   ├── css/
│   │   ├── variables.css      —— CSS 变量（4 套主题 + 字体系统）
│   │   ├── layout.css         —— 主布局 + 侧栏
│   │   └── components.css     —— 全局组件样式（部分已迁移至 Shadow DOM）
│   └── js/
│       ├── bus.js              —— 事件总线（跨 Shadow DOM 通信）
│       ├── app-modules.js      —— 全局入口 + 右键菜单映射
│       ├── components/         —— Web Components（Shadow DOM）
│       │   ├── app-nav.js      —— 左侧导航菜单
│       │   ├── app-content/    —— 主内容区（页面路由 + 全局事件）
│       │   ├── app-tree/       —— 模型仓库树
│       │   ├── app-sidebar/    —— 整合包列表
│       │   ├── app-preview/    —— 预览面板 + 3D/2D 渲染
│       │   ├── app-toast.js    —— Toast 通知
│       │   └── context-menu.js —— 右键菜单
│       ├── features/           —— 业务功能（import-queue / recycle-bin / workshop 等）
│       ├── dialogs/            —— 弹窗（modal/rename/batch-rename）
│       ├── pages/              —— 页面渲染（repository）
│       ├── core/               —— 基础设施（handler-dnd/handler-sync/theme/context-menus）
│       ├── services/           —— 服务注册
│       ├── utils/              —— 工具函数（display/fmt/dom/icon/summarize/preview-cache）
│       └── wasm/               —— YSMParser WASM 解码（ysm-wasm-data.js）
└── docs/                      ← 文档
    ├── architecture.md        —— 前端架构规范
    ├── Design.md              —— UI 设计规范（CSS 变量、布局、字体）
    ├── bug-chronicle.md       —— 问题排查记录
    ├── release-notes/         —— 版本发版说明
    ├── postmortem-*.md        —— 复盘
    ├── preview/               —— README 截图
    └── plan-p7-*.md           —— 未来计划
```

### 组件规范

大组件按职责拆分（以 `app-content` 为例）：

```
app-content/
  index.js          # 生命周期编排、页面路由、全局事件
  tpl.js            # HTML 模板（全部页面）
  content-css.js    # Shadow DOM 样式表
  workshop-*.js     # 创作者频道相关子模块
```

小组件（`app-nav` / `app-toast` / `context-menu`）直接单个文件。

---

## 🚀 开发

```bash
# 安装依赖
cd frontend && npm install

# 开发模式（前端热重载）
wails dev

# 仅构建前端
cd frontend && npx vite build

# 编译 Go 包
go build ./go/...

# 完整构建（生产）
wails build -ldflags "-X ysm-model-manager/go/version.Version=vX.X.X"
```

**注意**：

- 修改 Go 文件后必须 `go build ./go/...` + `wails build` 并重启
- 前端非 module 脚本需在 `app-modules.js` 中 import，禁止在 `index.html` 加 `<script>`
- 修改 CSS 变量或全局样式后需刷新（Vite 热重载）

---

## 📖 文档索引

| 文档                                                                 | 内容                                      |
| -------------------------------------------------------------------- | ----------------------------------------- |
| [`docs/用户指南.md`](docs/用户指南.md)                               | **用户手册**：安装、配置、功能详解、FAQ   |
| [`docs/architecture.md`](docs/architecture.md)                       | 前端架构规范 + 组件拆分指南               |
| [`docs/Design.md`](docs/Design.md)                                   | UI 设计规范（CSS 变量、布局、字体）       |
| [`docs/bug-chronicle.md`](docs/bug-chronicle.md)                     | Bug 排查记录（含 Debug Path Review）      |
| [`docs/dev-notes2026-06-05.md`](docs/dev-notes2026-06-05.md)         | 开发笔记 + 已知陷阱                       |
| [`docs/plan-p7-multi-resource.md`](docs/plan-p7-multi-resource.md)   | P7 计划：多资源类型支持 + 图标库设计      |
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
