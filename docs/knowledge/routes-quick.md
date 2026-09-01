<!-- 本文件由 scripts/gen-routes-quick.ts 自动生成，请勿手改。重跑：node scripts/gen-routes-quick.ts -->

# AI 急速版路由表（高频场景）

> 本表由知识卡 frontmatter 的 `quick_*` 字段自动生成。
> 新增高频场景请在对应知识卡 frontmatter 补充 `quick_groups`/`quick_intents`/`quick_risk_lines`/`pitfalls`。

## 🎯 3D 预览与模型追加

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 2D 预览、骨骼图、Canvas 渲染 | [2D 预览渲染 model2d](./model2d.md) | 2D 骨骼渲染必须走 model2d.ts 的 Canvas 渲染，禁止手写骨骼画布 | - |
| 3D 骨骼 spec、three.js | [3D 骨骼 spec go/threejs](./go-threejs.md) | YSM 骨骼数据必须走 go/threejs 的 spec.go 转换为 three.js 格式，前端禁止手写骨骼转换 | - |
| 3D 控制器、MMD 播放、VRM 材质 / YSM schema | [3D 预览控制器（声明式菜单节点）](./preview-controls.md) | 相机操作已归核心声明式根菜单，底部导航弹窗已删除；adapter 项必须经 setAdapterItems 注入核心根菜单，禁止内联 | ADR-127, ADR-132 |
| 3D 预览菜单、根菜单、dock 按钮 | [统一 3D 预览核心 preview-core](./preview_core.md) | 适配器项经 setAdapterItems 注入，禁止内联 | ADR-125 |
| 顶点 / UV / 四元数 | [3D 骨骼 spec go/threejs](./go-threejs.md) | - | - |
| 动画解析 / 求值 / 渲染注入 | [YSM (Bedrock) 动画管线](./ysm-anim-pipeline.md) | - | - |
| 多 3D 场景共存 | [联邦渲染能力 (Render Federation)](./render-federation.md) | - | ADR-125 |
| 多模型选择、多组件 / 多 entry | [多模型选择菜单原语 multiModelSelectNode](./multi_model_select.md) | 容器内多模型必须经 multiModelSelectNode 声明式菜单选择，禁止 adapter 直接遍历 entry 数组渲染 | ADR-132 |
| 骨骼动画、关键帧、动画播放 | [动画系统 animation](./animation-system.md) | 基岩 animation.json 解析后必须走 evaluateClip 插值，禁止前端手写关键帧插值逻辑 | - |
| 加密模型、wasm 加载、Emscripten | [WASM 解析器 ysm-parser](./ysm-wasm.md) | - | - |
| 截图按钮、相机控制、模型切换 | [3D 预览控制器（声明式菜单节点）](./preview-controls.md) | - | ADR-127, ADR-132 |
| 截图灯光、activeComponent、组件选择 | [预览面板设置与显示控制](./preview-settings.md) | - | ADR-132 |
| 蓝图、投影、资源管理 | [资源包功能 resource-packs](./resource-packs.md) | - | - |
| 模型切换、会话内替换 | [统一 3D 预览核心 preview-core](./preview_core.md) | switchTo 仅同类型；跨类型用 switchExternal | ADR-125 |
| 模型渲染 | [3D 骨骼 spec go/threejs](./go-threejs.md) | - | - |
| 前视图、骨骼热区、鼠标拾取、线框图 | [2D 预览渲染 model2d](./model2d.md) | - | - |
| 数字滚动、stagger 入场、关闭动画 | [动画系统 animation](./animation-system.md) | - | - |
| 头像、作者、创作者 avatar | [头像 go/avatar](./go-avatar.md) | 头像提取必须走 go/avatar 的 ExtractAvatarURI，前端禁止手写头像路径拼接 | - |
| 头像缓存、缩略图 | [头像 go/avatar](./go-avatar.md) | - | - |
| 投影、litematic、schematic、nbt、蓝图 | [Litematic 解析 go/litematic](./go-litematic.md) | Litematic 蓝图必须走 go/litematic 的 parser/schematic/structure 三层解析，禁止前端手写 Litematic 解析 | - |
| 相机控制、OrbitControls | [3D 预览渲染 model3d](./model3d.md) | 相机定位公式固定：position(0, 80, -120), target(0, 80, 0) | - |
| 渲染联邦、shared renderer、rAF 复用 | [联邦渲染能力 (Render Federation)](./render-federation.md) | 多 3D 场景必须走 render-federation 的 shared renderer / rAF，禁止各自创建 renderer | ADR-125 |
| 预览面板、模型预览、2D 骨骼 / 3D 预览 | [预览面板 app-preview](./app-preview.md) | 预览面板必须经 model:select 事件驱动，WASM 能力判定由 matchTypeByExt 注册表驱动，禁止内联正则 | - |
| 预览设置、显示控制、骨骼名称开关 | [预览面板设置与显示控制](./preview-settings.md) | 预览设置集中由 preview-state.ts 的 KNOWN_PATHS 注册管理，新增选项必须经注册而非直接读写状态 | ADR-132 |
| 帧率 / 像素比 / 视锥剔除 / 3D 偏好 | [预览面板设置与显示控制](./preview-settings.md) | - | ADR-132 |
| 追加模型、同台加载、多模型同框 | [统一 3D 预览核心 preview-core](./preview_core.md) | 跨类型必须走 switchExternal，禁止直接调 adapter.build | ADR-125 |
| 资源包、光影包、resourcepack / shaderpack | [资源包功能 resource-packs](./resource-packs.md) | 资源包 / 光影包详情必须经 detail.ts 的 showResourcePack/showShaderpack，禁止手写详情渲染 | - |
| AnimationController、状态机 | [动画系统 animation](./animation-system.md) | - | - |
| app-preview 组件、_previewGuard、detailGen | [预览面板 app-preview](./app-preview.md) | - | - |
| isSafeAvatarPath | [头像 go/avatar](./go-avatar.md) | - | - |
| Litematic / 蓝图、资源包 / 光影包 | [预览面板 app-preview](./app-preview.md) | - | - |
| MEMFS / node 解码 / callMain | [WASM 解析器 ysm-parser](./ysm-wasm.md) | - | - |
| model:select、WASM 解码、放大预览 | [预览面板 app-preview](./app-preview.md) | - | - |
| Molang 表达式求值 | [动画系统 animation](./animation-system.md) | - | - |
| multiModelSelectNode | [多模型选择菜单原语 multiModelSelectNode](./multi_model_select.md) | - | ADR-132 |
| multiModelSelectNode / preview menu node | [3D 预览控制器（声明式菜单节点）](./preview-controls.md) | - | ADR-127, ADR-132 |
| palette / voxel / bedrock 转换 | [Litematic 解析 go/litematic](./go-litematic.md) | - | - |
| showResourcePack、showShaderpack | [资源包功能 resource-packs](./resource-packs.md) | - | - |
| VRM 动画播放、VRMA | [统一 3D 预览核心 preview-core](./preview_core.md) | 必须 mixer.update(dt) → vrm.update(dt)，禁止手动 vrm.humanoid.update() | ADR-125 |
| WASM 解析器、YSMParser、ysm 解码 | [WASM 解析器 ysm-parser](./ysm-wasm.md) | YSM 前端解码必须走 ysm-wasm 的 WASM 解析器，禁止手写 YSM 字节流解析 | - |
| YSM 动画管线、基岩动画 | [YSM (Bedrock) 动画管线](./ysm-anim-pipeline.md) | YSM 动画必须走 ysm-anim-pipeline 的解析-求值-注入三段，禁止前端手写动画解析 | - |
| ysm-animation-player、molang | [YSM (Bedrock) 动画管线](./ysm-anim-pipeline.md) | - | - |
| zip 多模型、多候选、蓝图 zip、litematic zip | [多模型选择菜单原语 multiModelSelectNode](./multi_model_select.md) | - | ADR-132 |

