---
kind: context-menu
name: 右键菜单系统
tier: architecture
category: ui
source_files:
  - frontend/src/views/context-menu/index.ts
  - frontend/src/features/context-menu/context-menus.ts
  - frontend/src/features/context-menu/menu-defs.ts
  - frontend/src/features/context-menu/context-menu-dir-handlers.ts
  - frontend/src/features/context-menu/context-menu-file-handlers.ts
  - frontend/src/features/context-menu/context-menu-handlers.ts
  - frontend/src/features/context-menu/context-menu-shared.ts
  - frontend/src/features/pack-ops/instance-ops.ts
auto_fields:
  symbols_with_lines:
    - ContextMenuHandlers
    - createContextMenuHandlers
    - DIR_HANDLERS
    - DirCtx
    - FILE_HANDLERS
    - FileCtx
    - getMenuDef
    - HANDLERS
    - HandlerTable
    - isUnsafeFolderName
    - MENU_DEFS
    - MenuAction
    - MenuCtx
    - MenuDef
    - MenuItemDef
    - refreshUI
    - registerContextMenus
    - registerInstanceOps
    - resolveDstDir
    - runSingleOp
    - VIEW_TESTIDS
  tests:
    - frontend/src/features/context-menu/context-menus.test.ts
    - frontend/src/features/context-menu/context-menus-async.test.ts
    - frontend/src/features/context-menu/context-menus.setup.ts
    - frontend/src/features/pack-ops/instance-ops.test.ts
    - frontend/src/views/app-nav/index.test.ts
    - frontend/src/views/app-sync-manager/index.test.ts
    - frontend/src/views/app-toast/index.test.ts
    - frontend/src/views/context-menu/index.test.ts
use_when:
  - 右键菜单
  - 右键
  - 上下文菜单
  - ctx:show
  - menu:show
  - 批量操作
  - 移入回收站
invariant_anchors:
  - frontend/src/features/context-menu/context-menus.ts|registerContextMenus
  - frontend/src/features/context-menu/menu-defs.ts|MENU_DEFS
  - frontend/src/features/context-menu/menu-defs.ts|getMenuDef
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - 右键菜单、添加菜单项
  - 菜单行为执行、ctx:show
quick_risk_lines:
  - 菜单结构声明在 menu-defs.ts（唯一事实来源），行为在 features/context-menu/context-menu-handlers.ts（HANDLERS 表）
  - 禁止 view 层手写菜单项
pitfalls:
  - 「view 层」内联菜单结构 → 必须声明进 menu-defs.ts
  - file/dir handler 各用 FileCtx/DirCtx（Omit 掉对立字段）；dir handler 读 ctx.path→编译报错（P2-1 表级窄化）

status: active
---

# 右键菜单系统

## 概览

右键菜单系统采用「声明与行为分离」的三层结构：`menu-defs.ts` 声明菜单结构（唯一事实来源），`features/context-menu/context-menus.ts` 把 `ctx:show` 事件翻译成带行为的 `menu:show` 载荷，`views/context-menu/index.ts` 是纯渲染容器。五类菜单（整合包 instance / 多选 batch / 文件 file / 目录 dir / 工坊模型 workshop，ADR-208 D3 将 community 域右键幽灵菜单收编）覆盖重命名、移动、复制、推送到整合包、标签编辑、回收站、打开位置、复制路径、导出清单等全部右键操作；`MenuItemDef` 为 kind 判别联合（`divider | header | action`），workshop 是 4 条 `kind:"header"` 纯信息行（名称/路径/哈希/大小，label 由 ctx 动态生成、表意走 icon 字段、体积走 `utils/format formatBytes`——noop 假动作已退役，标题项不占 action 空间）。整合包两项（导出清单 / 清空）只派发事件，真正执行落在 `features/pack-ops/instance-ops.ts`；其菜单文案 `t("menu.copyModelList", {type})` / `t("menu.clearPack", {type})` 跟随当前 rtype 短标签（2026-09 锐评收口，见不变量）。

