# YSM 模型管理器 — 项目索引

> ⚠️ **本文件已过时（停留在 v1.7.4，实际已 v1.9.3），停止更新。**
> 索引职责已由以下文档取代（后续接入自动化后本文件将归档删除）：
> - 开发者文档入口：`docs/architecture/README.md`
> - 模块知识卡（AI 索引）：`docs/knowledge/index.md`（自动生成）
> - 项目现状：`docs/architecture/PROJECT_STATUS.md`（含 ADR 进行中清单）
> - AI 协作规则：`AGENTS.md`

## 项目概述

YSM 模型管理器是一个专为Minecraft整合包设计的工具，用于管理和同步各种游戏资源（YSM模型、MMD模型、VRC头像、资源包、光影包和蓝图）。项目采用现代Web技术构建，支持桌面应用和游戏内预览功能。

**核心功能**：整合包管理、模型预览、创作者频道、社区索引、资源同步

## 目录结构

### 前端代码
```
frontend/
├── js/
│   ├── bus.js                    # 事件总线系统
│   ├── app-modules.js            # 组件入口 + 右键菜单映射
│   ├── components/               # Web Components (所有UI组件)
│   │   ├── app-tree/             # 树状文件浏览器
│   │   ├── app-sidebar/          # 侧边栏组件
│   │   ├── app-preview/          # 模型预览组件
│   │   ├── app-content/          # 内容区域组件
│   │   ├── app-sync-manager/     # 同步管理器组件
│   │   ├── app-resource-manager/ # 资源管理器组件
│   │   ├── app-nav.js            # 导航组件
│   │   ├── app-toast.js          # 通知组件
│   │   └── context-menu.js       # 右键菜单组件
│   ├── features/                 # 业务功能模块
│   │   ├── import-queue.js       # 拖拽导入队列
│   │   ├── recycle-bin.js        # 回收站管理
│   │   ├── oldest-models.js      # 仓库元老 + 健康度 + 今日推荐
│   │   └── version-updater.js    # 自动更新
│   ├── dialogs/                  # 弹窗组件
│   │   ├── modal.js              # 模态弹窗
│   │   └── rename.js            # 重命名弹窗
│   ├── pages/                    # 页面渲染
│   │   └── repository.js         # 仓库页初始化
│   ├── core/                     # 基础设施
│   │   ├── buttons.js            # 按钮绑定
│   │   ├── global-handlers.js    # 全局事件入口
│   │   ├── handler-dnd.js        # 拖拽导入
│   │   ├── handler-sync.js       # 同步/安装
│   │   ├── handler-upload.js     # 上传
│   │   ├── handler-other.js      # 杂项
│   │   ├── context-menus.js      # 右键菜单映射
│   │   └── theme.js              # 主题切换
│   ├── utils/                    # 工具函数
│   │   ├── display.js            # 文件名渲染
│   │   ├── fmt.js                # 文件大小格式化
│   │   ├── dom.js                # HTML 转义/搜索高亮
│   │   ├── icon.js               # 文件图标映射
│   │   ├── summarize.js          # 模型摘要卡片 HTML
│   │   └── preview-cache.js      # 预览缓存 FIFO
│   └── services/                 # 服务注册
│       └── registry.js          # 全局可替换服务注册
├── css/                          # CSS 样式
│   ├── variables.css            # CSS 变量 + 主题系统
│   ├── layout.css               # 主 grid 布局
│   ├── components.css           # 跨组件通用类
│   └── transitions.css          # 动画过渡
└── vite.config.js               # Vite 构建配置
```

### Go 后端代码
```
go/
├── installer/      # 模型安装
├── sync/           # 整合包同步
├── recycle/        # 回收站管理
├── ysm/            # YSM 解析+摘要
├── watcher/        # 文件监听
├── updater/        # 自动更新
├── paths/          # 路径安全
├── types/          # 共享类型
├── logs/           # 导入日志
├── version/        # 版本号
└── app.go          # Wails Binding 入口
```

