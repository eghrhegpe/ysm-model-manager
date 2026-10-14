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
  - frontend/src/views/app-sidebar/sync-flow.ts
  - frontend/src/views/app-sidebar/sidebar-css.ts
  - frontend/src/views/app-sidebar/launcher-detect.ts
auto_fields:
  symbols_with_lines:
    - appSidebarStyle
    - bindCardEvents
    - bindFooter
    - bindMcPathLabel
    - bindSelectAll
    - bindSyncSelected
    - BusyGuard
    - EmitDedupe
    - emptyInstanceStateHTML
    - footerHTML
    - headerHTML
    - InstanceCardHeaderData
    - instanceCardHeaderHTML
    - listContainerHTML
    - loadErrorStateHTML
    - loadInstances
    - pruneCheckedSets
    - renderLoadError
    - renderVersionCards
    - restoreCheckboxes
    - runLauncherDetect
    - runMcSearch
    - sidebarCSS
    - SidebarHost
    - SidebarInstance
    - SYNC_TYPE_ALL
    - VIEW_TESTIDS
  tests:
    - frontend/src/features/community/data.test.ts
    - frontend/src/views/app-nav/index.test.ts
    - frontend/src/views/app-sidebar/loader.test.ts
    - frontend/src/views/app-sidebar/app-sidebar.keyboard.test.ts
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
  - 去重状态机未复位 → 拖拽导入重复触发；宿主必须实现 SidebarHost 并复位 lastEmittedPkg
use_when:
  - 侧边栏
  - 整合包列表
  - 版本卡片
  - 推送
  - 拉取
  - 同步状态卡片
invariant_anchors:
  - frontend/src/views/app-sidebar/events.ts|SidebarHost
status: active
---

# 侧边栏 app-sidebar

## 概览

`app-sidebar` 是仓库页左栏的整合包列表组件（Shadow DOM），展示当前资源类型下各整合包（Minecraft 版本实例）的同步状态卡片，支持选中联动、勾选批量推送/拉取、一键安装缺失资源。它遵循标准组件拆分规范（index/tpl/data/loader/render/events）。

**i18n 收敛（2026-08-31）**：推送/拉取全流程 toast 与按钮文案已全量迁移到 `sidebar.*` key（`selectPackFirst`/`verbPush`/`verbPull`/`pushDone*`/`pullDone*`/`packSkipped`/`packTimedOut`），复用既有 `sidebar.notSet`/`pushSelected`/`pullSelected`/`loadFailed`/`loadFailedDetail`；残留仅 `dbg()` 调试日志参数（非 UI 文案）。新增 key 集中在 zh-CN.ts sidebar 段，改文案只改语言包。

## 核心职责

