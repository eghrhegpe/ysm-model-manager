<!-- 本文件由 scripts/gen-routes-quick.ts 自动生成，请勿手改。重跑：node scripts/gen-routes-quick.ts -->

# AI 急速版路由表（高频场景）

> 本表由知识卡 frontmatter 的 `quick_*` 字段自动生成。
> 新增高频场景请在对应知识卡 frontmatter 补充 `quick_groups`/`quick_intents`/`quick_risk_lines`/`pitfalls`。

## 🎯 3D 预览与模型追加

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 2D 预览、骨骼图、Canvas 渲染 | [2D 预览渲染 model2d](./model2d.md) | 2D 骨骼渲染必须走 model2d.ts 的 Canvas 渲染，禁止手写骨骼画布 | - |
| 3D 菜单控件声明式渲染 | [场景能力注册表 scene-capability-registry](./scene_capability_registry.md) | - | ADR-132 |
| 3D 感知系统、自主动画、自动跳舞 | [3D 感知系统 perception](./perception.md) | 3D 感知必须走 perception 模块的控制器，禁止手写动画注入 | ADR-138 |
| 3D 控制器、MMD 播放、VRM 材质 / YSM schema | [3D 预览控制器（声明式菜单节点）](./preview-controls.md) | 相机操作已归核心声明式根菜单，底部导航弹窗已删除；adapter 项必须经 setAdapterItems 注入核心根菜单，禁止内联 | ADR-127, ADR-132 |
| 3D 渲染循环优化、Vector3 复用 | [3D 区审核与修复模式提炼](./3d-patterns.md) | 3D 资源释放必须走 dispose 链路，禁止依赖 GC | - |
| 3D 预览菜单、根菜单、dock 按钮 | [统一 3D 预览核心 preview-core](./preview_core.md) | 适配器项经 setAdapterItems 注入，禁止内联 | ADR-125 |
| 场景能力 / cap / registry | [场景能力注册表 scene-capability-registry](./scene_capability_registry.md) | 3D 能力必须走 scene-capability-registry 注册，禁止在 adapter 里直接创建场景对象 | ADR-132 |
| 动画解析 / 求值 / 渲染注入 | [YSM (Bedrock) 动画管线](./ysm-anim-pipeline.md) | - | - |
| 多 3D 场景共存 | [联邦渲染能力 (Render Federation)](./render-federation.md) | - | ADR-125 |
| 多模型选择、多组件 / 多 entry | [多模型选择菜单原语 multiModelSelectNode](./multi_model_select.md) | 容器内多模型必须经 multiModelSelectNode 声明式菜单选择，禁止 adapter 直接遍历 entry 数组渲染 | ADR-132 |
| 骨骼动画、关键帧、动画播放 | [动画系统 animation](./animation-system.md) | 基岩 animation.json 解析后必须走 evaluateClip 插值，禁止前端手写关键帧插值逻辑 | - |
| 加密模型、wasm 加载、Emscripten | [WASM 解析器 ysm-parser](./ysm-wasm.md) | - | - |
| 节拍检测、模型感知 | [3D 感知系统 perception](./perception.md) | - | ADR-138 |
| 截图按钮、相机控制、模型切换 | [3D 预览控制器（声明式菜单节点）](./preview-controls.md) | - | ADR-127, ADR-132 |
| 截图灯光、activeComponent、组件选择 | [预览面板设置与显示控制](./preview-settings.md) | - | ADR-132 |
| 模型切换、会话内替换 | [统一 3D 预览核心 preview-core](./preview_core.md) | switchTo 仅同类型；跨类型用 switchExternal | ADR-125 |
| 前视图、骨骼热区、鼠标拾取、线框图 | [2D 预览渲染 model2d](./model2d.md) | - | - |
| 数字滚动、stagger 入场、关闭动画 | [动画系统 animation](./animation-system.md) | - | - |
| 头像、作者、创作者 avatar | [头像 go/avatar](./go-avatar.md) | 头像提取必须走 go/avatar 的 ExtractAvatarURI，前端禁止手写头像路径拼接 | - |
| 头像缓存、缩略图 | [头像 go/avatar](./go-avatar.md) | - | - |
| 投影、litematic、schematic、nbt、蓝图 | [Litematic 解析 go/litematic](./go-litematic.md) | Litematic 蓝图必须走 go/litematic 的 parser/schematic/structure 三层解析，禁止前端手写 Litematic 解析 | - |
| 纹理缓存、AbortController 事件管理 | [3D 区审核与修复模式提炼](./3d-patterns.md) | - | - |
| 新增 3D 能力（雾/阴影/反射/环境/灯光/后处理） | [场景能力注册表 scene-capability-registry](./scene_capability_registry.md) | - | ADR-132 |
| 渲染联邦、shared renderer、rAF 复用 | [联邦渲染能力 (Render Federation)](./render-federation.md) | 多 3D 场景必须走 render-federation 的 shared renderer / rAF，禁止各自创建 renderer | ADR-125 |
| 预览设置、显示控制、骨骼名称开关 | [预览面板设置与显示控制](./preview-settings.md) | 预览设置集中由 preview-state.ts 的 KNOWN_PATHS 注册管理，新增选项必须经注册而非直接读写状态 | ADR-132 |
| 眨眼/呼吸/视线追踪/口型同步 | [3D 感知系统 perception](./perception.md) | - | ADR-138 |
| 帧率 / 像素比 / 视锥剔除 / 3D 偏好 | [预览面板设置与显示控制](./preview-settings.md) | - | ADR-132 |
| 追加模型、同台加载、多模型同框 | [统一 3D 预览核心 preview-core](./preview_core.md) | 跨类型必须走 switchExternal，禁止直接调 adapter.build | ADR-125 |
| 资源生命周期 dispose、循环依赖破壁 | [3D 区审核与修复模式提炼](./3d-patterns.md) | - | - |
| AnimationController、状态机 | [动画系统 animation](./animation-system.md) | - | - |
| createAll / loadAll / setPreset / saveAll / dispose | [场景能力注册表 scene-capability-registry](./scene_capability_registry.md) | - | ADR-132 |
| isSafeAvatarPath | [头像 go/avatar](./go-avatar.md) | - | - |
| MEMFS / node 解码 / callMain | [WASM 解析器 ysm-parser](./ysm-wasm.md) | - | - |
| Molang 表达式求值 | [动画系统 animation](./animation-system.md) | - | - |
| multiModelSelectNode | [多模型选择菜单原语 multiModelSelectNode](./multi_model_select.md) | - | ADR-132 |
| multiModelSelectNode / preview menu node | [3D 预览控制器（声明式菜单节点）](./preview-controls.md) | - | ADR-127, ADR-132 |
| palette / voxel / bedrock 转换 | [Litematic 解析 go/litematic](./go-litematic.md) | - | - |
| schema 键冲突、ADR-132 | [preview-menu-session-key](./preview_menu_session_key.md) | - | ADR-132 |
| schema 注册、per-scene、多模型同框 | [preview-menu-session-key](./preview_menu_session_key.md) | schema 注册必须用 per-scene 键，禁止跨场景共用 schema key | ADR-132 |
| VRM 动画播放、VRMA | [统一 3D 预览核心 preview-core](./preview_core.md) | 必须 mixer.update(dt) → vrm.update(dt)，禁止手动 vrm.humanoid.update() | ADR-125 |
| WASM 解析器、YSMParser、ysm 解码 | [WASM 解析器 ysm-parser](./ysm-wasm.md) | YSM 前端解码必须走 ysm-wasm 的 WASM 解析器，禁止手写 YSM 字节流解析 | - |
| YSM 动画管线、基岩动画 | [YSM (Bedrock) 动画管线](./ysm-anim-pipeline.md) | YSM 动画必须走 ysm-anim-pipeline 的解析-求值-注入三段，禁止前端手写动画解析 | - |
| ysm-animation-player、molang | [YSM (Bedrock) 动画管线](./ysm-anim-pipeline.md) | - | - |
| zip 多模型、多候选、蓝图 zip、litematic zip | [多模型选择菜单原语 multiModelSelectNode](./multi_model_select.md) | - | ADR-132 |