## 🎯 跨组件通信与页面

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 侧边栏、整合包列表、版本卡片 | [侧边栏 app-sidebar](./app-sidebar.md) | 侧边栏的 push/pull 必须经 events.ts 的 asbRunPush/asbRunPull 转发到 sync-manager，禁止直接调 API | - |
| 纯函数 | [核心工具函数 core-utils](./core_utils.md) | - | - |
| 订阅 / 退订事件 / once | [事件总线 bus.ts](./event-bus.md) | once 只能用它返回的退订函数取消（off 原 fn 匹配不到 wrapper） | - |
| 工具函数、防抖、异步工具 | [核心工具函数 core-utils](./core_utils.md) | swallowError 只用于"吞掉已知安全错误"，禁止用于掩盖业务异常；fireAndForget 必须带 error 回调兜底 | - |
| 加翻译 / 多语言 / i18n | [国际化 i18n 模块](./i18n.md) | t() 纯函数查表；语言切换广播 lang:changed 驱动全库重渲染 | - |
| 节点选择、多选、右键菜单 | [资源树 app-tree](./app-tree.md) | - | - |
| 启动初始页解析 | [页面状态管理 page-store.ts](./page-store.md) | - | - |
| 启动器检测 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 全局事件、拖拽导入、拖拽提示 | [全局事件处理 global-handlers](./global-handlers.md) | 全局事件必须经 global-handlers 单点注册，禁止各页面各自 bindGlobalHandler | - |
| 同步缺失、清空整合包、导出清单 | [全局事件处理 global-handlers](./global-handlers.md) | - | - |
| 推送 / 拉取、同步状态、勾选 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 新组件注册、import 组件、startup reveal | [组件入口 app-modules](./app-modules.md) | - | - |
| 页面初始化流程、订阅桶 / 会话状态 | [主内容页 app-content](./app-content.md) | - | - |
| 页面状态管理、当前页、page store | [页面状态管理 page-store.ts](./page-store.md) | page-store 只管理当前页标识（只读 getter），不协调页面挂载 / 卸载，那是 app-content 的职责 | - |
| 一键安装、整合包拖拽导入 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 整合包列表、同步状态、勾选 | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |
| 整合包同步、推送 / 拉取 | [整合包同步管理器 sync-manager](./sync-manager.md) | 同步操作必须经 sync-manager 的 queue 排队，禁止 app-sidebar 直接调 PushSingleResource | - |
| 主内容区、页面切换、仓库页 / 创作者页 / 社区页 | [主内容页 app-content](./app-content.md) | 主内容区页面切换必须经 nav:change / app-nav 路由分发，禁止页面之间直接 init 对方 | - |
| 主题初始化、服务注册、检查更新 | [组件入口 app-modules](./app-modules.md) | - | - |
| 资源树、tree、目录树 | [资源树 app-tree](./app-tree.md) | app-tree 的 bus 订阅必须经 _unsubs 收集，disconnectedCallback 必须清理全部订阅 | - |
| 组件入口、模块装配、启动流程 | [组件入口 app-modules](./app-modules.md) | 新增 JS 组件必须登记进 app-modules.ts 的 import 列表，致命陷阱 | - |
| emit 事件 / 跨组件通信 | [事件总线 bus.ts](./event-bus.md) | 所有跨组件异步通信必经 bus.ts，禁止组件间直耦 | - |
| input-and-animation | [Pointer Events 统一交互（触屏 + 桌面）](./pointer-events.md) | - | - |
| nav:change 事件分发、全局 handler 注册 | [主内容页 app-content](./app-content.md) | - | - |
| pointerdown / pointermove / pointerup、触屏 + 桌面统一 | [Pointer Events 统一交互（触屏 + 桌面）](./pointer-events.md) | 所有交互必须用 pointerdown/pointermove/pointerup 统一处理，禁止混用 mousedown/touchstart | - |
| PushSingleResource / PullSingleResource | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |
| registerGlobalHandlers、instance-ops | [全局事件处理 global-handlers](./global-handlers.md) | - | - |
| resolveInitialPage / sanitizePage | [页面状态管理 page-store.ts](./page-store.md) | - | - |
| setPointerCapture、touch-action、拖拽 | [Pointer Events 统一交互（触屏 + 桌面）](./pointer-events.md) | - | - |
| swallowError / fireAndForget / retry / timeout | [核心工具函数 core-utils](./core_utils.md) | - | - |
| sync:download:missing 缺包回拉 | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |
| tree:set-search、bus-handlers、selectState | [资源树 app-tree](./app-tree.md) | - | - |

