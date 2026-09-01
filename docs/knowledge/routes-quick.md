<!-- 本文件由 scripts/gen-routes-quick.ts 自动生成，请勿手改。重跑：node scripts/gen-routes-quick.ts -->

# AI 急速版路由表（高频场景）

> 本表由知识卡 frontmatter 的 `quick_*` 字段自动生成。
> 新增高频场景请在对应知识卡 frontmatter 补充 `quick_groups`/`quick_intents`/`quick_risk_lines`/`pitfalls`。

## 🎯 3D 预览与模型追加

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 3D 预览菜单、根菜单、dock 按钮 | [统一 3D 预览核心 preview-core](./preview_core.md) | 适配器项经 setAdapterItems 注入，禁止内联 | ADR-125 |
| 骨骼动画、关键帧、动画播放 | [动画系统 animation](./animation-system.md) | 基岩 animation.json 解析后必须走 evaluateClip 插值，禁止前端手写关键帧插值逻辑 | - |
| 截图灯光、activeComponent、组件选择 | [预览面板设置与显示控制](./preview-settings.md) | - | ADR-132 |
| 模型切换、会话内替换 | [统一 3D 预览核心 preview-core](./preview_core.md) | switchTo 仅同类型；跨类型用 switchExternal | ADR-125 |
| 数字滚动、stagger 入场、关闭动画 | [动画系统 animation](./animation-system.md) | - | - |
| 相机控制、OrbitControls | [3D 预览渲染 model3d](./model3d.md) | 相机定位公式固定：position(0, 80, -120), target(0, 80, 0) | - |
| 预览设置、显示控制、骨骼名称开关 | [预览面板设置与显示控制](./preview-settings.md) | 预览设置集中由 preview-state.ts 的 KNOWN_PATHS 注册管理，新增选项必须经注册而非直接读写状态 | ADR-132 |
| 帧率 / 像素比 / 视锥剔除 / 3D 偏好 | [预览面板设置与显示控制](./preview-settings.md) | - | ADR-132 |
| 追加模型、同台加载、多模型同框 | [统一 3D 预览核心 preview-core](./preview_core.md) | 跨类型必须走 switchExternal，禁止直接调 adapter.build | ADR-125 |
| AnimationController、状态机 | [动画系统 animation](./animation-system.md) | - | - |
| Molang 表达式求值 | [动画系统 animation](./animation-system.md) | - | - |
| VRM 动画播放、VRMA | [统一 3D 预览核心 preview-core](./preview_core.md) | 必须 mixer.update(dt) → vrm.update(dt)，禁止手动 vrm.humanoid.update() | ADR-125 |

## 🎯 跨组件通信与页面

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 侧边栏、整合包列表、版本卡片 | [侧边栏 app-sidebar](./app-sidebar.md) | 侧边栏的 push/pull 必须经 events.ts 的 asbRunPush/asbRunPull 转发到 sync-manager，禁止直接调 API | - |
| 订阅 / 退订事件 / once | [事件总线 bus.ts](./event-bus.md) | once 只能用它返回的退订函数取消（off 原 fn 匹配不到 wrapper） | - |
| 加翻译 / 多语言 / i18n | [国际化 i18n 模块](./i18n.md) | t() 纯函数查表；语言切换广播 lang:changed 驱动全库重渲染 | - |
| 启动器检测 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 推送 / 拉取、同步状态、勾选 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 页面初始化流程、订阅桶 / 会话状态 | [主内容页 app-content](./app-content.md) | - | - |
| 一键安装、整合包拖拽导入 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 整合包列表、同步状态、勾选 | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |
| 整合包同步、推送 / 拉取 | [整合包同步管理器 sync-manager](./sync-manager.md) | 同步操作必须经 sync-manager 的 queue 排队，禁止 app-sidebar 直接调 PushSingleResource | - |
| 主内容区、页面切换、仓库页 / 创作者页 / 社区页 | [主内容页 app-content](./app-content.md) | 主内容区页面切换必须经 nav:change / app-nav 路由分发，禁止页面之间直接 init 对方 | - |
| emit 事件 / 跨组件通信 | [事件总线 bus.ts](./event-bus.md) | 所有跨组件异步通信必经 bus.ts，禁止组件间直耦 | - |
| nav:change 事件分发、全局 handler 注册 | [主内容页 app-content](./app-content.md) | - | - |
| PushSingleResource / PullSingleResource | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |
| sync:download:missing 缺包回拉 | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |

## 🎯 后端桥接与数据存储

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| IndexedDB、网页版存储 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | 事务必须接线 complete/error/abort 三事件 | ADR-177 |
| Wails 绑定、Go 调用 | [Wails 桥接 app.ts](./wails-bridge.md) | 前端必须经 getApp() 访问，禁止直调 window.go | ADR-049 |

## 🎯 UI 交互与弹窗

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 菜单行为执行、ctx:show | [右键菜单系统](./context-menu.md) | 禁止 view 层手写菜单项 | - |
| 弹确认框 / 输入框 / 下拉选择 / modal | [弹窗基座 modal](./dialog-modal.md) | 业务弹窗必须复用 modal.ts 的 Promise API（prompt/select/confirm/picker），禁止手写弹窗 | - |
| 右键菜单、添加菜单项 | [右键菜单系统](./context-menu.md) | 菜单结构声明在 menu-defs.ts（唯一事实来源），行为在 core/context-menus.ts | - |

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
| 回收站 / 软删除 / 恢复 / 清空回收站 | [回收站 go/recycle](./go-recycle.md) | 删除必须走 .recycle 软删除（硬链接判定），禁止直接 os.Remove | - |
| 移动 / 复制 / 删除 / 重命名文件 / 文件夹导入 | [文件操作 go/fileops](./go-fileops.md) | 文件 CRUD 必须走 go/fileops，internal/app 薄壳仅转发 | - |

