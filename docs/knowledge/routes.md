<!-- 本文件由 scripts/gen-routes.mjs 自动生成，请勿手改。重跑：node scripts/gen-routes.mjs -->

# AI 知识库路由表

本表把用户的自然语言意图映射到首张知识卡。AI 应先命中首选卡，再沿卡片的 `source_files`、API 和子系统关系继续追踪；不要直接扫描整个 `frontend/src/` 或 `go/`。

> 由 `scripts/gen-routes.mjs` 自动生成：首选卡按卡片 `use_when` 关键词命中，摘要提供快速上下文。
> 更新后重新生成：`node scripts/gen-routes.mjs`。

> ⚠️ **歧义标注**：行内出现「⚠️歧义（另见…）」表示该意图关键词被多张卡共享——AI 需按上下文择层，仍不确定则参考本表生成时的 WARN 冲突清单消歧。

## 路由规则

| 用户意图或关键词 | 首选知识卡 | 摘要 |
|---|---|---|
| Android、存储授权、目录选择、MANAGE_EXTERNAL_STORAGE、权限、选择目录、SAF、android-bridge、pickDirectory | [Android 桥接层：存储授权 + 目录选择器](./android-bridge.md) ⚠️歧义（另见 go-android-platform-guard.md、rust-android-bridge.md） | Android 专属的 Java ↔ 前端桥（`WailsJSBridge` 以 `wails` 名注册到 WebView，桌面端无此桥返回 `null`）与跨平台目录选择器。解决 Android 上 Wails 官方**拒绝目录选择**（… |
| android:back、返回键、弹窗、退出、系统事件、ScreenLocked、NetworkChanged、permissionGranted、closeActiveDialog、registerAndroidEvents | [Android 系统事件消费（back/网络/存储授权）](./android-events.md) ⚠️歧义（另见 dialog-modal.md） | 前端消费 Java 层经 Wails 事件总线转发的 `android:*` 系统事件（ADR-046 P2，参照 MikuMikuAR ADR-017 A3-04）。桌面端无 Java 层，这些事件永不触发，注册无害。生命周期由 `reg… |
| 动画、骨骼动画、关键帧、动画播放、Molang、数字滚动、stagger 入场、关闭动画、状态机、动画控制器、AnimationController | [动画系统 animation](./animation-system.md) ⚠️歧义（另见 go-geometry.md） | 前端动画体系分两层：**模型骨骼动画**（基岩版 animation.json 解析 + 关键帧插值求值）与 **UI 动效**（数字里程表滚动、stagger 入场延迟）。UI 层的 CSS 动画可被全局 `no-animations` … |
| 新增/重构 internal/app 下的子组件（队列、缓存、扫描器等），且它需要调用 App 的能力（发事件、写日志、下载文件等）、评审 PR 时检查是否有人把 `*App` 反向指针重新加回某个子组件 struct、想确认「循环依赖」现状：本仓仅剩包级（import）环由 go build 兜底，对象级环已清零 | [App↔子组件对象级环打破范式（回调注入）](./app_cycle_injection.md) | `internal/app` 是 Wails 绑定层（`package app`），`App` 是 god-object，持有若干子组件 |
| 主内容区、页面切换、nav:change、仓库页、全局 handler | [主内容页 app-content](./app-content.md) | `app-content` 是应用的主内容区组件（Shadow DOM + adoptedStyleSheets），承载 6 个页面：模型仓库（repository）、整合包管理（instances）、创作者频道（workshop）、创意工… |
| 组件入口、模块装配、启动流程、主题初始化、服务注册、检查更新、import 组件、新组件注册、窗口显示、startup reveal | [组件入口 app-modules](./app-modules.md) ⚠️歧义（另见 version-updater.md） | `app-modules.ts` 是前端所有 ES module 组件的统一装配入口：注册可替换服务、按「轻量静态 + 重量级动态」策略导入全部 Web Components、注册右键菜单映射、初始化主题与 UI 偏好、静默检查更新。新增组… |
| 预览、模型预览、2D 骨骼、3D 预览、Litematic、蓝图、缩略图、WASM 解码、放大预览 | [预览面板 app-preview](./app-preview.md) ⚠️歧义（另见 dom-fab.md、go-threejs.md、model3d.md等） | `app-preview` 是仓库页右侧的预览面板组件（Shadow DOM），负责 YSM 模型的详情/2D 骨骼/3D 预览、Litematic 蓝图 3D 预览、资源包与光影包信息展示。它按 `model:select` 事件驱动，解… |
| 侧边栏、整合包列表、版本卡片、推送、拉取、一键安装、同步状态、勾选、整合包拖拽导入、启动器检测 | [侧边栏 app-sidebar](./app-sidebar.md) ⚠️歧义（另见 app-sync-manager.md） | `app-sidebar` 是仓库页左栏的整合包列表组件（Shadow DOM），展示当前资源类型下各整合包（Minecraft 版本实例）的同步状态卡片，支持选中联动、勾选批量推送/拉取、一键安装缺失资源。它遵循标准组件拆分规范（inde… |
| 整合包同步、同步状态、推送资源、拉取资源、待推送、可拉取、已禁用、实例资源 | [整合包同步页 app-sync-manager](./app-sync-manager.md) ⚠️歧义（另见 app-sidebar.md） | `app-sync-manager` 是整合包管理页内嵌的同步状态面板（light DOM），由 `app-content` 在收到 `package:selected` 后以 `<app-sync-manager instance="版本… |
| 树形、资源列表、tree、节点、树、目录树 | [资源树 app-tree](./app-tree.md) | `app-tree` 是 YSM 核心的资源目录树组件，使用 Web Components 实现，支持展开/折叠、右键菜单、文件图标显示。 |
| 缺失 import、auto-import、导出符号、tokenize、词法、缺失导入、goimports、大脚本拆分 | [auto-import 拆分与缺失 import 检测](./auto_import_split.md) ⚠️歧义（另见 source-graph.md） | `scripts/auto-import.mjs` 检测 TS/JS 缺失 import（goimports 轻量版，正则级非 AST 级，ADR-014 伴生）。原为 802 行单文件，2026-08-31 按 **ADR-141 大脚本… |
| 网页版、浏览器模式、web mode、IndexedDB、IDB、浏览器后端、browser adapter、跨域隔离、COI、NBT 解析、体素、体素颜色、Web CLI、社区下载、网页版文件系统、网页版仓库 | [网页版后端 backend-web](./backend_web.md) ⚠️歧义（另见 backend-idb.md、wails-bridge.md、go-litematic.md等） | `frontend/src/backend/` 是 YSM 网页版（ADR-049 Web Edition）的后端抽象层。在桌面/Android 环境下走 Wails Go 绑定替代，网页版使用 `browser-adapter.ts` +… |
| IndexedDB、网页版、backend、模型库、browser adapter、web mode | [浏览器后端 IndexedDB 封装](./backend-idb.md) ⚠️歧义（另见 backend_web.md、wails-bridge.md等） | `backend/` 目录是 YSM 网页版的后端抽象层（ADR-049 Phase 1-2），在桌面/Android 走 Wails Go 绑定、网页版走 `browser-adapter.ts` + `idb.ts` 的同一接口。`id… |
| 整合包分类、路由、location 路由、zipentry 指纹、蓝图、投影、vrm、pmx、回归、last-wins、priority 裁决 | [分类路由与回归护栏](./classify-routing.md) ⚠️歧义（另见 app-preview.md、go-litematic.md、resource-packs.md等） | 整合包分类的「路由不变量 + 回归护栏」设计备忘录。核心结论：**location 路由只在「同文件夹 = 同类型」时成立；一旦出现「同文件夹多类型」，必须降级到内容指纹（zipentry/ysm/mcmeta/shader），且各容器型需… |
| CLI、质量摸排、代码审核、代码审查、bug 排查、审计、白名单、绑定层、覆盖率、健康分 | [CLI 质量摸排 Checklist](./cli_quality_audit.md) ⚠️歧义（另见 fbx-cli-pipeline.md、frontend_repo_audit.md、frontend_test_audit.md等） | 本文档记录 YSM 项目 Go CLI 层（`go/cli/` + `internal/app/` + `frontend/src/services/`）代码审核的**高频问题模式**与**修复 Checklist**。2026-08-19… |
| 创意工坊、社区、下载队列、镜像源、批量下载、github 仓库、下载进度、workshop | [社区下载 community](./community-feature.md) ⚠️歧义（另见 go-download.md） | `features/community/` 是创意工坊（GitHub 模型仓库）浏览与批量下载的前端业务层，五个文件分工：`data.ts` 抓取远端 index.json（多镜像竞速）、`render.ts` 渲染站点卡片与模型列表、`e… |
| 右键菜单、右键、上下文菜单、ctx:show、menu:show、批量操作、移入回收站、重命名 | [右键菜单系统](./context-menu.md) ⚠️歧义（另见 go-fileops.md） | 右键菜单系统采用「声明与行为分离」的三层结构：`menu-defs.ts` 声明菜单结构（唯一事实来源），`core/context-menus.ts` 把 `ctx:show` 事件翻译成带行为的 `menu:show` 载荷，`view… |
| 工具函数、工具方法、纯函数、防抖、异步、日志 | [核心工具函数 core-utils](./core_utils.md) ⚠️歧义（另见 go-logs.md） | `utils/core/` 是全前端最基础的纯函数工具层，不依赖任何前端框架或业务模块。按 ADR-044 策略 A 收敛自多包重复实现，统一入口。 |
| 批量重命名、批量改名、查找替换、正则替换、统一作者、预设、batch-rename | [批量重命名 batch-rename](./dialog-batch-rename.md) ⚠️歧义（另见 ui_components.md） | `batch-rename.ts` 提供目录级批量重命名弹窗：接收文件条目列表，用 `parseModelName` 逐个解析出作者/作品/角色/日期，支持两种模式——「解析格式」（统一作者/作品批量改写）与「查找替换」（字面量或正则，含 … |
| 弹窗、对话框、确认框、输入框弹窗、下拉选择弹窗、modal、prompt、confirm | [弹窗基座 modal](./dialog-modal.md) ⚠️歧义（另见 android-events.md） | `modal.ts` 是全应用统一的模态弹窗基座：提供 prompt（带输入框）、select（下拉选择）、confirm（确认）、picker（富列表选择）四种 Promise 化弹窗，以及共享的转义、关闭动画、活动弹窗单例管理。所有业务… |
| 标签、打标签、编辑标签、tag、标签弹窗、分类标记 | [标签编辑器 tag-editor](./dialog-tag-editor.md) ⚠️歧义（另见 go-tags.md等） | `tag-editor.ts` 提供单个模型的标签编辑弹窗：加载该模型已有标签与全库已有标签，支持手工输入新标签（Enter 或「+ 添加」）与从建议列表点选，删除标签用标签内 ✕ 按钮。保存时把最终标签列表写回后端 go/tags Sto… |
| FAB、悬浮按钮、3D 预览、overlay、ADR-057 | [3D 预览悬浮 FAB 控制层](./dom-fab.md) ⚠️歧义（另见 app-preview.md、go-threejs.md、model3d.md等） | 3D 预览悬浮控制层组件（ADR-057），替代 `skeleton.ts` 内联 `style.cssText` 控制栏，集中治理样式 + 双端响应式。FAB 挂载在 document.body（light DOM），样式通过 `ensu… |
| 漂移检测、双轨、重复实现、口径漂移 | [drift-scan（双轨漂移检测）](./drift-scan.md) ⚠️歧义（另见 extensibility-index.md） | — |
| 事件、事件总线、通信、emit、跨组件通信、bus | [事件总线 bus.ts](./event-bus.md) | `bus.ts` 是 YSM 前端的唯一事件中枢，基于发布/订阅模式。所有跨组件、跨页面的异步通信都经过此总线，避免组件间直接耦合。 |
| 拓展点对账、落地状态、ADR 闭环 | [可拓展点索引对账（vs HEAD @ d517113c…）](./extensibility-index-reconciliation.md) | — |
| 可拓展点、扩展入口、硬编码、重复实现、插件化 | [可拓展点发掘索引（extensibility inventory）](./extensibility-index.md) ⚠️歧义（另见 drift-scan.md） | — |
| 新增资源类型、新增文件格式、新增网页桥接、新增同步逻辑、残留手改清单 | [拓展点 / 扩展入口 探索报告（Round 2）](./extensibility-round2.md) | — |
| FBX、CLI、命令行、转换、glTF、GLB、fbx2gltf、assimp、qmuntal、加载模型、模型格式 | [FBX CLI 处理管线 fbx-cli-pipeline](./fbx-cli-pipeline.md) ⚠️歧义（另见 cli_quality_audit.md） | **CLI 模式处理 FBX 的成熟路径，不是「Go 直接解析 FBX」，而是「现成转换器转中间格式 + 成熟库读取」的双段式**： |
| 代码审核、代码审查、审计、前端质量、技术债、重构排期、XSS、innerHTML | [前端 TS 整包审计](./frontend_repo_audit.md) ⚠️歧义（另见 cli_quality_audit.md、frontend_test_audit.md等） | 2026-08-26 按 `.trae/skills/ts-package-review/SKILL.md` 对 `frontend/src/` 全量只读评审（七个子代理并行，排除 vendor）。前置：type-consistency 全… |
| 代码审核、测试基建、契约测试、e2e、flaky、假绿、覆盖盲区 | [前端测试基建审计](./frontend_test_audit.md) ⚠️歧义（另见 cli_quality_audit.md、frontend_repo_audit.md、test-utils.md） | 2026-08-26 对测试基建层全量只读评审（两子代理并行）：`tests/*.mjs` 契约层（33 文件，核心 4039 LOC；`port-verification/` 为一次性迁移诊断工具不计分）+ `frontend/e2e`（… |
| 全局事件、拖拽导入、拖拽提示、同步缺失、清空整合包、导出清单 | [全局事件处理 global-handlers](./global-handlers.md) ⚠️歧义（另见 import-queue.md） | `core/handlers/global.ts` 是全应用唯一的 core 全局 handler 注册入口（致命陷阱 #2 的解法）：app-content 的 `connectedCallback` 调一次 `registerGloba… |
| 仓库审计、健康分数、完整性检查、缓存命中率、repoaudit、health-report、去重 | [仓库审计 go/repoaudit](./go_repoaudit.md) ⚠️歧义（另见 go-dedup.md） | `go/repoaudit/` 包提供仓库健康审计核心逻辑——资源扫描、完整性校验、缓存状态、健康分数、警告生成、去重汇总。从 `go/cli`（原 `resource.go` 的 `collectRepoHealth`）提取为独立包，CL… |
| Android、平台守卫、RevealInExplorer、OpenFolder、RestartApplication、xdg-open、重启、Node.js、sidecar、watcher、平台隔离、build tag | [Android 平台守卫（Go 侧）](./go-android-platform-guard.md) ⚠️歧义（另见 android-bridge.md、rust-android-bridge.md、go-watcher.md） | ADR-047「平台守卫批量」：Go 侧对 Android 上**无效或不适用的桌面能力**显式拒绝/降级，避免 `xdg-open`/`exec` 链静默失败（错误分类反模式——失败要可见）。结合既有的 build-tag 平台双文件（`… |
| 头像、作者、创作者、avatar、缓存、缩略图 | [头像 go/avatar](./go-avatar.md) ⚠️歧义（另见 go-scanner.md、app-preview.md、go-packs.md等） | `go/avatar/` 包负责创作者头像的提取与缓存：从模型文件（.ysm 二进制 / .zip / 解压目录 .json）的 `metadata.authors[].avatar` 声明中取出头像图片，缓存到**平台配置根 `os.Us… |
| 容器、解包、zip、7z、ContainerReader、归档、压缩包、目录容器 | [统一容器桥接层 go/container](./go-container.md) ⚠️歧义（另见 go-geometry.md等） | `go/container/` 包是统一容器桥接层（ADR-068）：收敛 ysm/geometry/avatar/packs 各自独立的「打开容器→找条目」实现（调研实测 zip.OpenReader 10 处 / zip.NewRead… |
| 去重、重复检测、dedup | [去重 go/dedup](./go-dedup.md) ⚠️歧义（另见 go_repoaudit.md） | `go/dedup/` 包提供资源去重检测，避免重复导入相同资源。 |
| 下载、进度、download、进度条、下载进度 | [下载器 go/download](./go-download.md) ⚠️歧义（另见 community-feature.md） | `go/download/` 包负责模型资源的纯 HTTP 下载（不依赖 Wails runtime），支持 ctx 取消中断、进度回调与失败半文件清理。镜像回退策略（raw/jsd/api 排序）在 `internal/app/app_d… |
| 子进程隐藏控制台窗口、跨平台 HideWindow、外部进程启动 | [进程隐藏窗口 go/executil](./go-executil.md) | `go/executil/` 包提供跨平台的外部进程执行工具，当前唯一功能是 **HideWindow**：在 Windows 上隐藏子进程控制台窗口，其他平台为 no-op。 |
| 移动、复制、重命名、删除、fileops、启用禁用、.ban、ysm.json 整组操作 | [文件操作 go/fileops](./go-fileops.md) ⚠️歧义（另见 context-menu.md、go-recycle.md、go-sync.md） | `go/fileops/` 包实现文件 CRUD + 移动/复制/删除 + 文件夹整组导入 + 预览提取 + 启用禁用（ADR-003 P3 下沉，薄壳 `internal/app/app_files.go` 仅转发）。 |
| geometry、基岩版、bedrock、模型解析、zip、7z、纹理、动画 | [Geometry 存档 go/geometry](./go-geometry.md) ⚠️歧义（另见 go-container.md、animation-system.md等） | `go/geometry/` 包解析 Bedrock（基岩版）`minecraft:geometry` 模型：既支持单个 geometry JSON，也支持从 ZIP/7z 存档中按 `ysm.json` 清单合并多个模型文件、提取纹理与动… |
| 导入、策略、导入队列、importer | [导入策略 go/importer](./go-importer.md) ⚠️歧义（另见 import-queue.md等） | `go/importer/` 包分两块：`importer.go` 的**按资源类型注册的复制策略表**（`Handler` 接口，供本地路径导入/安装复用），以及 `importer_file.go` 的 **base64 单文件导入核心… |
| 安装、installer、模型导入、下载模型 | [模型安装 go/installer](./go-installer.md) | `go/installer/`（单文件 `installer.go`）负责把仓库中的模型/资源文件**落地**到 Minecraft 整合包实例目录：按 `LinkMode`（`copy` / `hardlink` / `symlink`）… |
| 整合包、实例、版本实例、VersionInstance、同步项、BuildSyncItems、资源同步 | [整合包实例 go/instance](./go-instance.md) ⚠️歧义（另见 go-sync.md等） | `go/instance/` 包处理整合包（Minecraft 版本实例）的资源同步项构建，是 `app_install.go` 中 `GetInstanceSyncStatus` Binding 的下沉逻辑（知识卡旧文称 `GetReso… |
| 投影、litematic、schematic、nbt、蓝图、体素、方块 | [Litematic 解析 go/litematic](./go-litematic.md) ⚠️歧义（另见 classify-routing.md、resource-packs.md、app-preview.md等） | `go/litematic/` 包解析 Minecraft 建筑蓝图文件：Litematica 投影（`.litematic`，NBT gzip）、MCEdit 旧版 `.schematic`、原版结构 `.nbt`，产出元数据、方块统计（… |
| 导入日志、操作记录、日志、import log、历史 | [导入日志 go/logs](./go-logs.md) ⚠️歧义（另见 core_utils.md） | `go/logs/` 包提供两套互不相干的日志设施：**操作日志**（`Logger`，持久化）把导入/扫描/下载/同步/重命名/删除/UI 报错等操作的成败结果写入用户配置目录下的 `ysm-import-logs.json`；**运行时… |
| 资源包、光影包、mcmeta、pack_format、缩略图、类型检测 | [资源包 mcmeta go/packs](./go-packs.md) ⚠️歧义（另见 resource-packs.md、app-preview.md、go-avatar.md等） | `go/packs/` 包解析 Minecraft 资源包/光影包的 `pack.mcmeta`（目录或 ZIP 两种形态），提取 pack_format 版本信息与 pack.png 缩略图，并承担「一个文件到底属于哪种资源类型」的内容级… |
| 路径、安全、path、路径校验 | [路径安全 go/paths](./go-paths.md) | `go/paths/` 包提供路径安全校验，防止路径穿越攻击和非法路径访问。 |
| 回收站、删除、恢复、recycle、软删除 | [回收站 go/recycle](./go-recycle.md) ⚠️歧义（另见 recycle-bin.md、go-fileops.md等） | `go/recycle/` 包实现模型的软删除机制，通过硬链接/符号链接判定 + `.recycle` 目录实现可恢复删除。核心是 `TrashManager` 结构体（`New(root)` → `root/.recycle`），包级函数… |
| 扫描、扫描条目、文件树、哈希、缓存、作者提取、ScanEntries、索引生成 | [扫描核心 go/scanner](./go-scanner.md) ⚠️歧义（另见 go-avatar.md） | `go/scanner/` 包实现仓库文件扫描、哈希计算、缓存失效、作者提取、索引生成（ADR-003 P2 下沉，薄壳 `internal/app/app_scan.go` 仅保留依赖 App 的方法）。 |
| 整合包、同步、实例、硬链接、符号链接、缺失、多余、.ban、PrismLauncher | [整合包同步 go/sync](./go-sync.md) ⚠️歧义（另见 go-instance.md、go-fileops.md等） | `go/sync/` 包负责模型库（全局仓库）与 Minecraft 整合包实例之间的同步：发现实例（原版 / PrismLauncher 布局）、按 SHA256 哈希对比出缺失/多余/禁用文件、按文件名或文件夹对比资源包差异、检测目标文… |
| 标签、tag、分类、筛选、tag-editor | [标签系统 go/tags](./go-tags.md) ⚠️歧义（另见 dialog-tag-editor.md等） | `go/tags/` 包提供模型标签的线程安全持久化存储，是前端 tag-editor 弹窗的后端。标签存放在配置目录的 `tags.json`，以文件绝对路径为 key、标签列表为 value，与模型文件本身解耦（移动/链接模型不污染文件… |
| 3D 预览、骨骼、three.js、spec、顶点、UV、四元数、模型渲染 | [3D 骨骼 spec go/threejs](./go-threejs.md) ⚠️歧义（另见 app-preview.md、dom-fab.md、model3d.md等） | `go/threejs/` 包根据 YSMViewer 的 `ThreeJsPayloadBuilder.cs` 移植，把已解析的 `types.BedrockModel` 转换为 Three.js 可直接消费的 JSON spec：顶点、… |
| 共享类型、AppConfig、配置、注册表、扩展名、LinkType、BedrockModel | [共享类型 go/types](./go-types.md) ⚠️歧义（另见 resource-registry.md） | `go/types/` 包是全应用的共享类型层：应用配置（AppConfig）、各子系统交换的数据结构（模型条目/实例状态/同步结果/日志/投影元数据等）、以及资源类型注册表的 Go 端加载与扩展名查询。与 [resource_regist… |
| 更新、自动更新、版本升级、updater | [自动更新 go/updater](./go-updater.md) ⚠️歧义（另见 version-updater.md等） | `go/updater/` 包负责 YSM 应用的自动更新机制。 |
| 监听、文件变化、刷新、watcher | [文件监听 go/watcher](./go-watcher.md) ⚠️歧义（另见 go-android-platform-guard.md） | `go/watcher/` 包监听资源目录的文件系统变化，触发前端资源树刷新。 |
| YSM、解析、摘要、ysm 文件、元数据 | [YSM 解析 go/ysm](./go-ysm-parser.md) | `go/ysm/` 包负责解析 YSM（Yuan's Sketch Model）格式文件，提取模型元数据并生成结构化摘要。 |
| 翻译、多语言、i18n、t()、语言切换、lang:changed | [国际化 i18n 模块](./i18n.md) | `i18n` 模块是 YSM 前端的唯一翻译层，基于 ADR-045 设计。`t.ts` 提供纯函数式翻译（按 key 查表），`locale.ts` 管理语言状态、持久化与异步加载。支持简体中文（基准）、英语、日语三种语言，语言偏好持久化… |
| 导入、导入队列、拖拽导入、文件夹导入、覆盖导入、import、拖拽 | [全局导入执行 import-executor](./import-queue.md) ⚠️歧义（另见 go-importer.md、global-handlers.md、pointer-events.md等） | **2026-08-05 重构**：原 `import-queue.ts`（导入 tab UI 层）与 `ImportHistory`（内存导入历史）已全部删除。导入改为**全局静默执行**架构——拖拽/选择文件直接走 `import-ex… |
| 模型统计、骨骼数、立方体数、纹理尺寸、SearchModels、数值筛选、Web Worker、批量统计 | [Web Worker 模型统计层 model-stats](./model-stats.md) | `frontend/src/workers/` + `frontend/src/backend/web-stats.ts` 是 ADR-071 审计增强 #7 新增的**Web Worker 批量模型统计层**，为网页版 `SearchMo… |
| 2D 预览、骨骼图、Canvas 渲染、前视图、骨骼热区、鼠标拾取、线框图 | [2D 预览渲染 model2d](./model2d.md) | Canvas 2D 渲染基岩版模型骨骼的线框/正交投影图（前视图 + 可选 Y 轴旋转），是预览面板的轻量视图；与 [model3d](./model3d.md) 共享同一套 Bedrock 几何口径。 |
| 3D 预览、Three.js、相机、骨骼渲染、自由相机、3D 截图、纹理加载、spec 兜底、OrbitControls | [3D 预览渲染 model3d](./model3d.md) ⚠️歧义（另见 app-preview.md、dom-fab.md、go-threejs.md等） | 前端 Three.js 3D 渲染层（`frontend/src/preview-3d/`），**单会话架构**：场景/相机/渲染器/控制器由统一预览核心 `mount3D`（ADR-066）持有单实例，模型内容经适配器（ysm/vrm/m… |
| 多模型、多组件、模型选择、select、zip 多模型、多 entry、多候选、ADR-132、蓝图 zip、litematic zip、容器内多 nbt | [多模型选择菜单原语 multiModelSelectNode](./multi_model_select.md) | 跨资源类型的「多模型选择」声明式 select 菜单原语（ADR-132）。收编了此前三套并存的 |
| 优化、性能、瓶颈、优化记录、optimization、perf、KTX2、纹理缓存、加载速度、内存、GPU 内存、闪退、泄漏、dispose | [优化记录 optimization-log](./optimization_log.md) | — |
| 页面、当前页、状态管理、page store、currentPage | [页面状态管理 page-store.ts](./page-store.md) | `page-store.ts` 管理 YSM 的前端页面导航状态，是 `PageStore.currentPage` 的唯一数据源，替代了旧版 `window.__currentPage`。核心职责是维护只读当前页状态与启动初始页解析——*… |
| 自主动画、自动跳舞、眨眼、呼吸、视线追踪、口型同步、节拍检测、模型感知、自动运动 | [3D 感知系统 perception](./perception.md) | `preview-3d/perception/` 是实现模型「自主生命感」的感知层子系统：让 Minecraft 角色自动眨眼、呼吸、注视、对口型、随音乐律动。 |
| pointerdown、pointermove、pointerup、setPointerCapture、touch-action、触屏、拖拽、旋转、hover、mouseenter、全窗预览 | [Pointer Events 统一交互（触屏 + 桌面）](./pointer-events.md) ⚠️歧义（另见 import-queue.md） | ADR-047 核心立项 A：全前端拖拽/缩放/旋转/hover 交互从 mouse 事件统一迁移 **Pointer Events**（`pointerdown/move/up` + `setPointerCapture` + CSS `… |
| 3D 预览、统一预览外壳、程序化天空 / sky / 背景 / scene.background、PreviewAdapter 适配器、全模型预览（YSM / VRM / MMD / Litematic）、mount3D | [统一 3D 预览核心 preview-core](./preview_core.md) ⚠️歧义（另见 app-preview.md、dom-fab.md、go-threejs.md等） | ADR-066 落地的**统一 3D 预览核心**，收缴 vrm / litematic 复制脚手架（旧实现各内联 ~250 行同构），成为所有富格式 3D 预览的**单一事实来源外壳**。内容差异经 `PreviewAdapter.bui… |
| schema 注册、per-scene、多模型同框、schema 键冲突、activeComponent、组件选择、YSM maid 同台、ysm-model、sessionId | [preview-menu-session-key](./preview_menu_session_key.md) | 3D 预览面板的受控 schema 注册（`schema-registry.ts`）用「per-scene 唯一 key」保证多模型同台 |
| 回收站、恢复文件、清空回收站、软删除、recycle、还原 | [回收站界面 recycle-bin](./recycle-bin.md) ⚠️歧义（另见 go-recycle.md等） | `recycle-bin.ts` 实现仓库页「回收站」tab 的界面逻辑：列出 `.recycle` 中属于当前资源类型的已删除条目，提供单条恢复/永久删除、一键清空。由 app-content 首次切到 recycle tab 时懒加载调… |
| 资源包、光影包、蓝图、投影、resourcepack、shaderpack、资源管理 | [资源包功能 resource-packs](./resource-packs.md) ⚠️歧义（另见 go-packs.md、app-preview.md、classify-routing.md等） | **已删除（2026-08-18）**。原 `frontend/src/features/resource-packs.ts` 是一个薄 wrapper，把仓库页的各类资源包 tab 统一委托给 `<app-resource-manager… |
| 资源类型、注册表、resource_types、registry、文件类型 | [资源注册表 registry](./resource-registry.md) ⚠️歧义（另见 go-types.md） | `resource_types.json` 是 YSM 资源类型定义的单一事实来源（Single Source of Truth）。所有资源类型、子目录、扩展名的定义均以此处为准。 |
| Android、Linux、macOS、rust_backend、CGO | [Rust Scanner Bridge 全平台支持](./rust-android-bridge.md) ⚠️歧义（另见 android-bridge.md、go-android-platform-guard.md、rustbridge.md） | — |
| Rust 扫描器、rust_backend、桥 DLL、Wails 后端迁移 Rust | [Rust 桥 rustbridge](./rustbridge.md) ⚠️歧义（另见 rust-android-bridge.md） | — |
| 场景能力 / cap / registry / SceneCapability、3D 菜单控件声明式渲染（getMenuControls）、新增 3D 能力（雾/阴影/反射/环境/灯光/后处理）、3D 会话生命周期（createAll / loadAll / setPreset / saveAll / dispose）、「光」指代消歧（light 是光源，fog/shadow/reflector 不是） | [场景能力注册表 scene-capability-registry](./scene_capability_registry.md) | ADR-073 扩展落地的**场景能力注册表**：所有场景能力（Sky / Ground / Environment / Fog / Shadow / Reflector / Light / Postprocessing）由统一注册表**创… |
| 覆盖率门禁、diff-coverage、循环依赖、共享核、_lib、check-circular、findCycles、脚本去重、脚本重构 | [scripts 共享核演进（diff-coverage-core + cycles）](./script_shared_cores.md) | `scripts/_lib/` 承载跨脚本共享逻辑。2026-09 按「四脚本镜像嫌疑分析」实测后，新增两个共享核，消除两对镜像脚本的重复： |
| 脚本参数、argv、parseArgs、手写参数解析、positional、未知 flag、脚本卫生、hygiene | [脚本 argv 规范与已知豁免 parse-args.ts](./scripts_argv.md) | `scripts/*.mjs` 的命令行参数解析**统一走共享层 `scripts/_lib/parse-args.ts`**，禁止手写 `process.argv` 解析。核心动机（2026-08-04 全量审核 + 2026-08-30… |
| jscpd、go 重复代码、复制粘贴检测、duplicate、重复对、增量门禁、新增重复、独立 baseline | [Go 端 jscpd 重复检测脚本](./scripts_jscpd_go.md) | `scripts/jscpd-go.mjs` 是 Go 端复制粘贴检测工具：调用复用前端的 jscpd v5（Rust 内核）二进制，扫描 `./go/**/*.go`，与独立 baseline `scripts/baseline/jscp… |
| README、脚本索引、登记处、脚本登记、check-readme-index、脚本漂移、脚本对账 | [README 登记处对账 check-readme-index.mjs](./scripts_readme_index.md) | `scripts/README.md` 自称「所有 Node 工具脚本的索引」「治理检查（check-* 系列；唯一登记处）」，但历史上没有任何机器对账——新增/改名脚本后忘记登记 README 不会被任何门禁拦下。2026-08-31 审… |
| 符号提取、导出符号、顶层声明、api-break、audit-split、rollback-impact、bloat-history、依赖图、check-lib-adoption | [源码符号提取共享层 source-graph.ts](./source-graph.md) ⚠️歧义（另见 auto_import_split.md） | — |
| 测试工具、testid、getByTestId、waitFor、sleep、flaky、异步等待、组件测试、mock、G-1 | [测试工具 test-utils（G-1 抗脆弱测试基础设施）](./test-utils.md) ⚠️歧义（另见 frontend_test_audit.md） | `frontend/src/test-utils/` 是组件测试统一工具层（ADR-035 G-1 / Design.md §19.1）。查询走 `data-testid` 稳定钩子（不绑定 CSS 类/文案），等待走轮询（替代固定 sle… |
| UI 组件、UI 组件库、卡片组件、折叠面板、加载动画、滑块、行组件、预设、图标、幻灯片菜单、组件样式 | [UI 组件库 ui-components](./ui_components.md) ⚠️歧义（另见 dialog-batch-rename.md） | `frontend/src/ui/` 是前端通用 UI **helper 函数库**（自 MikuMikuAR 迁移，ADR-191 去桶化）：提供卡片、折叠面板、加载遮罩、行排列、滑块、幻灯片菜单、预设 chip、图标工厂等无业务逻辑的 … |
| 截图、导出 PNG、多角度截图、预览缓存、缩略图、blob URL 释放 | [截图与导出 export](./utils-export.md) ⚠️歧义（另见 app-preview.md、go-avatar.md、go-packs.md） | 预览产物的导出与缓存层：`screenshot-render.ts` 用离屏 Three.js 渲染器做透明背景多角度截图；`preview-cache.ts` 是模型预览数据的模块级持久缓存（组件卸载/重挂不丢失）。当前画面的单帧截图入口… |
| 更新、升级、检查更新、新版本、静默检查、updater、版本 | [版本更新 version-updater](./version-updater.md) ⚠️歧义（另见 go-updater.md、app-modules.md等） | `version-updater.ts` 是应用自更新的前端入口：启动时静默检查（受 6 小时频次限制）→ 发现新版本以可点击 toast 通知；设置页按钮手动检查 → 弹出带更新日志的 `modalConfirm` → 调 `DoUpda… |
| vitest、测试环境、node 环境、happy-dom、测试切换 | [Vitest 环境切换规则](./vitest-env-switch.md) | — |
| API、Binding、接口、Go 方法、调用后端、有哪些方法、App 方法、getApp、方法签名、app.ts 绑定 | [Wails Binding API 总览 internal/app](./wails-bindings.md) ⚠️歧义（另见 wails-bridge.md等） | `internal/app/` 是 Go 端唯一的 Wails Binding 入口层：所有导出给前端的方法都定义在 `*App` 上，业务逻辑下沉到 `go/*` 包，本层只做参数转发与窗口/事件/对话框编排。前端统一经 `getApp(… |
| Wails、桥接、getApp、Go 调用、Binding、window.go.main.App、网页版、browser adapter、浏览器后端 | [Wails 桥接 app.ts](./wails-bridge.md) ⚠️歧义（另见 wails-bindings.md、backend_web.md、backend-idb.md等） | `backend/app.ts` 是前端调用后端 Binding 的唯一入口。所有 Go 端方法通过 `getApp()` 获取，禁止直接通过 `window.go.main.App` 访问。**ADR-049 平台双路由**：网页版（无 … |
| 烘焙、几何反推、pivot、骨骼错位、模型错位、UV 对不上、贴图错位、RawYsmModel、RawFace、YSM 导出、BlockBench | [YSM 烘焙与几何反推](./ysm-baked.md) | YSM 作者导出模型时，**cube 的语义参数（origin/size/uv/rotation）在导出时被烘焙为纯顶点面**，`RawYsmModel.RawCube.faces` 只保留「每面 4 顶点 + 法线 + 4 组 u/v」。… |
| WASM、YSMParser、ysm 解码、加密模型、wasm 加载、Emscripten、MEMFS、node 解码、callMain | [WASM 解析器 ysm-parser](./ysm-wasm.md) | YSMParser WASM 的前端胶水层（算法口径与 YSMViewer 一致）：`ysm-parser.ts` 负责加载、初始化与解码调用；`ysm-wasm-data.js` / `ysm-glue-data.js` 是 base64… |

## 标准执行模板

```text
先按 docs/knowledge/routes.md 判断首选知识卡。
读取 docs/knowledge/AGENTS.md 和首选卡片，再按 source_files 阅读源码。
grep docs/adr/ 查找相关决策和状态。
以源码为最终事实来源；如果卡片过时，先报告漂移，再决定是否同步更新。
修改后运行最小相关测试和 node scripts/doctor.mjs --docs。
```

## 维护规则

- 本文件自动生成，**请勿手改**；重跑 `node scripts/gen-routes.mjs` 重新生成。
- 新增/修改知识卡：更新 frontmatter 的 `use_when`（意图关键词）后重跑即可自动入列。
- `use_when` 为空或不含关键词的卡不会出现在路由表（但仍可经索引/关联图抵达）。
- 表外分类（`category` 非 core/go/ui/feature/utils/config）的卡仍按 use_when 参与路由。
