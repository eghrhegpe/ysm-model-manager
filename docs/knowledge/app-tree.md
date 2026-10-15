---
kind: app-tree
name: 资源树 app-tree
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-tree/
  - frontend/src/core/model-path-store.ts
  - frontend/src/features/dnd/move-dnd.ts
  - frontend/src/utils/async/batch-all-settled.ts
auto_fields:
  symbols_with_lines:
    - __resetLastModelPathForTest
    - advFilterClearAll
    - advFilterTpl
    - AppTree
    - appTreeStyle
    - AuthorInfo
    - BATCH_ALL_SETTLED_DEFAULT_SIZE
    - batchAllSettled
    - BatchAllSettledResult
    - BatchFulfilled
    - BatchRejected
    - batchRenameTpl
    - batchToggleAll
    - bindBusEvents
    - bindToolbarEvents
    - bindTreeEvents
    - bindTreeMoveDnD
    - buildTree
    - cleanupVirtualScroll
    - computeMovedEntry
    - createTreeRenderCtx
    - emptyStateForEmptyEntries
    - emptyStateHTML
    - entryKey
    - fileRowCommon
    - fileRowHTML
    - filterSelfReflection
    - flattenVisible
    - folderRowCommon
    - folderRowHTML
    - footerHTML
    - getLastModelPath
    - getRenderMode
    - getVsMode
    - getVsRows
    - headerHTML
    - isTreeMoveDrag
    - listFileRowHTML
    - listFolderRowHTML
    - loadAuthors
    - loadEntries
    - MoveDropTarget
    - openAdvFilterDialog
    - parseTreeMovePayload
    - pickWebFilesAndImport
    - rememberModelPath
    - renameTpl
    - renderDropdown
    - RenderMode
    - renderRepoLabel
    - renderTree
    - resetFooterProgress
    - resolveFolderTarget
    - ROW_H_GRID_COMPACT
    - ROW_H_GRID_NORMAL
    - ROW_H_LIST_COMPACT
    - ROW_H_LIST_NORMAL
    - rowHeightGrid
    - rowHeightList
    - runToolbarCommand
    - SelectedKeys
    - selectSingle
    - SelectState
    - setFooterProgress
    - setRenderMode
    - setVsRows
    - spinnerHTML
    - tagEditorTpl
    - toggleSelect
    - TOOLBAR_COMMANDS
    - ToolbarCommandCtx
    - ToolbarCommandId
    - toolbarMenuTestids
    - TREE_MOVE_MIME
    - treeCSS
    - TreeEntry
    - treeLoadFailedHTML
    - TreeMoveDeps
    - TreeMovePayload
    - TreeNode
    - TreeRenderCtx
    - TreeRow
    - TreeSnapshot
    - TreeState
    - updateSelectCount
    - updateStat
    - VIEW_TESTIDS
    - withFooterProgress
  tests:
    - frontend/src/views/app-nav/index.test.ts
    - frontend/src/views/app-sync-manager/index.test.ts
    - frontend/src/views/app-toast/index.test.ts
    - frontend/src/views/context-menu/index.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 资源树、tree、目录树
  - 节点选择、多选、右键菜单
  - tree:set-search、bus-handlers、selectState
quick_risk_lines:
  - app-tree 的 bus 订阅必须经 _unsubs 收集，disconnectedCallback 必须清理全部订阅
  - TreeRow.key / data-fullpath / selectState.keys 三处键空间必须同源（统一经 entryKey），file 行取磁盘路径（ADR-222）
pitfalls:
  - bus 订阅未进 _unsubs → 组件卸载后监听泄漏；必须经 bindBusEvents 返回的 unsub 数组收集
  - DOM 委托事件进 _unsubs → disconnect 时重复 off 报错；DOM 委托事件应靠 ShadowRoot detach 自动清理
  - 文件行 key 与选中态路径必须同源（entryKey）：TreeRow.key 取树内拼接路径而 selectState.keys 取磁盘路径时，indexOf/has 恒失配且**不抛错**——Shift 范围选择、右键批量、键盘导航、全选、双击重命名定位 6 处一起静默失效（ADR-222）
  - 渲染层禁止值依赖 loader.ts：多个组件测试 vi.mock("./loader.ts") 只为替换 loadEntries，值导入会让渲染崩在 mock 下（entryKey 因此独立成 entry-key.ts）

use_when:
  - 树形
  - 资源列表
  - tree
  - 节点
  - 树
  - 目录树
invariant_anchors:
  - frontend/src/views/app-tree/index.ts|selectState
status: active
---

# 资源树 app-tree

## 概览

`app-tree` 是 YSM 核心的资源目录树组件，使用 Web Components 实现，支持展开/折叠、右键菜单、文件图标显示。

## 核心职责

- 渲染模型资源目录树
- 节点选择与多选
- 右键菜单触发
- 节点悬停快捷操作（ha-preview 🔍：解析模型名作者并在 B 站搜索；ha-copy 📋：`navigator.clipboard.writeText` 复制文件名）

## 对外 API / 入口

- `AppTree` 生命周期：`connectedCallback`（渲染布局 → 绑定工具栏/事件委托/键盘 → `_unsubs` 收集 bus 订阅）→ `disconnectedCallback`（清理订阅 / 快捷键 dispose（key-router）/ 虚拟滚动）
  - `_unsubs` 仅收集 bus 订阅（`bindBusEvents` 返回的 unsub 数组 + `bus.on("tree:set-search")`），DOM 委托事件（click/contextmenu，通过 `addEventListener` 绑定于 `#tree` 等容器）随 ShadowRoot detach 自动清理，不进入 `_unsubs`
- `_load` — 加载条目数据；`_renderTree` — 渲染树（grid/list 双模式）
- 搜索状态：`_search`（关键词字符串）和 `_filterPaths`（精确路径 Set）共同驱动树过滤
- **ADR-147 已落地（2026-09-01）**：`_typeFilter` 死字段已移除——原「按资源类型过滤」字段从未被生产代码赋非空值，仅测试自证用例写入；12 处读取点（bus-handlers 6 + events 2 + index 4）三元简化为 `_rootAttr || RESOURCE_TYPES.YSM`，`_rootAttr`（root 属性）是唯一 rtype 来源；`index.extra.test.ts` 自证用例删除；新增 `tests/test_private_access_contract.ts` 孤儿守卫：测试引用已删除的私有字段（无类声明且非 `_vsRows` 白名单）即红，防「删字段漏清测试」漂移

### 搜索过滤与渲染管线

搜索过滤在 `render.ts` 的 `buildTree` 函数中实现，两条过滤路径为 **AND 关系**：

1. **`_search`（关键词匹配）**：`trim().toLowerCase()` 后按 `relPath.includes(query)` 匹配模型路径（非仅文件名），匹配结果目录自动展开
2. **`_filterPaths`（精确路径交集）**：`buildTree` 用 `entry-key.ts|entryKey`（= `fullPath || path`）匹配 Set，
   来自高级筛选弹窗的标签 ∩ 搜索条件交集；与 tag-editor 写入的 `modelPath`（ctx:show path = `fullPath || path`）
   **同源**——原 `render.ts|buildTree` 写 `filterPaths.has(e.fullPath)` 不回落 path，fullPath 空条目对
   白名单里的相对 path 永不命中（标签筛选静默失效），锐评 2026-10-09 已统一走 `entryKey`（ADR-222 第④处同源）。