## 🎯 模型扫描与仓库管理

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 仓库审计、健康分 | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 冲突处理 conflict.go | [整合包同步 go/sync](./go-sync.md) | - | - |
| 待推送 / 可拉取 / 已禁用 / 实例资源 | [整合包同步页 app-sync-manager](./app-sync-manager.md) | - | - |
| 模型解析、zip / 7z / 纹理 / 动画 | [Geometry 存档 go/geometry](./go-geometry.md) | - | - |
| 去重、重复检测、dedup | [去重 go/dedup](./go-dedup.md) | 去重必须走 go/dedup，禁止在业务代码里手写文件指纹比较 | - |
| 去重检测、dedup | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 容器解析、container_entries | [统一容器桥接层 go/container](./go-container.md) | 容器内多模型枚举必须走 go/container，前端禁止手写 zip 内文件枚举 | - |
| 扫描模型、ScanModelEntries | [扫描核心 go/scanner](./go-scanner.md) | 容器指纹缓存失效需调 ClearScanCache | - |
| 搜索、筛选、关键词 / 标签 / 数值三路交集 | [搜索筛选编排 search](./search.md) | 搜索筛选必须经 toolbar-search 编排 + adv-filter 弹窗 + SearchModels 后端，前端只做 UI 不做筛选逻辑 | - |
| 缩略图、类型检测 | [资源包 mcmeta go/packs](./go-packs.md) | - | - |
| 同步状态、app-sync-manager | [整合包同步页 app-sync-manager](./app-sync-manager.md) | - | - |
| 文件监听、文件变化、刷新 | [文件监听 go/watcher](./go-watcher.md) | 文件变更监听必须走 go/watcher 的事件流，禁止轮询文件系统 | - |
| 整合包同步、推送 / 拉取 | [整合包同步 go/sync](./go-sync.md) | 整合包同步必须走 go/sync 的 diff+hash 双阶段，禁止在 app 层手写同步逻辑 | - |
| 整合包同步、sync | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 整合包同步页、推送 / 拉取资源 | [整合包同步页 app-sync-manager](./app-sync-manager.md) | app-sync-manager 的同步状态渲染必须经 _gen 单点生成，禁止各列各自查询状态 | - |
| 资源包 / 光影包、mcmeta、pack_format | [资源包 mcmeta go/packs](./go-packs.md) | 资源包元数据必须走 go/packs 的 mcmeta 解析，前端禁止手写 mcmeta.json 解析 | - |
| 资源类型识别、rtype 判定 | [扫描核心 go/scanner](./go-scanner.md) | resource_types.json 是唯一事实来源 | - |
| AnalyzeYSMModel、HasYSMMod | [YSM 解析 go/ysm](./go-ysm-parser.md) | - | - |
| dgAfIntersectPaths | [搜索筛选编排 search](./search.md) | - | - |
| filepath.WalkDir 路径安全 | [去重 go/dedup](./go-dedup.md) | - | - |
| Geometry 存档、基岩版 bedrock | [Geometry 存档 go/geometry](./go-geometry.md) | Geometry 存档解析必须走 go/geometry 的 parse/archive 封装，禁止在业务代码里直接 unzip | - |
| IsRecycleDir 守卫 | [去重 go/dedup](./go-dedup.md) | - | - |
| parse.go / archive.go | [Geometry 存档 go/geometry](./go-geometry.md) | - | - |
| SearchModels、adv-filter、网页版降级 | [搜索筛选编排 search](./search.md) | - | - |
| sync_diff / sync_hash / sync_push / sync_relink | [整合包同步 go/sync](./go-sync.md) | - | - |
| watcher、Events / errs / done | [文件监听 go/watcher](./go-watcher.md) | - | - |
| YSM 解析、摘要 ExtractYsmSummary | [YSM 解析 go/ysm](./go-ysm-parser.md) | YSM 解析必须走 go/ysm 的 AnalyzeYSMModel，前端禁止手写 YSM 解析逻辑 | - |
| YSM 文件元数据 | [YSM 解析 go/ysm](./go-ysm-parser.md) | - | - |
| zip 多模型、多 entry | [统一容器桥接层 go/container](./go-container.md) | - | - |