### 文档与配置
```
docs/
├── architecture.md              # 项目架构文档
├── Design.md                    # 设计规范
├── release-notes/                # 发版说明
│   ├── v1.7.4.md                # v1.7.4 发版说明
│   └── v1.7.4-compare.md         # v1.7.4 开发者版
├── bug-chronicle.md              # 已知 Bug 和排查路径
├── pending-cleanup.md            # 待清除清单
├── model3d.md                   # 3D 渲染参考
└── model3d-ysm-attempt.js       # YSMViewer 版本备份

.github/
├── workflows/                    # GitHub Actions
│   └── release.yml              # CI/CD 流程
└── copilot-instructions.md       # 战斗手册
```

## 核心组件

### 1. app-tree (文件浏览器)
- **文件数**: 7
- **总行数**: ~320
- **功能**: 文件树状展示、搜索、排序、类型过滤、作者管理、实例操作
- **主要文件**:
  - `index.js` - 生命周期编排
  - `data.js` - 数据逻辑
  - `render.js` - 渲染逻辑
  - `events.js` - 事件绑定
  - `tpl.js` - HTML 模板
  - `loader.js` - 加载逻辑
  - `authors.js` - 作者数据

### 2. app-sidebar (侧边栏)
- **文件数**: 6
- **总行数**: ~230
- **功能**: 版本卡片展示、导入/导出、状态显示、类型筛选
- **主要文件**:
  - `index.js` - 生命周期编排
  - `data.js` - 数据逻辑
  - `render.js` - 渲染逻辑
  - `events.js` - 事件绑定
  - `loader.js` - 加载逻辑
  - `sidebar-css.js` - 样式

### 3. app-preview (模型预览)
- **文件数**: 20+
- **总行数**: ~1,200
- **功能**: 3D模型预览、骨骼导出、纹理查看、模型详细信息、模型加载、缩放预览、日志预览
- **主要文件**:
  - `index.js` - 生命周期编排
  - `preview-3d.js` - 3D 渲染
  - `preview-wasm.js` - WASM 解码
  - `preview-detail.js` - 详情面板
  - `preview-loader.js` - 加载逻辑
  - `preview-zoom.js` - 缩放预览

### 4. app-content (内容区域)
- **文件数**: 8+
- **总行数**: ~1,000
- **功能**: 仓库页面、创作者频道、设置、诊断
- **主要文件**:
  - `index.js` - 生命周期编排
  - `content-css.js` - 样式
  - `tpl.js` - HTML 模板

### 5. app-sync-manager (同步管理器)
- **文件数**: 2
- **总行数**: ~380
- **功能**: 整合包内所有资源类型的同步状态展示
- **主要文件**:
  - `index.js` - 生命周期编排
  - `tpl.js` - HTML 模板

### 6. app-resource-manager (资源管理器)
- **文件数**: 2
- **总行数**: ~150
- **功能**: 资源包管理
- **主要文件**:
  - `index.js` - 生命周期编排
  - `tpl.js` - HTML 模板

## 技术架构

### 三层解耦
```
index.js（编排）
  ├── data.js（纯数据，无 DOM）
  ├── render.js（HTML 生成，无事件）
  └── events.js（事件绑定，无模板）
       ↑ 引用
  tpl.js / row-tpl.js（纯 HTML 模板）
```

### 层间契约

| 文件        | 可以做的                    | 不可以做的            |
| ----------- | --------------------------- | --------------------- |
| `index.js`  | 调 render / bindEvents      | 不写业务逻辑          |
| `data.js`   | 数组操作、判断              | 不碰 DOM              |
| `render.js` | innerHTML / textContent     | 不写 addEventListener |
| `events.js` | addEventListener / bus.emit | 不拼 HTML             |
| `tpl.js`    | HTML 模板字符串             | 不做事件绑定          |

### 共享工具

