<!-- 本文件由 scripts/gen-knowledge-index.mjs 自动生成，禁止手改 -->

# 知识卡索引

> 总计: 69 张知识卡

> 用途: AI 代理根据分类 + 关键词定位知识卡，摘要提供快速上下文。

## config（1 张）

*配置与注册表（resource_types、AppConfig）*

| 标识 | 名称 | tier | 关键词 |
|------|------|------|--------|
| 🏗 resource-registry | 资源注册表 registry | architecture | 资源类型, 注册表, resource_types, registry, 文件类型 |

### 摘要

- **resource-registry**（资源注册表 registry）：`resource_types.json` 是 YSM 资源类型定义的单一事实来源（Single Source of Truth）。所有资源类型、子目录、扩展名的定义均以此处为准。

## core（5 张）

*核心基础设施（事件总线、页面状态、Wails 桥接）*

| 标识 | 名称 | tier | 关键词 |
|------|------|------|--------|
| 🏗 event-bus | 事件总线 bus.ts | architecture | 事件, 事件总线, 通信, emit, 跨组件通信, bus |
| 🏗 global-handlers | 全局事件处理 global-handlers | architecture | 全局事件, 拖拽导入, 拖拽遮罩, 同步缺失, 清空整合包, 导出清单 |
| 🏗 page-store | 页面状态管理 page-store.ts | architecture | 页面, 当前页, 状态管理, page store, currentPage |
| 🍃 theme | 主题系统 theme | leaf | 主题, 换肤, 深色, 浅色, 跟随系统, 动画开关, 字号, 界面偏好 |
| 🏗 wails-bridge | Wails 桥接 app.ts | architecture | Wails, 桥接, getApp, Go 调用, Binding, window.go.main.App |

### 摘要