## 核心职责

- `views/context-menu/index.ts` — `<context-menu>` Shadow DOM 渲染容器：监听 `menu:show({ x, y, items })` 渲染菜单项（label/icon/danger/divider，逐项 `itemSlideIn` 入场动画）、绑定点击回调（`try/finally` 包裹 `onClick`，抛异常也必 `hide()` 防菜单残留）、视口边界检测（先移到 -9999px 离屏测量再经 `requestAnimationFrame` 定位，避免跳变）；**WCAG 2.1 合规**：容器 `role="menu"` + 菜单项 `role="menuitem"` + 键盘导航（ArrowUp/Down 循环移动焦点、Enter/Space 激活、Esc 关闭），show() 后焦点自动定位首个菜单项；菜单可访问名经 `show()` 时 `t("contextMenu.ariaLabel")` 按当前 i18n 语言覆写（模板层不写死语言——原英文字面量 `"context menu"` 在 zh/ja 下与界面脱节，2026 a11y 复测补缺）；document 级 click/contextmenu 关闭菜单。**标题行（`header:true`）是纯展示行，不参与可激活集合**（2026-09 锐评修复）：渲染为 `.item.item-header` + `role="presentation"`，不挂 `role="menuitem"`/`tabindex`、不绑 onclick、**不输出 `data-testid="ctx-item"`**（该 testid 语义 = 可点的菜单项，e2e 按它 `.first()` 定位点击目标，标题行混入会点到无动作行），CSS 抹掉 hover 高亮与手型光标（`.item-header{cursor:default;color:var(--muted);font-size:var(--fs-xs)}`，同特异度靠源序覆盖 `.item:hover`）；键盘导航选择器为 `.item:not(.item-header)`，方向键不在无动作行停留
- `features/context-menu/context-menus.ts` — 注册与编排层（orchestrator，仅消费）：`registerContextMenus(unsubs)` 监听 `ctx:show` → `buildMenuItems` 组装后派发 `menu:show`，unsub 收进传入数组；`HANDLERS` 经 `context-menu-handlers.ts` import（不再本地持有）；filter 链：① `visibleWhen` ② viewer-mode 守卫（`canWebAction` 两关 AND）
- `features/context-menu/context-menu-handlers.ts` — **HANDLERS 行为表**（`context-menu-handlers.ts|HANDLERS`，action id → handler，经 `FILE_HANDLERS`/`DIR_HANDLERS`/`INSTANCE_HANDLERS`/`BATCH_HANDLERS` 四子表展开）覆盖 `instance.*` / `batch.*` / `file.*` / `dir.*`（noop 假动作已退役），与 `menu-defs.ts` 声明一一对应；dir/file 拆分在 `context-menu-dir-handlers.ts` / `context-menu-file-handlers.ts`，共享工具在 `context-menu-shared.ts`。**表级 ctx 窄化全家平权**（P2-1 + P2-2，锐评 #4 收口）：`FileCtx`/`DirCtx`/`InstanceCtx`/`BatchCtx` 各以 `Omit<MenuCtx, 对立域字段>` 编译期防跨表误取（instance 不得读 dir/paths/count/workshop，batch 不得读 path/instanceName/subdir/dir/workshop）；workshop 全 header 无 handler 无表可窄。**行为 toast/弹窗文案全量 i18n**（2026-08-30 P3 收敛：handler 层 48 处裸中文 → `ctx.*` key，三语言包同步）——`runBatchFileOp` 从「中文 verb/message」改为 `BATCH_TPL` mode 模板表（move/copy 的 progress/okAll/okPartial/failAll/dialog 文案集中定义），file/dir/shared handler 一律 `tOf()` 多级兜底（缺失键回落 FALLBACK_LANG=en 语言包，ADR-210 D3 起 tr() 根除）；viewer-mode 过滤收敛为单一 `canWebAction(action)`（来自 `backend/capabilities.ts`，ADR-203 D3 自原 `utils/dom/capabilities.ts` 迁入，2026-08-30 P3 收敛——纯前端动作 `VIEWER_PURE_ACTIONS` 恒可达 + binding 走 `can()` 探测）；下载操作委托 `utils/dom/download-text.ts`；工具函数 `refreshUI()`（派发 `tree:reload` + `stats:refresh`）、`toast()`、`toastError()`（错误 toast 统一入口：`❌ friendlyError(e)` 模板 + long 时长，2026-08-30 收敛 handler 层 12 处行内模板）、`isUnsafeFolderName`（禁止 `..`/绝对路径/Windows 非法字符/保留设备名/尾随点空格，2026-09-06 锐评 #9 扩展，口径镜像 Go fsutil——见知识卡 win-filename-rules）、`resolveDstDir()`（move/copy 四处共用：弹窗输入 → 安全检查 → `GetRepoRoot(YSM)` → 拼目标目录，取消/失败返回 null）及其上的 `runSingleOp()`（2026-09-06 锐评 P2：file.move/copy + dir.move/copy 四胞胎 handler 收敛为同一模板——调用方只传路径/rtype/binding/弹窗标题/成功文案，与 batch 侧 `runBatchFileOp` + `BATCH_TPL` 同一屋檐）；连点防护从单一 `_batchBusy` 模块 flag 改为按 verb 独立闭包（`moveBusy / copyBusy / recycleBusy`）——同一 verb 连点互斥，不同 verb 可并发；复制类动作（`batch.copy-paths` / `file.copy-path`）统一走 `utils/dom/clipboard.ts copyText`（Clipboard API + textarea fallback）
- 异常兜底（0b1f6a9）：`file.recycle` / `file.push-to-pack` / `file.edit-tags` 的**外层** await 链各自套 `try/catch`（内层 Go 调用另有一层 catch），弹窗被抢占结算或 bindings 加载失败都会转成 `friendlyError` toast，不再冒泡成 unhandledrejection
- `features/context-menu/menu-defs.ts` — 声明式菜单规格（ADR-021 B 层）：`MENU_DEFS` 五类菜单的完整声明 + `getMenuDef(type)`；加菜单项只改这里。**`MenuItemDef` 为 kind 判别联合**（锐评 #7 收口，对齐 preview-3d `PreviewMenuNode.kind` 范式）：`"divider"`（零字段）| `"header"`（label + 可选 icon，纯展示行——instance/batch 标题与 workshop 信息行，**noop 假动作已退役，标题不再占 action 空间**）| `"action"`（action/label/icon/danger/visibleWhen 五件套，唯一带行为分支）——跨 kind 误填编译期即红。`label` 纯函数式 `(ctx) => string`（2026-08-30 删除死 string 分支）：所有声明 `() => t("menu.xxx")` 或 `(ctx) => 动态`，「label 必须经 i18n 或 ctx 动态生成」是**类型级约束**；表意符号一律走 `icon` 字段（ADR-245 语义名 + `context-menus.test.ts` 遍历声明断言 label 无 emoji 残留），workshop 体积走 `utils/format formatBytes`。文案经 `t()` 严格入口 + 缺失键多级兜底（current → FALLBACK_LANG=en → 裸 key，发版前漏译显示可读文案；`tr()` 双入口随 ADR-210 D3 根除）。`visibleWhen?: (ctx) => boolean` 节点级显隐守卫只活在 action 分支（与 3D 菜单 `PreviewMenuNode.visibleWhen` 同构，吃 ctx 快照、纯函数），filter 在 `buildMenuItems` 中**先于 viewer-mode 守卫**求值（两关 AND；未定义时行为不变）
- `features/pack-ops/instance-ops.ts` — 整合包两个重活的落地方：`instance:export-list` 走 `requireMcRoot` → `ListVersionInstances` → `GetSubDirMap` 按 rtype 分组 `ListFileNames` → 清单写剪贴板；`instance:clear` 走 `CountInstanceResources`（统计失败显式报错，不静默当空）→ `modalConfirm` → `ClearInstanceResources` → `stats:refresh`