渲染时，搜索态走 `hl(e.name, search)`（utils/dom/html.ts）高亮命中文字，非搜索态走 `renderDisplayName()`（治理红线 4.3）。
- **MMD 子目录分组展示（ADR-094/096 演进，2026-09-03 修正；2026-10-13 处置裁定）**：当前为**扁平化架构**——各 MMD 类型（SceneModel/CustomAnim 等）是独立顶级类型，`resource_types.json` 的 `GROUP_TYPE_OPTIONS` 全部 `subdir: ""`，`app-nav` 双下拉永不写非空 subdir（`repo_subdir` 恒落空值，`loader.ts` 的 `targetType = subdir || rtype` 是防御性写法）。`subdir` 属性通道 + `repo:subdir-changed` 事件是 ADR-094「子目录选择」的半迁移残留——知识卡不再宣称 subdir 参与路径拼接；`loader.ts` 的 `loadEntries(rtype, subdir)` 在 subdir 非空时以 subdir 覆盖 rtype 查表（GetRepoRoot("SceneModel") 而非 "mmd" 拼接），组名分组效果由 Go 扫描根即子目录根达成。**修改提醒**：任何文件夹操作（bus-handlers dir:rename/mkdir/recycle/batch-rename、events 右键、index 键盘删除）统一用 `vm._rootAttr || RESOURCE_TYPES.YSM` 即当前视图真实类型（root 就是完整 rtype），不要自行拼接 subdir 路径。
  **2026-10-13 删除评估（裁定：不动，留 ADR 立项）**：全链 grep 后确认 subdir 通道并非纯死码——①`repo_subdir` localStorage 有 3 个活读取方（app-sidebar/events.ts 右键透传 OpenInstanceFolder、app-nav 恢复选中、init-pages mountTree）；②Go `BuildSyncItems` 的 subtype 参数参与同步缓存键（instance.go buildSyncItemsKey）且 Go 注释保留「非空时路径限定」契约；③`repo:subdir-changed` 有 app-sync-manager 订阅（同值早退守卫，事件恒 "" 时零成本）。删除是跨 frontend 5 文件 + Go 签名 + bindings 重生成 + 存量 localStorage 迁移的手术，且「将来恢复 MMD 子目录选择」（ADR-094 遗留迁移脚本未实现）时通道要重建。故按 ADR-320 流程立项后统一处置，不在锐评修复批内顺手删（纯删除≠低风险：跨语言签名 + 存量存储键 + 契约恢复预期三重牵连）。**已立 ADR-096-d1（2026-10-14）**：裁定保留为跨语言契约占位、禁新增消费者，将来触发删除（见 `docs/adr/decisions/ADR-096-d1-repo-subdir-channel-disposition.md`）。
- `views/app-tree/index.ts|_initKeyboardShortcuts` / `views/app-tree/index.ts|_deleteSelected` — 键盘快捷键（key-router 注册表，ADR-308 D1）/ 批量删除。
  - 全局组合键走 `utils/dom/key-router.ts|registerShortcut` 注册表单点分发：`tree:find`（Ctrl+F / Meta+F → 聚焦搜索框）/ `tree:delete`（Delete / Del → 批量删除）/ `tree:nav-down`（ArrowDown）/ `tree:nav-up`（ArrowUp → 行导航）。原「document 单点 keydown 委托 + `_onKeydown` 串接三段」写法已退役；`_shortcutOffs` 收集各 spec 的 dispose 句柄，`disconnectedCallback` 逐个解除（防 keydown 监听泄漏），HMR 重入先解除旧代际再注册（防同 id 注册表碰撞告警）。
  - **语义收紧（ADR-308 D1 收编副作用，已知）**：方向键裸键匹配 = 无修饰键（原实现漏查 shift，Shift+方向键导航不再生效——按 ARIA 列表导航规范收紧）；Delete 同理。碰撞从「约定」变「检测」由注册表 `key-router` 负责，新增组合键不得绕过注册表手挂 document listener。
- **3D 全屏快捷键门禁**：`views/app-tree/index.ts|_initKeyboardShortcuts` 的 `yieldTo3D` 门禁 = `!isPreviewOverlayActive()`（`preview-3d/infra/overlay-active.ts`，ADR-175 M1 契约收编的权威查询——内部查 `document.getElementById("ysm-overlay-3d")`，常量见 `preview-3d/infra/ui-constants.ts`），作为 key-router 各 spec 的 `when` 谓词——3D 全屏打开期间树面板不接管任何全局按键（Ctrl+F 不抢焦点、Delete 不误删选中模型、方向键不与 3D 相机平移冲突）；overlay 移除后快捷键恢复。禁止组件裸查 overlay DOM，统一走该查询函数
- 子模块：`bus-handlers.ts`（事件处理）/ `events.ts`（委托）/ `render.ts`（含虚拟滚动，原独立 virtual-scroll.ts 已并入）/ `loader.ts`（数据加载抽象层）/ `authors.ts`（作者列表加载）/ `toolbar-events.ts`（工具栏 UI 绑定）/ `footer-progress.ts`（页脚进度槽，长批量可见进度）

### 渲染性能要点（2026-08-24）

- **搜索输入 debounce 150ms**（`toolbar-events.ts`）：`input` 事件里 `_search` 立即更新（后续其他渲染读取到最新值），仅 `_renderTree` 延迟合并——万级条目打字不再每字符全量 buildTree+渲染。测试用 `vi.useFakeTimers()` + `advanceTimersByTime` 推进。
- **文件夹启禁用标记**（`render.ts` `annotateDirNodes` → `dirFlags` WeakMap）：文件夹行的 `hasEnabled/hasDisabled` 由 `dirFlags` 提供（ckCls：全启 `" on"`、混合 `" on partial"`、全禁空）。实现为**显式栈迭代后序**（2026-09 审计重写）：父目录 flags = 直接文件贡献 ∪ 各子目录已算好的 flags，每节点恰好访问一次，**O(n)** 且无递归——旧实现「外层 for 每目录 + 内层 stack 重扫整棵子树」最坏 O(n²)（深链 2000 级 115.9ms、每倍增 3-6×），且递归深度=树深，10000 级深链直接 `Maximum call stack size exceeded`（回归绊线：`render.test.ts` 深链用例 + 计时断言）。
- **flattenVisible 显式栈迭代（2026-09 P2 修复）**：`flattenVisible` 原递归 `atFvFlattenLevel`（搜索态 `shouldOpen` 无条件 true 全展开 → 递归深度=树深，与 annotateDirNodes 同源栈溢出）。已改显式栈（Frame/idx 模式，同 annotateDirNodes 同款），深度优先前序保序、无递归。回归绊线：`render.test.ts`「10000 级深链 + 搜索命中」用例。
- **搜索态目录剪枝 + 行态同源（锐评 2026-10-15 P1-B）**：`flattenVisible` 末尾 `return isSearch ? pruneDirsWithoutMatch(rows) : rows`——搜索态剔除「子树内不含任何命中文件」的目录行。病灶两条：① 目录行原先**无条件入列**，大仓库搜一个模型名先撞上一堵空的作者文件夹墙；② 更硬的是「一个都没搜到」时 rows 仍非空 → `renderTree` 的 `!rows.length` 分支永不可达 → `guide/repository.md` 承诺的「无结果时显示未找到匹配的文件」在含子目录的仓库里等于失效。剪枝算法：树行是深度优先前序且每行带 `depth`，维护「仍可能有后代」的目录栈，遇文件行把栈内目录全部记保留，每行处理完按**下一行深度**弹栈（`>= nextDepth` 即已非祖先）；单趟 O(n·层深)、不递归（与显式栈口径一致，深链绊线不受影响）。同时 `folderTreeRow` 的 `isOpen` 入参改为 `isSearch || isOpen`——搜索态子行确实全量下探，行态必须与之一致，否则出现「箭头收起 / `aria-expanded=false` 但子文件可见」的说谎，且点箭头视觉无变化。回归锁：`render.test.ts` 搜索剪枝 3 例（空目录/深层祖先链/零命中→`toEqual([])`）+ 行态 1 例 + 非搜索态不受影响 1 例。
- **方向键导航（P2 观察）**：`selectSingle` 后仍全量 `_renderTree`，但行 HTML 预缓存 + 可见区 slice<100，实际开销低，未优化。
- **行高随卡片密度驱动（2026-09）**：行高不再是裸常量——`render.ts` 的 `rowHeightGrid()`/`rowHeightList()` 读 `ui-card-density` 返回 28/24（compact）或 32/28（normal），尺寸常量 `ROW_H_GRID_COMPACT|NORMAL`/`ROW_H_LIST_COMPACT|NORMAL` 是**唯一事实源**；`ui-prefs.ts` 把它们字符串化为 `--tree-row-grid`/`--tree-row-list` 供 CSS 行高（`.fl`/`.fh`/`.fl-list`/`.fh-list` 的 `height`）消费，`variables.css` 的 `:root` 默认值与 compact 档同值（applyUIPrefs 未跑时 CSS 与 JS 兜底仍一致）。**不变量：JS 行高必须等于 CSS 行高**，否则虚拟滚动 paddingTop/Bottom 撑出的滚动长度与 `index.ts` 键盘导航 `scrollTop` 全部算错。密度变更经 `bus.emit("ui:card-density")` → `bus-handlers.ts` 订阅调 `_renderTree()` 重排（行高变了必须重算切片）。