## 🎯 后端桥接与数据存储

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 调后端、app.ts 绑定、getApp | [Wails Binding API 总览 internal/app](./wails-bindings.md) | - | - |
| 网页版 / 浏览器模式 / web mode | [网页版后端 backend-web](./backend_web.md) | 网页版后端必须经 browserAdapter 代理，禁止 Wails 与浏览器后端混合调用 | - |
| API 总览、Binding 有哪些方法、App 方法签名 | [Wails Binding API 总览 internal/app](./wails-bindings.md) | 前端访问 Wails 后端必须经 getApp()，禁止直接调 window.go | - |
| browser adapter、跨域隔离 COI | [网页版后端 backend-web](./backend_web.md) | - | - |
| GetAppVersion / ScanModelEntries / SearchModels | [Wails Binding API 总览 internal/app](./wails-bindings.md) | - | - |
| IndexedDB / IDB / 浏览器后端 | [网页版后端 backend-web](./backend_web.md) | - | - |
| IndexedDB、网页版存储 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | 事务必须接线 complete/error/abort 三事件 | ADR-177 |
| NBT 解析 / 体素 / 网页版文件系统 | [网页版后端 backend-web](./backend_web.md) | - | - |
| Wails 绑定、Go 调用 | [Wails 桥接 app.ts](./wails-bridge.md) | 前端必须经 getApp() 访问，禁止直调 window.go | ADR-049 |