## 🎯 后端桥接与数据存储

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 调后端、app.ts 绑定、getApp | [Wails Binding API 总览 internal/app](./wails-bindings.md) | - | - |
| 跨平台路径处理、pathmgr | [Android 平台守卫（Go 侧）](./go-android-platform-guard.md) | - | - |
| 平台分支、WASM decoder 平台差异 | [Android 平台守卫（Go 侧）](./go-android-platform-guard.md) | - | - |
| 桥 DLL、Wails 后端迁移 Rust | [Rust 桥 rustbridge](./rustbridge.md) | - | - |
| 网页版 / 浏览器模式 / web mode | [网页版后端 backend-web](./backend_web.md) | 网页版后端必须经 browserAdapter 代理，禁止 Wails 与浏览器后端混合调用 | - |
| Android 存储授权、目录选择器 | [Android 桥接层：存储授权 + 目录选择器](./android-bridge.md) | Android 存储授权必须走 android-bridge 的 SAF 授权流程，禁止直接请求 MANAGE_EXTERNAL_STORAGE | - |
| Android 平台守卫、RevealInExplorer 降级 | [Android 平台守卫（Go 侧）](./go-android-platform-guard.md) | - | - |
| android:back 返回键、弹窗退出 | [Android 系统事件消费（back/网络/存储授权）](./android-events.md) | Android 系统事件必须经 android-events 的 registerAndroidEvents 单点注册，禁止各组件各自注册 | - |
| Android/Linux/macOS Rust 桥 | [Rust Scanner Bridge 全平台支持](./rust-android-bridge.md) | Android/Linux/macOS 的 Rust 桥必须走平台桥，禁止硬编码 Windows 路径 | - |
| API 总览、Binding 有哪些方法、App 方法签名 | [Wails Binding API 总览 internal/app](./wails-bindings.md) | 前端访问 Wails 后端必须经 getApp()，禁止直接调 window.go | - |
| bridge_windows/bridge_android/bridge_linux | [Rust 桥 rustbridge](./rustbridge.md) | - | - |
| browser adapter、跨域隔离 COI | [网页版后端 backend-web](./backend_web.md) | - | - |
| closeActiveDialog、registerAndroidEvents | [Android 系统事件消费（back/网络/存储授权）](./android-events.md) | - | - |
| compile-android-rust/compile-rust-static | [Rust Scanner Bridge 全平台支持](./rust-android-bridge.md) | - | - |
| GetAppVersion / ScanModelEntries / SearchModels | [Wails Binding API 总览 internal/app](./wails-bindings.md) | - | - |
| IndexedDB / IDB / 浏览器后端 | [网页版后端 backend-web](./backend_web.md) | - | - |
| IndexedDB、网页版存储 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | 事务必须接线 complete/error/abort 三事件 | ADR-177 |
| MANAGE_EXTERNAL_STORAGE、SAF、权限 | [Android 桥接层：存储授权 + 目录选择器](./android-bridge.md) | - | - |
| NBT 解析 / 体素 / 网页版文件系统 | [网页版后端 backend-web](./backend_web.md) | - | - |
| Rust 扫描器、rust_backend | [Rust 桥 rustbridge](./rustbridge.md) | Rust 桥必须走 go/rustbridge 的平台桥（bridge_*.go），禁止在业务代码里直接 dlopen 加载 | - |
| rust_backend、CGO | [Rust Scanner Bridge 全平台支持](./rust-android-bridge.md) | - | - |
| ScreenLocked、NetworkChanged、permissionGranted | [Android 系统事件消费（back/网络/存储授权）](./android-events.md) | - | - |