- `index.ts` — `<app-sidebar>` 生命周期编排：`observedAttributes: ["rtype"]`、订阅刷新事件、全选/同步所选（推送直调 `features/sync|downloadMissing`（ADR-340 去总线化 2026-10-14），拉取直调 `PullResourceFromInstance`）、`_reload` 带 `_reloadInFlight` 单飞锁 + `_guard` 代际守卫（双锁正交，见下方不变量）。**构造函数 rtype 缺省读 `currentRepoType()`**（P1 修复：tpl.ts 挂载 `<app-sidebar>` 不传 rtype 属性，此前恒回落 YSM，整合包标题首屏显示 `(ysm)` 须手动切导航标签才被 `repo:rtype-changed` 纠正；现与仓库页 `initRepositoryPage` 的 `savedRtype` 恢复逻辑对齐，首屏即正确）。**同步所选由一组包级助手承载（2026-08-26 批4.0 扁平化，非 withEventTimeout；原名 `asb*` 前缀已删除）**：`handleSyncMenuClick` 只做入闸（`beginSync`）+ 取类型 + `void runPush`/`runPull` 收口（**2026-10 锐评收口**：原实现 `beginSync` 与 `handleSyncMenuClick` 各自 `closest(".dd-item")` 一次，同一 target 查两遍；现 `.dd-item` 定位与 `data-sync-type` 读取都归调用方一次完成。在途标志由 `{ get val()/set val() }` 可变盒子字面量改为 `SyncBusyFlag {get,set}` 访问器对——原 push/pull 两处同构重抄，现单例直通组件 `_syncInProgress` 访问器）；**原推送并发原语四件套（`waitBusQuiet` 静默宽限 / `kindError`·`pushErrorKind` 错误归类 / `nextPushToken` 回执序号 / token 订阅匹配）已随 ADR-340 去总线化整体删除**——Promise `await` 天然提供请求-响应匹配、错误传播与结果类型化，「等总线回执」的全部猜测不再必要
- `tpl.ts` — 布局模板：`headerHTML` / `footerHTML` / `listContainerHTML` / `emptyInstanceStateHTML` / `loadErrorStateHTML` / `instanceCardHeaderHTML`（版本卡片头；**2026-10 锐评收口**：原第 5 位 `_status` 陪跑参数已删——函数体零消费，徽章全由三计数 + hasMod 驱动；**2026-10-14 签名收编**：7 个位置参数 → `InstanceCardHeaderData` 对象入参（参数闸 7≥6 报警驱动），调用点与测试断言同步改对象形态，位置断言改按名断言更抗字段增删）。**HTML 模板单一出口**（ADR-190 D1a）：空态/失败态结构 2026-10 自 `render.ts` 内联块迁入本文件，render 侧只留「状态分流 + role 摘挂」；模板不绑事件（重试监听仍归调用方自挂自摘）
- `data.ts` — 数据层类型：`SidebarInstance` 接口
- `loader.ts` — `loadInstances(rtype)`：调 Go 拉取实例与同步状态并转换为渲染格式（`loading:start`/`loading:end` 配对已删——孤儿事件退役）；**失败 reject，只有真空列表才 resolve `[]`（2026-10 P0 修复）**——原 catch 吞错 `return []`，调用方无法区分「读取失败」与「真没装整合包」，把一次 IPC 失败渲染成空态 + 配目录按钮误导用户；现保留 toast（调用方缺席场景兜底）后 `throw`，由 `_reload` 渲染失败态（见 `render.ts|renderLoadError`）。**同 rtype 在途请求合并**（2026-08-21：`_inflight` 表按归一后 rtype 键去重并发调用，空 rtype 回退 ysm 同键——配合 go/scanner 在途合并，治点击整合包时多组件并发触发的重复扫描刷屏）。**登记项身份守卫（2026-10 锐评修复）**：收尾 finally 与 30s 淘汰定时器都必须 `_inflight.get(key) === 自己` 才摘除 `_inflight` 条目——原 finally 无条件 `delete`，force 刷新后先收尾的旧请求会把新请求的登记项摘掉，紧随其后的普通读请求不再合并、重发第三次 IPC/扫描（在途去重形同虚设）；回归锁 `loader.test.ts|force 在途时旧请求先收尾` 精确构造「旧先收尾、新仍在途」时序。⚠️ 两处的守卫**范围不同**（2026-10 复查记录）：finally 分支连 `_inflightTimers` 句柄一起清（`=== p` 门内），定时器分支只守卫 `_inflight` 条目、`_inflightTimers.delete(key)` 是无条件的——旧定时器烧到时可能摘掉新请求的**句柄登记**。实测**无害**：条目的实际清除由「当前登记项自己的定时器」负责，旧定时器不带偏；被摘的句柄只是让后续 finally 少一次 `clearTimeout`（该定时器仍会按自身日程烧掉，且其 `=== p` 守卫会正确放行）。**不要再为这处不对称加复杂度**——除非能构造出真实受害时序（兜底淘汰锁 `loader.test.ts|卡死请求 → 30s 兜底淘汰生效`）。**计数口径 ADR-310（2026-09）**：徽章三数直接取 Go 的 `Synced` / `MissingCount`（含 diverged 折叠）/ `Extra.length`，`disabled` 取 `Disabled.length`（旧硬编码 `disabled: 0` 已废）；`Missing` 是仓库侧**文件级**路径清单（已排序去重、**恒不含目录**；长度与 `MissingCount` 无固定关系，勿当计数用，一键安装消费它），目录单元走 `MissingDirs`（一键安装经 `PushSingleResourceToInstance` 整夹推送）——**旧前端本地 MMD 变体聚合 `groupMmdVariants` 已删除**（聚合归 Go 面板链）
- `render.ts` — `renderVersionCards`：卡片逐个 `createElement` 入场（40ms 阶梯延迟），逐卡落 `data-idx` 与 **`data-name`（2026-10 P1 修复：跨渲染消费者如拖拽 drop 按名称解析目标，下标在重载后会指向别的包）**；**空态（`instances` 为空）调 `emptyInstanceStateHTML()`**——🔍 自动搜索 + 🎮 HMCL / PCL 两按钮（`data-sidebar-mc-search` / `data-sidebar-launcher-detect`），走列表事件委托在 `events.ts` 拦截；**`renderLoadError(container, onRetry)`（2026-10 P0 修复）**：加载失败**专用**态（`loadErrorStateHTML()` 结构 + 自挂自摘重试监听并返回 cleanup），与空态分流——失败不得复用 `renderVersionCards([])`，否则一次读取失败被讲成「没装整合包」。本文件只做 DOM 组装与状态分流，HTML 字面量一律出自 `tpl.ts`
- `events.ts` — `bindCardEvents`（事件委托在 `#sidebar-instance-list`，点击派发 `package:selected`、右键派发 `ctx:show` type=instance；**`instanceName` 直取数据源 `pkg.name`**（2026-10 锐评收口：原从 `.name` 节点 textContent 正则剥 📦 逆向解析——tpl 早把 📦 移入隔壁 `.pkg-icon` span，正则已成无靶化石；数据在手不再绕道 DOM，`events.test.ts` 以污染 DOM 文本仍须出正确 payload 的回归锁钉死）；localStorage `sb_selectedName_<rtype>` 恢复选中；点击 handler 顶部先拦截空态两按钮再进卡片逻辑）+ `bindFooter`（**仅完全同步计数动画**，纯实例数据、零 IPC）+ `bindMcPathLabel`（**MC 路径按钮**：首帧拉一次配置 + 订阅 `config:changed`，返回 unsub 归 `_unsubs` 桶。2026-10 架构补件，见下方「配置读取事件驱动」不变量）
- `launcher-detect.ts` — 空态就地配 mcRoot 两入口（**自 settings/launcher-detection.ts 搬家，2026-08-29**；settings 版按钮 + MutationObserver 注入已删，`app-modules.ts` 不再注册）：`runMcSearch`（`GetMinecraftPaths` 扫常见安装位，多结果 `modalSelect` 选择）与 `runLauncherDetect`（`pickDirectory` 选启动器目录 → `DetectLauncherInstances` 解析 HMCL/PCL/Minecraft 多实例 → 弹层选实例 → 经 `views/config-write.ts|writeAppConfig({ mcRoot })` 写 mcRoot，勾选「用作 YSM 根目录」时 `SetResourceRoot("ysm", customDir)`，失败回滚 mcRoot）；成功后派发 `stats:refresh`（sidebar 防抖重载实例列表）。模块级 `_busy` 守卫两类入口并发（都在改 mcRoot）。实例选择弹层原为自建 overlay 骨架，已在 2026-08-29 审核修复中收敛为 `modalPicker`（复用统一弹窗脚手架：单例/焦点陷阱/Esc/退场动画），流程文案走 `launcher.*` i18n keys（见知识卡 `dialog_modal`）。⚠️ **配置落盘禁止手抄 `SaveAppConfig` 六位置实参**（ADR-313）：本文件曾自抄一份并硬编码主题字面量 `"dark"`，而 `THEME_VALID` 无此值 → 落盘后被 `normalizeTheme` 静默归一成 `system`（用户只改目录、主题却变「跟随系统」）。`saveMcRoot` 的第二参 `app?`（原为省一次动态 import）已随出口上移删除
- **整合包卡片拖拽导入**（2026-08-29，见知识卡 `import_queue` 的 `pack-dnd.ts` 节）：`index.ts` `connectedCallback` 调 `features/dnd/pack-dnd.ts` 的 `bindPackCardDnD(root, () => this._instances)`（document 层监听 + cleanup 存 `_packDndCleanup`），拖文件到实例卡片 = 先入仓库再推送进该实例；`.dnd-over` 高亮样式在 `sidebar-css.ts`
- **键盘导航（ADR-308 D2，2026-09）**：`index.ts` `connectedCallback` 绑定 `utils/dom/bind-roving.ts` 的 `bindRoving`（preset `list`、orientation vertical、容器 `#sidebar-instance-list`、项 `.instance-card`）——ArrowUp/Down 移动即激活、Home/End 跳端、Enter/Space 再激活；激活 = 在卡片头几何中心派发合成 click（`clientX/clientY` 供 `--ripple-x/--ripple-y` 涟漪计算）→ 完整复用 events.ts 委托 click 链（高亮/`package:selected`/去重/localStorage），键盘路径零重复逻辑。结构角色由模板承担：容器 `role=listbox` + `aria-label t("sidebar.instanceList")`（tpl.ts `listContainerHTML`，渲染后 render.ts 挂空态时移除 role），卡片 `role=option` + `tabindex=-1` + `aria-selected`（render.ts 逐卡设置）；原语只管交互态（roving tabindex / aria-selected 迁移 / 焦点）。`restoreSelectedCard` 的 rAF 与**卡片点击路径**都经 `SidebarHost.syncRovingIndex?(idx)`（events.ts 可选成员，2026-10 由 `syncRestoredIndex` 正名——两条路径共用，语义不再只属「恢复」）把选中同步到 roving 锚点（不抢焦点）；`disconnectedCallback` 调 `_roving.dispose()`，卸载后键位全寂
- `sync-flow.ts` — 同步流程层（2026-09-08 从 `index.ts` 拆出，P1-3）：`runPush`/`runPull`（整包级 push/pull 执行链，推送按类型循环 `await downloadMissing({instanceNames})` 直调、拉取 `Promise.allSettled` 并拉——两链同构（ADR-340）；循环中把按钮 label 更新为 `i/n` 进度——推送按类型、拉取按包，消除大批量只干等 spinner；`finally` 的 `resetButton` 复原为「推送所选/拉取所选」，2026-10-14）、`bindSelectAll`/`bindSyncSelected`/`restoreCheckboxes`（勾选状态管理 + 全选/同步所选）、`pruneCheckedSets`（2026-10 P1：成功 reload 后按最新实例列表修剪勾选集合里的幽灵名，空列表保守不剪）；经 `getCheckedSets()` 回调读 `AppSidebar` 实例属性 `_checkedSets`（按 rtype 隔离的 Map，定义在 `index.ts`），实例级生命周期随组件 GC 回收，跨重渲染持久化勾选状态；`SYNC_TIMEOUT_MS`（单批 `withTimeout` 兜底 120s——binding 永久挂起是唯一超时成因，超时**即 break 早停**并如实计入（ADR-340 语义重定义，治锐评 P1-2 级联：原总线实现超时后续发只会撞 handler 持锁 busy 假跳过））；`index.ts` 仅保留 Web Component 生命周期与渲染编排（**2026-10 锐评收口**：原模块级 `renderCards` 六参全为 `this` 字段/闭包、还以「入参 cardCleanup + 返回 `{cardCleanup}`」模拟出参，已内联为 `AppSidebar._renderCards()` 私有方法——容器缺失早退时**旧 `_cardCleanup` 原样保留**的语义不可改；同轮补：失败态渲染走 `AppSidebar._renderLoadError()`，`_errorCleanup` 随 `_renderCards`/`disconnectedCallback` 摘除）
- `sidebar-css.ts` — Shadow DOM 样式表（adoptedStyleSheets）。其中 `fadeSlideLeft` 本地化 keyframe 受「app-content 本地化 keyframe 契约」约束：须与 `content-layout.ts` / `components.css` 副本**参数值一致**（`translateX(-8px)` 的 translate 数值，不要求字节级格式一致），由机检 1c 硬校验，改任一处须同步（2026-08-24 复盘第 1/2 条）