| 工具函数 | 功能 |
|----------|------|
| `display.js` | 文件名渲染 |
| `fmt.js` | 文件大小格式化 |
| `dom.js` | HTML 转义/搜索高亮 |
| `icon.js` | 文件图标映射 |
| `summarize.js` | 模型摘要卡片 HTML |
| `preview-cache.js` | 预览缓存 FIFO |

## 业务功能模块

| 模块 | 功能 |
|------|------|
| `import-queue.js` | 拖拽导入队列 |
| `recycle-bin.js` | 回收站管理 |
| `oldest-models.js` | 仓库元老 + 健康度 + 今日推荐 |
| `version-updater.js` | 自动更新 |

## 页面级初始化

| 页面 | 功能 |
|------|------|
| `repository.js` | 仓库页初始化 |

## 服务注册

| 服务 | 功能 |
|------|------|
| `registry.js` | 全局可替换服务注册 |

## 基础设施

| 模块 | 功能 |
|------|------|
| `buttons.js` | 按钮绑定（旧入口，逐步废弃） |
| `global-handlers.js` | 全局事件入口 |
| `handler-dnd.js` | 拖拽导入 |
| `handler-sync.js` | 同步/安装 |
| `handler-upload.js` | 上传 |
| `handler-other.js` | 杂项 |
| `context-menus.js` | 右键菜单映射 |
| `theme.js` | 主题切换 |

## 构建与部署

### CI/CD 流程

```bash
# push/pr 到 main 时
- go vet ./go/...
- go test ./go/... -count=1

# tag v* 时
- 上述 + Wails 构建
- 打包 ZIP → GitHub Release
```

### 构建命令

```powershell
# Go 改了
wails build -clean -ldflags "-X ysm-model-manager/go/version.Version=v1.x.x"

# 前端改了
npx vite build

# 复制到 release 目录
Copy-Item "build\bin\YSM-Model-Manager.exe" "build\release\"
Copy-Item "workshop_sites.json", "creators.json" "build\release\"
Compress-Archive -Path "build\release\*" -DestinationPath "build\release\YSM-Model-Manager_windows_amd64.zip" -Force
```

## 设计规范

### CSS 变量体系

```css
--bg:       /* 最底层背景 */ --surf: /* 表面背景（侧栏、顶栏） */
  --card: /* 卡片背景 */ --hover: /* hover 状态背景 */
  --act: /* active/选中状态背景 */
  --accent: /* 强调色（链接、选中、关键按钮） */ --txt: /* 主文字色 */
  --muted: /* 次要文字色 */ --bd: /* 边框色 */;
```

### 动画/过渡

```css
transition: background 0.15s, color 0.15s;   /* 按钮 hover */
transition: grid-template-columns 0.18s ease; /* 布局变化 */
transition: opacity 0.2s;                     /* 淡入淡出 */
```

### 语义化字号变量（按 UI 角色）

| 变量 | 值 | 应用元素 |
|------|-----|----------|
| `--fs-nav` | 13px | `.repo-tab` 导航主标签 |
| `--fs-tab` | 12px | `.repo-subtab` `.sm-tab` 子标签 |
| `--fs-filter` | 11px | `.sm-status-tab` 筛选标签 |
| `--fs-btn-primary` | 12px | `.hdr-btn` `.btn` 主要按钮 |
| `--fs-btn-secondary` | 11px | `.sm-item-btn` 次要/行内按钮 |
| `--fs-btn-tool` | 10px | `.repo-bar-btn` 工具栏按钮 |

## 关键约束

### 1. 改前读文件
禁止基于记忆修改。每次改文件前先 `grep_search` / `read_file` 确认最新状态。

### 2. 改完立即 build
```powershell
# Go 改了
go build ./go/... 2>&1 | Select-String error

# 前端改了
cd frontend ; npx vite build 2>&1 | Select-String error
```

### 3. 唯一性检查
改文件前先 `grep` 确认没有同名文件在 `public/` 下（Vite dev 优先加载 `public/`）。