## 🎯 模型扫描与仓库管理

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 仓库审计、健康分 | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 冲突处理 conflict.go | [整合包同步 go/sync](./go-sync.md) | - | ADR-064 |
| 待推送 / 可拉取 / 已禁用 / 实例资源 | [整合包同步页 app-sync-manager](./app-sync-manager.md) | - | - |
| 关键词搜索、数值范围搜索 | [CLI 搜索命令 search](./go-cli-search.md) | - | - |
| 每日推荐、月度活动、热力图、仓库健康 | [资历最深模型 oldest-models](./oldest-models.md) | - | - |
| 模型解析、zip / 7z / 纹理 / 动画 | [Geometry 存档 go/geometry](./go-geometry.md) | - | ADR-068 |
| 模型统计、骨骼数/立方体数/纹理尺寸 | [Web Worker 模型统计层 model-stats](./model-stats.md) | 模型统计必须走 Web Worker 批量统计层，主线程禁止同步跑统计，防 UI 卡顿 | - |
| 去重、重复检测、dedup | [去重 go/dedup](./go-dedup.md) | 去重必须走 go/dedup，禁止在业务代码里手写文件指纹比较 | - |
| 去重检测、dedup | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 日志查看、性能分析 | [诊断与冲突页 diagnostics](./app_content_diagnostics.md) | - | - |
| 容器解析、container_entries | [统一容器桥接层 go/container](./go-container.md) | 容器内多模型枚举必须走 go/container，前端禁止手写 zip 内文件枚举 | ADR-068, ADR-069 |
| 扫描模型、ScanModelEntries | [扫描核心 go/scanner](./go-scanner.md) | 容器指纹缓存失效需调 ClearScanCache | - |
| 搜索、筛选、关键词 / 标签 / 数值三路交集 | [搜索筛选编排 search](./search.md) | 搜索筛选必须经 toolbar-search 编排 + adv-filter 弹窗 + SearchModels 后端，前端只做 UI 不做筛选逻辑 | - |
| 缩略图、类型检测 | [资源包 mcmeta go/packs](./go-packs.md) | - | - |
| 同步项、BuildSyncItems、资源同步 | [整合包实例 go/instance](./go-instance.md) | - | - |
| 同步状态、app-sync-manager | [整合包同步页 app-sync-manager](./app-sync-manager.md) | - | - |
| 文件监听、文件变化、刷新 | [文件监听 go/watcher](./go-watcher.md) | 文件变更监听必须走 go/watcher 的事件流，禁止轮询文件系统 | - |
| 诊断页、仓库体检、冲突 / 去重 | [诊断与冲突页 diagnostics](./app_content_diagnostics.md) | 去重 / 体检必须经 diagnostics 页发起，禁止在其他页直接调 doDedup | - |
| 整合包分类、路由、location 路由 | [分类路由与回归护栏](./classify-routing.md) | 资源整合包分类必须走 go/packs/classify.go 的 ClassifyResource，前端禁止手写分类逻辑 | ADR-093 |
| 整合包实例、版本实例、VersionInstance | [整合包实例 go/instance](./go-instance.md) | 整合包实例同步必须走 go/instance 的 ysmsync.SyncResources，禁止在 app 层手写同步逻辑 | - |
| 整合包同步、推送 / 拉取 | [整合包同步 go/sync](./go-sync.md) | 整合包同步必须走 go/sync 的 diff+hash 双阶段，禁止在 app 层手写同步逻辑 | ADR-064 |
| 整合包同步、sync | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 整合包同步页、推送 / 拉取资源 | [整合包同步页 app-sync-manager](./app-sync-manager.md) | app-sync-manager 的同步状态渲染必须经 _gen 单点生成，禁止各列各自查询状态 | - |
| 资历最深、老模型、仓库评分 | [资历最深模型 oldest-models](./oldest-models.md) | 资历排行必须经 oldest-models.ts 统一计算，禁止各页面各自实现评分逻辑 | - |
| 资源包 / 光影包、mcmeta、pack_format | [资源包 mcmeta go/packs](./go-packs.md) | 资源包元数据必须走 go/packs 的 mcmeta 解析，前端禁止手写 mcmeta.json 解析 | - |
| 资源类型识别、rtype 判定 | [扫描核心 go/scanner](./go-scanner.md) | resource_types.json 是唯一事实来源 | - |
| AnalyzeYSMModel、HasYSMMod | [YSM 解析 go/ysm](./go-ysm-parser.md) | - | - |
| CLI 搜索、命令行搜索、search 命令 | [CLI 搜索命令 search](./go-cli-search.md) | CLI 搜索必须复用 go/cli 的 SearchModels 后端，禁止 CLI 层手写搜索逻辑 | - |
| dgAfIntersectPaths | [搜索筛选编排 search](./search.md) | - | - |
| filepath.WalkDir 路径安全 | [去重 go/dedup](./go-dedup.md) | - | - |
| Geometry 存档、基岩版 bedrock | [Geometry 存档 go/geometry](./go-geometry.md) | Geometry 存档解析必须走 go/geometry 的 parse/archive 封装，禁止在业务代码里直接 unzip | ADR-068 |
| initDiagnostics、startDedup | [诊断与冲突页 diagnostics](./app_content_diagnostics.md) | - | - |
| IsRecycleDir 守卫 | [去重 go/dedup](./go-dedup.md) | - | - |
| last-wins / priority 裁决 | [分类路由与回归护栏](./classify-routing.md) | - | ADR-093 |
| oldest 资历排行 | [诊断与冲突页 diagnostics](./app_content_diagnostics.md) | - | - |
| parse.go / archive.go | [Geometry 存档 go/geometry](./go-geometry.md) | - | ADR-068 |
| runSearch | [CLI 搜索命令 search](./go-cli-search.md) | - | - |
| SearchModels 数值筛选 | [Web Worker 模型统计层 model-stats](./model-stats.md) | - | - |
| SearchModels、adv-filter、网页版降级 | [搜索筛选编排 search](./search.md) | - | - |
| sync_diff / sync_hash / sync_push / sync_relink | [整合包同步 go/sync](./go-sync.md) | - | ADR-064 |
| watcher、Events / errs / done | [文件监听 go/watcher](./go-watcher.md) | - | - |
| Web Worker、批量统计 | [Web Worker 模型统计层 model-stats](./model-stats.md) | - | - |
| YSM 解析、摘要 ExtractYsmSummary | [YSM 解析 go/ysm](./go-ysm-parser.md) | YSM 解析必须走 go/ysm 的 AnalyzeYSMModel，前端禁止手写 YSM 解析逻辑 | - |
| YSM 文件元数据 | [YSM 解析 go/ysm](./go-ysm-parser.md) | - | - |
| zip 多模型、多 entry | [统一容器桥接层 go/container](./go-container.md) | - | ADR-068, ADR-069 |
| zipentry 指纹、蓝图 / 投影 / vrm / pmx | [分类路由与回归护栏](./classify-routing.md) | - | ADR-093 |