- **event-bus**（事件总线 bus.ts）：`bus.ts` 是 YSM 前端的唯一事件中枢，基于发布/订阅模式。所有跨组件、跨页面的异步通信都经过此总线，避免组件间直接耦合。
- **global-handlers**（全局事件处理 global-handlers）：`core/handlers/global.ts` 是全应用唯一的全局 handler 注册入口（致命陷阱 #2 的解法）：app-content 的 `connectedCallback` 调一次 `registerGlobalHandl…
- **page-store**（页面状态管理 page-store.ts）：`page-store.ts` 管理 YSM 的前端页面导航状态，是 `PageStore.currentPage` 的唯一数据源，替代了旧版 `window.__currentPage`。
- **theme**（主题系统 theme）：主题系统的实现在组件入口 `app-modules.ts`（无独立 theme.ts 文件）：提供 6 套主题皮肤（cyber/warm/pro/sakura/ocean/mint）+ `system` 跟随系统模式，全部通过在 `<bod…
- **wails-bridge**（Wails 桥接 app.ts）：`wails/app.ts` 是前端调用 Go Binding 的唯一入口。所有 Go 端方法通过 `getApp()` 获取，禁止直接通过 `window.go.main.App` 访问。

## feature（6 张）

*业务功能（导入队列、同步、社区）*

| 标识 | 名称 | tier | 关键词 |
|------|------|------|--------|
| 🏗 community-feature | 社区下载 community | architecture | 创意工坊, 社区, 下载队列, 镜像源, 批量下载, github 仓库, 下载进度, workshop |
| 🏗 import-queue | 导入队列 import-queue | architecture | 导入, 导入队列, 拖拽导入, 命名表单, 文件夹导入, 覆盖导入, import |
| 🍃 oldest-models | 资历最深模型 oldest-models | leaf | 资历最深, 老模型, 仓库评分, 每日推荐, 月度活动, 热力图, 仓库健康 |
| 🏗 recycle-bin | 回收站界面 recycle-bin | architecture | 回收站, 恢复文件, 清空回收站, 软删除, recycle, 还原 |
| 🏗 resource-packs | 资源包功能 resource-packs | architecture | 资源包, 光影包, 蓝图, 投影, resourcepack, shaderpack, 资源管理 |
| 🏗 version-updater | 版本更新 version-updater | architecture | 更新, 升级, 检查更新, 新版本, 静默检查, updater, 版本 |

### 摘要

- **community-feature**（社区下载 community）：`features/community/` 是创意工坊（GitHub 模型仓库）浏览与批量下载的前端业务层，四个文件分工：`data.ts` 抓取远端 index.json（多镜像竞速）、`render.ts` 渲染站点卡片与模型列表、`e…
- **import-queue**（导入队列 import-queue）：导入分两层：**全局导入执行器 `import-executor.ts`（一等公民）** 负责真正的落盘（`directImport` 单文件直导 / `importFolder` 文件夹整组 / `executeCollected` 批量…
- **oldest-models**（资历最深模型 oldest-models）：`oldest-models.ts` 实现仓库页「资历」tab（diagnostics/oldest 页面）的仪表盘：围绕 `ScanModelEntries` 扫描结果做本地统计，渲染四大板块——仓库评分（健康环）、资历最深 Top4（按…
- **recycle-bin**（回收站界面 recycle-bin）：`recycle-bin.ts` 实现仓库页「回收站」tab 的界面逻辑：列出 `.recycle` 中属于当前资源类型的已删除条目，提供单条恢复/永久删除、一键清空。由 app-content 首次切到 recycle tab 时懒加载调…
- **resource-packs**（资源包功能 resource-packs）：`resource-packs.ts` 是一个薄 wrapper：把仓库页的各类资源包 tab（资源包/光影包/蓝图/MMD/VRC/投影）统一委托给 `<app-resource-manager>` 组件渲染。文件本身不含业务逻辑，仅负责…
- **version-updater**（版本更新 version-updater）：`version-updater.ts` 是应用自更新的前端入口：启动时静默检查（受 6 小时频次限制）→ 发现新版本以可点击 toast 通知；设置页按钮手动检查 → 弹出带更新日志的 `modalConfirm` → 调 `DoUpda…

## go（25 张）

*Go 后端包（安装、下载、回收站、YSM 解析等）*

| 标识 | 名称 | tier | 关键词 |
|------|------|------|--------|
| 🏗 go-avatar | 头像 go/avatar | architecture | 头像, 作者, 创作者, avatar, 缓存, 缩略图 |
| 🏗 go-dedup | 去重 go/dedup | architecture | 去重, 重复检测, dedup |
| 🏗 go-download | 下载器 go/download | architecture | 下载, 进度, download, 进度条, 下载进度 |
| 🍃 go-errors | 错误包装 go/errors | leaf | 错误, 中文提示, friendly, 报错, toast |
| 🏗 go-fileops | 文件操作 go/fileops | architecture | 移动, 复制, 重命名, 删除, fileops, 启用禁用, .ban, ysm.json 整组操作 |
| 🍃 go-fsutil | 文件遍历 go/fsutil | leaf | 遍历, 目录, walk, 空目录, 文件数 |
| 🏗 go-geometry | Geometry 存档 go/geometry | architecture | geometry, 基岩版, bedrock, 模型解析, zip, 7z, 纹理, 动画 |
| 🏗 go-importer | 导入策略 go/importer | architecture | 导入, 策略, 导入队列, importer |
| 🏗 go-installer | 模型安装 go/installer | architecture | 安装, installer, 模型导入, 下载模型 |
| 🏗 go-instance | 整合包实例 go/instance | architecture | 整合包, 实例, 版本实例, VersionInstance, 同步项, BuildSyncItems, 资源同步 |
| 🏗 go-litematic | Litematic 解析 go/litematic | architecture | 投影, litematic, schematic, nbt, 蓝图, 体素, 方块 |
| 🏗 go-logs | 导入日志 go/logs | architecture | 导入日志, 操作记录, 日志, import log, 历史 |
| 🏗 go-packs | 资源包 mcmeta go/packs | architecture | 资源包, 光影包, mcmeta, pack_format, 缩略图, 类型检测 |
| 🏗 go-paths | 路径安全 go/paths | architecture | 路径, 安全, path, 路径校验 |
| 🏗 go-recycle | 回收站 go/recycle | architecture | 回收站, 删除, 恢复, recycle, 软删除 |
| 🏗 go-scanner | 扫描核心 go/scanner | architecture | 扫描, 扫描条目, 文件树, 哈希, 缓存, 作者提取, ScanEntries, 索引生成 |
| 🏗 go-sync | 整合包同步 go/sync | architecture | 整合包, 同步, 实例, 硬链接, 符号链接, 缺失, 多余, .ban, PrismLauncher |
| 🏗 go-tags | 标签系统 go/tags | architecture | 标签, tag, 分类, 筛选, tag-editor |
| 🏗 go-threejs | 3D 骨骼 spec go/threejs | architecture | 3D 预览, 骨骼, three.js, spec, 顶点, UV, 四元数, 模型渲染 |
| 🏗 go-types | 共享类型 go/types | architecture | 共享类型, AppConfig, 配置, 注册表, 扩展名, LinkType, BedrockModel |
| 🏗 go-updater | 自动更新 go/updater | architecture | 更新, 自动更新, 版本升级, updater |
| 🍃 go-version | 版本号 go/version | leaf | 版本, version, 更新, ldflags |
| 🏗 go-watcher | 文件监听 go/watcher | architecture | 监听, 文件变化, 刷新, watcher |
| 🏗 go-ysm-parser | YSM 解析 go/ysm | architecture | YSM, 解析, 摘要, ysm 文件, 元数据 |
| 🏗 wails-bindings | Wails Binding API 总览 internal/app | architecture | API, Binding, 接口, Go 方法, 调用后端, 有哪些方法, App 方法, getApp, 方法签名, app.ts 绑定 |

### 摘要

- **go-avatar**（头像 go/avatar）：`go/avatar/` 包负责创作者头像的提取与缓存：从模型文件（.ysm 二进制 / .zip / 解压目录 .json）的 `metadata.authors[].avatar` 声明中取出头像图片，缓存到 exe 同目录 `crea…
- **go-dedup**（去重 go/dedup）：`go/dedup/` 包提供资源去重检测，避免重复导入相同资源。
- **go-download**（下载器 go/download）：`go/download/` 包负责模型资源的纯 HTTP 下载（不依赖 Wails runtime），支持 ctx 取消中断、进度回调与失败半文件清理。镜像回退策略（raw/jsd/api 排序）在 `internal/app/app_d…
- **go-errors**（错误包装 go/errors）：`go/errors/` 是纯工具小包，把英文系统错误转换为用户能看懂的中文提示（权限不足/文件被占用/磁盘空间不足等），服务于「所有异常路径必须有 toast 反馈」的 UI 安全红线。
- **go-fileops**（文件操作 go/fileops）：`go/fileops/` 包实现文件 CRUD + 移动/复制/删除 + 文件夹整组导入 + 预览提取 + 启用禁用（ADR-003 P3 下沉，薄壳 `internal/app/app_files.go` 仅转发）。
- **go-fsutil**（文件遍历 go/fsutil）：`go/fsutil/` 是纯工具小包，集中管理 `WalkDir` 逻辑：递归收集文件/目录路径、统计文件数、清理空目录，并内置对 `.recycle` 回收站目录的跳过开关。
- **go-geometry**（Geometry 存档 go/geometry）：`go/geometry/` 包解析 Bedrock（基岩版）`minecraft:geometry` 模型：既支持单个 geometry JSON，也支持从 ZIP/7z 存档中按 `ysm.json` 清单合并多个模型文件、提取纹理与动…
- **go-importer**（导入策略 go/importer）：`go/importer/` 包分两块：`importer.go` 的**按资源类型注册的复制策略表**（`Handler` 接口，供本地路径导入/安装复用），以及 `importer_file.go` 的 **base64 单文件导入核心…
- **go-installer**（模型安装 go/installer）：`go/installer/`（单文件 `installer.go`）负责把仓库中的模型/资源文件**落地**到 Minecraft 整合包实例目录：按 `LinkMode`（`copy` / `hardlink` / `symlink`）…
- **go-instance**（整合包实例 go/instance）：`go/instance/` 包处理整合包（Minecraft 版本实例）的资源同步项构建，是 `app_install.go` 中 `GetResourceInstanceStatus` 等 Binding 的下沉逻辑。
- **go-litematic**（Litematic 解析 go/litematic）：`go/litematic/` 包解析 Minecraft 建筑蓝图文件：Litematica 投影（`.litematic`，NBT gzip）、MCEdit 旧版 `.schematic`、原版结构 `.nbt`，产出元数据、方块统计（…
- **go-logs**（导入日志 go/logs）：`go/logs/` 包提供两套互不相干的日志设施：**操作日志**（`Logger`，持久化）把导入/扫描/下载/同步/重命名/删除/UI 报错等操作的成败结果写入用户配置目录下的 `ysm-import-logs.json`；**运行时…
- **go-packs**（资源包 mcmeta go/packs）：`go/packs/` 包解析 Minecraft 资源包/光影包的 `pack.mcmeta`（目录或 ZIP 两种形态），提取 pack_format 版本信息与 pack.png 缩略图，并承担「一个文件到底属于哪种资源类型」的内容级…
- **go-paths**（路径安全 go/paths）：`go/paths/` 包提供路径安全校验，防止路径穿越攻击和非法路径访问。
- **go-recycle**（回收站 go/recycle）：`go/recycle/` 包实现模型的软删除机制，通过硬链接/符号链接判定 + `.recycle` 目录实现可恢复删除。核心是 `TrashManager` 结构体（`New(root)` → `root/.recycle`），包级函数…
- **go-scanner**（扫描核心 go/scanner）：`go/scanner/` 包实现仓库文件扫描、哈希计算、缓存失效、作者提取、索引生成（ADR-003 P2 下沉，薄壳 `internal/app/app_scan.go` 仅保留依赖 App 的方法）。
- **go-sync**（整合包同步 go/sync）：`go/sync/` 包负责模型库（全局仓库）与 Minecraft 整合包实例之间的同步：发现实例（原版 / PrismLauncher 布局）、按 SHA256 哈希对比出缺失/多余/禁用文件、按文件名或文件夹对比资源包差异、检测目标文…
- **go-tags**（标签系统 go/tags）：`go/tags/` 包提供模型标签的线程安全持久化存储，是前端 tag-editor 弹窗的后端。标签存放在配置目录的 `tags.json`，以文件绝对路径为 key、标签列表为 value，与模型文件本身解耦（移动/链接模型不污染文件…
- **go-threejs**（3D 骨骼 spec go/threejs）：`go/threejs/` 包根据 YSMViewer 的 `ThreeJsPayloadBuilder.cs` 移植，把已解析的 `types.BedrockModel` 转换为 Three.js 可直接消费的 JSON spec：顶点、…
- **go-types**（共享类型 go/types）：`go/types/` 包是全应用的共享类型层：应用配置（AppConfig）、各子系统交换的数据结构（模型条目/实例状态/同步结果/日志/投影元数据等）、以及资源类型注册表的 Go 端加载与扩展名查询。与 [resource_regist…
- **go-updater**（自动更新 go/updater）：`go/updater/` 包负责 YSM 应用的自动更新机制。
- **go-version**（版本号 go/version）：`go/version/` 只有一件事：持有应用版本号。默认 `"dev"`，发版构建时通过 `-ldflags -X` 注入正式版本，供界面展示与自动更新的版本比较。
- **go-watcher**（文件监听 go/watcher）：`go/watcher/` 包监听资源目录的文件系统变化，触发前端资源树刷新。
- **go-ysm-parser**（YSM 解析 go/ysm）：`go/ysm/` 包负责解析 YSM（Yuan's Sketch Model）格式文件，提取模型元数据并生成结构化摘要。
- **wails-bindings**（Wails Binding API 总览 internal/app）：`internal/app/` 是 Go 端唯一的 Wails Binding 入口层：所有导出给前端的方法都定义在 `*App` 上，业务逻辑下沉到 `go/*` 包，本层只做参数转发与窗口/事件/对话框编排。前端统一经 `getApp(…

## ui（17 张）

*前端 UI 组件（tree、sidebar、preview、content）*

| 标识 | 名称 | tier | 关键词 |
|------|------|------|--------|
| 🏗 app-content | 主内容页 app-content | architecture | 主内容区, 页面切换, nav:change, 仓库页, 诊断页, 设置页, 创作者频道, 创意工坊, 全局 handler |
| 🏗 app-modules | 组件入口 app-modules | architecture | 组件入口, 模块装配, 启动流程, 主题初始化, 服务注册, 检查更新, import 组件, 新组件注册 |
| 🍃 app-nav | 顶部导航 app-nav | leaf | 导航栏, 导航, 切页, nav:change, 菜单, 页面记忆, 版本号 |
| 🏗 app-preview | 预览面板 app-preview | architecture | 预览, 模型预览, 2D 骨骼, 3D 预览, Litematic, 蓝图, 缩略图, WASM 解码, 放大预览 |
| 🏗 app-resource-manager | 资源管理页 app-resource-manager | architecture | 资源管理, 资源包, 光影包, resourcepack, shaderpack, 导入资源, 启用禁用, 通用资源 |
| 🏗 app-sidebar | 侧边栏 app-sidebar | architecture | 侧边栏, 整合包列表, 版本卡片, 推送, 拉取, 一键安装, 同步状态, 勾选 |
| 🏗 app-sync-manager | 整合包同步页 app-sync-manager | architecture | 整合包同步, 同步状态, 推送资源, 拉取资源, 待推送, 可拉取, 已禁用, 实例资源 |
| 🍃 app-toast | Toast 通知 app-toast | leaf | toast, 通知, 提示, 消息, 撤销, 反馈, 报错提示 |
| 🏗 app-tree | 资源树 app-tree | architecture | 树形, 资源列表, tree, 节点, 树, 目录树 |
| 🏗 context-menu | 右键菜单系统 | architecture | 右键菜单, 右键, 上下文菜单, ctx:show, menu:show, 批量操作, 移入回收站, 重命名 |
| 🍃 dialog-adv-filter | 高级筛选 adv-filter | leaf | 高级筛选, 筛选, 骨骼数, 立方体, 纹理尺寸, 按标签筛选, 条件过滤 |
| 🏗 dialog-batch-rename | 批量重命名 batch-rename | architecture | 批量重命名, 批量改名, 查找替换, 正则替换, 统一作者, 预设, batch-rename |
| 🏗 dialog-modal | 弹窗基座 modal | architecture | 弹窗, 对话框, 确认框, 输入框弹窗, 下拉选择弹窗, modal, prompt, confirm |
| 🍃 dialog-rename | 重命名弹窗 rename | leaf | 重命名, 改名, 命名规范, 作者 品牌 角色, rename, 读取头部 |
| 🏗 dialog-tag-editor | 标签编辑器 tag-editor | architecture | 标签, 打标签, 编辑标签, tag, 标签弹窗, 分类标记 |
| 🍃 shared-styles | 共享样式 shared-styles | leaf | 共享样式, 按钮样式, btn-base, focus-visible, tree 样式, Shadow DOM 样式, CSS 变量 |
| 🏗 test-utils | 测试工具 test-utils（G-1 抗脆弱测试基础设施） | architecture | 测试工具, testid, getByTestId, waitFor, 组件测试, mock, G-1 |

### 摘要

- **app-content**（主内容页 app-content）：`app-content` 是应用的主内容区组件（Shadow DOM + adoptedStyleSheets），承载 6 个页面：模型仓库（repository）、整合包管理（instances）、创作者频道（workshop）、创意工…
- **app-modules**（组件入口 app-modules）：`app-modules.ts` 是前端所有 ES module 组件的统一装配入口：注册可替换服务、按「轻量静态 + 重量级动态」策略导入全部 Web Components、注册右键菜单映射、初始化主题与 UI 偏好、静默检查更新。新增组…
- **app-nav**（顶部导航 app-nav）：`app-nav` 是应用的主导航菜单组件（Shadow DOM，渲染为左侧固定栏），列出模型仓库、整合包管理、创作者频道、创意工坊、诊断与冲突、设置 6 个入口，底部显示应用版本号。它是 `nav:change` 事件的唯一派发源，并在启…
- **app-preview**（预览面板 app-preview）：`app-preview` 是仓库页右侧的预览面板组件（Shadow DOM），负责 YSM 模型的详情/2D 骨骼/3D 预览、Litematic 蓝图 3D 预览、资源包与光影包信息展示。它按 `model:select` 事件驱动，解…
- **app-resource-manager**（资源管理页 app-resource-manager）：`app-resource-manager` 是通用资源管理组件（light DOM），以 `rtype` 属性驱动，管理资源包/光影包及未来任意注册类型的列表、详情、导入、启用/禁用与删除。类型行为（可用操作、扩展名、安装目录）全部从 `…
- **app-sidebar**（侧边栏 app-sidebar）：`app-sidebar` 是仓库页左栏的整合包列表组件（Shadow DOM），展示当前资源类型下各整合包（Minecraft 版本实例）的同步状态卡片，支持选中联动、勾选批量推送/拉取、一键安装缺失资源。它遵循标准组件拆分规范（inde…
- **app-sync-manager**（整合包同步页 app-sync-manager）：`app-sync-manager` 是整合包管理页内嵌的同步状态面板（light DOM），由 `app-content` 在收到 `package:selected` 后以 `<app-sync-manager instance="版本…
- **app-toast**（Toast 通知 app-toast）：`app-toast` 是全局 Toast 通知组件（Shadow DOM，固定悬浮于视口底部居中），是全应用唯一的操作反馈出口。治理红线要求所有异常路径必须有 toast 反馈，各模块统一通过 `bus.emit("toast:show"…
- **app-tree**（资源树 app-tree）：`app-tree` 是 YSM 核心的资源目录树组件，使用 Web Components 实现，支持展开/折叠、右键菜单、文件图标显示。
- **context-menu**（右键菜单系统）：右键菜单系统采用「声明与行为分离」的三层结构：`menu-defs.ts` 声明菜单结构（唯一事实来源），`core/context-menus.ts` 把 `ctx:show` 事件翻译成带行为的 `menu:show` 载荷，`view…
- **dialog-adv-filter**（高级筛选 adv-filter）：`adv-filter.ts` 提供模型高级筛选弹窗：关键字 + 骨骼数/立方体数/纹理尺寸三组数值范围 + 标签名，采集后返回结构化条件对象交给调用方执行搜索。控件集合与后端 `SearchModels` 的能力严格对齐（6 个范围参数 …
- **dialog-batch-rename**（批量重命名 batch-rename）：`batch-rename.ts` 提供目录级批量重命名弹窗：接收文件条目列表，用 `parseModelName` 逐个解析出作者/作品/角色/日期，支持两种模式——「解析格式」（统一作者/作品批量改写）与「查找替换」（字面量或正则，含 …
- **dialog-modal**（弹窗基座 modal）：`modal.ts` 是全应用统一的模态弹窗基座：提供 prompt（带输入框）、select（下拉选择）、confirm（确认）三种 Promise 化弹窗，以及共享的转义、关闭动画、活动弹窗单例管理。所有业务弹窗（rename/batc…
- **dialog-rename**（重命名弹窗 rename）：`rename.ts` 提供单个模型的结构化重命名弹窗：把文件名按 `[作者]【品牌】角色-变体 (年月).ext` 规范拆成五个输入框，实时预览新文件名，可选「📖 读取头部」从 YSM 文件头提取作者/介绍。弹窗只负责产出新文件名，实际落…
- **dialog-tag-editor**（标签编辑器 tag-editor）：`tag-editor.ts` 提供单个模型的标签编辑弹窗：加载该模型已有标签与全库已有标签，支持手工输入新标签（Enter 或「+ 添加」）与从建议列表点选，删除标签用标签内 ✕ 按钮。保存时把最终标签列表写回后端 go/tags Sto…
- **shared-styles**（共享样式 shared-styles）：两个样式模块为 Shadow DOM 组件提供可复用的 CSS 字符串：`css/shared-styles.ts` 导出全应用统一的按钮体系 `.btn-base` 与通用 focus-visible 规则；`components/app…
- **test-utils**（测试工具 test-utils（G-1 抗脆弱测试基础设施））：`frontend/src/test-utils/` 是组件测试统一工具层（ADR-035 G-1 / Design.md §19.1）。查询走 `data-testid` 稳定钩子（不绑定 CSS 类/文案），等待走轮询（替代固定 sle…

## utils（15 张）

*工具函数（display、fmt、dom、animation）*

| 标识 | 名称 | tier | 关键词 |
|------|------|------|--------|
| 🏗 animation-system | 动画系统 animation | architecture | 动画, 骨骼动画, 关键帧, 动画播放, Molang, 数字滚动, stagger 入场, 关闭动画 |
| 🏗 model2d | 2D 预览渲染 model2d | architecture | 2D 预览, 骨骼图, Canvas 渲染, 前视图, 骨骼热区, 鼠标拾取, 线框图 |
| 🏗 model3d | 3D 预览渲染 model3d | architecture | 3D 预览, Three.js, 相机, 骨骼渲染, 自由相机, 3D 截图, 纹理加载, spec 兜底, OrbitControls |
| 🍃 utils-display | 文件名显示 display | leaf | 文件名, 文件名显示, 美化文件名, renderDisplayName, 作者标签, 作品标签, 文件名着色, 搜索高亮, ban 文件 |
| 🍃 utils-dom | DOM 工具 dom | leaf | esc, HTML 转义, innerHTML, 搜索高亮, mark, XSS |
| 🍃 utils-errors | 错误处理 errors | leaf | 错误提示, 友好错误, friendlyError, toast 文案, 报错翻译, 网络错误, 文件被占用 |
| 🏗 utils-export | 截图与导出 export | architecture | 截图, 导出 PNG, 多角度截图, 预览缓存, 缩略图, blob URL 释放 |
| 🍃 utils-extensions | 扩展名映射 extensions | leaf | 扩展名, 支持的文件类型, 拖拽过滤, RESOURCE_EXTS, ALL_EXTS, 导入过滤, 扩展名归属 |
| 🍃 utils-fmt | 格式化工具 fmt | leaf | 文件大小, 字节格式化, KB MB, 日期格式化, 友好日期, 文件大小颜色 |
| 🍃 utils-icon | 图标映射 icon | leaf | 图标, emoji, 文件图标, fileIcon, 判断 YSM 文件 |
| 🍃 utils-mc-format | MC 格式判定 mc-format | leaf | 分节符, § 颜色, MC 颜色码, pack_format, MC 版本, 资源包版本, renderFormattedText, 版本兼容 |
| 🍃 utils-misc | 常量与调试 constants/debug | leaf | 调试日志, dbg, 调试开关, 环形日志, debugGetSpec, 全局常量 |
| 🍃 utils-resource-types | 资源类型工具 resource-types | leaf | 资源类型, RESOURCE_TYPES, 类型标签, 存储子目录, storageSubDir, LoadResourceTypes, 注册表加载 |
| 🍃 utils-summarize | 摘要生成 summarize | leaf | 模型详情, 摘要卡片, summaryCardHTML, 预览卡片, 加密模型, 作者信息, 动画分组, 免费付费 |
| 🏗 ysm-wasm | WASM 解析器 ysm-parser | architecture | WASM, YSMParser, ysm 解码, 加密模型, wasm 加载, Emscripten, MEMFS |

### 摘要

- **animation-system**（动画系统 animation）：前端动画体系分两层：**模型骨骼动画**（基岩版 animation.json 解析 + 关键帧插值求值）与 **UI 动效**（数字里程表滚动、stagger 入场延迟）。UI 层的 CSS 动画可被全局 `no-animations` …
- **model2d**（2D 预览渲染 model2d）：Canvas 2D 渲染基岩版模型骨骼的线框/正交投影图（前视图 + 可选 Y 轴旋转），是预览面板的轻量视图；与 [model3d](./model3d.md) 共享同一套 Bedrock 几何口径。
- **model3d**（3D 预览渲染 model3d）：前端 Three.js 3D 渲染层，由三个文件组成：`model3d.ts` 负责场景搭建/相机/渲染循环，`model3d-loader.ts` 负责纹理与 spec 加载（**Go binding 为唯一事实来源，不再降级 JS 兜底…
- **utils-display**（文件名显示 display）：模型文件名解析 + 美化显示管线。YSM 社区文件名遵循 `[作者]【作品】角色 日期.ext` 命名约定，本模块把它解析为结构化字段，并在原文件名上原位着色（作者/作品/日期各自样式），是 UI 侧文件名展示的唯一入口。
- **utils-dom**（DOM 工具 dom）：HTML 转义与搜索高亮工具。`esc()` 是全前端 HTML 转义的统一入口，也是治理红线指定的转义函数。
- **utils-errors**（错误处理 errors）：把 Go 端/运行时返回的原始错误转换为用户可读的中文提示，是异常路径 toast 文案的统一入口（治理红线：所有异常路径必须有 toast 反馈）。
- **utils-export**（截图与导出 export）：预览产物的导出与缓存层：`screenshot-renderer.ts` 用离屏 Three.js 渲染器做透明背景多角度截图；`preview-cache.ts` 是模型预览数据的模块级持久缓存（组件卸载/重挂不丢失）。当前画面的单帧截图…
- **utils-extensions**（扩展名映射 extensions）：前端扩展名 → 资源类型映射的集中定义。拖拽导入等场景需要同步判断扩展名（无法等待异步注册表加载），故提供这份静态默认表；事实来源仍是 `resource_types.json`，三端一致性由契约测试守护。
- **utils-fmt**（格式化工具 fmt）：字节数与时间戳的格式化纯函数集，服务于列表行的尺寸与日期展示。
- **utils-icon**（图标映射 icon）：文件名 → 图标 emoji 的映射工具，用于列表/树行的文件类型图标展示。
- **utils-mc-format**（MC 格式判定 mc-format）：两个 Minecraft 相关的纯工具：`mc-format.ts` 把 § 分节符颜色/格式码渲染为 HTML；`pack-format.ts` 把 pack_format 数值映射为可读的 MC 版本描述。
- **utils-misc**（常量与调试 constants/debug）：前端调试基础设施：`debug.ts` 提供带 tag 过滤与环形缓冲的调试日志工具。原 `constants.ts`（预览画布/缩放/下载守护等全局数值常量）因长期无消费方已在死代码清理中移除，本卡同时承接「常量治理」的约定说明。
- **utils-resource-types**（资源类型工具 resource-types）：前端资源类型常量与注册表加载工具。与 [resource_registry](./resource-registry.md) 卡互补：那张讲 `resource_types.json` 单一事实源与 `services/registry.t…
- **utils-summarize**（摘要生成 summarize）：把 Go 端解析出的模型摘要（YsmSummary）与头部信息（YSMHeader）渲染为预览面板的「模型详情」卡片 HTML。
- **ysm-wasm**（WASM 解析器 ysm-parser）：YSMParser WASM 的前端胶水层（算法口径与 YSMViewer 一致）：`ysm-parser.ts` 负责加载、初始化与解码调用；`ysm-wasm-data.js` / `ysm-glue-data.js` 是 base64…

---

## 使用说明

### 快速开始

```bash
# 新建知识卡
node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [--leaf]

# 漂移检查
node scripts/check-knowledge-drift.mjs

# 重新生成索引
node scripts/gen-knowledge-index.mjs
```

### 文件结构

| 文件 | 说明 |
|------|------|
| `AGENTS.md` | 分区路由指南（必读） |
| `index.md` | 分类索引（自动生成） |
| `<kind>.md` | 知识卡（kind 为 snake_case） |

### 约束

- `source_files` **必须**真实存在于磁盘
- `kind` = 文件名，snake_case
- 生成物（`index.md`）**禁止手改**
- H1 标题 = `name` 字段

## 分类说明

| 分类 | 用途 |
|------|------|
| core | 核心基础设施（事件总线、页面状态、Wails 桥接） |
| go | Go 后端包（安装、下载、回收站、YSM 解析等） |
| ui | 前端 UI 组件（tree、sidebar、preview、content） |
| feature | 业务功能（导入队列、同步、社区） |
| utils | 工具函数（display、fmt、dom、animation） |
| config | 配置与注册表（resource_types、AppConfig） |