## 对外 API / 入口

- 自定义元素：`<app-sidebar rtype="ysm">`（属性变更触发 `_reload` 与按钮文案更新；**属性缺省时构造函数读 `currentRepoType()`**——localStorage `repo_rtype` 权威源，app-nav 切换器落盘，首屏整合包标题即显示当前全局类型而非默认 YSM）
- 监听 bus：`stats:refresh`（300ms 防抖重载）、`repo:rtype-changed`（随仓库页类型切换重载）——原 `sync:download:done` 订阅已随 ADR-340 退役（推送改 `downloadMissing` 直调 await）
- 派发 bus：`package:selected`、`ctx:show`、`toast:show`、`stats:refresh`、`tree:reload`、`nav:changed`（底部路径按钮跳设置页）——原 `sync:download:missing` 发射已随 ADR-340 退役
- Go 调用：统一经 `getApp()` 取绑定（ADR-012 红线，禁 `window.go.main.App.*`）——`LoadAppConfig` / `ListVersionInstances` / `GetResourceInstanceStatus` / `GetRepoRoot`（loader.ts）、`PullResourceFromInstance`（index.ts 拉取）、`LoadAppConfig` / `GetMinecraftPaths`（**`bindMcPathLabel` 首帧**自动检测 MC 路径——不再每轮 reload 重拉；**落盘不在此处直调 `SaveAppConfig`**，走 `views/config-write.ts|writeAppConfig`，ADR-313）；「推送到整合包」由 `features/context-menu/context-menu-file-handlers.ts` 的 `file.push-to-pack` 走 `InstallModelTo`（见知识卡 `context_menu`）
- 导出符号：`loadInstances`（loader.ts，`index.ts` 直接 import，无注册表）；`renderVersionCards` / `renderLoadError`（render.ts）、`pruneCheckedSets`（sync-flow.ts，叶函数导出供直测）——原 `nextPushToken`/`waitBusQuiet` 直测导出随 ADR-340 删除