## 🎯 UI 交互与弹窗

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 菜单行为执行、ctx:show | [右键菜单系统](./context-menu.md) | 禁止 view 层手写菜单项 | - |
| 打标签、编辑标签、tag-editor | [标签编辑器 tag-editor](./dialog-tag-editor.md) | tag-editor 弹窗必须复用 modal.ts 的 Promise API，标签写回走 go/tags Store 的原子替换 | - |
| 弹确认框 / 输入框 / 下拉选择 / modal | [弹窗基座 modal](./dialog-modal.md) | 业务弹窗必须复用 modal.ts 的 Promise API（prompt/select/confirm/picker），禁止手写弹窗 | - |
| 分类标记、全库标签建议 | [标签编辑器 tag-editor](./dialog-tag-editor.md) | - | - |
| 批量重命名、查找替换、正则替换 | [批量重命名 batch-rename](./dialog-batch-rename.md) | batch-rename 弹窗必须是模块级单例 dialogEl，重复打开先 close() 结算上一个 Promise | - |
| 统一作者 / 作品、5 个内置预设 | [批量重命名 batch-rename](./dialog-batch-rename.md) | - | - |
| 右键菜单、添加菜单项 | [右键菜单系统](./context-menu.md) | 菜单结构声明在 menu-defs.ts（唯一事实来源），行为在 core/context-menus.ts | - |
| modalTagEditor | [标签编辑器 tag-editor](./dialog-tag-editor.md) | - | - |
| showBatchRenameDialog | [批量重命名 batch-rename](./dialog-batch-rename.md) | - | - |

## 🎯 截图导出与缓存

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 截图 / 导出 PNG / 多角度截图 / 预览缓存 | [截图与导出 export](./utils-export.md) | 离屏截图渲染器资源与 blob URL 必须释放，防内存泄漏 | - |
| 截图、导出 PNG、多角度截图 | [截图导出 export](./export.md) | 离屏截图渲染器资源与 blob URL 必须显式释放，禁止依赖 GC 回收 | ADR-127 |
| 离屏截图渲染器 | [截图导出 export](./export.md) | - | ADR-127 |
| 透明背景 / 预览缓存 / blob URL | [截图导出 export](./export.md) | - | ADR-127 |