## 🎯 跨组件通信与页面

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 侧边栏、整合包列表、版本卡片 | [侧边栏 app-sidebar](./app-sidebar.md) | 侧边栏的 push/pull 必须经 events.ts 的 runPush/runPull 转发到 sync-manager，禁止直接调 API | - |
| 纯函数 | [核心工具函数 core-utils](./core_utils.md) | - | - |
| 错误提示、友好错误、friendlyError | [错误处理 errors](./utils-errors.md) | 所有异常路径必须经 friendlyError 转中文提示，禁止裸抛原始错误到 UI | - |
| 错误消息提取、Worker 错误、catch | [安全错误消息提取 utils](./safe_error_msg.md) | Web Worker 内错误提取必须用 safeErrorMessage，禁止 import i18n 依赖 | - |
| 调试日志、dbg、调试开关 | [常量与调试 constants/debug](./utils-misc.md) | 调试日志必须走 debug.ts 的 dbg 工具，禁止 console.log 散落在业务代码 | - |
| 订阅 / 退订事件 / once | [事件总线 bus.ts](./event-bus.md) | once 只能用它返回的退订函数取消（off 原 fn 匹配不到 wrapper） | - |
| 更新检查、升级、新版本 | [版本更新 version-updater](./version-updater.md) | 版本更新必须经 version-updater 的 canCheck/markChecked 节流，禁止高频轮询 GitHub API | - |
| 工具函数、防抖、异步工具 | [核心工具函数 core-utils](./core_utils.md) | swallowError 只用于"吞掉已知安全错误"，禁止用于掩盖业务异常；fireAndForget 必须带 error 回调兜底 | - |
| 环形日志、debugGetSpec、全局常量 | [常量与调试 constants/debug](./utils-misc.md) | - | - |
| 加翻译 / 多语言 / i18n | [国际化 i18n 模块](./i18n.md) | t() 纯函数查表；语言切换广播 lang:changed 驱动全库重渲染 | ADR-124 |
| 节点选择、多选、右键菜单 | [资源树 app-tree](./app-tree.md) | - | - |
| 静默检查、canCheck、markChecked | [版本更新 version-updater](./version-updater.md) | - | - |
| 列表 reorder | [数组工具 moveItem](./utils-array.md) | - | - |
| 启动初始页解析 | [页面状态管理 page-store.ts](./page-store.md) | - | - |
| 启动器检测 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 全局事件、拖拽导入、拖拽提示 | [全局事件处理 global-handlers](./global-handlers.md) | 全局事件必须经 global-handlers 单点注册，禁止各页面各自 bindGlobalHandler | - |
| 数组排序、拖拽排序、moveItem | [数组工具 moveItem](./utils-array.md) | 数组移动必须走 array.ts 的 moveItem，禁止手写 splice 排序 | - |
| 同步缺失、清空整合包、导出清单 | [全局事件处理 global-handlers](./global-handlers.md) | - | - |
| 推送 / 拉取、同步状态、勾选 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 外部进程启动、跨平台 HideWindow | [进程隐藏窗口 go/executil](./go-executil.md) | - | - |
| 新组件注册、import 组件、startup reveal | [组件入口 app-modules](./app-modules.md) | - | - |
| 循环依赖、NewApp 组装 | [App↔子组件对象级环打破范式（回调注入）](./app_cycle_injection.md) | - | ADR-109 |
| 页面初始化流程、订阅桶 / 会话状态 | [主内容页 app-content](./app-content.md) | - | - |
| 页面状态管理、当前页、page store | [页面状态管理 page-store.ts](./page-store.md) | page-store 只管理当前页标识（只读 getter），不协调页面挂载 / 卸载，那是 app-content 的职责 | - |
| 一键安装、整合包拖拽导入 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 整合包列表、同步状态、勾选 | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |
| 整合包同步、推送 / 拉取 | [整合包同步管理器 sync-manager](./sync-manager.md) | 同步操作必须经 sync-manager 的 queue 排队，禁止 app-sidebar 直接调 PushSingleResource | - |
| 主内容区、页面切换、仓库页 / 创作者页 / 社区页 | [主内容页 app-content](./app-content.md) | 主内容区页面切换必须经 nav:change / app-nav 路由分发，禁止页面之间直接 init 对方 | - |
| 主题初始化、服务注册、检查更新 | [组件入口 app-modules](./app-modules.md) | - | - |
| 资源树、tree、目录树 | [资源树 app-tree](./app-tree.md) | app-tree 的 bus 订阅必须经 _unsubs 收集，disconnectedCallback 必须清理全部订阅 | - |
| 子进程隐藏控制台窗口、HideWindow | [进程隐藏窗口 go/executil](./go-executil.md) | 子进程隐藏控制台窗口必须走 go/executil 的 HideWindow，禁止直调 os/exec 不带隐藏标志 | - |
| 组件入口、模块装配、启动流程 | [组件入口 app-modules](./app-modules.md) | 新增 JS 组件必须登记进 app-modules.ts 的 import 列表，致命陷阱 | - |
| App↔子组件对象级环、回调注入 | [App↔子组件对象级环打破范式（回调注入）](./app_cycle_injection.md) | 子组件必须用回调注入替代 *App 反向指针，禁止在子组件 struct 里持 *App 字段 | ADR-109 |
| emit 事件 / 跨组件通信 | [事件总线 bus.ts](./event-bus.md) | 所有跨组件异步通信必经 bus.ts，禁止组件间直耦 | - |
| input-and-animation | [Pointer Events 统一交互（触屏 + 桌面）](./pointer-events.md) | - | - |
| isFileExistsError | [错误处理 errors](./utils-errors.md) | - | - |
| nav:change 事件分发、全局 handler 注册 | [主内容页 app-content](./app-content.md) | - | - |
| node 环境、happy-dom、测试切换 | [Vitest 环境切换规则](./vitest-env-switch.md) | - | - |
| pointerdown / pointermove / pointerup、触屏 + 桌面统一 | [Pointer Events 统一交互（触屏 + 桌面）](./pointer-events.md) | 所有交互必须用 pointerdown/pointermove/pointerup 统一处理，禁止混用 mousedown/touchstart | - |
| PushSingleResource / PullSingleResource | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |
| registerGlobalHandlers、instance-ops | [全局事件处理 global-handlers](./global-handlers.md) | - | - |
| resolveInitialPage / sanitizePage | [页面状态管理 page-store.ts](./page-store.md) | - | - |
| safeErrorMessage、异常提取 | [安全错误消息提取 utils](./safe_error_msg.md) | - | - |
| setPointerCapture、touch-action、拖拽 | [Pointer Events 统一交互（触屏 + 桌面）](./pointer-events.md) | - | - |
| swallowError / fireAndForget / retry / timeout | [核心工具函数 core-utils](./core_utils.md) | - | - |
| sync:download:missing 缺包回拉 | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |
| toast 文案、报错翻译、网络错误 | [错误处理 errors](./utils-errors.md) | - | - |
| tree:set-search、bus-handlers、selectState | [资源树 app-tree](./app-tree.md) | - | - |
| updater | [版本更新 version-updater](./version-updater.md) | - | - |
| Vitest 环境切换、测试环境 | [Vitest 环境切换规则](./vitest-env-switch.md) | 只有纯逻辑测试（不碰 DOM）才能切 @vitest-environment node，源码顶层副作用必须先治理 | - |

## 🎯 3D 预览面板与模型追加

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 预览面板、模型预览、2D 骨骼 / 3D 预览 | [预览面板 app-preview](./app-preview.md) | 预览面板必须经 model:select 事件驱动，WASM 能力判定由 matchTypeByExt 注册表驱动，禁止内联正则 | ADR-137, ADR-138 |
| app-preview 组件、_previewGuard、detailGen | [预览面板 app-preview](./app-preview.md) | - | ADR-137, ADR-138 |
| Litematic / 蓝图、资源包 / 光影包 | [预览面板 app-preview](./app-preview.md) | - | ADR-137, ADR-138 |
| model:select、WASM 解码、放大预览 | [预览面板 app-preview](./app-preview.md) | - | ADR-137, ADR-138 |
| showResourcePack、showShaderpack | [预览面板 app-preview](./app-preview.md) | - | ADR-137, ADR-138 |

