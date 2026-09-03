---
kind: app-sidebar
name: 侧边栏 app-sidebar
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-sidebar/index.ts
  - frontend/src/views/app-sidebar/tpl.ts
  - frontend/src/views/app-sidebar/data.ts
  - frontend/src/views/app-sidebar/loader.ts
  - frontend/src/views/app-sidebar/render.ts
  - frontend/src/views/app-sidebar/events.ts
  - frontend/src/views/app-sidebar/sidebar-css.ts
  - frontend/src/views/app-sidebar/launcher-detect.ts
auto_fields:
  symbols_with_lines:
    - appSidebarStyle
    - bindCardEvents
    - bindFooter
    - footerHTML
    - groupMmdVariants
    - headerHTML
    - instanceCardHeaderHTML
    - listContainerHTML
    - loadInstances
    - MmdVariantGroups
    - renderVersionCards
    - resetSelectedEmit
    - runLauncherDetect
    - runMcSearch
    - sidebarCSS
    - SidebarInstance
    - VIEW_TESTIDS
  tests:
    - frontend/src/features/community/data.test.ts
    - frontend/src/views/app-nav/index.test.ts
    - frontend/src/views/app-sidebar/loader.test.ts
    - frontend/src/views/app-sidebar/launcher-detect.test.ts
    - frontend/src/views/app-sync-manager/index.test.ts
    - frontend/src/views/app-toast/index.test.ts
    - frontend/src/views/app-tree/data.test.ts
    - frontend/src/views/app-tree/render.test.ts
    - frontend/src/views/context-menu/index.test.ts
tests:
  - frontend/src/features/community/data.test.ts
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-sidebar/loader.test.ts
  - frontend/src/views/app-sidebar/launcher-detect.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/data.test.ts
  - frontend/src/views/app-tree/render.test.ts
  - frontend/src/views/context-menu/index.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 侧边栏、整合包列表、版本卡片
  - 推送 / 拉取、同步状态、勾选
  - 一键安装、整合包拖拽导入
  - 启动器检测
quick_risk_lines:
  - 侧边栏的 push/pull 必须经 events.ts 的 runPush/runPull 转发到 sync-manager，禁止直接调 API
pitfalls:
  - events.ts 里直接调 PushSingleResource → 绕过排队，并发冲突；必须经 runPush/runPull
  - _lastEmittedPkg 未更新 → 拖拽导入重复触发；每次导入必须刷新该锚点
use_when:
  - 侧边栏
  - 整合包列表
  - 版本卡片
  - 推送
  - 拉取
  - 同步状态卡片
invariant_anchors:
  - frontend/src/views/app-sidebar/events.ts|_lastEmittedPkg
status: active
---

# 侧边栏 app-sidebar

## 概览

`app-sidebar` 是仓库页左栏的整合包列表组件（Shadow DOM），展示当前资源类型下各整合包（Minecraft 版本实例）的同步状态卡片，支持选中联动、勾选批量推送/拉取、一键安装缺失资源。它遵循标准组件拆分规范（index/tpl/data/loader/render/events）。

**i18n 收敛（2026-08-31）**：推送/拉取全流程 toast 与按钮文案已全量迁移到 `sidebar.*` key（`selectPackFirst`/`verbPush`/`verbPull`/`pushDone*`/`pullDone*`/`packSkipped`/`packTimedOut`），复用既有 `sidebar.notSet`/`pushSelected`/`pullSelected`/`loadFailed`/`loadFailedDetail`；残留仅 `dbg()` 调试日志参数（非 UI 文案）。新增 key 集中在 zh-CN.ts sidebar 段，改文案只改语言包。

## 核心职责