## 🎯 文件操作与标签

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 打标签 / 标签存储 / 按标签筛选 | [标签系统 go/tags](./go-tags.md) | 标签以文件绝对路径为 key 存 tags.json；写入走 tmp + os.Rename 原子替换，禁止直写 | - |
| 导入、导入策略、导入队列 | [导入策略 go/importer](./go-importer.md) | 导入必须走 go/importer，落地用 fsutil.WriteFileAtomic 原子替换，禁止直写目标文件 | - |
| 回收站 / 软删除 / 恢复 / 清空回收站 | [回收站 go/recycle](./go-recycle.md) | 删除必须走 .recycle 软删除（硬链接判定），禁止直接 os.Remove | - |
| 模型安装、模型导入、下载模型 | [模型安装 go/installer](./go-installer.md) | 模型落地必须走 go/installer，按 LinkMode 选择落地方式，落地前做路径安全校验 | - |
| 下载、下载进度、进度条 | [下载器 go/download](./go-download.md) | 下载必须走 go/download，必须带校验和校验防截断 / 部分响应 | - |
| 校验和校验 | [下载器 go/download](./go-download.md) | - | - |
| 移动 / 复制 / 删除 / 重命名文件 / 文件夹导入 | [文件操作 go/fileops](./go-fileops.md) | 文件 CRUD 必须走 go/fileops，internal/app 薄壳仅转发 | - |
| download、HTTPStatusError、TruncationError | [下载器 go/download](./go-download.md) | - | - |
| ERROR_NOT_SAME_DEVICE | [模型安装 go/installer](./go-installer.md) | - | - |
| fsutil.WriteFileAtomic | [导入策略 go/importer](./go-importer.md) | - | - |
| importer、DetectZipType | [导入策略 go/importer](./go-importer.md) | - | - |
| LinkMode（copy / hardlink / symlink） | [模型安装 go/installer](./go-installer.md) | - | - |

## 🎯 配置与注册表

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 检查更新、更新下载、update | [自动更新 go/updater](./go-updater.md) | 更新检查必须走 go/updater，前端禁止手写更新下载逻辑 | - |
| 新增资源类型 / 修改 resource_types.json / 文件类型 | [资源注册表 registry](./resource-registry.md) | resource_types.json 是唯一事实来源；前端只读不判、禁本地重算 | - |
| version-updater | [自动更新 go/updater](./go-updater.md) | - | - |

## 🎯 模型格式与解析

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| YSM 烘焙 / 几何反推 / pivot 错位 / BlockBench 导出 | [YSM 烘焙与几何反推](./ysm-baked.md) | cube 语义已烘焙为纯顶点面，禁止前端反推 origin/size/uv | - |

## 🚨 高频陷阱速查