## 🎯 文件操作与标签

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 创意工坊、社区下载、下载队列 | [社区下载 community](./community-feature.md) | 社区下载必须走 community download-queue 排队，禁止各组件各自发下载请求 | - |
| 打标签 / 标签存储 / 按标签筛选 | [标签系统 go/tags](./go-tags.md) | 标签以文件绝对路径为 key 存 tags.json；写入走 tmp + os.Rename 原子替换，禁止直写 | - |
| 导入、导入策略、导入队列 | [导入策略 go/importer](./go-importer.md) | 导入必须走 go/importer，落地用 fsutil.WriteFileAtomic 原子替换，禁止直写目标文件 | - |
| 导入队列、拖拽导入、文件夹导入 | [全局导入执行 import-executor](./import-queue.md) | 导入必须走 import-executor 单点编排 + dnd-collector 收集，禁止各组件各自调 ImportModel | - |
| 导入日志、操作记录、日志 | [导入日志 go/logs](./go-logs.md) | 导入日志必须走 go/logs 的 WriteFileAtomic 追加，禁止直接 os.WriteFile | - |
| 覆盖导入、import-executor | [全局导入执行 import-executor](./import-queue.md) | - | - |
| 回收站 / 软删除 / 恢复 / 清空回收站 | [回收站 go/recycle](./go-recycle.md) | 删除必须走 .recycle 软删除（硬链接判定），禁止直接 os.Remove | - |
| 回收站、恢复文件、清空回收站 | [回收站界面 recycle-bin](./recycle-bin.md) | 删除必须走 .recycle 软删除（go/recycle 实现），前端禁止直接 os.Remove | - |
| 镜像源、批量下载、github 仓库 | [社区下载 community](./community-feature.md) | - | - |
| 路径安全、路径校验、path | [路径安全 go/paths](./go-paths.md) | 路径校验必须走 go/paths 的 IsInside，禁止手写路径安全检查 | - |
| 路径穿越 | [路径安全 go/paths](./go-paths.md) | - | - |
| 模型安装、模型导入、下载模型 | [模型安装 go/installer](./go-installer.md) | 模型落地必须走 go/installer，按 LinkMode 选择落地方式，落地前做路径安全校验 | - |
| 软删除、recycle、还原 | [回收站界面 recycle-bin](./recycle-bin.md) | - | - |
| 下载、下载进度、进度条 | [下载器 go/download](./go-download.md) | 下载必须走 go/download，必须带校验和校验防截断 / 部分响应 | - |
| 校验和校验 | [下载器 go/download](./go-download.md) | - | - |
| 移动 / 复制 / 删除 / 重命名文件 / 文件夹导入 | [文件操作 go/fileops](./go-fileops.md) | 文件 CRUD 必须走 go/fileops，internal/app 薄壳仅转发 | - |
| dnd-shared / dnd-collector / pack-dnd | [全局导入执行 import-executor](./import-queue.md) | - | - |
| download-queue / download-tasks | [社区下载 community](./community-feature.md) | - | - |
| download、HTTPStatusError、TruncationError | [下载器 go/download](./go-download.md) | - | - |
| ERROR_NOT_SAME_DEVICE | [模型安装 go/installer](./go-installer.md) | - | - |
| fsutil.WriteFileAtomic | [导入策略 go/importer](./go-importer.md) | - | - |
| import log、历史 | [导入日志 go/logs](./go-logs.md) | - | - |
| importer、DetectZipType | [导入策略 go/importer](./go-importer.md) | - | - |
| initRecycleBin / GetRepoRoot / createLoadGuard | [回收站界面 recycle-bin](./recycle-bin.md) | - | - |
| IsInside / IsInsideResolved | [路径安全 go/paths](./go-paths.md) | - | - |
| LinkMode（copy / hardlink / symlink） | [模型安装 go/installer](./go-installer.md) | - | - |

## 🎯 UI 交互与弹窗

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 按标签筛选、条件过滤 | [高级筛选 adv-filter](./dialog-adv-filter.md) | - | - |
| 菜单行为执行、ctx:show | [右键菜单系统](./context-menu.md) | 禁止 view 层手写菜单项 | - |
| 打标签、编辑标签、tag-editor | [标签编辑器 tag-editor](./dialog-tag-editor.md) | tag-editor 弹窗必须复用 modal.ts 的 Promise API，标签写回走 go/tags Store 的原子替换 | - |
| 弹确认框 / 输入框 / 下拉选择 / modal | [弹窗基座 modal](./dialog-modal.md) | 业务弹窗必须复用 modal.ts 的 Promise API（prompt/select/confirm/picker），禁止手写弹窗 | - |
| 读取 YSM 头部（作者 / 介绍） | [重命名弹窗 rename](./dialog-rename.md) | - | - |
| 分类标记、全库标签建议 | [标签编辑器 tag-editor](./dialog-tag-editor.md) | - | - |
| 高级筛选、骨骼数 / 立方体 / 纹理尺寸数值范围 | [高级筛选 adv-filter](./dialog-adv-filter.md) | adv-filter 弹窗必须复用 modal.ts 的 Promise API，禁止手写弹窗 DOM | - |
| 加载动画、滑块、行组件、预设 chip | [UI 组件库 ui-components](./ui_components.md) | - | - |
| 批量重命名、查找替换、正则替换 | [批量重命名 batch-rename](./dialog-batch-rename.md) | batch-rename 弹窗必须是模块级单例 dialogEl，重复打开先 close() 结算上一个 Promise | - |
| 统一作者 / 作品、5 个内置预设 | [批量重命名 batch-rename](./dialog-batch-rename.md) | - | - |
| 右键菜单、添加菜单项 | [右键菜单系统](./context-menu.md) | 菜单结构声明在 menu-defs.ts（唯一事实来源），行为在 core/context-menus.ts | - |
| 重命名、改名、命名规范 | [重命名弹窗 rename](./dialog-rename.md) | rename 弹窗必须复用 modal.ts 的 Promise API，非法字符与长度校验在弹窗内完成 | - |
| createCard / createSlideMenu / createLoading | [UI 组件库 ui-components](./ui_components.md) | - | - |
| FAB、悬浮按钮、3D 预览 | [3D 预览悬浮 FAB 控制层](./dom-fab.md) | FAB 控制层必须走 dom/fab.ts 的 ensureFabStyles 注入，禁止各组件各自注入 style 标签 | - |
| modalAdvFilter | [高级筛选 adv-filter](./dialog-adv-filter.md) | - | - |
| modalTagEditor | [标签编辑器 tag-editor](./dialog-tag-editor.md) | - | - |
| overlay、ADR-057、ensureFabStyles | [3D 预览悬浮 FAB 控制层](./dom-fab.md) | - | - |
| rename-format、showRenameDialog | [重命名弹窗 rename](./dialog-rename.md) | - | - |
| showBatchRenameDialog | [批量重命名 batch-rename](./dialog-batch-rename.md) | - | - |
| UI 组件库、卡片组件、折叠面板 | [UI 组件库 ui-components](./ui_components.md) | UI 组件必须走 ui-components 的 helper 函数，禁止手写重复 DOM 结构 | - |

## 🎯 截图导出与缓存

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 截图 / 导出 PNG / 多角度截图 / 预览缓存 | [截图与导出 export](./utils-export.md) | 离屏截图渲染器资源与 blob URL 必须释放，防内存泄漏 | - |
| 截图、导出 PNG、多角度截图 | [截图导出 export](./export.md) | 离屏截图渲染器资源与 blob URL 必须显式释放，禁止依赖 GC 回收 | ADR-127 |
| 离屏截图渲染器 | [截图导出 export](./export.md) | - | ADR-127 |
| 模型详情、摘要卡片、summaryCardHTML | [摘要生成 summarize](./utils-summarize.md) | 模型摘要必须走 summarize.ts 的 summaryCardHTML，禁止手写详情卡片 HTML | - |
| 透明背景 / 预览缓存 / blob URL | [截图导出 export](./export.md) | - | ADR-127 |
| 预览卡片、加密模型、作者信息、动画分组、免费付费 | [摘要生成 summarize](./utils-summarize.md) | - | - |

## 🎯 3D spec 渲染与模型追加

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 3D 骨骼 spec、three.js | [3D 骨骼 spec go/threejs](./go-threejs.md) | YSM 骨骼数据必须走 go/threejs 的 spec.go 转换为 three.js 格式，前端禁止手写骨骼转换 | - |
| 顶点 / UV / 四元数 | [3D 骨骼 spec go/threejs](./go-threejs.md) | - | - |
| 模型渲染 | [3D 骨骼 spec go/threejs](./go-threejs.md) | - | - |