## 对外 API / 入口

- 自定义元素：`<context-menu>`
- 导出函数：`registerContextMenus(unsubs: Array<() => void>)`（features/context-menu/context-menus.ts，由 `views/app-content/index.ts` 注册一次）、`MENU_DEFS` / `getMenuDef`（features/context-menu/menu-defs.ts）、`registerInstanceOps(unsubs)`（features/pack-ops/instance-ops.ts）
- 监听 bus：`ctx:show`（features/context-menu/context-menus.ts）、`menu:show`（views/context-menu/index.ts）、`instance:export-list` / `instance:clear`（features/pack-ops/instance-ops.ts）
- 派发 bus：`menu:show`；行为 handler 内再派发 `instance:export-list` / `instance:clear` / `batch:rename` / `dir:rename` / `dir:batch-rename` / `dir:mkdir` / `dir:recycle` / `toast:show` / `tree:reload` / `stats:refresh`
- Go 调用（handler 内经 `context-menu-deps.ts` seam 的 `getApp()` 取 bindings——ADR-208 D1 合规，禁直载 `backend/app.ts`，不再逐处动态 import）：`OpenInstanceFolder`、`MoveModelFile`、`CopyModelFile`、`GetRepoRoot(rtype)`、`MoveToRecycle`、`RenameFile`、`InstallModelTo`、`ListVersionInstances`、`LoadAppConfig`、`RevealInExplorer`；instance-ops 侧另有 `ListFileNames`、`GetSubDirMap`、`CountInstanceResources`、`ClearInstanceResources`
- `ctx:show` 派发方：`app-tree`（file/dir/batch）、`app-sidebar`（instance）、`features/community/events.ts`（workshop，ADR-208 D3）