- `index.ts` — `<app-sidebar>` 生命周期编排：`observedAttributes: ["rtype"]`、订阅刷新事件、全选/同步所选（推送走 `sync:download:missing` 事件 + correlation token，拉取直调 `PullResourceFromInstance`）、`_reload` 带 `_loading` 并发守卫。**构造函数 rtype 缺省读 `currentRepoType()`**（P1 修复：tpl.ts 挂载 `<app-sidebar>` 不传 rtype 属性，此前恒回落 YSM，整合包标题首屏显示 `(ysm)` 须手动切导航标签才被 `repo:rtype-changed` 纠正；现与仓库页 `initRepositoryPage` 的 `savedRtype` 恢复逻辑对齐，首屏即正确）。**同步所选由一组 `asb*` 包级助手承载（2026-08-26 批4.0 扁平化，非 withEventTimeout）**：`asbHandlePushMenuClick`/`asbHandlePullMenuClick` 只做入闸（`asbBeginSync`）+ 取类型 + `void runPush`/`runPull` 收口；推送并发原语拆为 `asbPushOne`（等单 token done、skipped/超时分别 reject 带 `kind`）、`asbWaitBusQuiet`（等同步归位防竞态），错误归类走 `asbKindError`/`asbPushErrorKind`
- `tpl.ts` — 布局模板：`headerHTML` / `footerHTML` / `listContainerHTML` / `instanceCardHeaderHTML`（版本卡片头）
- `data.ts` — 数据层类型：`SidebarInstance` 接口
- `loader.ts` — `loadInstances(rtype)`：调 Go 拉取实例与同步状态并转换为渲染格式（含 MMD `.pmx` 变体按父文件夹聚合 `groupMmdVariants`），前后派发 `loading:start` / `loading:end`；**同 rtype 在途请求合并**（2026-08-21：`_inflight` 表按归一后 rtype 键去重并发调用，空 rtype 回退 ysm 同键——配合 go/scanner 在途合并，治点击整合包时多组件并发触发的重复扫描刷屏）
- `render.ts` — `renderVersionCards`：卡片逐个 `createElement` 入场（40ms 阶梯延迟）；**空态（`instances` 为空）渲染就地配置入口**——🔍 自动搜索 + 🎮 HMCL / PCL 两按钮（`data-sidebar-mc-search` / `data-sidebar-launcher-detect`），走列表事件委托在 `events.ts` 拦截
- `events.ts` — `bindCardEvents`（事件委托在 `#sidebar-instance-list`，点击派发 `package:selected`、右键派发 `ctx:show` type=instance；localStorage `sb_selectedName_<rtype>` 恢复选中；点击 handler 顶部先拦截空态两按钮再进卡片逻辑）+ `bindFooter`（MC 路径按钮、完全同步计数动画）
- `launcher-detect.ts` — 空态就地配 mcRoot 两入口（**自 settings/launcher-detection.ts 搬家，2026-08-29**；settings 版按钮 + MutationObserver 注入已删，`app-modules.ts` 不再注册）：`runMcSearch`（`GetMinecraftPaths` 扫常见安装位，多结果 `modalSelect` 选择）与 `runLauncherDetect`（`pickDirectory` 选启动器目录 → `DetectLauncherInstances` 解析 HMCL/PCL/Minecraft 多实例 → 弹层选实例 → `SaveAppConfig` 写 mcRoot，勾选「用作 YSM 根目录」时 `SetResourceRoot("ysm", customDir)`，失败回滚 mcRoot）；成功后派发 `stats:refresh`（sidebar 防抖重载实例列表）。模块级 `_busy` 守卫两类入口并发（都在改 mcRoot）。实例选择弹层原为自建 overlay 骨架，已在 2026-08-29 审核修复中收敛为 `modalPicker`（复用统一弹窗脚手架：单例/焦点陷阱/Esc/退场动画），流程文案走 `launcher.*` i18n keys（见知识卡 `dialog_modal`）
- **整合包卡片拖拽导入**（2026-08-29，见知识卡 `import_queue` 的 `pack-dnd.ts` 节）：`index.ts` `connectedCallback` 调 `features/pack-dnd.ts` 的 `bindPackCardDnD(root, () => this._instances)`（document 层监听 + cleanup 存 `_packDndCleanup`），拖文件到实例卡片 = 先入仓库再推送进该实例；`.dnd-over` 高亮样式在 `sidebar-css.ts`
- `sidebar-css.ts` — Shadow DOM 样式表（adoptedStyleSheets）。其中 `fadeSlideLeft` 本地化 keyframe 受「app-content 本地化 keyframe 契约」约束：须与 `content-layout.ts` / `components.css` 副本**参数值一致**（`translateX(-8px)` 的 translate 数值，不要求字节级格式一致），由机检 1c 硬校验，改任一处须同步（2026-08-24 复盘第 1/2 条）

## 对外 API / 入口