## 与其他子系统关系

- 卡片点击派发 `package:selected` → `app-content` instances 页据此挂载 `<app-sync-manager>`（见知识卡 `app_content`、`app_sync_manager`）
- 右键派发 `ctx:show`（type=instance）→ `features/context-menu/context-menus.ts` 转 `menu:show`（见知识卡 `context_menu`）
- 推送经 `features/sync.ts|downloadMissing` **直调**（ADR-340 去总线化 2026-10-14，原 bus `sync:download:missing` → `registerSync` handler 链路退役；`registerSync` 现仅注册 `sync:toggle:status`）；数据源对应 Go 端 `go/sync` 包与 `internal/app/app_install.go`
- `loadInstances` 由 `views/app-sidebar/loader.ts` 直接导出，`index.ts` 直接 import（原 `services/registry.ts` 注册表已删），测试经 `vi.mock("./loader.ts")` 替换
- 刷新由 `stats:refresh` 驱动，派发方包括设置页、右键菜单操作、去重流程等

## 不变量

- 三徽章计数与面板链**同源**（ADR-310）：`synced`/`missing`/`extra`/`disabled` 均为 Go 单元级计数（dirLevel=模型夹、fileLevel=文件），红徽章已含 diverged 折叠（内容分叉学面板 `tabStatus` 归红，不补第四色）；列表内容 `array.length` **不再是**徽章数（`Missing` 为文件级一键安装清单）
- 禁用项（`.ban`）只进 `disabled` 计数，不驱动红/橙徽章——与面板 `aggregateStatus`「disabled 中立」一致，避免「禁用=有差异」误导
- **`SidebarInstance` 不再携带路径清单/`items` 死 payload（2026-10 锐评摘除）**：`_missingPaths`/`_extraPaths`/`items` 三字段曾由 loader 逐实例构建，但全仓**零生产读者**（老 JS 时代的消费方 `actions.js` 已随 TS 重写消失，注释却仍宣称「一键安装/展开卡片用」= 第二事实源说谎）。需要文件级清单请直接消费 `GetResourceInstanceStatus` 响应（`features/sync/sync.ts|runDownloadMissing` 即此路径：`Missing` + `MissingDirs` 当次调用内取用，不过 sidebar 中转）。**新增 payload 字段前先 grep 消费者**，勿再让「注释承诺的未来消费方」长期占位
- `bus.on` 订阅全部收进 `_unsubs` 并在 `disconnectedCallback` 清理；`_cardCleanup` / `_packDndCleanup`（document 级 DnD）/ `_docClickHandler`（document 级）同步清理
- 双锁分工（2026-10 命名纠偏）：`_reloadInFlight`（原 `_loading`）单飞锁管「同一时刻只跑一次」，`_guard`（`createLoadGuard`，原手搓 `_reloadGen` 计数）管「丢弃过期结果」，二者**正交不可互相替代**；在途时新请求记 `_reloadPending`（原 `_pendingReload`）补跑最新 rtype。`_syncInProgress` 守卫防止推送/拉取并发触发；`stats:refresh` 走 300ms 防抖
- **代际守卫必须在 `disconnectedCallback` 接上 `invalidate()`（2026-10 锐评修复幽灵写入）**：单飞锁复位只解「同刻只跑一次」，**不作废在途代数**——`_reload` 若正挂在 `await loadInstances(...)` 上，卸载后那块续体仍会走 `_renderCards()` + `bindFooter()`，给**已卸载**的 shadow root 重渲染卡片、重绑 click/contextmenu 委托。本组件曾漏接该调用（同仓 `app-tree`/`app-sync-manager` 的 cleanup 均已成对接上），导致 `stale(gen)` 恒 false、代际守卫形同虚设。回归锁 `app-sidebar.unmount.test.ts`（组件卸载期在途结果必须被丢弃）
- **实例级** `_checkedSets`（`AppSidebar` 实例字段 `private _checkedSets = new Map<string, Set<string>>()`，定义在 `index.ts`，非模块级——模块级会跨组件实例共享、成泄漏源；sync-flow.ts 仅经 `getCheckedSets()` 回调读）按 rtype 隔离跨重渲染持久化勾选状态（实例级 = 组件 GC 自动回收）；事件绑定用事件委托 + 「list 未变则复用 handler」——**该复用分支生产不可达**（`_cardCleanup` 先置空 `_lastList`），实际每次 reload 都是「全量摘监听→重绑」，监听不累积（防泄漏语义成立，与「复用」描述有出入）
- 渲染后经 `_restoreCheckboxes` 恢复勾选，选中卡片经 localStorage 恢复；**`restoreSelectedCard` 去重由宿主注入的去重状态机（`SidebarHost`/`EmitDedupe`）跨 reload 生效**（P2 复核修复：原「list 替换时复位」因复用分支不可达而每次复位、去重恒真失效、每次重发 `package:selected` 反复重建 `<app-sync-manager>`；现状态由宿主实例持有，同组件 reload 不复位，仅新挂载会话经宿主的 `resetSelectedEmit()` 重置，由 `disconnectedCallback` 调用）。2026-09 定位降级：app-content 已改为**复用**同一面板实例（只改属性），重复 emit 不再导致丢状态，本状态机退化为省事件扩散的优化
- ~~推送 done 按 token 精确匹配 + 识别 `skipped`~~ **已由 ADR-340 结构性消解（2026-10-14）**：回执匹配问题不复存在——`await downloadMissing` 的返回值即本次结果（`{skipped, skipReason}`），busy 命中在返回值里如实可见，不存在「匹配错位误判成功」的可能
- **roving handle 实例级**（`_roving`，ADR-308 D2）：`disconnectedCallback` 必 `dispose()`，卸载后键位全寂（契约测试 `app-sidebar.keyboard.test.ts`「卸载后 keydown 死寂」锁定）；键盘激活走合成 click 复用委托链，**禁止**在键盘路径另写高亮/emit/去重逻辑
- **只在 connectedCallback 绑一次的绑定必须收 getter，禁按值捕获（2026-10 修复「全选跨 reload 蒸发」）**：`bindSelectAll` 曾在 connectedCallback 按值收 `rtype`/`instances`，而彼时 `_instances` 还是初始 `[]`、`_reload` 又换的是**新数组引用**——捕获的旧引用永远为空 → 全选只改 DOM、从未写入 `_checkedSets`，任何一次 reload 后选择即丢（`rtype` 同理：按值捕获会把勾选写进切类型前的旧桶）。同型先例：`bindSyncSelected`/`restoreCheckboxes` 早已走 `() => this._instances` 形态。回归锁 `app-sidebar.sync.test.ts`「全选 → 跨 reload 存活」
- **加载失败必须渲染失败态，禁复用空态（P0，2026-10）**：`loadInstances` 失败 `reject`（不再 `return []`），`_reload` 以 `failed` 标记在 finally 之后二选一——失败走 `_renderLoadError()`（`renderLoadError`：错误文案 + `role=alert` + `data-sidebar-retry` 重试按钮，`_errorCleanup` 归组件清理），成功才 `_renderCards()` + `bindFooter()`。「读取失败」与「真没装整合包」是**两种用户处境**：前者该重试，后者该去配 mcRoot；混为一态会把一次 IPC 失败讲成「你没装包」。重试按钮监听**不经**卡片事件委托（首帧即失败时 `bindCardEvents` 尚未绑定），由 `renderLoadError` 自挂自摘。回归锁：`render.test.ts|renderLoadError`、`app-sidebar.sync.test.ts|loadInstances 抛错 → 渲染失败态`、`loader.test.ts|加载失败 → reject`
- **拖拽落点按名称解析，禁按下标（P1，2026-10）**：`render.ts` 卡片同时落 `data-idx` 与 `data-name`；`features/dnd/pack-dnd.ts|onDrop` 用 `data-name` 在最新实例列表里 `find`——原 `getInstances()[idx]` 的下标是渲染时快照，sidebar 重载/实例增删后静默指向别的整合包（把模型推进错包还报成功）。名称缺失或对不上（卡片已删/陈旧渲染）一律 toast 报错，不猜、不静默丢。回归锁 `pack-dnd.test.ts`「列表顺序与下标错位仍推给名字对应实例」+ 两条 stale/缺属性负例
- **批量推送收敛为 O(类型) 次调用，禁逐包×逐类型 N×T（ADR-310 性能修复，2026-10；ADR-340 后落点为直调）**：`sync-flow.ts|runPush` 按类型循环，每类型一次 `downloadMissing` 带 `instanceNames` 多包名单（一次 `GetResourceInstanceStatus` 全量扫描后按名单装全部选中包），RPC 降至 O(T)。回归锁 `app-sidebar.sync.test.ts`「批量推送 → 每类型一次直调、带 instanceNames 全包名单」
- ~~推送回执 token 用单调序号~~ **随 ADR-340 整体退役（2026-10-14）**：`nextPushToken`/`waitBusQuiet` 已删——同毫秒回执错配是总线匹配协议自造的问题，Promise 直调不存在
- **勾选集合必须随 reload 修剪幽灵名，但空列表不修剪（P1，2026-10）**：`sync-flow.ts|pruneCheckedSets` 在 `_renderCards` 内**先于** `restoreCheckboxes` 调用（顺序不可倒置）——实例删除后名字原会永远留在 `_checkedSets`（同名实例再现时被静默勾选）。**空列表保守不剪**：`loadInstances` 在 mcRoot 未配置时也返回 `[]`，那不是「实例全被删了」，剪掉会丢用户选择（真失败走失败态，根本不进 `_renderCards`）
- **选中名键与去重键同源派生（`events.ts|rtypeKeyOf`，2026-10 收口）**：`sb_selectedName_<rtype>` 的读写两侧与 `makeEmitKey` 前缀都取 `instances[0]?.rtype || currentRepoType()`（列表级 rtype）——原先点击路径用 `pkg.rtype` 落盘、restore 用 `instances[0].rtype` 读取，混合 rtype 列表下写读落进不同桶、选中名静默恢复不了。**新增任何选中态持久化键前，先确认读写同源**
- **禁伪 async（2026-10 锐评全页收口）**：生命周期回调（`connectedCallback`）与 bus handler（`repo:rtype-changed`）、渲染段（`bindFooter` 的 stat-sync）一律不得标 `async` 而函数体零 `await`——返回值无人接管时，同步抛错会被转成 unhandled rejection（仓内 `render` 曾同病：错误提示整段变死码）。真实异步入口显式 `void this._reload()` 发起；本次三处已归正
- **卡片入场阶梯必须封顶，禁用裸 `idx * step`（2026-10 修复「卡卡」直因）**：`render.ts|renderVersionCards` 的 `animation-delay` 走共享原语 `utils/animation/stagger.ts|stagger(idx, 40)`（300ms 封顶）。原实现 `idx * 40` 无封顶，而 `.instance-card` 的 animation 带 **`both` 填充**——延迟期间卡片停在 from 态（透明/位移），包多时（MMD 用户常几十个）第 30 张要等 **1160ms** 才出现、下半屏长时间空白；且每次 `stats:refresh`（任何导入/同步/删除）整列表重建都会**重演**一遍。站点卡片（`app-content/site/render.ts`）早已同口径封顶，本例是漏网。回归锁 `render.test.ts`「入场延迟带封顶（stagger）」
- **配置读取事件驱动，禁「每次 reload 重拉配置」（2026-10 架构补件）**：`views/config-write.ts|writeAppConfig` 落盘成功后广播 `bus.emit("config:changed", 六元组)`，`events.ts|bindMcPathLabel` **首帧主动拉一次 + 订阅该事件**（载荷自带六元组 → 订阅分支**零 IPC** 直接渲染）。原实现把 MC 路径检测挂在 `bindFooter` 里、随每轮 `_reload` 重跑：① 每轮操作（导入/同步/删除，均触发 `stats:refresh` → 300ms 防抖 → `_reload`）白付一次 `LoadAppConfig`，未配置时还会连带 `GetMinecraftPaths` **扫盘**；② 设置页改完游戏目录后侧栏要等下一次 reload 才更新显示。回归锁：`config-write.test.ts`「落盘成功 → 广播 config:changed / 失败不广播」+ `events.test.ts`「bindFooter 不再拉配置（零 IPC）」「config:changed → 立即按载荷刷新（零 IPC，不等 reload）」。**新增配置读取方一律订阅该事件，不要回落到「每次 reload 重读」**；`config:changed` 是 bus 上第一个「配置类」事件（形状就地声明于 `bus.ts`，避免 bus 反向依赖 views）
- **异步段落地前必须验存活（`isConnected`），禁对游离 DOM 动手（2026-10 收口）**：两处已归正——① `events.ts|restoreSelectedCard` 的 `requestAnimationFrame` 回调：列表被后续 `_reload` 重渲染替换（卡片被丢弃）或组件已卸载时，原实现照样给游离节点打 `.active`、照样 `bus.emit("package:selected")`（**组件卸载后仍能在全局「复活」一个选中态**）；② `events.ts|loadAndRenderMcPath`（原 `bindFooter` 异步段）：`await LoadAppConfig` / `await GetMinecraftPaths` 之后原无检查，卸载后不仅写游离按钮，还会在「未配置 + 检测到路径」分支 **把 mcRoot 落盘**（已卸载的组件改用户配置 = 最该禁的侧效果）。判据统一用 `元素.isConnected`（唯一可信的「还在文档树上」信号，同时覆盖「被重渲染替换」与「组件卸载」两种游离态）；**测试夹具必须把宿主挂进 document**（`events.test.ts` 的 `mount`/`mountFooter` 已改），游离夹具等于在测生产不可能出现的状态，会把守卫测成「常态早退」。回归锁：`events.test.ts`「rAF 落地前卡片已脱离文档」「检测 await 期间卸载 → 不落盘 mcRoot」
- **存活守卫的适用边界（2026-10 对账结论，勿过度套用）**：判据是「await 落地后的动作**属于谁**」——① 写**本组件自有 DOM**（重渲染/改按钮/落盘用户配置）→ 必须验 `isConnected`，卸载后做这些就是幽灵写入；② 广播**数据已变更**类事件（`sync-flow.ts|runPull` 的 `stats:refresh`/`tree:reload`）→ **不需要**守卫：拉取真的发生了、树真的该重读，死组件发这声是语义正确的副作用（该事件全仓 10+ 处变异后广播，本就是幂等的「谁改了数据请重读」信号）；③ 只碰组件实例态（`busy.set(false)`/`resetButton` 写自有按钮）→ 随组件 GC，无守卫成本。**故 `runPull`/`runPush` 末尾无 `isConnected` 检查不是缺陷**，勿机械补上（补了反而会漏掉该发的刷新广播）。

## 相关

- `internal/app/app_install_instance.go` — `GetResourceInstanceStatus`（侧栏唯一计数入口，ADR-310 后内部走 `go/instance.BuildInstanceStatusCounts`）/ `GetInstanceStatus`（旧别名，同链）/ `PullResourceFromInstance` binding；`internal/app/app_install_import.go` — `InstallModelTo` binding
- `go/sync/` — 整合包同步核心逻辑
- 知识卡：`app_content`、`app_sync_manager`、`context_menu`、`go_sync`、`app_modules`