## 🎯 配置与注册表

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 存储子目录、storageSubDir、LoadResourceTypes、注册表加载 | [资源类型工具 resource-types](./utils-resource-types.md) | - | - |
| 共享类型、AppConfig、配置 | [共享类型 go/types](./go-types.md) | 共享类型必须走 go/types 单点定义，禁止在业务代码里复制类型定义 | ADR-144 |
| 检查更新、更新下载、update | [自动更新 go/updater](./go-updater.md) | 更新检查必须走 go/updater，前端禁止手写更新下载逻辑 | - |
| 扩展名、支持的文件类型、拖拽过滤 | [扩展名映射 extensions](./utils-extensions.md) | 扩展名判定必须走 extensions.ts 的 isSupportedExt，拖拽导入场景禁止等待异步注册表 | - |
| 新增资源类型 / 修改 resource_types.json / 文件类型 | [资源注册表 registry](./resource-registry.md) | resource_types.json 是唯一事实来源；前端只读不判、禁本地重算 | - |
| 注册表、扩展名、LinkType、BedrockModel | [共享类型 go/types](./go-types.md) | - | ADR-144 |
| 资源类型、RESOURCE_TYPES、类型标签 | [资源类型工具 resource-types](./utils-resource-types.md) | 资源类型注册表必须经 LoadResourceTypes 加载，前端禁止手写类型映射 | - |
| LoadRegistry/ParseDedupConfig | [共享类型 go/types](./go-types.md) | - | ADR-144 |
| RESOURCE_EXTS/ALL_EXTS、导入过滤、扩展名归属 | [扩展名映射 extensions](./utils-extensions.md) | - | - |
| version-updater | [自动更新 go/updater](./go-updater.md) | - | - |

## 🎯 提交与钩子

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 防吞并发会话未提交漂移 | [提交前钩子 pre-commit](./pre-commit-hook.md) | - | - |
| 改门禁并行结构 | [推送前门禁 pre-push-gate](./pre_push_gate.md) | - | - |
| 门禁检查项有哪些 | [推送前门禁 pre-push-gate](./pre_push_gate.md) | 推送门禁失败先看 FAIL 块，禁止无脑 git push --no-verify 绕过 | - |
| 提交前文档自动同步 | [提交前钩子 pre-commit](./pre-commit-hook.md) | 禁止在 pre-commit 用 git add -u docs/ 兜底（会吞他人未提交半成品，违反 P2-2） | - |
| 推送被门禁阻断怎么办 | [推送前门禁 pre-push-gate](./pre_push_gate.md) | 门禁并行 async IIFE 必须带调用括号，漏 () 会静默跳过整域检查 | - |

## 🚨 高频陷阱速查