## 响应式属性与代际守卫

- `observedAttributes` 声明 `root`（资源类型根）+ `subdir`（ADR-094 子类型子目录）；`attributeChangedCallback` 响应属性变更触发 `_load` → `_renderTree` 重新加载并渲染（**止血 2026-10-15 A2 起切类型链不再前置全局 `ClearScanCache`**——原每次切类型核平全仓所有类型缓存 = 新类型整库重新冷扫+重哈希的「哈希税」；新鲜度三口径：per-dir 30s 缓存 + watcher 清缓存 + `tree:reload` 手动全局清。已知边界：watcher 只监听 ysm 根，非 ysm 类型外部文件变更最长 30s TTL 后感知）。**生产主路径（2026-09 收债）**：`init-pages.ts|mountTree` 改为**复用实例改属性**（同 mountSyncManager 范式）——树内搜索/排序/滚动状态跨类型切换存活（选中态在切类型链清空，锐评 2026-10-13 P1-1；目录展开态改由 `_hydrateDirOpen` 按 rtype 重读，锐评 2026-10-15 P1-A）；同任务内 root+subdir 成对变更经 **microtask 合并**只放行一次全价重扫（`_attrReloadQueued` 句柄，gen 在 microtask 里捕获即终值代际）；同值 setAttribute 被 `oldVal === newVal` 拦下（repo:rtype-changed 同值重放零成本，「强制刷新」语义归 `tree:reload`）
- 挂载时序保护（2026-09 收敛，取代原 `_pendingRoot` 机制）：`connectedCallback` 入口捕获 `initRoot/initSubdir` 快照，`_ready` 标志区分首次挂载与后续属性变更——`attributeChangedCallback` 在挂载未完成（`!_ready || !isConnected`）时仅同步属性 + `_guard.next()` 作废在途首代渲染（不启动加载）；`connectedCallback` 的 `_load` 完成后按**快照差量**（当前属性 ≠ 入口快照）判定补载一次最新 root。收益：未连接 setAttribute 单次加载（旧实现双加载 + 冗余 ClearScanCache）、挂载期间切换无「新 rootAttr + 旧 entries」错配帧
- **重连恢复（2026-09 收债，ADR-163 §3.5）**：常驻面板 detach/attach 仍走完整断连/重连——`_ready` 作重连判据，重连渲染成功上屏后 `_restoreRemountState()` 恢复滚动位置 + 回填搜索词。⚠️ 滚动快照靠 **scroll 事件持续记录**（scroll 监听随 `_unsubs` 退订），**不能**在 disconnectedCallback 里读 scrollTop——断连回调触发时元素已分离，真实浏览器 scrollTop 恒读 0（happy-dom 不归零，测试测不出此坑）。`_load()` 照跑不可省：树不消费 watcher 增量，重连加载是分离期间文件变更的唯一补采口；catch 失败态清快照，root/subdir 快照差补载路径不恢复（旧位置已失义）
- 代际守卫 `_guard = createLoadGuard()`（ADR-230 全仓唯一代际守卫出口，`utils/async/load-guard.ts`；原 `_gen` 裸计数已退役并入此出口）：`next()` 每次加载开头自增取号、`stale(gen)` 在 await 返回后代数已过期时直接 return（不写 DOM、不绑监听）、`invalidate()` 在 cleanup 时使所有在途请求失效（防幽灵写入/监听泄漏）、`current` 读取当前代数——异步 `_load` 完成后用 `_guard.stale(gen)` 校验，若期间 root 已切换则丢弃本次过期加载的渲染（防旧类型数据覆盖新类型树），是 app-tree 多资源类型快速切换的核心机制；挂载/补载失败走 `toastThrottled`（5s 节流，对齐 loader.ts 模式）。⚠️ **`disconnectedCallback` 必须调 `_guard.invalidate()`（2026-10 锐评修复）**：卸载若只解订阅/定时器/监听而**不作废代数**，`stale(gen)` 恒 false——`_reloadAfterMountSwitch`（`await _load()` 慢 IPC；止血 2026-10-15 A2 起补载链无 `ClearScanCache` 前置步）的续体在卸载后仍会执行 `_renderTree()`，给已卸载的 shadow root 重渲染整棵树（幽灵写入）。回归锁 `index.extra.test.ts|在途补载期间卸载 → 迟到结果不重渲染`；同型先例：`app-sidebar` 同类漏接（同批修复）

## 工具栏功能（toolbar-events.ts）

`bindToolbarEvents`（toolbar-events.ts）绑定工具栏所有 UI 入口，对外功能清单：

| 功能 | 触发元素 | 说明 |
|------|----------|------|
| 高级筛选弹窗 | `#btn-adv-filter` 点击 → `openAdvFilterDialog`（toolbar-search.ts） | 弹窗输入关键词/标签/骨骼/立方体/纹理数值范围（当前 rtype 无几何管线时数值区禁用 + 提示，`geometrySearchable` 门控见 dialog-adv-filter 卡），回填 inline 面板并调用后端 SearchModels |
| 排序下拉 | `#sort` change | name/size/date 排序（name/目录恒按名称；文件 size/date **降序**，同键回退名称序——目录无独立 size/modTime 语义，子树聚合归 Go。⚠️ 2026-09 前比较器漏实现 size/date 档，`render.test.ts` 的 `treeKeys` 用 `Object.keys().sort()` 自排序致用例对任何实现通过，断言必须走 `flattenVisible` 行序且数据须使字典序 ≠ 期望序） || 视图模式切换 | `#btn-view-mode` click | grid ⇄ list 切换，持久化到 localStorage |
| 作者下拉菜单 | `#dd-authors`（`initDropdown` 控制器 click 展开，onOpen 钩子每次展开重填 `fillAuthorMenu`——ADR-238 hover 展开已退役） | 点击作者名自动填入搜索框并触发搜索 |
| 全选 / 反选 | `#sel-all` click | 基于当前可见行切换 `selectState.keys` |
| 生成仓库索引 | `data-more="genindex"` | 调用 Go `GenerateRepoIndex`，网页版触发下载，桌面端写盘 |

