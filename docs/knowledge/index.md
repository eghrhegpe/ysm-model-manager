<!-- 本文件由 scripts/gen-knowledge-index.ts 自动生成，禁止手改 -->

# 知识卡索引

> 总计: 157 张知识卡

> 用途: AI 代理根据分类 + 关键词定位知识卡，摘要提供快速上下文。

## config（10 张）

*配置与注册表（resource_types、AppConfig）*

| 标识 | 名称 | tier | 性能 | 关键词 |
|------|------|------|------|--------|
| 🏗 auto_import_split | auto-import 拆分与缺失 import 检测 | architecture | — | 缺失 import, auto-import, 导出符号, tokenize, 词法, 缺失导入, goimports, 大脚本拆分 |
| 🏗 extensibility-index-reconciliation | 可拓展点索引对账（vs HEAD @ d517113c…） | architecture | — | 拓展点对账, 落地状态, ADR 闭环 |
| 🏗 extensibility-index | 可拓展点发掘索引（extensibility inventory） | architecture | — | 可拓展点, 扩展入口, 硬编码, 重复实现, 插件化 |
| 🏗 extensibility-round2 | 拓展点 / 扩展入口 探索报告（Round 2） | architecture | — | 新增资源类型, 新增文件格式, 新增网页桥接, 新增同步逻辑, 残留手改清单, 拓展点探索 |
| 🏗 optimization_log | 优化记录 optimization-log | architecture | cpu-bound, gpu-bound, concurrent, memory-heavy | 性能优化, KTX2 编码, 纹理缓存, 主线程监控, 内存泄漏 |
| 🏗 resource-registry | 资源注册表 registry | architecture | — | 资源类型, 注册表, resource_types, registry, 文件类型 |
| 🏗 scripts_argv | 脚本 argv 规范与已知豁免 parse-args.ts | architecture | — | 脚本参数, argv, parseArgs, 手写参数解析, positional, 未知 flag, 脚本卫生, hygiene |
| 🏗 scripts_jscpd_go | Go 端 jscpd 重复检测脚本 | architecture | — | jscpd, go 重复代码, 复制粘贴检测, duplicate, 重复对, 增量门禁, 新增重复, 独立 baseline |
| 🏗 scripts_readme_index | README 登记处对账 check-readme-index.mjs | architecture | single-thread | README, 脚本索引, 登记处, 脚本登记, check-readme-index, 脚本漂移, 脚本对账 |
| 🏗 vitest-env-switch | Vitest 环境切换规则 | architecture | — | vitest, 测试环境, node 环境, happy-dom, 测试切换 |

### 摘要