## 与其他子系统关系

- 弹窗交互委托 `features/dialogs/`：`modalPrompt`（modal-prompt.ts） / `modalConfirm`（modal-confirm.ts） / `modalSelect`（modal-select.ts）、`showRenameDialog`（rename.ts）、`modalTagEditor`（tag-editor.ts）（ADR-170 自 `utils/dom/dialogs/` 升格）
- `dir:*` / `batch:rename` 等事件由 `app-tree/bus-handlers.ts` 消费（批量重命名弹窗见知识卡 `dialog_batch_rename`）
- 错误文案统一走 `context-menu-shared.ts` 的 `toastError(err, fallback?, prefix?)`（内部转 `utils/dom/errors.ts` 的 `friendlyError`，long 时长），避免把 Go 原始错误串直接抛给用户——handler 层 catch 一律 `toastError`，不手写 `toast("❌ " + ...)` 模板
- 回收站行为最终走 Go `go/recycle` 包（`MoveToRecycle`）
- 注册时机随 `app-content` 的 `connectedCallback` 直调 `registerContextMenus` 生效，`disconnectedCallback` 统一退订（见知识卡 `global_handlers`、`app_content`）

## 不变量

- 菜单结构只允许在 `menu-defs.ts` 修改；`MenuItemDef` action 分支的 `action` 与 `HANDLERS` 表一一对应（`HandlerTable = Record<MenuAction, ...>` 注解穷举 + 各域子表 `Extract<MenuAction, \`域.${string}\`>` satisfies 双向钉死；noop 退役后 action 空间无假动作），`buildMenuItems` 对失配 action 打 `console.warn`，契约测试遍历声明断言零警告（缺 handler 会测试失败）；**待办（P2）**：升级为直接对账声明表 vs handler 表，不再依赖 spy
- `visibleWhen` 与 viewer-mode 全局过滤 AND：两边都通过才出现在 items；与 3D `PreviewMenuNode.visibleWhen`（[doc:adr-126-p4-d]）语义同构（都吃状态快照/ctx 快照的纯函数谓词），共享「声明式菜单唯一条件守卫口」精神面。**2026-09-06 起有真实消费者**（file.rename 的 ysm.json 守卫），不再是零消费机制
- `CtxShowPayload` 不携带 `banned`（2026-09-06 出契约）：树行启用/禁用切换走 app-tree 自己的 `.ck` 事件链，与右键菜单无关——原字段发射端携带、全链零消费
- `registerContextMenus(unsubs)` 只由 `app-content` 的 `connectedCallback` 调用一次且必须把 unsub 收进数组，禁止组件内重复注册（事件无守卫注册反模式，ADR-008）
- 菜单项 label/icon 一律过 `_esc`（委托 utils/dom/html.ts 的 `esc`）转义；移动/复制目标文件夹名过 `isUnsafeFolderName` 安全过滤
- 每个 async handler 的最外层 await 链都要有 catch 出口——右键菜单点击是「发射后不管」调用，未捕获异常只会变成 unhandledrejection，用户看不到任何反馈。**已全量补齐**（P2 修复）：batch.move/batch.copy/batch.recycle 补外层 catch，file.move/file.copy/dir.move/dir.copy 的 `resolveDstDir`/`getApp` 与 file.reveal 的 `getApp` 纳入 try——原实现 `getApp`（import 失败 rethrow）与 `resolveDstDir`（内含 GetRepoRoot）在 try 外，reject 时 rejection 逸出
- `ysm.json` 禁止单文件重命名（ADR-038 D3）：守卫在**声明层**——`menu-defs.ts` 的 `file.rename` 项挂 `visibleWhen`（path 末段 ysm.json 大小写不敏感 → 隐藏整项，2026-09-06 自 handler 内 toast 教育上移，首个真实消费者）；后端 Go fileops / web-fs.ts 双侧硬拒保留兜底，`ctx.renameYsmJson` i18n 键已删
- **instance 两项按 rtype 收窄的操作（export-list / clear），菜单文案必须跟随类型**（2026-09 锐评「整合包菜单」收口）：执行层只处理当前 rtype 的资源（`instance-ops.ts` P0 修复明文拒绝 fallback 全类型），静态「模型清单/模型」文案停在 shaderpack/blueprint 卡片上即语义说谎（且 clear 是 danger 操作）。实现：`menu-defs.ts` 两项 label 走 `(ctx) => t("menu.xxx", { type: shortLabelOf(ctx.rtype || "") })`——类型词必须用 `utils/resource/short-label.ts` 的 `shortLabelOf`（i18n 感知，en/ja 返回对应语言短标签），**禁用 `RESOURCE_TYPE_LABELS`**（中文全名硬编码，外语界面注入中文）；三语 locale 的 `{type}` 占位符由 locales-consistency 测试校验对齐；回归锁见 `context-menus.test.ts`「instance 文案跟随 rtype」describe。同型推广：新增按 rtype 收窄的操作菜单项时，凡文案含类型暗示（"模型"等）一律走 `{type}` 插值，不写死。**同一条菜单内口径必须唯一**（2026-09-06 补漏）：instance 首行 header 原写 `(${ctx.rtype})` 直插**原始 rtype ID**，于是 MMD 卡片上并存「测试整合包 (EntityPlayer)」与「复制MMD清单」——独立于下方 action 的第二套口径，任何类型改名都会让两行各说各话。现 header 同样走 `shortLabelOf`；回归锁为 `context-menus.test.ts` 的「header 标题行与 action 行同口径」「header 与 action 共用同一份短标签口径」（后者对每个 rtype 断言 header 括号内的类型词必须出现在 export-list 文案中，散装第二套映射即红）
- **`MenuItem.header?: boolean` 是「纯展示行」的渲染层判别位**（2026-09 锐评修复，`bus.ts`）：`context-menus.ts` 的 header 分支产出 `{ label, header: true, icon? }`，渲染层据此不挂 `role="menuitem"`/`tabindex`/onclick、不给 hover 高亮、不计入键盘导航集合，也不输出 `ctx-item` testid。**不变量**：kind 判别为 `header` 的声明必然产出 `header:true`，`action` 声明必然不带该位（`context-menus.setup.ts` 的 `expectItemsMatchDef` 双向硬断言，漏挂/误挂即红）——否则标题行会伪装成可点项（SR 播报成菜单项、悬停高亮却点了无事发生），或行为项被降级成不可激活的展示行
- **instance 菜单 divider 只放在语义组边界**（2026-09 锐评「整合包菜单」减肥，`menu-defs.ts|MENU_DEFS`）：标题行之后一条（探查组 `instance.open-folder` + `instance.export-list` 并排同组）、danger 组（`instance.clear`）之前一条——3 动作配 2 线。禁止逐动作画线的斑马纹（旧 4 线形态菜单更像表格）；新增 action 先定归属组，跨组才加线，组内并排
- **`context-menu-handlers.ts|HANDLERS` 是模块级共享单例，非废弃符号**：生产消费方（`context-menus.ts`）与测试探针注入都走这张表（busy 锁 `moveBusy/copyBusy/recycleBusy` 全进程共享；测试收尾清理探针 action 防泄漏）。需要隔离 busy 锁的独立实例才用 `createContextMenuHandlers()`。该导出**不挂 @deprecated**（2026-09 修正：旧注解承诺「使用未导出的 defaultHandlers」，指引本身是坏的，误导维护者误删生产消费者）
- 源码注释**不写死代码行号**（2026-09 锐评教训）：仓内 `check-knowledge-drift` 的「禁硬编码行号」检查只扫**知识卡正文**，源码注释不在扫描域 → 注释里写「某文件名 + 行号」会静默漂移（实证：`vitest.config.ts` 的 `isolate: true` 开关上方后来插入一段注释后被下推数行，三处指向旧行号的测试注释全部失效多时无人知）。引用源码位置请写**文件+符号名**（如「`vitest.config.ts` 的 `isolate: true` 开关」），不写行号；ADR 章节号（如 `ADR-023` 的第三层）、分层编号（如「感知层」二级）、vendor 坐标（如 `Blockbench cube.js` 的 updateUV mirror_uv 段）不属此列
- `<context-menu>` 的 `bus.on` 与 document 级 click/contextmenu/keydown 监听在 `disconnectedCallback` 成对清理
- 键盘导航（Arrow/Enter/Escape，2026-09-05 code_review 补强）三条不变量：
  1. **shadow 深焦解析**：`document.activeElement` 对 shadow DOM 内聚焦元素 retarget 成 host（`<context-menu>` 本体），`items.indexOf(active)`/`classList.contains("item")` 对 host 恒 false → 方向键/Enter 整体失效。必须沿 `shadowRoot.activeElement` 下钻取真实聚焦项（范式同 `utils/dom/focus-restore.ts` 的 trapFocusAcrossShadow）——此坑在 jsdom/happy-dom 下因不实现 retargeting 而测不出，须显式断言 `shadowRoot.activeElement`
  2. **焦点归属守卫**：焦点不在本菜单（Tab 逃逸/外部点击/空 items）时不接管方向键/Enter——防劫持页面滚动/光标、防误触页面上恰好同 class 的元素
  3. **焦点归还**：`show()` 记录打开前焦点（host/body 不入账），`hide()` 归还——Esc/选中后键盘上下文不丢到 body

## 相关

- `frontend/src/features/dialogs/` — modal / rename / batch-rename / tag-editor 弹窗
- `frontend/src/features/context-menu/context-menus.test.ts` + `context-menus-async.test.ts` — 声明与 handler 的契约测试（sync/async 分域，mock 矩阵唯一化于 `context-menus.setup.ts`，ADR-187 D5 修订）
- `frontend/src/views/context-menu/index.test.ts` — 渲染容器测试
- 知识卡：`global_handlers`、`app_tree`、`app_sidebar`、`app_content`、`dialog_batch_rename`、`event_bus`