### 4. 日志优先于猜测
遇到"逻辑对但没反应"，先加 `console.log` 看实际值，不要猜原因。

## 翻译计划

### 翻译计划文件
`YSM-UI-Translation-Plan.md` - 完整的UI翻译实施方案，包括翻译工作范围、实施方案、文件结构和集成步骤。

### 翻译文件结构
```
frontend/
├── js/
│   ├── i18n.js          # 翻译初始化和工具
│   └── locales/          # 翻译文件
│       ├── en.json      # 英语（默认）
│       ├── zh-CN.json   # 简体中文
│       ├── zh-TW.json   # 繁体中文
│       ├── ja.json      # 日语
│       └── es.json      # 西班牙语
```

## 参考文档

### 内部文档
- `docs/architecture.md` - 项目架构
- `docs/Design.md` - 设计规范
- `docs/release-notes/` - 发版说明
- `docs/bug-chronicle.md` - 已知 Bug 和排查路径
- `docs/pending-cleanup.md` - 待清除清单

### 外部资源
- `frontend/js/wasm/ysm-wasm-data.js` - WASM 数据（base64 编码）
- `frontend/js/bus.js` - 事件总线
- `frontend/vite.config.js` - Vite 配置
- `build-release.ps1` - 发版脚本
- `scripts/smoke-test.ps1` - 集成测试

## 开发指南

### 组件开发规范

1. **每个组件目录 = 1 个标签 + 1 个目录 + 若干文件，每文件 ≤ 80 行。**
2. **模板与数据分离**：`data.js` 不碰 DOM
3. **通用工具引用** `js/utils/` 而非重写
4. **所有新组件为 ESM**（使用 `export`/`import`）
5. **在 `app-modules.js` 中通过 `import` 引入**，不在 `index.html` 加 `<script>` 标签
6. **禁止在 `public/` 目录放置 JS 文件**

### 3D 渲染标准

- **只用 YSMViewer 、 BlockBench的 `expandBoxUV` + 自定义 `BufferGeometry`**，禁止使用旧版 `applyBoxUV`/`applyFaceUV` + `BoxGeometry`
- **UV 坐标不翻转 V**（`tex.flipY = false` 时，`v0 = fv / texH` 直接使用，不加 `1 -`）
- **Origin X 不取反**（匹配 YSMViewer `ThreeJsPayloadBuilder.cs` 的 `cube.Origin.X - cube.Size.X`）
- **vertex 顺序**: YSMViewer 的 East/West/Up/Down/South/North
- **Mesh 位置 = `cube.pivot`**（顶点已相对 pivot 偏移，Group 在原点）

### 致命陷阱

1. **Go 改后必须重建**：Wails Binding 是编译二进制，改 Go 文件后必须 `wails build` / `go build .` + 重启。
2. **全局事件必须放在常驻组件**：`sync:download-missing` 等 handler 放 `app-tree` 会随页面切换消失。必须放 `app-content/index.js` 的 `_registerGlobalHandlers()`。
3. **按钮状态恢复 — 始终用 `finally`**：异步操作失败后按钮卡死的根因是没走 finally。emit 完成事件只放 finally，不放 try 末尾。

## 项目状态

### 当前版本
- **版本**: v1.7.4
- **状态**: 开发中
- **主要功能**: 整合包管理、模型预览、创作者频道、社区索引

### 近期变更
- **v1.7.4**: 社区站点视图迁移至 Go 后端 + 下载后增量提取头像 + 同步管理器 UI 动画化
- **v1.7.3**: 创作者频道空状态死循环修复 + PR #7 合并
- **v1.7.0**: 创作者频道 UI 翻新 + 头像缓存优化 + 样式调整

## 联系方式

### 开发交流
- GitHub Issues
- 项目文档
- 团队协作工具

### 支持
- 常见问题
- 故障排查
- 社区论坛

---

*本索引由 AI 助手生成，用于快速了解项目结构和开发指南。*