- **auto_import_split**（auto-import 拆分与缺失 import 检测）：`scripts/auto-import.ts` 检测 TS/JS 缺失 import（goimports 轻量版，正则级非 AST 级，ADR-014 伴生）。原为 802 行单文件，2026-08-31 按 **ADR-141 大脚本拆…
- **resource-registry**（资源注册表 registry）：`resource_types.json` 是 YSM 资源类型定义的单一事实来源（Single Source of Truth）。所有资源类型、子目录、扩展名的定义均以此处为准。
- **scripts_argv**（脚本 argv 规范与已知豁免 parse-args.ts）：`scripts/*.mjs` 的命令行参数解析**统一走共享层 `scripts/_lib/parse-args.ts`**，禁止手写 `process.argv` 解析。核心动机（2026-08-04 全量审核 + 2026-08-30…
- **scripts_jscpd_go**（Go 端 jscpd 重复检测脚本）：`scripts/jscpd-go.ts` 是 Go 端复制粘贴检测工具：调用复用前端的 jscpd v5（Rust 内核）二进制，扫描 `./go/**/*.go`，与独立 baseline `scripts/baseline/jscpd…
- **scripts_readme_index**（README 登记处对账 check-readme-index.mjs）：`scripts/README.md` 自称「所有 Node 工具脚本的索引」「治理检查（check-* 系列；唯一登记处）」，但历史上没有任何机器对账——新增/改名脚本后忘记登记 README 不会被任何门禁拦下。2026-08-31 审…

## core（20 张）

*核心基础设施（事件总线、页面状态、Wails 桥接）*

| 标识 | 名称 | tier | 性能 | 关键词 |
|------|------|------|------|--------|
| 🏗 android-bridge | Android 桥接层：存储授权 + 目录选择器 | architecture | — | Android, 存储授权, 目录选择, MANAGE_EXTERNAL_STORAGE, SAF |
| 🏗 android-events | Android 系统事件消费（back/网络/存储授权） | architecture | — | android:back, 返回键, 弹窗, 系统事件, ScreenLocked, NetworkChanged |
| 🏗 backend-idb | 浏览器后端 IndexedDB 封装 | architecture | io-bound | IndexedDB, 网页版, backend, 模型库, browser adapter, web mode |
| 🏗 backend_web | 网页版后端 backend-web | architecture | — | 网页版, 浏览器模式, browser adapter, IndexedDB, 跨域隔离 |
| 🏗 binding_json_cleanup | string-JSON 绑定铲债清单 | architecture | — | string-JSON, JSON.parse 断言, 绑定 struct 化, 铲债清单, 错误通道统一, ADR-143, 绑定返回 string |
| 🏗 event-bus | 事件总线 bus.ts | architecture | — | 事件, 事件总线, 通信, emit, 跨组件通信, bus |
| 🍃 event-graph-guard | Bus 事件契约守卫 | leaf | — | 未传参, 缺参, bus 事件, 事件契约, 事件漂移, 内联脚本, 可选链, 跨行调用 |
| 🏗 frontend_parsers | 解析簇 parsers/ 自 backend 迁出 | architecture | — | 解析 YSM / NBT / 体素 / zip / pack.mcmeta / 颜色映射, voxel-parse / ysm-header / nbt-parse 定位 |
| 🏗 frontend_test_audit | 前端测试基建审计 | architecture | — | 代码审核, 测试基建, 契约测试, e2e, flaky, 假绿, 覆盖盲区 |
| 🏗 global-handlers | 全局事件处理 global-handlers | architecture | — | 全局事件, 拖拽导入, 拖拽提示, 同步缺失, 清空整合包, 导出清单 |
| 🏗 i18n | 国际化 i18n 模块 | architecture | — | 翻译, 多语言, i18n, t(), 语言切换, lang:changed |
| 🍃 i18n_accuracy | i18n 翻译准确度扫描记录 | leaf | — | 翻译准确度, 键名与值语义错位, i18n 翻译扫描, en 丢 Count, Opacity 误译, 术语统一, 翻译名实不符 |
| 🍃 ik_solver | CCD IK 求解器 ik-solver / 足部锚地 mmd-foot-ik | leaf | cpu-bound | IK 求解, 骨骼 IK, 足部锚地, foot IK, 极向量 / pole, CCD |
| 🏗 model-stats | Web Worker 模型统计层 model-stats | architecture | cpu-bound, concurrent | 模型统计, 骨骼数, 立方体数, 纹理尺寸, SearchModels, 数值筛选, Web Worker, 批量统计 |
| 🏗 page-store | 页面状态管理 page-store.ts | architecture | — | 页面, 当前页, 状态管理, page store, currentPage |
| 🏗 pointer-events | Pointer Events 统一交互（触屏 + 桌面） | architecture | — | pointerdown, pointermove, pointerup, 触屏, 拖拽, 旋转 |
| 🏗 rust-android-bridge | Rust Scanner Bridge 全平台支持 | architecture | — | Android, Linux, macOS, rust_backend, CGO |
| 🍃 theme | 主题系统 theme | leaf | — | 主题, 换肤, 深色, 浅色, 跟随系统, 动画开关, 字号, 界面偏好 |
| 🏗 wails-bridge | Wails 桥接 app.ts | architecture | — | Wails, 桥接, getApp, Go 调用, Binding, window.go.main.App, 网页版, browser adapter |
| 🏗 ysm-baked | YSM 烘焙与几何反推 | architecture | — | 烘焙, 几何反推, pivot, 骨骼错位, 模型错位, UV 对不上, 贴图错位, RawYsmModel |

### 摘要

- **android-bridge**（Android 桥接层：存储授权 + 目录选择器）：Android 专属的 Java ↔ 前端桥（`WailsJSBridge` 以 `wails` 名注册到 WebView，桌面端无此桥返回 `null`）与跨平台目录选择器。解决 Android 上 Wails 官方**拒绝目录选择**（…
- **android-events**（Android 系统事件消费（back/网络/存储授权））：前端消费 Java 层经 Wails 事件总线转发的 `android:*` 系统事件（ADR-046 P2，参照 MikuMikuAR ADR-017 A3-04）。桌面端无 Java 层，这些事件永不触发，注册无害。生命周期由 `reg…
- **backend-idb**（浏览器后端 IndexedDB 封装）：`backend/` 目录是 YSM 网页版的后端抽象层（ADR-049 Phase 1-2），在桌面/Android 走 Wails Go 绑定、网页版走 `browser-adapter.ts` + `idb.ts` 的同一接口。`id…
- **backend_web**（网页版后端 backend-web）：`frontend/src/backend/` 是 YSM 网页版（ADR-049 Web Edition）的后端抽象层。在桌面/Android 环境下走 Wails Go 绑定替代，网页版使用 `browser-adapter.ts` +…
- **binding_json_cleanup**（string-JSON 绑定铲债清单）：ADR-143 的实施进度账本。2026-09-01 审计 `internal/app` 全部导出绑定：返回 `string` 的 44 个签名逐个核语义，分四档——**23 条 JSON 病灶**（P0×6 + P1×17，该 struc…
- **event-bus**（事件总线 bus.ts）：`bus.ts` 是 YSM 前端的唯一事件中枢，基于发布/订阅模式。所有跨组件、跨页面的异步通信都经过此总线，避免组件间直接耦合。
- **event-graph-guard**（Bus 事件契约守卫）：`scripts/event-graph.ts` 是 Bus 事件契约的唯一机器守卫：从 `frontend/src/bus.ts` 的 `BusEvents`
- **frontend_parsers**（解析簇 parsers/ 自 backend 迁出）：`frontend/src/parsers/`：纯解析层，自 `backend/` 迁出（ADR-170 第一段）。含 YSM 头/摘要、NBT、体素（voxel）、zip 解包、pack.mcmeta、方块颜色映射六类解析器。真叶子层——…
- **frontend_test_audit**（前端测试基建审计）：2026-08-26 对测试基建层全量只读评审（两子代理并行）：`tests/*.mjs` 契约层（33 文件，核心 4039 LOC；`port-verification/` 为一次性迁移诊断工具不计分）+ `frontend/e2e`（…
- **global-handlers**（全局事件处理 global-handlers）：`core/handlers/global.ts` 是全应用唯一的 core 全局 handler 注册入口（致命陷阱 #2 的解法）：app-content 的 `connectedCallback` 调一次 `registerGloba…
- **i18n**（国际化 i18n 模块）：`i18n` 模块是 YSM 前端的唯一翻译层，基于 ADR-045 设计。`t.ts` 提供纯函数式翻译（按 key 查表），`locale.ts` 管理语言状态、持久化与异步加载。支持简体中文（基准）、英语、日语三种语言，语言偏好持久化…
- **i18n_accuracy**（i18n 翻译准确度扫描记录）：2026-08-28 对三语翻译包（zh-CN / en / ja）进行了系统性扫描，覆盖 13 个命名空间、4 种语义模式（Count 后缀、Opacity 后缀、Size 后缀、Material 后缀）。发现并修复 10 处"键名与翻译…
- **ik_solver**（CCD IK 求解器 ik-solver / 足部锚地 mmd-foot-ik）：自写精简版 CCD（Cyclic Coordinate Descent）IK 求解器（ADR-072 工具层纯净、零 DOM / 零 backend），
- **model-stats**（Web Worker 模型统计层 model-stats）：`frontend/src/workers/` + `frontend/src/backend/web-stats.ts` 是 ADR-071 审计增强 #7 新增的**Web Worker 批量模型统计层**，为网页版 `SearchMo…
- **page-store**（页面状态管理 page-store.ts）：`page-store.ts` 管理 YSM 的前端页面导航状态，是 `PageStore.currentPage` 的唯一数据源，替代了旧版 `window.__currentPage`。核心职责是维护只读当前页状态与启动初始页解析——*…
- **pointer-events**（Pointer Events 统一交互（触屏 + 桌面））：ADR-047 核心立项 A：全前端拖拽/缩放/旋转/hover 交互从 mouse 事件统一迁移 **Pointer Events**（`pointerdown/move/up` + `setPointerCapture` + CSS `…
- **theme**（主题系统 theme）：主题系统的实现在组件入口 `app-modules.ts`（无独立 theme.ts 文件）：提供 6 套主题皮肤（cyber/warm/pro/sakura/ocean/mint）+ `system` 跟随系统模式，全部通过在 `<bod…
- **wails-bridge**（Wails 桥接 app.ts）：`backend/app.ts` 是前端调用后端 Binding 的唯一入口。所有 Go 端方法通过 `getApp()` 获取，禁止直接通过 `window.go.main.App` 访问。**ADR-049 平台双路由**：网页版（无 …
- **ysm-baked**（YSM 烘焙与几何反推）：YSM 作者导出模型时，**cube 的语义参数（origin/size/uv/rotation）在导出时被烘焙为纯顶点面**，`RawYsmModel.RawCube.faces` 只保留「每面 4 顶点 + 法线 + 4 组 u/v」。…

## feature（12 张）

*业务功能（导入队列、同步、社区）*

| 标识 | 名称 | tier | 性能 | 关键词 |
|------|------|------|------|--------|
| 🏗 community-feature | 社区下载 community | architecture | io-bound | 创意工坊, 社区, 下载队列, 镜像源, 批量下载, github 仓库, 下载进度, workshop |
| 🏗 export | 截图导出 export | architecture | — | 截图, 导出 PNG, 多角度截图, 透明背景, 预览缓存, blob URL, saveScreenshot, renderMultiAngle |
| 🏗 import-queue | 全局导入执行 import-executor | architecture | io-bound | 导入, 导入队列, 拖拽导入, 文件夹导入, 覆盖导入, import, 拖拽 |
| 🏗 oldest-models | 资历最深模型 oldest-models | architecture | io-bound | 资历最深, 老模型, 仓库评分, 每日推荐, 月度活动, 热力图, 仓库健康 |
| 🏗 preview-controls | 3D 预览控制器（声明式菜单节点） | architecture | — | 3D 控制器, MMD 播放, 截图按钮, 相机控制, 模型切换 |
| 🏗 preview-settings | 预览面板设置与显示控制 | architecture | — | 预览设置, 显示控制, 骨骼名称, 帧率, 截图灯光 |
| 🍃 preview_3d_migration | preview-3d 领域根迁移 | leaf | — | 整目录搬家, 领域根提升, 相对引用修复, cmd 命令行限制, 目录归置 |
| 🏗 recycle-bin | 回收站界面 recycle-bin | architecture | io-bound | 回收站, 恢复文件, 清空回收站, 软删除, recycle, 还原 |
| 🏗 resource-packs | 资源包功能 resource-packs（已归档） | architecture | — | 资源包, 光影包, resourcepack, shaderpack |
| 🏗 search | 搜索筛选编排 search | architecture | — | 搜索, 筛选, 三路交集, adv-filter, SearchModels, 网页版降级 |
| 🏗 sync-manager | 整合包同步管理器 sync-manager | architecture | — | 整合包同步, 推送, 拉取, 跨组件同步编排, 缺包回拉, PullSingleResource, sync:download:missing |
| 🏗 version-updater | 版本更新 version-updater | architecture | io-bound | 更新, 升级, 检查更新, 新版本, 静默检查, updater, 版本 |

### 摘要

- **community-feature**（社区下载 community）：`features/community/` 是创意工坊（GitHub 模型仓库）浏览与批量下载的前端业务层，五个文件分工：`data.ts` 抓取远端 index.json（多镜像竞速）、`render.ts` 渲染站点卡片与模型列表、`e…
- **export**（截图导出 export）：> **差异化定位**：`utils-export.md`（utils 分类）回答"截图/缓存**怎么写**"（API 签名、淘汰策略、dispose 顺序）；本 feature 卡回答"用户点截图按钮后**发生了什么**"——从触发入口到…
- **import-queue**（全局导入执行 import-executor）：**2026-08-05 重构**：原 `import-queue.ts`（导入 tab UI 层）与 `ImportHistory`（内存导入历史）已全部删除。导入改为**全局静默执行**架构——拖拽/选择文件直接走 `import-ex…
- **oldest-models**（资历最深模型 oldest-models）：`oldest-models.ts` 实现仓库页「资历」tab（diagnostics/oldest 页面）的仪表盘：围绕 `ScanModelEntries` 扫描结果做本地统计，渲染四大板块——仓库评分（健康环）、资历最深 Top4（按…
- **preview-controls**（3D 预览控制器（声明式菜单节点））：> ⚠️ **重要前提（ADR-076 v2 Phase 2 重构后）**：相机操作已收编进**核心声明式根菜单**（⚙️ 按钮 → `mountPreviewRootMenu` 的 `camera` 项），底部导航弹窗已删除。现存的 `m…
- **preview-settings**（预览面板设置与显示控制）：> **重要前提**：预览面板设置**不是单一 settings 面板**，而是分散在 **3 域**（2D 显示控制 / 3D 全域状态层 / 截图 & 填充面板）。本 feature 卡汇总三域设置项的语义、持久化点、广播契约与相互依赖…
- **preview_3d_migration**（preview-3d 领域根迁移）：ADR-129 第三刀：把 `frontend/src/utils/3d/`（227 文件）整编搬迁到 `frontend/src/preview-3d/`。纯改名、收益最低、但暗礁最多。三刀顺序不可逆：第一刀正类型（依赖倒置修复）→ 第二…
- **recycle-bin**（回收站界面 recycle-bin）：`recycle-bin.ts` 实现仓库页「回收站」tab 的界面逻辑：列出 `.recycle` 中属于当前资源类型的已删除条目，提供单条恢复/永久删除、一键清空。由 app-content 首次切到 recycle tab 时懒加载调…
- **resource-packs**（资源包功能 resource-packs（已归档））：**已删除（2026-08-18）**。原 `frontend/src/features/resource-packs.ts` 是一个薄 wrapper，把仓库页的各类资源包 tab 统一委托给 `<app-resource-manager…
- **search**（搜索筛选编排 search）：搜索筛选的**跨层端到端编排层**：前端工具栏搜索输入 → 关键词 + 标签 + 数值三路交集 → 后端 Go 一次性过滤 → 白名单回填 `buildTree` 精确匹配。
- **sync-manager**（整合包同步管理器 sync-manager）：`app-sync-manager` 是一个 Web Component 视图组件（`<app-sync-manager>`），承担**单个整合包（instance）内「仓库 ↔ 实例」双向同步状态展示与逐文件推送/拉取编排**：
- **version-updater**（版本更新 version-updater）：`version-updater.ts` 是应用自更新的前端入口：启动时静默检查（受 6 小时频次限制）→ 发现新版本以可点击 toast 通知；设置页按钮手动检查 → 弹出带更新日志的 `modalConfirm` → 调 `DoUpda…

## go（43 张）

*Go 后端包（安装、下载、回收站、YSM 解析等）*

| 标识 | 名称 | tier | 性能 | 关键词 |
|------|------|------|------|--------|
| 🏗 app_cycle_injection | App↔子组件对象级环打破范式（回调注入） | architecture | — | 新增/重构 internal/app 下的子组件（队列、缓存、扫描器等），且它需要调用 App 的能力（发事件、写日志、下载文件等）, 评审 PR 时检查是否有人把 `*App` 反向指针重新加回某个子组件 struct, 想确认「循环依赖」现状：本仓仅剩包级（import）环由 go build 兜底，对象级环已清零 |
| 🏗 classify-routing | 分类路由与回归护栏 | architecture | — | 整合包分类, 路由, zipentry 指纹, 蓝图, 回归, last-wins |
| 🏗 cli_quality_audit | CLI 质量摸排 Checklist | architecture | — | CLI, 质量摸排, 代码审核, 代码审查, bug 排查, 审计, 白名单, 绑定层 |
| 🍃 doctor_gate_overlap | 质量闸门双调度器重叠审计 | leaf | — | 双调度器, 质量闸门重叠, doctor gate 差异, 治理红线下沉 |
| 🏗 drift-scan | drift-scan（双轨漂移检测） | architecture | — | 漂移检测, 双轨, 重复实现, 口径漂移, 常量硬编码, 错误链断裂, 资源泄漏, 定时器泄漏 |
| 🏗 fbx-cli-pipeline | FBX CLI 处理管线 fbx-cli-pipeline | architecture | — | FBX, CLI, 命令行, 转换, glTF, GLB, fbx2gltf, assimp |
| 🏗 go-android-platform-guard | Android 平台守卫（Go 侧） | architecture | — | Android、平台守卫, RevealInExplorer / OpenFolder / xdg-open, SAF / MANAGE_EXTERNAL_STORAGE, build-tag, pathmgr, RestartApplication / 重启, Node.js, watcher 守卫 / fsnotify |
| 🍃 go-avatar-decode | Go 头像提取：纯函数 vs Node+WASM 解码分界 | leaf | io-bound, single-thread | 改头像提取 / DecodeYSMFiles / ExtractAvatarURI 逻辑或补 avatar 测试时 |
| 🏗 go-avatar | 头像 go/avatar | architecture | io-bound | 头像, 作者, 创作者, avatar, 缓存, 头像缩略图 |
| 🏗 go-cli-search | CLI 搜索命令 search | architecture | — | CLI 搜索, 命令行搜索, search 命令, 关键词搜索, 数值范围搜索, 模型搜索, go run search, runSearch |
| 🍃 go-conc | 通用泛型并发工具 go/conc | leaf | — | 并发, 并行, worker 池, 批量并发, 输入序收集 |
| 🍃 go-config | Go 配置单持有点 go/config | leaf | — | 改配置注入/阈值逻辑，或消费包读阈值时 |
| 🏗 go-container | 统一容器桥接层 go/container | architecture | — | 容器, 解包, zip, 7z, ContainerReader, 归档, 压缩包, 目录容器 |
| 🏗 go-dedup | 去重 go/dedup | architecture | io-bound | 去重, 重复检测, dedup |
| 🏗 go-download | 下载器 go/download | architecture | io-bound, single-thread | 下载, 进度, download, 进度条, 下载进度 |
| 🏗 go-executil | 进程隐藏窗口 go/executil | architecture | — | 子进程隐藏控制台窗口, 跨平台 HideWindow, 外部进程启动 |
| 🏗 go-fileops | 文件操作 go/fileops | architecture | io-bound | 移动, 复制, 重命名, 删除, fileops, 启用禁用, .ban, ysm.json 整组操作 |
| 🍃 go-fsutil | 文件基础设施 go/fsutil | leaf | io-bound | 遍历, walk, 原子写, 复制, 硬链接, 跨设备 |
| 🏗 go-geometry | Geometry 存档 go/geometry | architecture | io-bound, memory-heavy | geometry, 基岩版, bedrock, 模型解析, zip, 7z, 纹理, 动画 |
| 🏗 go-importer | 导入策略 go/importer | architecture | io-bound | 导入, 策略, 导入队列, importer |
| 🏗 go-installer | 模型安装 go/installer | architecture | io-bound | 安装, installer, 模型导入, 下载模型 |
| 🏗 go-instance | 整合包实例 go/instance | architecture | io-bound | 整合包, 实例, 版本实例, VersionInstance, 同步项, BuildSyncItems, 资源同步 |
| 🍃 go-launcher | 启动器实例发现 go/launcher | leaf | — | 改启动器发现/实例目录解析逻辑时 |
| 🏗 go-litematic | Litematic 解析 go/litematic | architecture | — | 投影, litematic, schematic, nbt, 蓝图, 体素, 方块 |
| 🏗 go-logs | 导入日志 go/logs | architecture | io-bound | 导入日志, 操作记录, 操作日志, import log, 历史 |
| 🏗 go-packs | 资源包 mcmeta go/packs | architecture | io-bound | 资源包, 光影包, mcmeta, pack_format, 包封面缩略图, 类型检测 |
| 🏗 go-paths | 路径安全 go/paths | architecture | — | 路径, 安全, path, 路径校验 |
| 🏗 go-recycle | 回收站 go/recycle | architecture | io-bound | 回收站, 删除, 恢复, recycle, 软删除 |
| 🏗 go-repoaudit | 仓库审计 go/repoaudit | architecture | io-bound, memory-heavy | 仓库审计, 健康分数, 完整性检查, 缓存命中率, repoaudit, health-report, 去重 |
| 🏗 go-scanner | 扫描核心 go/scanner | architecture | io-bound, concurrent | 扫描, 扫描条目, 文件树, 哈希, 缓存, 作者提取, ScanEntries, 索引生成 |
| 🏗 go-sync | 整合包同步 go/sync | architecture | io-bound | 整合包, 同步, 硬链接, 缺失, 多余 |
| 🏗 go-tags | 标签系统 go/tags | architecture | io-bound | 标签, tag, 分类, tag-editor |
| 🍃 go-testutil | 测试辅助函数 go/internal/testutil | leaf | — | 跨包复用测试 helper, 创建测试文件, 构造内存 ZIP |
| 🏗 go-threejs | 3D 骨骼 spec go/threejs | architecture | cpu-bound, concurrent | 3D 预览, 骨骼, three.js, spec, 顶点, UV, 四元数, 模型渲染 |
| 🏗 go-types | 共享类型 go/types | architecture | — | 共享类型, AppConfig, 配置, 注册表, 扩展名, LinkType, BedrockModel |
| 🏗 go-updater | 自动更新 go/updater | architecture | io-bound | 自动更新, 版本升级, updater |
| 🍃 go-version | 版本号 go/version | leaf | — | 版本, version, ldflags |
| 🏗 go-watcher | 文件监听 go/watcher | architecture | io-bound | 监听, 文件变化, 刷新, watcher |
| 🏗 go-ysm-parser | YSM 解析 go/ysm | architecture | io-bound | YSM, 解析, 摘要, ysm 文件, 元数据 |
| 🏗 go_design_critique | Go 后端设计锐评 | architecture | — | Go 后端评审, Go 锐评, Go 可读性审查, Go 命名审查, Wails 绑定审查, 隐式协议审查 |
| 🏗 go_ts_golden | Go-TS 解析层 golden 对拍（ADR-154 双端互锁） | architecture | — | 网页影子层（TS 平移 Go 的解析函数）与 Go 侧口径是否漂移, 新增/修改 resource_types.json 的 zipEntries 指纹后是否影响 Go-TS 一致性, voxel-colors-data.json 生成物是否过期（Go 表变更未同步前端）, 双端互锁契约 fixture 的更新口径 |
| 🏗 rustbridge | Rust 桥 rustbridge | architecture | io-bound, concurrent | Rust 扫描器, rust_backend, 桥 DLL, Wails 后端迁移 Rust |
| 🏗 wails-bindings | Wails Binding API 总览 internal/app | architecture | — | API, Binding, 调用后端, getApp, 方法签名, app.ts 绑定 |

### 摘要

- **app_cycle_injection**（App↔子组件对象级环打破范式（回调注入））：`internal/app` 是 Wails 绑定层（`package app`），`App` 是 god-object，持有若干子组件
- **classify-routing**（分类路由与回归护栏）：整合包分类的「路由不变量 + 回归护栏」设计备忘录。核心结论：**location 路由只在「同文件夹 = 同类型」时成立；一旦出现「同文件夹多类型」，必须降级到内容指纹（zipentry/ysm/mcmeta/shader），且各容器型需…
- **cli_quality_audit**（CLI 质量摸排 Checklist）：本文档记录 YSM 项目 Go CLI 层（`go/cli/` + `internal/app/` + `frontend/src/services/`）代码审核的**高频问题模式**与**修复 Checklist**。2026-08-19…
- **doctor_gate_overlap**（质量闸门双调度器重叠审计）：2026-08-14 摸排结论：推送测试链路本身不臃肿，但质量闸门体系存在**双调度器 + 双重实现**，约 250 行重复逻辑，已出现参数漂移。
- **fbx-cli-pipeline**（FBX CLI 处理管线 fbx-cli-pipeline）：**CLI 模式处理 FBX 的成熟路径，不是「Go 直接解析 FBX」，而是「现成转换器转中间格式 + 成熟库读取」的双段式**：
- **go-android-platform-guard**（Android 平台守卫（Go 侧））：ADR-047「平台守卫批量」：Go 侧对 Android 上**无效或不适用的桌面能力**显式拒绝/降级，避免 `xdg-open`/`exec` 链静默失败（错误分类反模式——失败要可见）。结合既有的 build-tag 平台双文件（`…
- **go-avatar-decode**（Go 头像提取：纯函数 vs Node+WASM 解码分界）：`go/avatar` 提取作者头像有**两条路**：纯 Go 函数链（零 IO、零 WASM）与 `DecodeYSMFiles`（Node.js + WASM glue 子进程解码 .ysm）。**包头「不依赖 Wails runtim…
- **go-avatar**（头像 go/avatar）：`go/avatar/` 包负责创作者头像的提取与缓存：从模型文件（.ysm 二进制 / .zip / 解压目录 .json）的 `metadata.authors[].avatar` 声明中取出头像图片，缓存到**平台配置根 `os.Us…
- **go-cli-search**（CLI 搜索命令 search）：`go/cli/model.go` 的 `search` 命令是 YSM CLI 模式的模型搜索入口，注册为 `RegisterCommandC("search", CatModel, "搜索模型（支持关键词过滤）", runSearch)…
- **go-conc**（通用泛型并发工具 go/conc）：`go/conc` 提供唯一泛型并行入口 `Parallel[T,R]`，收敛 `internal/app` 三处手写 worker 池（`app_scan.go:runConcurrentAnalyze` / `app_model.go:…
- **go-config**（Go 配置单持有点 go/config）：运行阈值配置的共享单持有点（ADR-091 D12 收敛）：fileops/logs/download/scanner 原各持一份 `var configFunc func() types.AppConfig` 全局变量（写读无同步、仅靠启…
- **go-container**（统一容器桥接层 go/container）：`go/container/` 包是统一容器桥接层（ADR-068）：收敛 ysm/geometry/avatar/packs 各自独立的「打开容器→找条目」实现（调研实测 zip.OpenReader 10 处 / zip.NewRead…
- **go-dedup**（去重 go/dedup）：`go/dedup/` 包提供资源去重检测，避免重复导入相同资源。
- **go-download**（下载器 go/download）：`go/download/` 包负责模型资源的纯 HTTP 下载（不依赖 Wails runtime），支持 ctx 取消中断、进度回调与失败半文件清理。镜像回退策略（raw/jsd/api 排序）在 `internal/app/app_d…
- **go-executil**（进程隐藏窗口 go/executil）：`go/executil/` 包提供跨平台的外部进程执行工具，当前唯一功能是 **HideWindow**：在 Windows 上隐藏子进程控制台窗口，其他平台为 no-op。
- **go-fileops**（文件操作 go/fileops）：`go/fileops/` 包实现文件 CRUD + 移动/复制/删除 + 文件夹整组导入 + 预览提取 + 启用禁用（ADR-003 P3 下沉，薄壳 `internal/app/app_files.go` 仅转发）。
- **go-fsutil**（文件基础设施 go/fsutil）：`go/fsutil/` 是 Go 侧文件系统基础设施包，按 ADR-044 策略 A 收敛自多包重复实现。覆盖 7 大职能：文件/目录遍历、原子写入、原子复制、权限常量、硬链接判定、跨设备错误判定、UTF-8 BOM 剥离、zip/7z …
- **go-geometry**（Geometry 存档 go/geometry）：`go/geometry/` 包解析 Bedrock（基岩版）`minecraft:geometry` 模型：既支持单个 geometry JSON，也支持从 ZIP/7z 存档中按 `ysm.json` 清单合并多个模型文件、提取纹理与动…
- **go-importer**（导入策略 go/importer）：`go/importer/` 包分两块：`importer.go` 的**按资源类型注册的复制策略表**（`Handler` 接口，供本地路径导入/安装复用），以及 `importer_file.go` 的 **base64 单文件导入核心…
- **go-installer**（模型安装 go/installer）：`go/installer/`（单文件 `installer.go`）负责把仓库中的模型/资源文件**落地**到 Minecraft 整合包实例目录：按 `LinkMode`（`copy` / `hardlink` / `symlink`）…
- **go-instance**（整合包实例 go/instance）：`go/instance/` 包处理整合包（Minecraft 版本实例）的资源同步项构建，是 `app_install.go` 中 `GetInstanceSyncStatus` Binding 的下沉逻辑。
- **go-launcher**（启动器实例发现 go/launcher）：桌面启动器 Minecraft 实例发现：识别用户所选启动器（HMCL / PCL / Minecraft 官方），并把每个 MC 版本解析到实际运行目录与 YSM 自定义目录（`config/yes_steve_model/custom`…
- **go-litematic**（Litematic 解析 go/litematic）：`go/litematic/` 包解析 Minecraft 建筑蓝图文件：Litematica 投影（`.litematic`，NBT gzip）、MCEdit 旧版 `.schematic`、原版结构 `.nbt`，产出元数据、方块统计（…
- **go-logs**（导入日志 go/logs）：`go/logs/` 包提供两套互不相干的日志设施：**操作日志**（`Logger`，持久化）把导入/扫描/下载/同步/重命名/删除/UI 报错等操作的成败结果写入用户配置目录下的 `ysm-import-logs.json`；**运行时…
- **go-packs**（资源包 mcmeta go/packs）：`go/packs/` 包解析 Minecraft 资源包/光影包的 `pack.mcmeta`（目录或 ZIP 两种形态），提取 pack_format 版本信息与 pack.png 缩略图，并承担「一个文件到底属于哪种资源类型」的内容级…
- **go-paths**（路径安全 go/paths）：`go/paths/` 包提供路径安全校验，防止路径穿越攻击和非法路径访问。
- **go-recycle**（回收站 go/recycle）：`go/recycle/` 包实现模型的软删除机制，通过硬链接/符号链接判定 + `.recycle` 目录实现可恢复删除。核心是 `TrashManager` 结构体（`New(root)` → `root/.recycle`），包级函数…
- **go-repoaudit**（仓库审计 go/repoaudit）：`go/repoaudit/` 包提供仓库健康审计核心逻辑——资源扫描、完整性校验、缓存状态、健康分数、警告生成、去重汇总。从 `go/cli`（原 `resource.go` 的 `collectRepoHealth`）提取为独立包，CL…
- **go-scanner**（扫描核心 go/scanner）：`go/scanner/` 包实现仓库文件扫描、哈希计算、缓存失效、作者提取、索引生成（ADR-003 P2 下沉，薄壳 `internal/app/app_scan.go` 仅保留依赖 App 的方法）。
- **go-sync**（整合包同步 go/sync）：`go/sync/` 包负责模型库（全局仓库）与 Minecraft 整合包实例之间的同步：发现实例（原版 / PrismLauncher 布局）、按 SHA256 哈希对比出缺失/多余/禁用文件、按文件名或文件夹对比资源包差异、检测目标文…
- **go-tags**（标签系统 go/tags）：`go/tags/` 包提供模型标签的线程安全持久化存储，是前端 tag-editor 弹窗的后端。标签存放在配置目录的 `tags.json`，以文件绝对路径为 key、标签列表为 value，与模型文件本身解耦（移动/链接模型不污染文件…
- **go-testutil**（测试辅助函数 go/internal/testutil）：`go/internal/testutil/` 包提供跨包复用的 Go 单元测试辅助函数，解决原先各包各自实现同名 helper 导致的重复维护问题。
- **go-threejs**（3D 骨骼 spec go/threejs）：`go/threejs/` 包根据 YSMViewer 的 `ThreeJsPayloadBuilder.cs` 移植，把已解析的 `types.BedrockModel` 转换为 Three.js 可直接消费的 JSON spec：顶点、…
- **go-types**（共享类型 go/types）：`go/types/` 包是全应用的共享类型层：应用配置（AppConfig）、各子系统交换的数据结构（模型条目/实例状态/同步结果/日志/投影元数据等）、以及资源类型注册表的 Go 端加载与扩展名查询。与 [resource_regist…
- **go-updater**（自动更新 go/updater）：`go/updater/` 包负责 YSM 应用的自动更新机制。
- **go-version**（版本号 go/version）：`go/version/` 只有一件事：持有应用版本号。默认 `"dev"`，发版构建时通过 `-ldflags -X` 注入正式版本，供界面展示与自动更新的版本比较。
- **go-watcher**（文件监听 go/watcher）：`go/watcher/` 包监听资源目录的文件系统变化，触发前端资源树刷新。
- **go-ysm-parser**（YSM 解析 go/ysm）：`go/ysm/` 包负责解析 YSM（Yuan's Sketch Model）格式文件，提取模型元数据并生成结构化摘要。
- **go_design_critique**（Go 后端设计锐评）：2026-09-03 三路子代理并发只读锐评（IO/扫描域 / 二进制解析域 / Wails 绑定与应用域），主模型对每份报告最强断言逐条实地抽查背书，**无幻觉指控**（3 处过激指控已被主模型仲裁修正，见「仲裁修正」）。安全防御层行业级…
- **go_ts_golden**（Go-TS 解析层 golden 对拍（ADR-154 双端互锁））：网页版（无 Go 壳）把整层 Go 解析逻辑平移成 TS 影子层（ADR-049 web 豁免 + ADR-070/066/082「TS 镜像 Go」），双实现漂移是永久负债。ADR-154 以共享 fixture（`tests/parit…
- **wails-bindings**（Wails Binding API 总览 internal/app）：`internal/app/` 是 Go 端唯一的 Wails Binding 入口层：所有导出给前端的方法都定义在 `*App` 上，业务逻辑下沉到 `go/*` 包，本层只做参数转发与窗口/事件/对话框编排。前端统一经 `getApp(…

## rendering（12 张）

*3D 渲染与预览核心（preview-core、model2d/3d、perception、render-federation）*

| 标识 | 名称 | tier | 性能 | 关键词 |
|------|------|------|------|--------|
| 🍃 bone-tools | 跨格式骨骼工具层 bone-tools | leaf | cpu-bound | 骨骼工具, 骨骼树, 骨骼拾取, BoneNode, BoneTree, buildBoneTree |
| 🍃 ground-cap-materialgroup-factories | ground-cap 材质菜单工厂（material-group factories） | leaf | cpu-bound | 拆 buildGroundMaterialGroup 长函数, 评审 ground-capability.ts 菜单构建 |
| 🍃 ground_surface_spec | 地面材质 spec 单一事实源 ground-surface-spec | leaf | cpu-bound | 地面材质 / 地面贴图 / 地板 / surface, 材质重建与原地更新的判别（needsRebuild）, 程序化纹理生成（solid/plain/grid/checker/stripes/diamond/marble 像素）, 自定义图片上传到地面（TextureLoader）, GroundMaterialSpec / specKey / textureToken |
| 🍃 mc-ao-tint | MC 环境光遮蔽(AO) 权重 + biome 配色 参考实现 | leaf | cpu-bound | MC 方块模型 AO / 平滑光照, biome tint / 草叶水配色 / 4 类 tint, pack-model-adapter 材质升级后续（ADR-080）, 顶点色遮蔽权重 |
| 🏗 model2d | 2D 预览渲染 model2d | architecture | cpu-bound | 2D 预览, 骨骼图, Canvas 渲染, 前视图, 骨骼热区, 鼠标拾取, 线框图 |
| 🏗 model3d | 3D 预览渲染 model3d | architecture | memory-heavy, gpu-bound | 3D 渲染层, Three.js, 相机, 骨骼渲染, 自由相机, 3D 截图, 纹理加载, spec 兜底 |
| 🍃 mount-preview-module-singleton-race | mount3D 并发竞态（已闭环 — _gen 代际守卫） | leaf | concurrent | mount3D 并发竞态（已闭环）, 评审模块级单例守卫（历史） |
| 🍃 mount3d-584-giant | mount3D 巨函数现状（2026-08-27 已部分拆分） | leaf | gpu-bound | 拆 mount3D 巨函数, 评审 mount-preview-core.ts |
| 🏗 perception | 3D 感知系统 perception | architecture | cpu-bound | 自主动画, 眨眼, 节拍检测, 模型感知 |
| 🏗 preview_core | 统一 3D 预览核心 preview-core | architecture | gpu-bound | 3D 预览, 统一预览外壳, 程序化天空 / sky / 背景 / scene.background, PreviewAdapter 适配器, 全模型预览（YSM / VRM / MMD / Litematic）, mount3D |
| 🏗 render-federation | 联邦渲染能力 (Render Federation) | architecture | gpu-bound | 联邦渲染, shared renderer, rAF 复用, 多 3D 场景 |
| 🏗 scene_capability_registry | 场景能力注册表 scene-capability-registry | architecture | gpu-bound | 场景能力 / cap / registry / SceneCapability, 3D 菜单控件声明式渲染（getMenuControls）, 新增 3D 能力（雾/阴影/反射/环境/灯光/后处理）, 3D 会话生命周期（createAll / loadAll / setPreset / saveAll / dispose）, 「光」指代消歧（light 是光源，fog/shadow/reflector 不是） |

### 摘要

- **bone-tools**（跨格式骨骼工具层 bone-tools）：`frontend/src/preview-3d/bone-tools.ts` 是 ADR-072 落地后新增的**跨格式骨骼工具层**，屏蔽 YSM spec 扁平 bones 声明与 VRM humanoid Object3D 层级树两…
- **ground-cap-materialgroup-factories**（ground-cap 材质菜单工厂（material-group factories））：`ground-capability.ts` `buildGroundMaterialGroup` 约 55 行（T2 工厂化后从 133 行降至 <60 行），构建「表面材质」菜单组 14 个控件。已按建议抽 `groundSliderD…
- **ground_surface_spec**（地面材质 spec 单一事实源 ground-surface-spec）：ADR-117：GroundCapability 的表面材质层（`ysm-ground-surface`，y=0.005 介于网格 y=0 与水面 y=0.01）。架构移植自 MikuMikuAR ADR-226「GroundMateria…
- **model2d**（2D 预览渲染 model2d）：Canvas 2D 渲染基岩版模型骨骼的线框/正交投影图（前视图 + 可选 Y 轴旋转），是预览面板的轻量视图；与 [model3d](./model3d.md) 共享同一套 Bedrock 几何口径。
- **model3d**（3D 预览渲染 model3d）：前端 Three.js 3D 渲染层（`frontend/src/preview-3d/`），**单会话架构**：场景/相机/渲染器/控制器由统一预览核心 `mount3D`（ADR-066）持有单实例，模型内容经适配器（ysm/vrm/m…
- **mount-preview-module-singleton-race**（mount3D 并发竞态（已闭环 — _gen 代际守卫））：**已闭环**。`mount-preview-core.ts:164` 声明模块级 `let _gen = 0`，`mount3D` 入口（L271）`const myGen = ++_gen` 捕获本次挂载的代数。此后三处 `await`…
- **mount3d-584-giant**（mount3D 巨函数现状（2026-08-27 已部分拆分））：`mount3D`（mount-preview-core.ts:263-866）**604 行**，仍超 100 行红线。文件总量 **1202 行**，已拆出 5 个包级 `mp*` 子函数（`mpUnloadRole` L926-964…
- **perception**（3D 感知系统 perception）：`preview-3d/perception/` 是实现模型「自主生命感」的感知层子系统：让 Minecraft 角色自动眨眼、呼吸、注视、对口型、随音乐律动。
- **preview_core**（统一 3D 预览核心 preview-core）：ADR-066 落地的**统一 3D 预览核心**，收缴 vrm / litematic 复制脚手架（旧实现各内联 \~250 行同构），成为所有富格式 3D 预览的**单一事实来源外壳**。内容差异经 `PreviewAdapter.bu…
- **scene_capability_registry**（场景能力注册表 scene-capability-registry）：ADR-073 扩展落地的**场景能力注册表**：所有场景能力（Sky / Ground / Environment / Fog / Shadow / Reflector / Light / Postprocessing）由统一注册表**创…

## ui（34 张）

*前端 UI 组件（tree、sidebar、preview、content）*

| 标识 | 名称 | tier | 性能 | 关键词 |
|------|------|------|------|--------|
| 🍃 3d-oversize-file-codesplit-feasibility | 3D 层超大文件 code-split 可行性 | leaf | cpu-bound | code-split, 超大文件, mmd-adapter, 拆分可行性 |
| 🏗 3d-patterns | 3D 区审核与修复模式提炼 | architecture | — | 3D 渲染循环优化, Vector3 复用, 纹理缓存, AbortController 事件管理, 资源生命周期 dispose, 循环依赖破壁, 审核驱动开发, 并发防护 gen 守卫 |
| 🏗 app-content | 主内容页 app-content | architecture | — | 主内容区, 页面切换, nav:change, 仓库页, 全局 handler |
| 🏗 app-modules | 组件入口 app-modules | architecture | io-bound | 组件入口, 模块装配, 启动流程, 主题初始化, 服务注册, 检查更新 |
| 🍃 app-nav | 顶部导航 app-nav | leaf | — | 导航栏, 导航, 切页, nav:change, 菜单, 页面记忆, 版本号 |
| 🏗 app-preview | 预览面板 app-preview | architecture | — | 预览, 模型预览, 3D 预览, Litematic, WASM 解码 |
| 🏗 app-sidebar | 侧边栏 app-sidebar | architecture | — | 侧边栏, 整合包列表, 版本卡片, 推送, 拉取, 同步状态卡片 |
| 🏗 app-sync-manager | 整合包同步页 app-sync-manager | architecture | io-bound | 整合包同步, 同步状态, 推送资源, 拉取资源, 待推送, 可拉取, 已禁用, 实例资源 |
| 🍃 app-toast | Toast 通知 app-toast | leaf | — | toast, 通知, 提示, 消息, 撤销, 反馈, 报错提示 |
| 🏗 app-tree | 资源树 app-tree | architecture | — | 树形, 资源列表, tree, 节点, 树, 目录树 |
| 🏗 app_content_diagnostics | 诊断与冲突页 diagnostics | architecture | cpu-bound, gpu-bound, concurrent | 诊断页, 冲突, 去重流程, 诊断页日志 tab, 性能, oldest |
| 🍃 app_content_settings | 设置页 settings | leaf | — | 设置页, 主题设置, 键位, 路径配置, 界面偏好 |
| 🍃 app_content_site | 创意工坊站点视图 site | leaf | — | 创意工坊, 站点视图, 浏览模式, 卡片拖拽, workshop-data |
| 🏗 context-menu | 右键菜单系统 | architecture | — | 右键菜单, 右键, 上下文菜单, ctx:show, menu:show, 批量操作, 移入回收站 |
| 🏗 dialog-adv-filter | 高级筛选 adv-filter | architecture | — | 高级筛选, 筛选, 骨骼数, 立方体, 纹理尺寸, 按标签筛选, 条件过滤 |
| 🏗 dialog-batch-rename | 批量重命名 batch-rename | architecture | — | 批量重命名, 批量改名, 查找替换, 正则替换, 统一作者, 预设, batch-rename |
| 🏗 dialog-modal | 弹窗基座 modal | architecture | — | 弹窗, 对话框, 确认框, 输入框弹窗, 下拉选择弹窗, modal, prompt, confirm |
| 🏗 dialog-rename | 重命名弹窗 rename | architecture | — | 重命名, 改名, 命名规范, 作者 品牌 角色, rename, 读取头部 |
| 🏗 dialog-tag-editor | 标签编辑器 tag-editor | architecture | — | 标签, 打标签, 编辑标签, tag, 标签弹窗, 分类标记 |
| 🏗 dom-fab | 3D 预览悬浮 FAB 控制层 | architecture | — | FAB, 悬浮按钮, FAB 3D 预览入口, overlay, ADR-057 |
| 🏗 features_dialogs | 业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选) | architecture | — | 批量重命名 / 标签编辑 / 高级筛选对话框, 找对话框入口符号 |
| 🏗 frontend_design_critique | 前端设计锐评 | architecture | — | 设计评审, 前端设计, 锐评, 主题系统, 3D 性能审查, 生命周期审查, 技术债 |
| 🍃 frontend_naming | 前端命名章程（黑话治理） | leaf | — | 黑话, 命名, 缩写, 重命名, 可读性, 匈牙利前缀, 单字母变量, 动词名词化 |
| 🏗 frontend_repo_audit | 前端 TS 整包审计 | architecture | — | 代码审核, 代码审查, 审计, 前端质量, 技术债, 重构排期, XSS, innerHTML |
| 🏗 multi_model_select | 多模型选择菜单原语 multiModelSelectNode | architecture | gpu-bound | 多模型, 模型选择, select, zip 多模型, 多 entry, ADR-132 |
| 🏗 preview_menu_session_key | preview-menu-session-key | architecture | — | schema 注册, per-scene, 多模型同框, schema 键冲突, activeComponent, 组件选择, YSM maid 同台, sessionId |
| 🍃 preview_menu_settings_state | 3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125） | leaf | — | 新增 3D 预览设置项, 新增 cap 想让某个开关出现在设置面板, 排查设置项改了不生效 / 重开面板值不对, 排查条件显隐控件不出现, ADR-125 三块落地状态核对 |
| 🍃 preview_panel_declarative | 3D 预览面板内容声明式化通道（ADR-126 P4-B） | leaf | gpu-bound | 新增 3D 预览面板内容（统计 / 纹理 / 按钮组 / 信息卡）, 评估"面板内容该走 renderCustom 还是 children 声明式", 排查面板内容不出现 / 渲染通道冲突, P4-B 子步（1→2→3）状态通道复用参考 |
| 🍃 preview_state | 3D 预览全域状态层（ADR-126 P4-A） | leaf | — | 新增 3D 预览面板跨 cap 设置项, 排查预览面板状态改了不生效 / 重开面板值不对, 排查条件显隐控件不出现, P4 子步（A→B→D→C）状态通道复用参考, 评估"某状态是否应进 previewState vs 留在 sceneRegistry/SlideMenu/节点字段" |
| 🍃 shared-styles | 共享样式 shared-styles | leaf | — | 共享样式, 按钮样式, btn-base, focus-visible, tree 样式, Shadow DOM 样式, CSS 变量 |
| 🏗 test-utils | 测试工具 test-utils（G-1 抗脆弱测试基础设施） | architecture | — | 测试工具, testid, getByTestId, waitFor, sleep, flaky, 异步等待, 组件测试 |
| 🍃 toolbar-search | 工具栏搜索编排 toolbar-search | leaf | — | 搜索编排, 高级筛选, 关键词搜索, 数值范围搜索, 标签过滤, 多线程统计角标, 降级提示 |
| 🍃 ui-slide-menu | ADR 去桶化 slide-menu 外壳组件 | leaf | — | slide-menu, slide 菜单, 去桶化, 两级菜单, 轻量导航栈, createSlideMenu, slideRow |
| 🏗 ui_components | UI 组件库 ui-components | architecture | — | UI 组件, 卡片组件, 折叠面板, 加载动画, 滑块, 行组件, 预设, 图标 |

### 摘要

- **app-content**（主内容页 app-content）：`app-content` 是应用的主内容区组件（Shadow DOM + adoptedStyleSheets），承载 6 个页面：模型仓库（repository）、整合包管理（instances）、创作者频道（workshop）、创意工…
- **app-modules**（组件入口 app-modules）：`app-modules.ts` 是前端所有 ES module 组件的统一装配入口：注册可替换服务、按「轻量静态 + 重量级动态」策略导入全部 Web Components、注册右键菜单映射、初始化主题与 UI 偏好、静默检查更新。新增组…
- **app-nav**（顶部导航 app-nav）：`app-nav` 是应用的主导航菜单组件（Shadow DOM，渲染为左侧固定栏），列出模型仓库、整合包管理、创作者频道、创意工坊、诊断与冲突、设置 6 个入口，底部显示应用版本号。它是 `nav:change` 事件的唯一派发源，并在启…
- **app-preview**（预览面板 app-preview）：`app-preview` 是仓库页右侧的预览面板组件（Shadow DOM），按 `model:select` 事件驱动。负责 YSM 模型的详情 / 2D 骨骼 / 3D 预览、Litematic 蓝图 3D 预览、资源包与光影包信息展…
- **app-sidebar**（侧边栏 app-sidebar）：`app-sidebar` 是仓库页左栏的整合包列表组件（Shadow DOM），展示当前资源类型下各整合包（Minecraft 版本实例）的同步状态卡片，支持选中联动、勾选批量推送/拉取、一键安装缺失资源。它遵循标准组件拆分规范（inde…
- **app-sync-manager**（整合包同步页 app-sync-manager）：`app-sync-manager` 是整合包管理页内嵌的同步状态面板（light DOM），由 `app-content` 在收到 `package:selected` 后以 `<app-sync-manager instance="版本…
- **app-toast**（Toast 通知 app-toast）：`app-toast` 是全局 Toast 通知组件（Shadow DOM，固定悬浮于视口底部居中），是全应用唯一的操作反馈出口。治理红线要求所有异常路径必须有 toast 反馈，各模块统一通过 `bus.emit("toast:show"…
- **app-tree**（资源树 app-tree）：`app-tree` 是 YSM 核心的资源目录树组件，使用 Web Components 实现，支持展开/折叠、右键菜单、文件图标显示。
- **app_content_diagnostics**（诊断与冲突页 diagnostics）：`diagnostics/` 是 `app-content` 的「诊断与冲突」页子域（6 个 tab：冲突 / 日志 / 体检 / 去重 / 性能 / 资历），由主卡 `app-content` 的 `init-pages.ts` 在切到诊…
- **app_content_settings**（设置页 settings）：`settings/` 是 `app-content` 的「设置」页子域，由主卡 `app-content` 的 `init-pages.ts` 在切到设置页时分发初始化。内部高内聚：`init.ts` 汇聚全部子模块（键位 / 路径卡 /…
- **app_content_site**（创意工坊站点视图 site）：`site/` + `site-view.ts` 是 `app-content` 的「创意工坊站点」页子域，由主卡 `app-content` 的 `init-workshop.ts` 调用 `renderSiteView` 组装。内部高内…
- **context-menu**（右键菜单系统）：右键菜单系统采用「声明与行为分离」的三层结构：`menu-defs.ts` 声明菜单结构（唯一事实来源），`core/context-menus.ts` 把 `ctx:show` 事件翻译成带行为的 `menu:show` 载荷，`view…
- **dialog-adv-filter**（高级筛选 adv-filter）：`adv-filter.ts` 提供模型高级筛选弹窗：关键字 + 骨骼数/立方体数/纹理尺寸三组数值范围 + 标签名，采集后返回结构化条件对象交给调用方执行搜索。控件集合与后端 `SearchModels` 的能力严格对齐（6 个范围参数 …
- **dialog-batch-rename**（批量重命名 batch-rename）：`batch-rename.ts` 提供目录级批量重命名弹窗：接收文件条目列表，用 `parseModelName` 逐个解析出作者/作品/角色/日期，支持两种模式——「解析格式」（统一作者/作品批量改写）与「查找替换」（字面量或正则，含 …
- **dialog-modal**（弹窗基座 modal）：`modal.ts` 是全应用统一的模态弹窗基座：提供 prompt（带输入框）、select（下拉选择）、confirm（确认）、picker（富列表选择）四种 Promise 化弹窗，以及共享的转义、关闭动画、活动弹窗单例管理。所有业务…
- **dialog-rename**（重命名弹窗 rename）：`rename.ts` 提供单个模型的结构化重命名弹窗：把文件名按 `[作者]【品牌】角色-变体 (年月).ext` 规范拆成五个输入框，实时预览新文件名，可选「📖 读取头部」从 YSM 文件头提取作者/介绍。弹窗只负责产出新文件名，实际落…
- **dialog-tag-editor**（标签编辑器 tag-editor）：`tag-editor.ts` 提供单个模型的标签编辑弹窗：加载该模型已有标签与全库已有标签，支持手工输入新标签（Enter 或「+ 添加」）与从建议列表点选，删除标签用标签内 ✕ 按钮。保存时把最终标签列表写回后端 go/tags Sto…
- **dom-fab**（3D 预览悬浮 FAB 控制层）：3D 预览悬浮控制层组件（ADR-057），替代 `skeleton.ts` 内联 `style.cssText` 控制栏，集中治理样式 + 双端响应式。FAB 挂载在 document.body（light DOM），样式通过 `ensu…
- **features_dialogs**（业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选)）：`frontend/src/features/dialogs/`：业务对话框目录，自 `utils/dom/dialogs/` 升格（ADR-170 第一段）。批量重命名、标签编辑器、高级筛选、通用 modal 底座九对源+测试在此归位——…
- **frontend_design_critique**（前端设计锐评）：2026-09-03 三子代理并发只读锐评（架构 / UI/UX / 3D性能），主模型对每份报告的最强断言逐条实地抽查，**无幻觉指控**。基线：`frontend_repo_audit`（2026-08-26，4.1/5，偏代码质量）。…
- **frontend_naming**（前端命名章程（黑话治理））：2026-09 ADR-161「渲染会话词汇章程」实施时扩大扫描 `frontend/src` 404 个生产 TS 文件，发现命名黑话远超章程六类，按模式统计：
- **frontend_repo_audit**（前端 TS 整包审计）：2026-08-26 按 `.trae/skills/ts-package-review/SKILL.md` 对 `frontend/src/` 全量只读评审（七个子代理并行，排除 vendor）。前置：type-consistency 全…
- **multi_model_select**（多模型选择菜单原语 multiModelSelectNode）：跨资源类型的「多模型选择」声明式 select 菜单原语（ADR-132）。收编了此前三套并存的
- **preview_menu_session_key**（preview-menu-session-key）：3D 预览面板的受控 schema 注册（`schema-registry.ts`）用「per-scene 唯一 key」保证多模型同台
- **preview_menu_settings_state**（3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125））：ADR-085（菜单单一事实来源）采纳的 S1 注册表、S3 refreshDock 已落地，**S2「状态单向流」只落了 bind 回写，未落统一状态源**——横切设置项各自有独立读写通道，声明式 Schema 的 `control.bi…
- **preview_panel_declarative**（3D 预览面板内容声明式化通道（ADR-126 P4-B））：ADR-125 把**设置面板**的控件统一到 `MenuControlDef[]`（B 层单渲染器）。ADR-126 P4-B 把同一方向的**面板内容**（统计/纹理/按钮组/信息卡——非控件的内容展示）也声明式化：panel 节点带 …
- **preview_state**（3D 预览全域状态层（ADR-126 P4-A））：ADR-125 P1 把 ADR-085 S2「状态单向流」在**设置面板**落地（原 `settings-state.ts` / 六项横切）。ADR-126 P4-A 把该模式**升格到 3D 预览全域**——本文件是升格后的形态，是 P…
- **shared-styles**（共享样式 shared-styles）：两个样式模块为 Shadow DOM 组件提供可复用的 CSS 字符串：`utils/dom/css.ts` 导出全应用统一的按钮体系 `.btn-base` 与通用 focus-visible 规则；`views/app-tree/app…
- **test-utils**（测试工具 test-utils（G-1 抗脆弱测试基础设施））：`frontend/src/test-utils/` 是组件测试统一工具层（ADR-035 G-1 / Design.md §19.1）。查询走 `data-testid` 稳定钩子（不绑定 CSS 类/文案），等待走轮询（替代固定 sle…
- **toolbar-search**（工具栏搜索编排 toolbar-search）：`toolbar-search.ts` 是 YSM 前端搜索/筛选/导入逻辑的编排核心（272 行，从 `toolbar-events.ts` 拆出，ADR-040 P1）。它管理从用户输入到搜索结果渲染的完整链路：弹窗交互 → 后端搜索 …
- **ui-slide-menu**（ADR 去桶化 slide-menu 外壳组件）：`frontend/src/ui/ui-slide-menu.ts` 是 ADR 去桶化（ADR-075/076）配套新增的**通用 slide-menu 卡片外壳组件**，复刻 MikuMikuAR 的 slide-menu 视觉卡片（m…
- **ui_components**（UI 组件库 ui-components）：`frontend/src/ui/` 是前端通用 UI **helper 函数库**（自 MikuMikuAR 迁移，ADR-191 去桶化）：提供卡片、折叠面板、加载遮罩、行排列、滑块、幻灯片菜单、预设 chip、图标工厂等无业务逻辑的 …

## utils（26 张）

*工具函数（display、fmt、dom、animation）*

| 标识 | 名称 | tier | 性能 | 关键词 |
|------|------|------|------|--------|
| 🏗 animation-system | 动画系统 animation | architecture | cpu-bound | 动画, 骨骼动画, 关键帧, Molang, 数字滚动, stagger 入场 |
| 🏗 commit-with-check | 提交脚本 commit-with-check | architecture | — | commit-with-check, 自动提交, 并发提交, 临时索引, 白名单提交, 门禁后自动 commit |
| 🏗 core_utils | 核心工具函数 core-utils | architecture | — | 工具函数, 工具方法, 纯函数, 防抖, 异步 |
| 🍃 dom-storage | localStorage 安全读写 safeGet/safeSet | leaf | — | localStorage, 隐私模式, safeGet, safeSet, storage |
| 🍃 dom_tooltip | 悬浮提示 tooltip | leaf | — | tooltip, 悬浮提示, hover 提示, title 气泡, 3D 按钮 |
| 🍃 format-ysm-anim-config | YSM 动画分组与配置菜单提取 | leaf | — | 动画分组, 配置菜单, ysm.json, extra_animation, summarize |
| 🏗 pre-commit-hook | 提交前钩子 pre-commit | architecture | — | pre-commit, 钩子, 文档同步, 自动 stage, 并发隔离 |
| 🏗 pre_push_gate | 推送前门禁 pre-push-gate | architecture | — | 推送门禁, 质量门禁, 域级检查, 门禁阻断, go build, vite build, 契约测试, Promise.all |
| 🏗 safe_error_msg | 安全错误消息提取 utils | architecture | — | 错误消息, Worker 错误, catch, safeErrorMessage, 异常提取 |
| 🏗 script_shared_cores | scripts 共享核演进（diff-coverage-core + cycles） | architecture | — | 覆盖率门禁, diff-coverage, 循环依赖, 共享核, _lib, check-circular, findCycles, 脚本去重 |
| 🏗 source-graph | 源码符号提取共享层 source-graph.ts | architecture | — | 符号提取, 导出符号, 顶层声明, api-break, audit-split, rollback-impact, bloat-history, 依赖图 |
| 🏗 utils-array | 数组工具 moveItem | architecture | — | 数组排序, 拖拽排序, moveItem, 列表 reorder |
| 🍃 utils-display | 文件名显示 display | leaf | — | 文件名显示, renderDisplayName, 作者标签, 作品标签, 文件名着色, 搜索高亮 |
| 🍃 utils-dom | DOM 工具 dom | leaf | — | esc, HTML 转义, innerHTML, 搜索高亮, mark, XSS |
| 🏗 utils-errors | 错误处理 errors | architecture | — | 错误提示, 友好错误, friendlyError, toast 文案, 报错翻译, 网络错误, 文件被占用 |
| 🏗 utils-export | 截图与导出 export | architecture | memory-heavy, gpu-bound | 截图, 导出 PNG, 多角度截图, 预览缓存淘汰, blob URL 释放 |
| 🏗 utils-extensions | 扩展名映射 extensions | architecture | — | 扩展名, 支持的文件类型, 拖拽过滤, RESOURCE_EXTS, ALL_EXTS, 导入过滤, 扩展名归属 |
| 🍃 utils-fmt | 格式化工具 fmt | leaf | — | 文件大小, 字节格式化, KB MB, 日期格式化, 友好日期, 文件大小颜色 |
| 🍃 utils-icon | 图标映射 icon | leaf | — | 图标, emoji, 文件图标, fileIcon, 判断 YSM 文件 |
| 🍃 utils-mc-format | MC 格式判定 mc-format | leaf | — | 分节符, § 颜色, MC 颜色码, pack_format, MC 版本, 资源包版本, renderFormattedText, 版本兼容 |
| 🏗 utils-misc | 常量与调试 constants/debug | architecture | — | 调试日志, dbg, 调试开关, 环形日志, debugGetSpec, 全局常量 |
| 🏗 utils-resource-types | 资源类型工具 resource-types | architecture | — | 资源类型, RESOURCE_TYPES, 类型标签, 存储子目录, storageSubDir, LoadResourceTypes, 注册表加载 |
| 🏗 utils-summarize | 摘要生成 summarize | architecture | — | 模型详情, 摘要卡片, summaryCardHTML, 预览卡片, 加密模型, 作者信息, 动画分组, 免费付费 |
| 🍃 worker-bridge-settleerror-fallback | worker-bridge-settleError-fallback | leaf | concurrent | 扩展 WorkerErrorStrategy 策略, 评审 worker-bridge settleError 分支 |
| 🏗 ysm-anim-pipeline | YSM (Bedrock) 动画管线 | architecture | cpu-bound | YSM 动画, 基岩动画, molang, 动画管线 |
| 🏗 ysm-wasm | WASM 解析器 ysm-parser | architecture | cpu-bound, single-thread | WASM / YSMParser, ysm 解码, wasm 加载、按需加载, MEMFS, callMain, crossOriginIsolated, stats.worker / worker.format, pthread |

### 摘要

- **animation-system**（动画系统 animation）：前端动画体系分两层：**模型骨骼动画**（基岩版 animation.json 解析 + 关键帧插值求值）与 **UI 动效**（数字里程表滚动、stagger 入场延迟）。UI 层的 CSS 动画可被全局 `no-animations` …
- **commit-with-check**（提交脚本 commit-with-check）：`commit-with-check.ts` 把「改代码→tsc→build→test→git add→commit」压缩为单条命令：门禁委托 `pre-push-gate.ts`（唯一检查清单源头），全绿后**临时索引白名单提交**（AD…
- **core_utils**（核心工具函数 core-utils）：`utils/core/` 是全前端最基础的纯函数工具层，不依赖任何前端框架或业务模块。按 ADR-044 策略 A 收敛自多包重复实现，统一入口。
- **dom-storage**（localStorage 安全读写 safeGet/safeSet）：`localStorage` 安全读写工具层（ADR-044 策略 A），收敛项目内所有 `localStorage` 调用，避免隐私模式/存储禁用下裸调抛错中断启动链（`initTheme`/`applyUIPrefs`/`setting…
- **dom_tooltip**（悬浮提示 tooltip）：3D 预览控制层的自定义悬浮提示组件（单例 light DOM），替代原生 `title` 的迟缓黄气泡（~1s 延迟、样式不可控）。毛玻璃风格对齐 3D HUD（`fab.ts` `.ysm-3d-popup` 同族）；tooltip 节…
- **format-ysm-anim-config**（YSM 动画分组与配置菜单提取）：前端镜像 Go 端 `appendAnimGroupsAndConfigs` 逻辑的纯函数模块（`summary.go`）。加密 `.ysm` 经 WASM 解码后，`ysm.json` 的 `properties` 字段可读，但原 `wa…
- **pre-commit-hook**（提交前钩子 pre-commit）：`.githooks/pre-commit`（非阻断）在 commit 前跑秒级 gen 脚本同步文档/索引/知识卡机器生成区，并**仅 stage 本次 gen 实际 touch 的文件**（gen 前后快照 diff 对比，2026-0…
- **pre_push_gate**（推送前门禁 pre-push-gate）：`.githooks/pre-push`（薄壳）→ `scripts/pre-push-gate.ts`（调度器，681 行）：本地质量门禁核心，**CI 红之前本地先红**。按变更域（Go / 前端 / 数据 / 文档）裁剪检查，硬错误（…
- **safe_error_msg**（安全错误消息提取 utils）：`frontend/src/utils/safe-error-msg.ts` 提供轻量级错误消息提取函数 `safeErrorMessage`，从任意错误对象中安全提取可读消息字符串。与 `errors.ts` 的 `friendlyErr…
- **script_shared_cores**（scripts 共享核演进（diff-coverage-core + cycles））：`scripts/_lib/` 承载跨脚本共享逻辑。2026-09 按「四脚本镜像嫌疑分析」实测后，新增两个共享核，消除两对镜像脚本的重复：
- **utils-array**（数组工具 moveItem）：纯函数层数组操作工具，从 `site/edit.ts` 的拖拽排序 drop 逻辑抽出，供单测覆盖（ADR-023 L3）。
- **utils-display**（文件名显示 display）：模型文件名解析 + 美化显示管线。YSM 社区文件名遵循 `[作者]【作品】角色 日期.ext` 命名约定，本模块把它解析为结构化字段，并在原文件名上原位着色（作者/作品/日期各自样式），是 UI 侧文件名展示的唯一入口。
- **utils-dom**（DOM 工具 dom）：HTML 转义、搜索高亮、全局 toast 时长语义常量、焦点记忆 / 恢复（a11y）。`esc()` 是全前端 HTML 转义的统一入口，也是治理红线指定的转义函数；`toast-ms.ts` 是全应用 toast 时长的单一事实源（8…
- **utils-errors**（错误处理 errors）：把 Go 端/运行时返回的原始错误转换为用户可读的中文提示，是异常路径 toast 文案的统一入口（治理红线：所有异常路径必须有 toast 反馈）。
- **utils-export**（截图与导出 export）：预览产物的导出与缓存层：`screenshot-render.ts` 用离屏 Three.js 渲染器做透明背景多角度截图；`preview-3d/decoder/cache.ts` 是模型预览数据的模块级持久缓存（组件卸载/重挂不丢失）。…
- **utils-extensions**（扩展名映射 extensions）：前端扩展名 → 资源类型映射的集中定义。拖拽导入等场景需要同步判断扩展名（无法等待异步注册表加载），故提供这份静态默认表；事实来源仍是 `resource_types.json`，三端一致性由契约测试守护。
- **utils-fmt**（格式化工具 fmt）：字节数与时间戳的格式化纯函数集，服务于列表行的尺寸与日期展示。
- **utils-icon**（图标映射 icon）：文件名 → 图标 emoji 的映射工具，用于列表/树行的文件类型图标展示。
- **utils-mc-format**（MC 格式判定 mc-format）：两个 Minecraft 相关的纯工具：`mc-format.ts` 把 § 分节符颜色/格式码渲染为 HTML；`pack-format.ts` 把 pack_format 数值映射为可读的 MC 版本描述。
- **utils-misc**（常量与调试 constants/debug）：前端调试基础设施：`debug.ts` 提供带 tag 过滤与环形缓冲的调试日志工具。
- **utils-resource-types**（资源类型工具 resource-types）：前端资源类型常量与注册表加载工具。与 [resource_registry](./resource-registry.md) 卡互补：那张讲 `resource_types.json` 单一事实源与 `services/registry.t…
- **utils-summarize**（摘要生成 summarize）：把 Go 端解析出的模型摘要（YsmSummary）与头部信息（YSMHeader）渲染为预览面板的「模型详情」卡片 HTML。
- **worker-bridge-settleerror-fallback**（worker-bridge-settleError-fallback）：`worker-bridge.ts:94-105` `settleError` 三分支结算：`terminatePool` → reject；`makeErrorResponse` 存在 → resolve 错误响应；else → reje…
- **ysm-wasm**（WASM 解析器 ysm-parser）：YSMParser WASM 的前端胶水层（算法口径与 YSMViewer 一致）：`ysm-parser.ts` 负责加载、初始化与解码调用；`ysm-wasm-data.js` / `ysm-glue-data.js` 是 base64…

## 性能画像（perf 标签）

> 卡片 frontmatter 的 `perf:` 字段（受控词表 = `scripts/_lib/knowledge-cards.ts` PERF_TAGS）；词表外标签由 check-knowledge-drift 报 ERROR。扩展新维度（如能耗）只加词表。

| 标签 | 含义 | 卡片 |
|------|------|------|
| io-bound | IO 密集（批量读写/RPC/网络） | app-modules, app-sync-manager, backend-idb, community-feature, go-avatar, go-avatar-decode, go-dedup, go-download, go-fileops, go-fsutil, go-geometry, go-importer, go-installer, go-instance, go-logs, go-packs, go-recycle, go-repoaudit, go-scanner, go-sync, go-tags, go-updater, go-watcher, go-ysm-parser, import-queue, oldest-models, recycle-bin, rustbridge, version-updater |
| cpu-bound | CPU 密集（解析/编译/解算/编码） | 3d-oversize-file-codesplit-feasibility, animation-system, app_content_diagnostics, bone-tools, go-threejs, ground-cap-materialgroup-factories, ground_surface_spec, ik_solver, mc-ao-tint, model-stats, model2d, optimization_log, perception, ysm-anim-pipeline, ysm-wasm |
| gpu-bound | GPU/显存敏感（纹理/3D 渲染） | app_content_diagnostics, model3d, mount3d-584-giant, multi_model_select, optimization_log, preview_core, preview_panel_declarative, render-federation, scene_capability_registry, utils-export |
| concurrent | 多核并行（goroutine 池/Worker 池/pthread/Promise 竞速） | app_content_diagnostics, go-scanner, go-threejs, model-stats, mount-preview-module-singleton-race, optimization_log, rustbridge, worker-bridge-settleerror-fallback |
| memory-heavy | 内存/显存大户（大缓冲/长驻缓存） | go-geometry, go-repoaudit, model3d, optimization_log, utils-export |
| single-thread | 单线程顺序执行（顺序流水线/串行队列） | go-avatar-decode, go-download, scripts_readme_index, ysm-wasm |

---

## 使用说明

### 快速开始

```bash
# 新建知识卡
node scripts/new-knowledge-card.ts <kind> <name> <category> <source_file> [--leaf]

# 漂移检查
node scripts/check-knowledge-drift.ts

# 重新生成索引
node scripts/gen-knowledge-index.ts
```

### 文件结构

| 文件 | 说明 |
|------|------|
| `AGENTS.md` | 分区路由指南（必读） |
| `index.md` | 分类索引（自动生成） |
| `<kind>.md` | 知识卡（kind 为 kebab-case） |

### 约束

- `source_files` **必须**真实存在于磁盘
- `kind` = 文件名，kebab-case
- 生成物（`index.md`）**禁止手改**
- H1 标题 = `name` 字段

## 分类说明

| 分类 | 用途 |
|------|------|
| core | 核心基础设施（事件总线、页面状态、Wails 桥接） |
| go | Go 后端包（安装、下载、回收站、YSM 解析等） |
| ui | 前端 UI 组件（tree、sidebar、preview、content） |
| feature | 业务功能（导入队列、同步、社区） |
| rendering | 3D 渲染与预览核心（preview-core、model2d/3d、perception、render-federation） |
| utils | 工具函数（display、fmt、dom、animation） |
| config | 配置与注册表（resource_types、AppConfig） |