> 2026-10-13 清理：原表中「导出骨骼名 | `#repo-export`」条目删除——grep 全前端无 `repo-export` 元素与 `ExportBoneStructures` 前端调用（Go 绑定仍在，wails-bindings.md 登记），是知识卡遗留的幽灵条目（ADR-053 时代的入口已整体消失）。

`_loadAuthorsAsync` 在 `connectedCallback` 内延迟调用 `loadAuthors` 加载作者列表至 `_authors`，供 `fillAuthorMenu` 填充下拉。

## 与其他子系统关系

- `app-content/`: 选中节点内容在 content 区域渲染
- `app-sidebar/`: 侧栏面板状态联动
- `features/context-menu/context-menus.ts`: 右键菜单事件路由
- 通过 bus 发出节点选择事件

## 不变量

- **树键必须避开原型链（ADR-334，2026-10-13）**：建树键直接取自磁盘路径段（`entry.path.split("/")`，无净化），目录/文件恰名 `__proto__` 时，普通对象会沿原型链读到 `Object.prototype` → `= {}` 走**原型 setter**把整棵子树写进全局原型（**全进程污染**），且该目录及子树在 UI **完全不显示**（`Object.keys(root)` 恒不含它）。**故 `buildTree` 的 root 与每个中间目录一律 `Object.create(null)`**；展开态读侧（`index.ts|toggleDir`、`render.ts|flattenVisible`）一律 `Object.hasOwn(dirOpen, key) ? dirOpen[key] === true : false`（口径先例 `utils/icon/workshop-icons.ts`），`readScopedDirOpen` 返回 null 原型副本。遍历侧语义不变（全用 `Object.keys` + 显式 `_e` 过滤）。⚠️ **代价**：null 原型对象没有 `hasOwnProperty`/`toString`，将来若对 `TreeNode` 直接调这些方法须改 `Object.hasOwn(node, ...)`。回归锁 `render.test.ts`「buildTree 键与 Object.prototype 同名」4 例；**写该类测试时构造含 `__proto__` 键的输入必须用 `Object.fromEntries`——对象字面量 `{__proto__:true}` 设的是原型不是 own key**
- **dirOpen 持久化按 rtype 命名空间（2026-09 收债）**：localStorage `dirOpenState` 值为 `{ [rtype]: { 相对目录: bool } }`（`index.ts` 的 `readScopedDirOpen`/`writeScopedDirOpen` 单点读写）——原平铺键不分类型，不同类型同名目录互相串展开态。旧平铺值无法判定来源，读侧直接忽略（重新展开一次即重建新形态）。**水化必须三入口收敛（锐评 2026-10-15 P1-A）**：只在 `connectedCallback` 读一次是不够的——切 rtype 有三条**不重连**路径都会让新树沿用上类型展开图：① `mountTree` 的 `setAttribute("root", …)`（实例复用 → `_attrChangeReloadAsync`）；② 分离期切类型（`!isConnected` 分支只更新 rootAttr）→ 切回页面重连；③ 首挂载 `await _load()`（慢扫描 RPC）期间切类型 → `_reloadAfterMountSwitch`。污染面不止显示：`toggleDir` 的 `writeScopedDirOpen(rtype, this._state.dirOpen)` 写的是**全量 map**，混装态一落盘就把上类型目录写进新类型槽位。故收敛为 `index.ts|_hydrateDirOpen()` 单点：以 `_dirOpenRtype` 判「rtype 是否变过」，变则**赋值替换** `this._state.dirOpen = readScopedDirOpen(rtype)`（**禁止 `Object.assign` 合并**——合并等于把旧类型残留留在新类型里，正是本缺陷本体）；同 rtype 重连保留内存态（不打断「分离→重连保留展开态」承诺）。回归锁：`index.extra.test.ts|切资源类型 → 展开态换新类型命名空间` + `|分离期间切 rtype → 重连按 rtype 重读`（后者在旧 `Object.assign` 实现下必红，并断言写侧两槽位互不污染）。
- **tree:set-search 监听 + 冷启动 pending 消费（2026-09 收债）**：listener 填词后 `takePendingTreeSearch()` 清残；`connectedCallback` 挂载段对称 take 消费（`repo:search-creator` 在 app-tree chunk 未加载时 emit 落空的兜底，词槽在 `utils/dom/search-pending.ts`，写侧 app-content **先 set 再 emit**——bus 同步派发，顺序保证 listener 命中路径能 take 清残）。填词动作单点 `applySearchToInput`（value + input 事件派发，走统一防抖渲染入口）。
- **文件行键空间契约（ADR-222，2026-09-10）**：file 行的 `TreeRow.key` = **磁盘完整路径**，统一经 `entry-key.ts` 的 `entryKey(e)`（= `e.fullPath || e.path`）取值；与 DOM `data-fullpath`（`row-common.ts` 的 `fp`）、`selectState.keys` / `lastKey`（选中态）**三者同源**。folder 行 key 仍为树内拼接路径（仅服务 `dirOpen` 展开态与 `data-dir` 自洽闭环，不参与选中/批量，**有意的非对称**）。历史病灶：file 行 key 曾用树内拼接路径 `${prefix}/${name}`，与选中态的磁盘路径分裂，致 6 处 `indexOf`/`has` 静默失配且不抛错——Shift 范围选择、右键菜单批量判定、键盘 ↑↓ 导航（`currentIdx` 恒 -1）、全选按钮（`allSelected` 恒 false 且把相对键**混入**选中集污染批量删除）、双击重命名行定位。修复须三处同源，**禁止任何一处另写 `fullPath || path` 表达式**。回归绊线：`render.test.ts`「文件行 key 用 fullPath」+ E2E `tree-multiselect.spec.ts`
- **渲染层对 `loader.ts` 只许 type-only 依赖**：5 个组件测试 `vi.mock("./loader.ts")` 仅为替换 `loadEntries`，渲染层若值依赖 loader 会在 mock 下取到 `undefined` 并崩整树渲染（实施中已实际触发 20 条测试批量失败）。需被渲染层复用的 `TreeEntry` 派生函数放独立零依赖叶模块（如 `entry-key.ts`），勿并入 `loader.ts`
- **Go 下发的扫描字段必须逐项透传 TreeEntry（2026-09 对接锐评①教训）**：`loader.ts` 的 map 是 Go `ModelEntry` → 渲染格式的**唯一 seam**，逐字段手抄漏一项就是「Go 白算、渲染白写、中间断」的静默截断——`HasTags` 曾被漏（Go `scanModelEntriesWithHit` 逐条读标签存储填充、`row-tpl` 的 tag-dot 标记与 `.tag-dot` 样式全链存活，唯独 seam 断了，标签圆点永不显示）。现 map 内 `HasTags: e.HasTags || false` 显式归一，回归锁见 `loader.test.ts`「HasTags 由 Go 下发并透传」用例；**给 ModelEntry 加字段时必须检查该 map**
- 文件名显示统一走 `renderDisplayName()`（治理红线 4.3）；搜索态走 `hl(e.name, search)`（utils/dom/html.ts，同源转义但美化样式在搜索时丢失——P3 观察）
- **行选中态唯一出口 = 数据渲染（2026-10-13 P0-1 接线，f4d590e12 病灶根治）**：`renderTree` 收 `selectedKeys`（AppTree 传 `state.selectState.keys`，同一 Set 直传勿复制）→ `flattenVisible` → `visibleFileRow` → `fileRowFromEntry` 派生 `rowCls`（命中 = `" selected"`）与搜索态 `hl()` 高亮——`.fl.selected` / `.fl-list.selected` CSS 与 `aria-selected` 由数据渲染单点驱动。**禁止**在渲染管线外手写 `classList.add("selected")` 补丁（原 `_onKeyArrowNav` 双轨已拆除：它会被下一次重渲的 `cloneNode` 冲掉，且鼠标路径完全无覆盖）。folder 行无选中语义（`folderRowHTML` 无 rowCls 形参），`.fh.selected` 死规则已删。回归锁：`render.test.ts`「行选中态随数据渲染」组 + E2E `tree-multiselect.spec.ts` 视觉断言（class + aria-selected——`data-count` 只证数据不证视觉，f4d590e12 断链时五处测试全绿的教训）
- **虚拟滚动两级复用（锐评性能 #5 后续，2026-10-14）**：① **监听跨渲染复用**——`_renderTree` 曾先 `cleanupVirtualScroll` 再 `renderTree`，而 scroll 同步 / ResizeObserver 是按需安装一次的（`renderTree` 内 `if (!st.cleanup)` / `if (!st.resizeObserver)` 守卫），于是每次交互（选中/方向键/拖源态/搜索击键）都拆了再装。监听器是容器级、无状态（`redraw` 闭包每次从 `vsStates` 取最新 rows/mode），跨渲染复用无需重建；**销毁点唯一归 `disconnectedCallback`**，`_renderTree` 不再预cleanup。② **行节点跨帧复用**——`renderSlice` 原每帧 `cloneNode` 重建全部可见行（滚动 1px 也重克隆整个可见行组），现由 `VsState.liveNodes`（`Map<key, {row, el}>`）按 **row 对象身份** 复用：命中且身份一致则直接搬动节点，身份变（搜索/排序/选中新数据产生新 row 对象）则重建该行；滚出窗口的 key 从池中剔除（防无界增长），`cleanupVirtualScroll` 一并清池。安全性：树事件全为容器级委托（closest），行节点无独立监听器，身份比对保证内容不串行。回归锁：`index.extra.test.ts`「_renderTree 重入不重装 scroll 监听」+「disconnected 后监听确实拆除」+「滚动重绘复用行节点（中间行 DOM 实例不变）」三例，均变异验证
- **`TreeRow.html` 是惰性 getter（锐评性能 #5 后续，2026-10-14）**：虚拟滚动只把可见窗口的行写进 DOM，但 eager 实现为**全部**可见行拼 HTML 字符串——搜索击键一次 = O(n) 次模板拼接（万级仓库每次击键拼 O(n) 个字符串，DOM 里只进可见窗口那些行）。`render.ts|lazyRow` 用 `Object.defineProperty` 把 `html` 定义为 memoize-once 的 getter：只有被 `rowElOf` 读到或测试直读 `.html` 的行才付构造成本，首次读取后记忆化。**字段名与字符串语义完全不变**，故 25 处既有 `.html` 断言与所有消费方零改动——只挪了构造时机。回归锁：`render.test.ts`「html 是惰性 getter」+「首次读取构造、重复读取记忆化」两例（用 `getOwnPropertyDescriptor` 断言存在 get 且无 value），变异验证：改回 eager 值即转红
- **树键盘可达性：焦点归容器（锐评 UX #1，2026-10-14）**：`role="tree"` 容器挂 `tabindex="0"` 作单点 tab 停靠，`_onKeyArrowNav` 每次导航 `container.focus({preventScroll:true})`。病：行（`role="treeitem"`）与容器全无 tabindex → 浏览器焦点永不落在树内 → 旧守卫 `this._root.contains(target)` 把 body 事件全拦下，方向键导航是死代码（键盘用户完全无法在树里移动）。焦点**不能**交给行——`renderTree` 每次重渲 `cloneNode` 重建行，行上焦点会在下一次按键前丢失（连按方向键第二下就哑）。守卫放宽为「焦点不在输入区」：`target instanceof Element && target.closest("input,textarea,select,[contenteditable]")` 才 return（`e.target` 在 happy-dom/部分 WebView 下可能是 document 无 `closest`，故先 instanceof 收窄；tagName 判定漏 contenteditable）。回归锁：`index.extra.test.ts`「树容器挂 tabindex=0」+「body 焦点下 ArrowDown 焦点归树容器」+「输入框内不抢」三例，均变异验证
- **单文件开关乐观更新（2026-10-13 P1-2）**：`events.ts` 的 `.ck` 单文件链 = 先本地翻转 `vm.entries` 内该条目的 `banned` 位 + `_renderTree()` 即时反馈，`ToggleEnable` IPC 落盘成功后后台 `_load()` reload 校正真值（Go `InvalidatePath` 已使本次扫描缓存失效，重载必真扫盘）；失败 catch 里本地 revert（双守卫：代际过期或条目被换出则跳过 revert，toast 必达）+ error toast；`flashBtn` 必须在乐观重渲**之后**取新行（旧行已被重建，先 flash 后重渲 = 闪烁落空，初版回归实证）。`flipLocal` 按 `entryKey` 匹配，找不到条目（entries 未含该路径）跳过本地翻转、IPC 照发。批量链（`toggleFolderBatch`）**2026-10-15 P1-C 起也已乐观化**——原文「多条目乐观翻转易与部分失败语义打架，勿轻改」的顾虑由三件套化解：①先本地翻转全部待翻条目 + 重渲（IPC 在途即见结果）；②失败项按 `rejected[].index` 本地回滚（代际守卫同单文件链）；③有成功项才 `_load()` 取磁盘真值校正，**全失败则不付全量重扫**（回滚后的本地态即真值）。⚠️ 回滚守卫代数必须在 `await` **前**捕获——`stale(gen)` 判据是 `gen !== current`，拿 `await` 之后的 `current` 去问恒为 false（死判据）。工具栏链 `bus-handlers.ts|runBatchToggle`（整库「全部启用/禁用」，全仓最长批量链）**同批也收了**：同款乐观 + 进度 + 回滚，并删掉无调用方传入的 `opts.prefix` 死形参（留着会让人以为存在「只翻某前缀子树」的路径）。另注：`targetsToToggle` 恒非空（`enable` 由「是否全启用」派生，filter 必取到至少一项），故无「空集早退」分支。回归锁：`events.test.ts` 乐观即时反馈例（IPC 挂起期条目已翻 + 进度已显示）+ 部分失败回滚例 + 全失败不重扫例。回归锁（单文件链）：`events.test.ts`「乐观更新」五例（IPC 挂起期间本地位已翻 / 失败回滚 / 找不到条目不炸 / flash 落新行 / 回滚代际守卫）
- **启停链单锁 + 删除/移动双锁（ADR-341 归一，2026-10-14）**：`_toggleLock` 是单文件开关（`events.ts` 的 `.ck` 链）与文件夹批量（`toggleFolderBatch` / `bus-handlers.ts|runBatchToggle`）**共用的唯一互斥锁**——原 `_toggleBusy`/`_batchBusy` 双布尔互查（A 在途拦 B、B 在途拦 A）在互斥语义下本就是「一把锁两个名字」；`_deleteLock`/`_moveLock` 各自独立临界区（删除与移动互不阻塞），`get deleting()` 读面 = `_deleteLock.isBusy()`。三把锁均 `createBusyLock()` 实例级、随组件 GC；`_treeMovePayload` 的拖源拒绝走 `_deleteLock.isBusy()` 查询。
- **批量并发收口 batchAllSettled（2026-10-13，五处手抄归一）**：`BATCH=8 + Promise.allSettled + ok/fail 统计`在 app-tree 内五处逐字复制（events.toggleFolderBatch / bus-handlers.runBatchRename·atBeHandleDirRecycle·runBatchToggle / index._deleteSelected），收口为 `utils/async/batch-all-settled.ts`（批内并发、批间串行、`rejected[].index` = **原任务列表下标**——失败归因配对原数组，非批内下标）。五处差异只剩业务层：任务构造、成功项收集（flipped）、失败原因格式化（friendlyError/logWarn）。新增批量 IPC 一律走它，勿再手抄循环。**第三参 `onProgress(done, total)`（2026-10-15 P1-C 加）**：每批落定后回调一次（累计已落定数／总数，空任务列表不回调），专供长批量可见进度——分批边界只有本函数知道，让调用方自己切片重写一遍正是「判据手抄复发」的并发版，故进度以可选钩子收在此处（批大小与进度口径天然同源）。⚠️ 钩子是**旁路观察者**：内部 `try/catch` 吞掉其抛错，防「显示数字崩了」连坐整批业务（已落定批次不回滚、余批不跑、调用方 outer catch 还会把乐观翻转留在错误态）。回归锁：`batch-all-settled.test.ts` 15 例（并发上限/批间串行/下标归因/非法 batchSize 回落/顺序保序/进度 8-16-20 递增/失败项也计入 done/空任务不回调/不传钩子纯增量/钩子抛错批处理照常跑完）
- **页脚进度槽 `#ftr-progress`（2026-10-15 P1-C 新增）**：长批量操作的「看得见」单点出口，由 `footer-progress.ts|setFooterProgress(root, text|null)` 控制显隐与文案（传 `null` 清除并隐藏，缺元素静默 no-op）。**为什么另开槽**：toast 会刷屏且遮挡树；`#ftr-stat` 被 `updateStat`/`updateSelectCount` 每次重渲改写，进度写进去会被下一次渲染静默冲掉（那是「写进别人的槽」）。**单一入口 = `footer-progress.ts|withFooterProgress(root, format, total, run)`**：起始 `0/N` → 每批落定推进 → 必清槽，五条长批量链全部走它（`events.ts|toggleFolderBatch` 文件夹启禁、`bus-handlers.ts|runBatchToggle` 整库启停、`|atBeHandleDirRecycle` 整目录入回收站、`|runBatchRename` 批量重命名、`index.ts|_deleteSelected` 批量删除）——各链自己抄「起始 + 推进 + 清槽」三步就是可漂移样板，故收敛单点。**单槽多写者**：`_deleteLock` 与 `_toggleLock` 独立（ADR-341），删除与启停可并发，故模块级 `activeBatches` 计数——**最后一个批次退出才清槽**，否则先结束者会把仍在跑的进度抹掉。空集不写 `0/0`（无意义闪烁窗口，且并行批次文案会被凭空覆盖）。动作词复用既有键（批量重命名用 `diagnostics.opRename`、整目录回收用 `menu.recycle`、批量删除用 `tree.deleteOk`）——新造 `tree.renameAction` 会被 i18n 命名闸按 ADR-124 判违规（尾段 `Action` 属已知角色词，两段式违规，闸给的建议 `tree.section.renameAction` 语义更差）；回收链**不能**用 `tree.dirRecycleOk`（ja「ゴミ箱へ」拼进「{action}中」成不成句的「ゴミ箱へ中」，`menu.recycle` 三语皆通）。⚠️ **已知边界与自愈出口**：批次若永不落定（IPC 挂死），`activeBatches` 滞留 >0 → 此后所有批次失去清槽与进度（不比改动前更差，但会退化到不一致态）；**自愈出口 = `footer-progress.ts|resetFooterProgress()`，由 `index.ts|disconnectedCallback` 调用**——泄漏范围收窄到单个组件实例生命周期内（生产只有一个 `<app-tree>` 实例，app-content 复用同一元素，故全局计数在此复位不踩并发实例）。不设超时 watchdog 的理由见模块注释（挂死时 `_deleteLock`/`_toggleLock` 同样常驻 busy，功能区已整体不可用）。回归锁：`footer-progress.test.ts|resetFooterProgress → 计数归零且清槽` + `index.extra.test.ts|卸载 → 进度槽复位`。布局注：`.ftr .stat` 原有的 `margin-right:auto` 已移除——它本就是**空操作**（flex-grow 先吃完全部自由空间，auto 边距只剩 0，正/负自由空间皆然；2026-10-15 复核纠正了「两者争空间、会把进度槽挤最右」的初版错误推理），右推由 `.ftr` 内 `flex:1` 占位承担，视觉逐值不变。`.ftr-progress` 带 `min-width:0 + overflow:hidden + text-overflow:ellipsis`（nowrap 文案不可缩，窄窗下须自己截断而非把仓库路径按钮挤出页脚）。
- **reload 加载段收敛 vm._load()（2026-10-13，第三处平行实现消除）**：`bus-handlers.reload` 原「手写 loadEntries + entries/filesRoot 赋值 + 自带 catch toast」是 `_load` 的平行实现（reload 四胞胎：connected/_reloadAfterMountSwitch/_attrChangeReloadAsync/reload）——`TreeState.loadFailed` 引入后此分叉立即致病（reload 成功不清 loadFailed 位，「加载失败」空态无法自愈，组件测试实证）。现 reload = ClearScanCache + `community:clear-cache` emit + `vm._load()` + stale 检查 + `_renderTree`；`_load` 内部 catch 全部错误（空 entries + loadFailed 置位），reload 无自有 catch。**tree:reload 的一切加载行为变更只需改 `_load`**。回归锁：`index.extra.test.ts`「_load 抛错 → 空态显示加载失败且 reload 自愈」两例
- **树加载 seam = `ScanModelEntriesForBrowse`（止血 2026-10-15 P0-1：全库哈希税）**：`loader.ts|loadEntries` 改调浏览投影 binding——与 `ScanModelEntriesFiltered` 过滤语义一致（app 层共享 `finalizeScanEntries` 单点），唯一差异 = Go 侧不计算 SHA256（树/预览从不消费 Hash，`ModelEntry.Hash` 只服务同步匹配；万级库冷加载读盘量降一个量级）。`bus-handlers|atBeHandleDirBatchRename` 与预览候选链（`app-preview/siblings.ts` 两处 / `preview-library.ts|scanModelsByType`）已随止血 2026-10-15 复核 P1-1/P2-1 全量切 ForBrowse（均只消费 Name/Path 不读 Hash——树切投影后不再预热全量哈希缓存，开预览下拉/批量重命名对话框不该再冷付全库 SHA256；卡文原「批量重命名需全量条目」与代码不符已更正）；同步链继续走 `ScanModelEntries*` 哈希入口。回归锁：`loader.test.ts`（mock 面换 ForBrowse）+ `app_scan_browse_test.go|ParityWithFiltered`（Go 侧对账）+ 各 siblings/preview-library/bus-handlers 测试 mock 面同步换 ForBrowse
- **文件系统变更自动重载 `repo:fs-changed`（止血 2026-10-15 A3）**：Go watcher → Wails `repo:fs-changed`（`emitRepoFsChanged`）→ `features/repo/repo-fs-events.ts` app 级单例 EventsOn + 二级 800ms 防抖 → bus `repo:fs-changed` → `bus-handlers|atBeHandleRepoFsChanged`：定向失效当前树根（`InvalidateScanPath(filesRoot)`，**不**走全局 ClearScanCache——A2 语义）+ `_load()` + 代际守卫 + `_renderTree`。订阅经 `bindBusEvents` 入 `_unsubs`（卸载即退订）；网页版 runtime Events.On 为 no-op 桩恒静默（手动刷新保持现状）。「watcher 不驱动 UI」的 2026-08 口径已翻转。回归锁：`bus-handlers.test.ts|repo:fs-changed` 三例（定向失效/空根跳过/代际守卫）+ `repo-fs-events.test.ts` 三例（幂等/防抖合并/在途清抖）+ `watcher_onchange_test.go` 三例（触发/nil 守卫/合并）
- **加载失败空态可区分（2026-10-13 P2）**：`TreeState.loadFailed` = 最近一次 `_load` 是否失败；成功加载（含真返回空列表）即清位。空 entries 时 `render.ts|emptyStateForEmptyEntries(loadFailed)` 分叉：失败 → warning 图标 + `tree.treeLoadFailed` 文案；真空目录 → folder 图标 + `tree.noModelFiles`。搜索无匹配空态（`tree.noMatchFiles`）独立分支不受影响。loader 侧另有节流 toast 即时提示，本标志管树面板内驻留空态。回归锁：`render.test.ts`「加载失败空态区分」3 例 + `index.extra.test.ts` 自愈/清位两例
- **选中态清空只有一处动作 `index.ts|_clearSelection`（2026-10-13 P1-1）**：移动 / 删除 / **切资源类型** 三条链共用它（清 keys + lastKey + `updateSelectCount` 三件套），新增清空路径一律调它、勿再手抄三行。⚠️ **改名链刻意不调它（锐评 2026-10-15 P2 收敛）**：内联改名只失效**被改的那一条**键，原实现 `keys.clear()` 会连坐清空无关选中项（「选 5 个改 1 个」把 5 个都丢掉）——双击改名与选中集是两条正交路径（`atTeBindRowDoubleClick` 不触碰 selectState），故改名链改为 `keys.delete(path)` + lastKey 命中即置空 + `updateSelectCount`；移动/删除/切类型三条链是**全体失效**，才用全清。回归锁：`events.test.ts|改名成功 → 只摘被改的那一条`。切类型原本**漏清**：`attributeChangedCallback` → `_attrChangeReloadAsync` 只换 `rootAttr` + `_load` + 重渲，选中集留的是**上一种类型的磁盘路径**，而键空间随类型变（新树 0 行高亮、底部仍报「已选 N 个」）；按 Delete 会拿「新类型 rtype + 旧路径」拼参，确认框宣称删除 N 个而实为上类型文件。**删不掉**（Go 双道 root 包含守卫 `DeleteResourcePack` 目录型走 `EvalSymlinks` 比对、文件型走 `fileops.DeleteModelFile` 逐分支 rel 校验，且 15 类型存储根两两互异不存在守卫失效组合）——是**状态不一致 + 虚假危险确认框**，故定 P1 非 P0。⚠️ **落点必须在切类型链而非 `_load`**：`_load` 也是删除后的重载入口，而「删除失败不清空选中」是刻意行为（有回归锁），放那儿会误伤。回归锁：`index.extra.test.ts` 两例（切类型后 keys/lastKey 清空 / 切类型后按 Delete 不触达绑定与确认框），变异验证：撤 `_clearSelection` 调用即双双转红
- **Shift 区间选有跨度上限 `SHIFT_RANGE_MAX`（锐评 2026-10-15）**：区间按**当前可见行序**（`getVsRows`）取 `lastKey`→目标行之间的全部 file 行，而 `lastKey` 与 `selectState` 是跨搜索/排序**存活**的。病灶：搜索态 Shift 选一小段（此时可见行只有几条命中）→ 清除搜索词 → 再 Shift 点远处一行，`allPaths` 已换成**全树行序**，同一手势从「选 3 行」变成「选几千行」——一次 Shift 吞掉整个仓库，随后任何批量操作（删除/回收/重命名）的作用域都失控。现超过上限**拒选**并 toast 引导改用「全选」（**不静默截断**：截断会让选中集合与视觉区间不一致，比拒绝更坏），锚点 `lastKey` 不被改写（用户可重新定点后再小范围 Shift）。回归锁：`events.test.ts` 两例——跨度 501 拒选 + 选中集与锚点不变；跨度恰为 500 照常选中（边界不误拒），变异验证：阈值调大即转红
- **⚠️ 挂账：排序方向切换（升/降序）未实现，勿在文档里承诺（2026-10-15 锐评考古）**：排序下拉只选「按什么排」，方向**固定**——名称恒升序，size/date 恒降序（`render.ts|compareTreeChildren` 无 reverse 分支，`TreeState` 无 `sortDir` 字段）。`docs/guide/repository.md` 曾在一次「新手友好」文档改造（2026-08-15）**凭空写入**「点两次同一种排序可以反序」——而当时的控件已是原生 `<select>`（3 个 option），该功能**从未实现**（非回归、非被删功能；且原生 select 选同一项不触发 `change`，「点两次反序」这一交互本身无法承载）。已删该承诺、指南改为描述事实并指向本挂账条目。**能力需求保留在此**：实现须新增方向控件（`<select>` 承载不了）+ 图标 + i18n×3 + 定「目录是否随方向反序」语义 + 指南改写；新增 2D 工具栏控件前先确认 AGENTS 的「新增 UI 须可被 MenuNode schema 调用」是否适用于非 3D 工具栏。教训：**指南承诺没有机器闸**（`check-knowledge-drift` 只看 frontmatter 符号存在性），描述性承诺只能靠人肉核对——写指南时勿描述未实现的行为
- **拖拽移动的在途判据 = 三锁单点 `_repoOpBusy()`（锐评 2026-10-15 修正）**：`index.ts|_treeMovePayload` 的注释原本就写着「busy 拒绝（导入链/批量链在途）」，但实现**只查了 `_deleteLock`**（批量删除）——两条**最长**的批量链（文件夹批量启禁 `toggleFolderBatch`、整库启停 `runBatchToggle`）走 `_toggleLock`，完全没查；`_moveLock`（移动途中再起拖）也没查。并发后果：两条链的 IPC 打同一文件，`fileops.opMu` 串行化后总有一方拿到旧路径（另一方已改名加 `.disabled` / 已搬走）→ 部分失败 + 困惑 toast。现收敛为 `_repoOpBusy()` 单点（三把锁同答，均实例级 + try/finally 故不泄漏）。回归锁：`index.extra.test.ts` 两例（空闲时锚行在/不在选中集 → 全集/单行；三把锁逐一在途 → 均不起拖、释放即恢复），变异验证：判据退回只查 `_deleteLock` 即转红。⚠️ **同族未治（挂账）**：① **导入链**的 busy 锁建在 `import-dnd.ts|bindTreeDnD` 闭包内、对 app-tree 不可达，要覆盖须改其签名（共享/注入锁）；② **批量重命名**（`runBatchRename`）与**整目录回收**（`atBeHandleDirRecycle`）两条长链**不持任何锁**，同类并发风险仍在。长治方向 = 让全部仓库长操作共用一个「在途」原语，届时本判据改为问那一个原语（勿再逐锁手抄）
- **⚠️ 排序切换本身不清选中，且这【不是】缺陷（2026-10-15 锐评自纠）**：`lastKey` 与 `selectState.keys` 跨搜索/排序存活是**刻意**行为（键是磁盘路径，重排不使其失效）。排序后 Shift 是**在新序下重新取区间**——与 Windows 资源管理器同语义（先选一段、重排、再 Shift 扩展），并非「延续旧选择」的错误。锐评初版曾把它列为 P2「选择语义漂移」，复核后**降级为非缺陷、不改**（改成「排序即清选中」反而会删掉一个有用行为）。真正的风险面是「搜索态选完后清词再 Shift 会横跨全树」，已由 `SHIFT_RANGE_MAX` 上限守卫封住
- **树内拖拽移动双通道契约（ADR-336，2026-10-13 落地）**：①**分流唯一判据 = `dataTransfer.types`**——应用内拖源 `move-dnd.ts|TREE_MOVE_MIME`（`application/x-ysm-tree-move`）与 OS 文件导入（`Files`）互斥；`onDrop` 的 types 守卫**前置**（非本通道零开销早退，也不触碰 `getData`——测试桩未必实现完整 DataTransfer 接口）。②**document 层 shadow 拖拽判定一律 `composedPath()[0]`（`move-dnd.ts|innerTargetOf`），禁裸 `e.target`**——composed 事件冒泡到 document 时 target 被 retarget 成 shadow host（e2e 实证：target 恒 APP-CONTENT），行信息只在 composedPath 首元；import-dnd 的 `isInTree` 用 composedPath 即同因，此为跨双通道公共契约。③执行链 `index.ts|_executeTreeMove`：自反过滤（绝对父目录 == filesRoot+targetDir → no-op 静默跳过）→ `batchAllSettled` 批量 `MoveModelFile` → 乐观重算 `move-dnd.ts|computeMovedEntry`（正斜杠归一，ADR-222 key 同形）+ 代际守卫 → `_load` reload 校正 → 选中清空（移动后旧路径失效，防批量误删）+ toast。④Files 类型仅在 dataTransfer 真含 File 时出现（空 DataTransfer 的 types 为空——e2e 构造 Files 拖源必须 `items.add(new File)`）。回归锁：`move-dnd.test.ts` 17 例（分流/防伪载荷/自反/乐观重算）+ `e2e/tree-move.spec.ts` 5 例（实参/互斥双例/视觉态/自反 no-op）
- **⚠️ 分流判据必须【两侧】都有，缺一侧即回归（锐评 2026-10-13 P0-1）**：两链的 `dragover`/`drop` 都注册在 `document`（WebView2 shadow drop 限制的同款绕道），而 `addEventListener` **不阻止同一事件的其它监听器执行**、`preventDefault()` 也只影响默认动作——故「谁在树内落手」并非单一归属。ADR-336 初版只给 `move-dnd.ts` 三处加了 `TREE_MOVE_MIME` 早退，`import-dnd.ts|onDrop` 只有 `isInTree` 判定：纯应用内拖源的 dataTransfer 不带任何文件，被下游 `handleTreeDrop` 的「收集 0」分支无条件判成失败 ⇒ **每次树内移动都并排弹出「未检测到支持文件」与「移动成功」双 toast**（另经 `AddOpLog` 往环形日志写噪声记录）。现两侧判据共用 `move-dnd.ts|isTreeMoveDrag` 单一事实源（**禁各写一份**），`dragover` 同步早退（否则导入遮罩与 `.droppable` 会在移动拖拽期间闪现）。回归锁：`import-dnd.test.ts`「双通道分流」组 3 例——移动 MIME 不导入/不提示/启停链锁不占用（判别样本）、Files 拖源照常走（**对照样本，缺则早退可能误伤真实导入**）、`-v2` 前缀相近 type 仍走导入（`isTreeMoveDrag` 精确匹配语义的对侧样本）；三例均经变异验证（撤守卫即转红）
- **「📂 打开文件夹」/「📁 导入文件夹」Android 双端桥（ADR-046）**：两按钮均不可调 Wails Dialog（`SelectDirectory`/`OpenFolder` 在 Android 由官方/Go 守卫报错）——Android 分支统一走 `resolveAndroidRepoDir()`（directory-picker.ts，授权引导 + 定位公共仓库目录 + toast 提示路径），桌面行为不变
- 使用 Shadow DOM 隔离样式
- 组件拆分遵循 app-xxx 规范（index/tpl/row-tpl/data/render/events）
- 动态 import 链路带 `.catch` 兜底（如 ha-preview 解析模块加载失败以 toast 提示，见 events.ts）
- **事件层 toast/弹窗文案全量 i18n（2026-08-31）**：`events.ts` / `bus-handlers.ts` / `toolbar-events.ts` / `toolbar-search.ts` / `index.ts` / `render.ts` 53 处裸中文收敛到 `tree.*` key（含复用 `ctx.busyWait`/`ctx.renameFail`/`ctx.fileRecycleTitle` 与既有 `tree.recycled`/`tree.dirEmpty`/`tree.noAuthor`/`tree.copied`/`tree.browserFailed`/`tree.inputNewFolder` 等）；新增 key 集中在 zh-CN.ts 的「文件树动作 toast/弹窗」注释段，改动 UI 文案只改三语言包即可
- **选中态在数据变更链路（回收/重命名）成功后必须清空**（P2 修复：`selectState` 是模块级单例，bus-handlers 的 dir:recycle / batch:rename / dir:batch-rename 成功后清 keys+lastKey；2026-09 补漏 `events.ts` 内联重命名成功链——原漏清导致旧路径滞留显示「已选 N 个文件」并对已不存在路径误删）。全部链路：bus-handlers 三条 + events.ts 内联重命名 + index.ts _deleteSelected
- **重命名 Escape 取消不得误保存（P1 修复 2026-09）**：`events.ts` rename keydown Escape 分支原直接 `_renderTree()`——聚焦的 `.rename-inp` 被 DOM 移除时 Chromium 同步派发 focusout（冒泡到 container）→ 走保存链，用户按 Esc 想放弃却把改动写盘。修复：Escape 先置 `inp.dataset.cancelRename="1"` + `value=""`（双保险），focusout 分支查标记跳过保存。回归测试在 `events.test.ts`（模拟真实 DOM 重建 + 手动派发 focusout 断言 RenameFile 不被调用）——原测试 mock `_renderTree` 不重建 DOM 故假绿，勿回退到裸 `_renderTree()`
- **instance-actions 契约口径（2026-08-09 收敛）**：① 同步键口径 = Go `sync_push.go` `SyncCustomToRepo` 的去重规则（Hash 优先 + 原始 Name 兜底、复制保留相对路径）——前端**不**自行按 `.ban` 剥离裸名 Set 计数，`uploaded` 直接信任 Go 返回值（单一事实来源，防「📤 N」撒谎/漏同步）；② `AddImportLog` 调用源在 `features/sync.ts`（`registerSync` 内，原 `instance-actions.ts` 模块已删除，知识卡保留此标注供追溯）；sourcePath=源、targetDir=目标，调用方不得装反/漏传

## 相关

- `frontend/src/utils/dom/display.ts` — 文件名渲染
- `frontend/src/views/app-tree/` — 组件目录
- 批量启用/禁用按钮图标：`icon` 填**语义名**（`enableAll` / `disableAll`），经 `resolveIcon()` 取 `UI_ICONS` 的 SVG（原 `ICON_KIT` 多源中介层已于 2026-09 并入 `UI_ICONS`，见 ADR-248 §3）