| 陷阱 | 位置 | 正确做法 |
|------|------|----------|
| 手写关键帧插值 | - | 与基岩官方行为不一致、T-pose 漂移；必须经 evaluateClip |
| Molang 表达式缓存键不完整 | - | 相同逻辑不同骨骼重复求值；缓存 key 必须含 clip/bone 标识 |
| 页面 A 直接调用页面 B 的 init | - | 重复初始化 / 订阅泄漏；必须经 nav:change 单点分发 |
| subscription-bucket 未退订 | - | 跨页残留监听、状态串扰；每次切换必须 clear 旧桶 |
| 新 JS 未登记进 app-modules.ts | - | 组件不加载、Shadow DOM 未升级；必须在 app-modules.ts 加入口 |
| 主题值未归一化 | - | 脏值污染 localStorage 持久层；必须经 normalizeTheme 白名单过滤 |
| 手写 .(ysm\|zip\|json) 判定 | - | .7z 漏判、注册表变更不同步；必须经 matchTypeByExt(RESOURCE_TYPES.YSM) |
| async 窗口期无 container.isConnected 守卫 | - | 组件卸载后异步回调写已卸载 DOM；每个 await 后必须检查 isConnected |
| events.ts 里直接调 PushSingleResource | - | 绕过排队，并发冲突；必须经 asbRunPush/asbRunPull |
| _lastEmittedPkg 未更新 | - | 拖拽导入重复触发；每次导入必须刷新该锚点 |
| 各列各自查询同步状态 | - | 状态不一致、并发冲突；必须经 _gen 单点生成 |
| 同步操作未进队列 | - | 并发 push/pull 冲突；必须经 sync-manager 排队 |
| bus 订阅未进 _unsubs | - | 组件卸载后监听泄漏；必须经 bindBusEvents 返回的 unsub 数组收集 |
| DOM 委托事件进 _unsubs | - | disconnect 时重复 off 报错；DOM 委托事件应靠 ShadowRoot detach 自动清理 |
| 网页版直调 window.go | - | 无 wails runtime 时报错；必须经 browserAdapter |
| 跨域资源共享不处理 COI | - | SharedArrayBuffer 等 API 不可用；必须设置 cross-origin-isolation 头 |
| 内联菜单结构 | `view 层` | 必须声明进 menu-defs.ts |
| swallowError 吞掉业务异常 | - | 静默失败、无法排查；必须用于"预期内可忽略"的错误 |
| fireAndForget 无 error 兜底 | - | 异常丢失；必须挂 onerror 回调或全局 error 监听 |
| 重复打开 batch-rename 不 close | - | 上一个 Promise 悬挂、调用方 await 卡死；必须先 close 结算 |
| 正则替换不分离扩展名 | - | 把 .ext 一起替换掉；必须只对文件名主体替换 |
| 手写 tag-editor 弹窗 | - | 弹窗样式 / 焦点陷阱与全局不一致；必须复用 modal.ts |
| 标签写回用直写 tags.json | - | 并发写破坏文件；必须经 go/tags Store 的 tmp+os.Rename 原子替换 |
| once off 错对象 | `bus.off(event, 原fn)` | 用 once 返回的 unsub 函数取消 |
| 离屏 Canvas 不释放 | - | 内存泄漏、连续截图卡死；必须在完成回调里 release |
| blob URL 不 revokeObjectURL | - | 浏览器内存累积；导出 / 失败分支都必须 revoke |
| 各页面各自注册全局事件 | - | 重复绑定、冲突处理；必须经 global-handlers 单点 |
| 拖拽导入未进 import-dnd | - | 与全局拖拽状态冲突；必须经 features/import-dnd.ts |
| 手写头像路径拼接 | - | 越权路径穿越、缓存污染；必须经 isSafeAvatarPath 校验 |
| 头像缓存不失效 | - | 换头像后仍显示旧图；必须经缓存失效策略 |
| 手写 zip 内枚举 | - | 与 go/container 判定不一致、多 entry 漏检；必须经 go/container |
| 未处理 7z 格式 | - | 容器解析失败；必须经 go/container 的格式分流 |
| 手写去重比较 | - | 与 go/dedup 判定不一致、漏检；必须经 go/dedup |
| filepath.WalkDir 跟符号链接 | - | 目录遍历循环；必须跳过 ModeSymlink 条目 |
| 下载不校验 checksum | - | 静默损坏文件；必须经 ErrChecksumMismatch 拦截 |
| 部分响应未识别 | - | 后续续传逻辑失效；必须经 ErrPartialResponse 分类 |
| 直接 unzip | - | 7z 未支持、纹理提取缺路径安全；必须经 go/geometry |
| 未走 ysm_parser.go | - | .ysm 解析不一致；必须经 go/ysm 兜底 |
| 直写目标文件 | - | 中断留下半文件；必须经 WriteFileAtomic 的 tmp+rename |
| 未走 DetectZipType | - | 误判 zip 类型、解压错误；必须先 DetectZipType 分流 |
| 手写落地逻辑 | - | LinkMode 不一致、ERROR_NOT_SAME_DEVICE 未处理；必须经 go/installer |
| 落地不原子替换 | - | 中断留下半文件；必须经 installer 的原子替换 |
| 前端手写 Litematic 解析 | - | 与 Go 解析结果不一致、palette 映射错误；必须交 Go 解析 |
| 未走 bedrock.go 做基岩版转换 | - | voxel 位置偏移；必须经 bedrock.go 转换 |
| 前端手写 mcmeta.json 解析 | - | 与 Go 解析字段不一致、漏检 pack_format；必须交 Go 解析 |
| 未限制 LimitReader/maxLangSize | - | 大语言文件 OOM；必须用 LimitReader 截断 |
| app 层手写同步 | - | 与 go/sync 判定不一致、冲突未处理；必须经 go/sync |
| 同步不做 hash 校验 | - | 文件变更未检测；必须经 sync_hash 校验 |
| 前端手写骨骼转换 | - | 与 go/threejs 输出不一致、四元数旋转错乱；必须经 spec.go |
| spec 字段漏转换 | - | 骨骼变形丢失；必须完整覆盖所有 spec 字段 |
| 手写更新下载 | - | 与 go/updater 的增量 / 全量策略不一致；必须经 go/updater |
| 更新未完成前继续操作 | - | 半更新状态、启动失败；必须等更新完成再操作 |
| 轮询文件系统 | - | 延迟高、CPU 浪费；必须经 go/watcher 事件流 |
| watcher 未读 errs/done 通道 | - | goroutine 泄漏；必须 drain 通道 |
| 前端手写 YSM 解析 | - | 与 Go 解析结果不一致、漏掉 HasYSMMod 判定；必须交 Go 解析 |
| 跳过 ExtractYsmSummary 走全文解析 | - | 详情展示性能差；摘要必须复用 |
| 手写骨骼画布 | - | 与 model2d 输出不一致、缺鼠标拾取；必须复用 model2d.ts |
| Canvas 不销毁 | - | 内存泄漏；必须复用 renderer 并dispose |
| adapter 直接遍历 entry 数组 | - | 容器内多模型顺序不稳定、缺用户选择点；必须走 multiModelSelectNode |
| litematic zip 多 nbt 未走 select | - | 默认取第一个，用户无法换选；必须复用 multiModelSelectNode |
| 在 page-store 里挂页面挂载 / 卸载逻辑 | - | 与 app-content 重复、状态串扰；必须分开 |
| resolveInitialPage 无回退 | - | 隐私模式读不到 localStorage 时死页；必须经三优先级回退 repository |
| 混用 mousedown + touchstart | - | 触屏双触发、桌面手势冲突；必须经 pointer events 统一 |
| 拖拽不设 touch-action:none | - | 浏览器滚动吃掉手势；必须在拖拽元素上禁用 touch-action |
| 跨类型追加走错适配器 | `frontend/src/preview-3d/menu/core.ts` | 必须经 switchExternal → openModel3DFullscreen(cooperate) |
| 异步回调写入已卸载 DOM | `skeleton.ts` | 每个 await 后检查 container.isConnected |
| 手动调用导致 T-pose 回归 | `vrm.humanoid.update()` | 只用 vrm.update(dt) |
| 新加相机按钮 | - | 直接注入 mmd-controls → 切类型时按钮消失；必须走 setAdapterItems 注入核心根菜单 |
| YSM schema 未走 registerYsmModelSchema 注册 | - | schema 变更不同步到菜单；必须经 schema-registry |
| 直接改 preview-state 未注册字段 | - | 切页/换模后状态回滚、选项失效；应走 KNOWN_PATHS |
| 截图灯光与预览灯光混用 | - | 导出 PNG 与实时预览不一致；截图灯光必须走 shot-panel 独立通道 |
| 各自创建 renderer | - | 多 rAF 循环、GPU 资源浪费；必须经 render-federation 共享 |
| rAF 未统一节流 | - | 帧率不统一；必须经 federation 的 rAF 调度 |
| 手写详情渲染 | - | 与模型详情样式不一致、缺 Go 侧 ReadPackMeta/ReadShaderpackLang；必须复用 |
| 光影包配置未读 ReadShaderpackLang | - | 显示名 / 配置简介缺失；必须经 Go 侧读取 |
| 前端本地重算筛选逻辑 | - | 与后端 SearchModels 能力脱节、结果不一致；必须交后端执行 |
| adv-filter 条件未走三路交集（关键词 + 数值 + 标签）→ 结果不精确；必须经 dgAfIntersectPaths | - | - |
| app-sidebar 直接发 push/pull 请求 | - | 并发冲突 / 状态错乱；必须经 sync-manager 排队 |
| PullSingleResource 未完成前刷新侧边栏 | - | 半同步状态显示；必须等 store 状态收敛 |
| 直调 window.go 方法 | - | Wails 启动时序不确定、方法未就绪时调用失败；必须经 getApp() 代理 |
| 在 web 模式直调 wails binding | - | window.go 不存在；必须走 backend-web 的 browser-adapter |
| 手写动画解析 | - | 与基岩版 animation.json 语义不一致；必须经 ysm-animation-player |
| Molang 求值未缓存 | - | 每帧重复求值、性能差；必须缓存 Molang 表达式 |
| 手写 YSM 字节流解析 | - | 与 YSMParser WASM 输出不一致；必须经 ysm-wasm |
| wasmBinary 未释放 | - | 内存泄漏；必须复用 wasm 实例并释放 |

---
<!--  END_GENERATED_SECTION -->