| 陷阱 | 位置 | 正确做法 |
|------|------|----------|
| Vector3 频繁 new 造成 GC 抖动；必须复用或池化 | - | - |
| AbortController 未清理导致事件泄漏；必须在 dispose 时 abort + removeEventListener | - | - |
| 直接请求 MANAGE_EXTERNAL_STORAGE | - | 新版 Android 拒绝、Google Play 下架；必须走 SAF |
| 目录选择未回传 URI | - | 后续访问失败；必须经 android-bridge 持久化 URI |
| 各组件各自注册 | - | 重复监听、返回键冲突；必须经 registerAndroidEvents |
| 返回键未消费 | - | 直接退出应用；必须在有弹窗时 consume back 事件 |
| 手写关键帧插值 | - | 与基岩官方行为不一致、T-pose 漂移；必须经 evaluateClip |
| Molang 表达式缓存键不完整 | - | 相同逻辑不同骨骼重复求值；缓存 key 必须含 clip/bone 标识 |
| 在仓库页直接调 doDedup | - | 缺上下文、无法展示冲突视图；必须走 diagnostics 页 initDiagnostics |
| 性能 trace 未释放 | - | 长时占用内存；file-bench / perf-trace 完成后必须 stop 回收 |
| 子组件持 *App 字段 | - | 对象级循环依赖、GC 无法回收；必须经回调注入 |
| 回调未正确包装 | - | 空指针 panic；必须在新 App 时注入完整包装 |
| 页面 A 直接调用页面 B 的 init | - | 重复初始化 / 订阅泄漏；必须经 nav:change 单点分发 |
| subscription-bucket 未退订 | - | 跨页残留监听、状态串扰；每次切换必须 clear 旧桶 |
| 新 JS 未登记进 app-modules.ts | - | 组件不加载、Shadow DOM 未升级；必须在 app-modules.ts 加入口 |
| 主题值未归一化 | - | 脏值污染 localStorage 持久层；必须经 normalizeTheme 白名单过滤 |
| 手写 .(ysm\|zip\|json) 判定 | - | .7z 漏判、注册表变更不同步；必须经 matchTypeByExt(RESOURCE_TYPES.YSM) |
| async 窗口期无 container.isConnected 守卫 | - | 组件卸载后异步回调写已卸载 DOM；每个 await 后必须检查 isConnected |
| events.ts 里直接调 PushSingleResource | - | 绕过排队，并发冲突；必须经 runPush/runPull |
| _lastEmittedPkg 未更新 | - | 拖拽导入重复触发；每次导入必须刷新该锚点 |
| 各列各自查询同步状态 | - | 状态不一致、并发冲突；必须经 _gen 单点生成 |
| 同步操作未进队列 | - | 并发 push/pull 冲突；必须经 sync-manager 排队 |
| bus 订阅未进 _unsubs | - | 组件卸载后监听泄漏；必须经 bindBusEvents 返回的 unsub 数组收集 |
| DOM 委托事件进 _unsubs | - | disconnect 时重复 off 报错；DOM 委托事件应靠 ShadowRoot detach 自动清理 |
| 网页版直调 window.go | - | 无 wails runtime 时报错；必须经 browserAdapter |
| 跨域资源共享不处理 COI | - | SharedArrayBuffer 等 API 不可用；必须设置 cross-origin-isolation 头 |
| 前端手写分类 | - | 与 Go classify 判定不一致、last-wins 裁决丢失；必须交 Go 分类 |
| 新增资源类型未更新 priority | - | 冲突时优先级错乱；必须经 classify.go 的 priority 表 |
| 各组件各自发下载请求 | - | 并发冲突、进度丢失；必须经 download-queue 排队 |
| 镜像源未走 gh-links | - | 下载慢、镜像不可用；必须经 gh-links 的 CDN 分流 |
| 内联菜单结构 | `view 层` | 必须声明进 menu-defs.ts |
| swallowError 吞掉业务异常 | - | 静默失败、无法排查；必须用于"预期内可忽略"的错误 |
| fireAndForget 无 error 兜底 | - | 异常丢失；必须挂 onerror 回调或全局 error 监听 |
| 手写 adv-filter 弹窗 DOM | - | 与全局弹窗样式 / 焦点陷阱不一致；必须复用 modal.ts 的 registerDlg |
| adv-filter 输入不校验就提交 | - | min > max 传后端报错；必须在 validate() 拦截并在 |
| 重复打开 batch-rename 不 close | - | 上一个 Promise 悬挂、调用方 await 卡死；必须先 close 结算 |
| 正则替换不分离扩展名 | - | 把 .ext 一起替换掉；必须只对文件名主体替换 |
| 重命名不校验非法字符 | - | 后端 RenameFile 报错 / 文件名含控制字符；必须在校验阶段拦截 |
| 读取 YSM 头部后按钮 loading 态未 finally 恢复 | - | 用户卡死；必须在 finally 恢复按钮态 |
| 手写 tag-editor 弹窗 | - | 弹窗样式 / 焦点陷阱与全局不一致；必须复用 modal.ts |
| 标签写回用直写 tags.json | - | 并发写破坏文件；必须经 go/tags Store 的 tmp+os.Rename 原子替换 |
| 各组件各自注入 style 标签 | - | 多次注入、样式冲突；必须经 ensureFabStyles 一次注入 |
| FAB 挂 document.body 但样式在 Shadow DOM | - | light DOM 按钮不继承；必须经 ensureFabStyles 注入 head 标签 |
| once off 错对象 | `bus.off(event, 原fn)` | 用 once 返回的 unsub 函数取消 |
| 离屏 Canvas 不释放 | - | 内存泄漏、连续截图卡死；必须在完成回调里 release |
| blob URL 不 revokeObjectURL | - | 浏览器内存累积；导出 / 失败分支都必须 revoke |
| 各页面各自注册全局事件 | - | 重复绑定、冲突处理；必须经 global-handlers 单点 |
| 拖拽导入未进 import-dnd | - | 与全局拖拽状态冲突；必须经 features/import-dnd.ts |
| 手写头像路径拼接 | - | 越权路径穿越、缓存污染；必须经 isSafeAvatarPath 校验 |
| 头像缓存不失效 | - | 换头像后仍显示旧图；必须经缓存失效策略 |
| CLI 手写搜索 | - | 与 GUI 搜索结果不一致、参数不统一；必须复用 go/cli 的 SearchModels |
| runSearch 未传范围参数 | - | 数值筛选失效；必须完整传 6 个范围参数 |
| 手写 zip 内枚举 | - | 与 go/container 判定不一致、多 entry 漏检；必须经 go/container |
| 未处理 7z 格式 | - | 容器解析失败；必须经 go/container 的格式分流 |
| 手写去重比较 | - | 与 go/dedup 判定不一致、漏检；必须经 go/dedup |
| filepath.WalkDir 跟符号链接 | - | 目录遍历循环；必须跳过 ModeSymlink 条目 |
| 下载不校验 checksum | - | 静默损坏文件；必须经 ErrChecksumMismatch 拦截 |
| 部分响应未识别 | - | 后续续传逻辑失效；必须经 ErrPartialResponse 分类 |
| 直调 os/exec 不带隐藏标志 | - | Windows 子进程闪控制台窗口；必须经 HideWindow |
| Unix 平台 HideWindow 未 no-op | - | 编译失败；必须在 build tags 中区分平台 |
| 直接 unzip | - | 7z 未支持、纹理提取缺路径安全；必须经 go/geometry |
| 未走 ysm_parser.go | - | .ysm 解析不一致；必须经 go/ysm 兜底 |
| 直写目标文件 | - | 中断留下半文件；必须经 WriteFileAtomic 的 tmp+rename |
| 未走 DetectZipType | - | 误判 zip 类型、解压错误；必须先 DetectZipType 分流 |
| 手写落地逻辑 | - | LinkMode 不一致、ERROR_NOT_SAME_DEVICE 未处理；必须经 go/installer |
| 落地不原子替换 | - | 中断留下半文件；必须经 installer 的原子替换 |
| app 层手写同步 | - | 与 go/instance 判定不一致；必须经 SyncResources |
| BuildSyncItems 未去重 | - | 重复同步同一资源；必须在 BuildSyncItems 里做去重 |
| 前端手写 Litematic 解析 | - | 与 Go 解析结果不一致、palette 映射错误；必须交 Go 解析 |
| 未走 bedrock.go 做基岩版转换 | - | voxel 位置偏移；必须经 bedrock.go 转换 |
| 直接 os.WriteFile | - | 并发写破坏日志；必须经 WriteFileAtomic 原子追加 |
| 日志未轮转 | - | 单个文件无限膨胀；必须经日志轮转策略 |
| 前端手写 mcmeta.json 解析 | - | 与 Go 解析字段不一致、漏检 pack_format；必须交 Go 解析 |
| 未限制 LimitReader/maxLangSize | - | 大语言文件 OOM；必须用 LimitReader 截断 |
| 手写路径安全检查 | - | 越权路径穿越、符号链接绕过；必须经 IsInside |
| 符号链接未解析 | - | 路径穿越绕过 IsInside；必须用 IsInsideResolved 处理符号链接 |
| app 层手写同步 | - | 与 go/sync 判定不一致、冲突未处理；必须经 go/sync |
| 同步不做 hash 校验 | - | 文件变更未检测；必须经 sync_hash 校验 |
| 前端手写骨骼转换 | - | 与 go/threejs 输出不一致、四元数旋转错乱；必须经 spec.go |
| spec 字段漏转换 | - | 骨骼变形丢失；必须完整覆盖所有 spec 字段 |
| 复制类型定义 | - | 类型不一致、重构时漏改；必须经 go/types 单点 |
| LoadRegistry 失败未兜底 | - | 启动崩溃；必须在 LoadRegistry 里做默认值兜底 |
| 手写更新下载 | - | 与 go/updater 的增量 / 全量策略不一致；必须经 go/updater |
| 更新未完成前继续操作 | - | 半更新状态、启动失败；必须等更新完成再操作 |
| 轮询文件系统 | - | 延迟高、CPU 浪费；必须经 go/watcher 事件流 |
| watcher 未读 errs/done 通道 | - | goroutine 泄漏；必须 drain 通道 |
| 前端手写 YSM 解析 | - | 与 Go 解析结果不一致、漏掉 HasYSMMod 判定；必须交 Go 解析 |
| 跳过 ExtractYsmSummary 走全文解析 | - | 详情展示性能差；摘要必须复用 |
| 各组件各自调 ImportModel | - | 并发冲突、队列状态混乱；必须经 import-executor |
| dnd-collector 未做去重 | - | 同文件重复导入；必须在 collector 阶段去重 |
| 主线程同步跑统计 | - | 大库卡死 UI；必须经 Web Worker 后台统计 |
| Worker 未独立加载 WASM | - | 与主线程 WASM 实例冲突；必须在 Worker 内独立 open 解码 |
| 手写骨骼画布 | - | 与 model2d 输出不一致、缺鼠标拾取；必须复用 model2d.ts |
| Canvas 不销毁 | - | 内存泄漏；必须复用 renderer 并dispose |
| adapter 直接遍历 entry 数组 | - | 容器内多模型顺序不稳定、缺用户选择点；必须走 multiModelSelectNode |
| litematic zip 多 nbt 未走 select | - | 默认取第一个，用户无法换选；必须复用 multiModelSelectNode |
| 各页面各自实现评分 | - | 结果不一致、排名错乱；必须经 oldest-models 单点 |
| bus.emit 未带 payload | - | 下游无法渲染推荐卡；必须经 bus.emit 携带完整 payload |
| 在 page-store 里挂页面挂载 / 卸载逻辑 | - | 与 app-content 重复、状态串扰；必须分开 |
| resolveInitialPage 无回退 | - | 隐私模式读不到 localStorage 时死页；必须经三优先级回退 repository |
| 手写动画注入 | - | 与感知系统控制器冲突、节奏不同步；必须经感知控制器 |
| 节拍检测未缓存 | - | 每帧重复采样音频；必须经 beat-detector 的缓存策略 |
| 混用 mousedown + touchstart | - | 触屏双触发、桌面手势冲突；必须经 pointer events 统一 |
| 拖拽不设 touch-action:none | - | 浏览器滚动吃掉手势；必须在拖拽元素上禁用 touch-action |
| 改 Promise.all 并行结构漏写 () | - | 域级检查静默不跑（8/17 起 13 项失效实证） |
| push 被拒直接 --no-verify | - | 绕过不留审计；应修 FAIL 项或 git pull 整合 |
| 跨类型追加走错适配器 | `frontend/src/preview-3d/menu/core.ts` | 必须经 switchExternal → openModel3DFullscreen(cooperate) |
| 异步回调写入已卸载 DOM | `skeleton.ts` | 每个 await 后检查 container.isConnected |
| 手动调用导致 T-pose 回归 | `vrm.humanoid.update()` | 只用 vrm.update(dt) |
| 跨场景共用 schema key | - | 多模型同框时 schema 冲突、菜单项混乱；必须用 per-scene 键 |
| switch-preview 未清 schema 注册表 | - | 旧模型 schema 残留；必须经 switch-preview 清理 |
| 新加相机按钮 | - | 直接注入 mmd-controls → 切类型时按钮消失；必须走 setAdapterItems 注入核心根菜单 |
| YSM schema 未走 registerYsmModelSchema 注册 | - | schema 变更不同步到菜单；必须经 schema-registry |
| 直接改 preview-state 未注册字段 | - | 切页/换模后状态回滚、选项失效；应走 KNOWN_PATHS |
| 截图灯光与预览灯光混用 | - | 导出 PNG 与实时预览不一致；截图灯光必须走 shot-panel 独立通道 |
| 前端直调 os.Remove | - | 无法恢复、跳过 ADR-038 合并规则；必须经 go/recycle |
| initRecycleBin 不返回清理函数 | - | 监听泄漏；必须在 app-content 切换页时调用返回的清理函数 |
| 各自创建 renderer | - | 多 rAF 循环、GPU 资源浪费；必须经 render-federation 共享 |
| rAF 未统一节流 | - | 帧率不统一；必须经 federation 的 rAF 调度 |
| 硬编码 Windows 路径 | - | Android/Linux 启动失败；必须经平台桥的编译脚本 |
| CGO 未静态链接 | - | Android 缺少依赖库；必须经 compile-rust-static 静态编译 |
| 直接 dlopen 加载 rust.dll | - | 平台差异处理不全、符号名不匹配；必须经 bridge_*.go 封装 |
| Rust 后端未正确回收 | - | 内存泄漏；必须经 rustbridge 的 drop/destroy 生命周期 |
| Worker 内 import i18n | - | 模块加载失败、Worker 崩溃；必须用 safeErrorMessage |
| safeErrorMessage 不做字符串化 | - | null/undefined 错误丢信息；必须经 safeStr 兜底 |
| adapter 直接创建场景对象 | - | 能力列表 / 菜单 / 状态同步不一致；必须经 sceneCapabilityRegistry 注册 |
| 能力未实现 getMenuControls | - | 菜单缺控件；必须在 SceneCapability 接口中实现 getMenuControls |
| 前端本地重算筛选逻辑 | - | 与后端 SearchModels 能力脱节、结果不一致；必须交后端执行 |
| adv-filter 条件未走三路交集（关键词 + 数值 + 标签）→ 结果不精确；必须经 dgAfIntersectPaths | - | - |
| app-sidebar 直接发 push/pull 请求 | - | 并发冲突 / 状态错乱；必须经 sync-manager 排队 |
| PullSingleResource 未完成前刷新侧边栏 | - | 半同步状态显示；必须等 store 状态收敛 |
| 手写重复 DOM | - | 样式不一致、缺可访问性；必须经 ui-components |
| ui-components 内自定义元素 | - | 与全仓 Web Components 规范冲突；ui-components 只做 helper 函数 |
| 手写 splice 排序 | - | 与拖拽 drop 逻辑不一致、边界溢出；必须经 moveItem |
| moveItem 未 clamp | - | 拖拽到首/尾位置时报错；必须在 moveItem 内做 clamp |
| 裸抛原始错误 | - | 用户看不懂、违反治理红线；必须经 friendlyError 翻译 |
| 网络错误未分类 | - | 一律显示未知错误；必须经 friendlyError 的网络错误分支 |
| 拖拽导入等待异步注册表 | - | 导入按钮短暂不可用；必须用 RESOURCE_EXTS 静态表 |
| 静态表未与 resource_types.json 对齐 | - | 三端不一致；必须由契约测试守护 |
| console.log 散落 | - | 无法按 tag 过滤、生产环境泄漏日志；必须经 dbg |
| 环形缓冲区未限制大小 | - | 内存累积；必须经环形缓冲的 max 限制 |
| 手写类型映射 | - | 与注册表不一致、分类错乱；必须经 LoadResourceTypes |
| 新增资源类型未注册 | - | 前端无法识别；必须在 resource_types.json 中注册 |
| 手写详情卡片 | - | 与 summaryCardHTML 样式不一致、作者信息重复；必须经 summaryCardHTML |
| 加密模型未走 summarizeDecoded | - | 加密内容泄露；必须经 summarizeDecoded 的安全提取 |
| 高频轮询 GitHub API | - | 触发限流、浪费带宽；必须经 canCheck 节流 |
| check 未 markChecked | - | 重启后重复检查；必须在检查完成后 markChecked 记录时间戳 |
| DOM 测试切 node 环境 | - | window/document 报错；必须保持 happy-dom 或治理源码副作用 |
| 用 vi.mock 硬扛源码副作用 | - | 治标不治本；必须先做惰性化守卫/神桶拆分 |
| 直调 window.go 方法 | - | Wails 启动时序不确定、方法未就绪时调用失败；必须经 getApp() 代理 |
| 在 web 模式直调 wails binding | - | window.go 不存在；必须走 backend-web 的 browser-adapter |
| 手写动画解析 | - | 与基岩版 animation.json 语义不一致；必须经 ysm-animation-player |
| Molang 求值未缓存 | - | 每帧重复求值、性能差；必须缓存 Molang 表达式 |
| 手写 YSM 字节流解析 | - | 与 YSMParser WASM 输出不一致；必须经 ysm-wasm |
| wasmBinary 未释放 | - | 内存泄漏；必须复用 wasm 实例并释放 |
| Worker 内静态 import WASM 数据模块 | - | 另一变体成 1.5MB 死重；必须动态 import |
| vite worker.format 未设 es | - | iife 强制 inlineDynamicImports，动态 import 构建直接失败 |

---
<!--  END_GENERATED_SECTION -->