- 自定义元素：`<app-sidebar rtype="ysm">`（属性变更触发 `_reload` 与按钮文案更新；**属性缺省时构造函数读 `currentRepoType()`**——localStorage `repo_rtype` 权威源，app-nav 切换器落盘，首屏整合包标题即显示当前全局类型而非默认 YSM）
- 监听 bus：`stats:refresh`（300ms 防抖重载）、`repo:rtype-changed`（随仓库页类型切换重载）、`sync:download:done`（按 token 匹配推送结果，30s 超时）
- 派发 bus：`package:selected`、`ctx:show`、`sync:download:missing`（含 token）、`toast:show`、`stats:refresh`、`tree:reload`、`nav:change`（底部路径按钮跳设置页）、`loading:start` / `loading:end`
- Go 调用：统一经 `getApp()` 取绑定（ADR-012 红线，禁 `window.go.main.App.*`）——`LoadAppConfig` / `ListVersionInstances` / `GetResourceInstanceStatus` / `GetRepoRoot`（loader.ts）、`PullResourceFromInstance`（index.ts 拉取）、`LoadAppConfig` / `SaveAppConfig` / `GetMinecraftPaths`（events.ts bindFooter 自动检测 MC 路径）；「推送到整合包」由 `core/context-menus.ts` 的 `file.push-to-pack` 走 `InstallModelTo`（见知识卡 `context_menu`）
- 导出符号：`loadInstances`（loader.ts，被 `app-modules.ts` 注册为全局服务）

## 与其他子系统关系

- 卡片点击派发 `package:selected` → `app-content` instances 页据此挂载 `<app-sync-manager>`（见知识卡 `app_content`、`app_sync_manager`）
- 右键派发 `ctx:show`（type=instance）→ `core/context-menus.ts` 转 `menu:show`（见知识卡 `context_menu`）
- 推送经 `sync:download:missing` 交给全局同步 handler（`core/handlers/sync.ts` 的 `registerSync`，由 `app-content` 经 `registerGlobalHandlers` 注册）；数据源对应 Go 端 `go/sync` 包与 `internal/app/app_install.go`
- `loadInstances` 经 `services/registry.ts` 注册，可被测试或其他模块替换（见知识卡 `resource_registry`）
- 刷新由 `stats:refresh` 驱动，派发方包括设置页、右键菜单操作、去重流程等

## 不变量

- `bus.on` 订阅全部收进 `_unsubs` 并在 `disconnectedCallback` 清理；`_cardCleanup` / `_packDndCleanup`（document 级 DnD）/ `_docClickHandler`（document 级）同步清理
- `_loading` 守卫防止并发 `_reload`（`_reloadGen` 代数校验丢弃过期结果 + `_pendingReload` 补跑最新 rtype）；`_syncInProgress` 守卫防止推送/拉取并发触发；`stats:refresh` 走 300ms 防抖
- 模块级 `_checkedSets`（按 rtype 隔离的 Map）跨重渲染持久化勾选状态；事件绑定用事件委托 + 「list 未变则复用 handler」——**该复用分支生产不可达**（`_cardCleanup` 先置空 `_lastList`），实际每次 reload 都是「全量摘监听→重绑」，监听不累积（防泄漏语义成立，与「复用」描述有出入）
- 渲染后经 `_restoreCheckboxes` 恢复勾选，选中卡片经 localStorage 恢复；**`restoreSelectedCard` 去重 `_lastEmittedPkg` 跨 reload 生效**（P2 复核修复：原「list 替换时复位」因复用分支不可达而每次复位、去重恒真失效、每次重发 `package:selected` 反复重建 `<app-sync-manager>`；现复位移到 `resetSelectedEmit()`，由 `disconnectedCallback` 调用，仅新挂载会话重置）
- **推送 done 按 token 精确匹配 + 识别 `skipped`**（P1 修复，与 sync.ts 联动）：原 `instanceName ===` fallback 会把「busy 被吞未处理」误判为成功（toast 报 ✅ 实际未推）；现 sync.ts busy 命中时回 done 带 `skipped: true`，sidebar 按拒绝处理

## 相关

- `internal/app/app_install.go` — `GetResourceInstanceStatus` / `PullResourceFromInstance` / `InstallModelTo` binding
- `go/sync/` — 整合包同步核心逻辑
- 知识卡：`app_content`、`app_sync_manager`、`context_menu`、`go_sync`、`app_modules`