## 🎯 模型扫描与仓库管理

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 仓库审计、健康分 | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 去重检测、dedup | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 扫描模型、ScanModelEntries | [扫描核心 go/scanner](./go-scanner.md) | 容器指纹缓存失效需调 ClearScanCache | - |
| 整合包同步、sync | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 资源类型识别、rtype 判定 | [扫描核心 go/scanner](./go-scanner.md) | resource_types.json 是唯一事实来源 | - |

## 🎯 配置与注册表

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 新增资源类型 / 修改 resource_types.json / 文件类型 | [资源注册表 registry](./resource-registry.md) | resource_types.json 是唯一事实来源；前端只读不判、禁本地重算 | - |

## 🎯 模型格式与解析

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| YSM 烘焙 / 几何反推 / pivot 错位 / BlockBench 导出 | [YSM 烘焙与几何反推](./ysm-baked.md) | cube 语义已烘焙为纯顶点面，禁止前端反推 origin/size/uv | - |

## 🚨 高频陷阱速查

| 陷阱 | 位置 | 正确做法 |
|------|------|----------|
| 手写关键帧插值 | - | 与基岩官方行为不一致、T-pose 漂移；必须经 evaluateClip |
| Molang 表达式缓存键不完整 | - | 相同逻辑不同骨骼重复求值；缓存 key 必须含 clip/bone 标识 |
| 动画 | - | - |
| 骨骼动画 | - | - |
| 关键帧 | - | - |
| 动画播放 | - | - |
| Molang | - | - |
| 数字滚动 | - | - |
| stagger 入场 | - | - |
| 关闭动画 | - | - |
| 状态机 | - | - |
| 动画控制器 | - | - |
| AnimationController | - | - |
| 页面 A 直接调用页面 B 的 init | - | 重复初始化 / 订阅泄漏；必须经 nav:change 单点分发 |
| subscription-bucket 未退订 | - | 跨页残留监听、状态串扰；每次切换必须 clear 旧桶 |
| 主内容区 | - | - |
| 页面切换 | - | - |
| nav:change | - | - |
| 仓库页 | - | - |
| 全局 handler | - | - |
| events.ts 里直接调 PushSingleResource | - | 绕过排队，并发冲突；必须经 asbRunPush/asbRunPull |
| _lastEmittedPkg 未更新 | - | 拖拽导入重复触发；每次导入必须刷新该锚点 |
| 侧边栏 | - | - |
| 整合包列表 | - | - |
| 版本卡片 | - | - |
| 推送 | - | - |
| 拉取 | - | - |
| 一键安装 | - | - |
| 同步状态 | - | - |
| 勾选 | - | - |
| 整合包拖拽导入 | - | - |
| 启动器检测 | - | - |
| 内联菜单结构 | `view 层` | 必须声明进 menu-defs.ts |
| once off 错对象 | `bus.off(event, 原fn)` | 用 once 返回的 unsub 函数取消 |
| 离屏 Canvas 不释放 | - | 内存泄漏、连续截图卡死；必须在完成回调里 release |
| blob URL 不 revokeObjectURL | - | 浏览器内存累积；导出 / 失败分支都必须 revoke |
| 截图 | - | - |
| 导出 PNG | - | - |
| 多角度截图 | - | - |
| 透明背景 | - | - |
| 预览缓存 | - | - |
| blob URL | - | - |
| saveScreenshot | - | - |
| renderMultiAngle | - | - |
| 跨类型追加走错适配器 | `frontend/src/preview-3d/menu/core.ts` | 必须经 switchExternal → openModel3DFullscreen(cooperate) |
| 异步回调写入已卸载 DOM | `skeleton.ts` | 每个 await 后检查 container.isConnected |
| 手动调用导致 T-pose 回归 | `vrm.humanoid.update()` | 只用 vrm.update(dt) |
| 直接改 preview-state 未注册字段 | - | 切页/换模后状态回滚、选项失效；应走 KNOWN_PATHS |
| 截图灯光与预览灯光混用 | - | 导出 PNG 与实时预览不一致；截图灯光必须走 shot-panel 独立通道 |
| 预览设置 | - | - |
| 显示控制 | - | - |
| 骨骼名称 | - | - |
| 帧率 | - | - |
| 像素比 | - | - |
| 视锥剔除 | - | - |
| 状态层 | - | - |
| 3D 偏好 | - | - |
| 组件选择 | - | - |
| 截图灯光 | - | - |
| activeComponent | - | - |
| app-sidebar 直接发 push/pull 请求 | - | 并发冲突 / 状态错乱；必须经 sync-manager 排队 |
| PullSingleResource 未完成前刷新侧边栏 | - | 半同步状态显示；必须等 store 状态收敛 |
| 整合包同步 | - | - |
| 推送 | - | - |
| 拉取 | - | - |
| 整合包列表 | - | - |
| 同步状态 | - | - |
| instance | - | - |
| PushSingleResource | - | - |
| PullSingleResource | - | - |
| sync:download:missing | - | - |
| app-sidebar | - | - |

---
<!--  END_GENERATED_SECTION -->
