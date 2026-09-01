---
kind: app-tree
name: 资源树 app-tree
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-tree/index.ts
  - frontend/src/views/app-tree/
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
pitfalls:
  - bus 订阅未进 _unsubs → 组件卸载后监听泄漏；必须经 bindBusEvents 返回的 unsub 数组收集
  - DOM 委托事件进 _unsubs → disconnect 时重复 off 报错；DOM 委托事件应靠 ShadowRoot detach 自动清理

use_when:
  - 树形
  - 资源列表
  - tree
  - 节点
  - 树
  - 目录树
invariant_anchors:
  - frontend/src/views/app-tree/bus-handlers.ts|selectState
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

- `AppTree` 生命周期：`connectedCallback`（渲染布局 → 绑定工具栏/事件委托/键盘 → `_unsubs` 收集 bus 订阅）→ `disconnectedCallback`（清理订阅 / keydown / 虚拟滚动）
  - `_unsubs` 仅收集 bus 订阅（`bindBusEvents` 返回的 unsub 数组 + `bus.on("tree:set-search")`），DOM 委托事件（click/contextmenu，通过 `addEventListener` 绑定于 `#tree` 等容器）随 ShadowRoot detach 自动清理，不进入 `_unsubs`
- `_load` — 加载条目数据；`_renderTree` — 渲染树（grid/list 双模式）
- 搜索状态：`_search`（关键词字符串）和 `_filterPaths`（精确路径 Set）共同驱动树过滤
- **ADR-147 已落地（2026-09-01）**：`_typeFilter` 死字段已移除——原「按资源类型过滤」字段从未被生产代码赋非空值，仅测试自证用例写入；12 处读取点（bus-handlers 6 + events 2 + index 4）三元简化为 `_rootAttr || RESOURCE_TYPES.YSM`，`_rootAttr`（root 属性）是唯一 rtype 来源；`index.extra.test.ts` 自证用例删除；新增 `tests/test_private_access_contract.ts` 孤儿守卫：测试引用已删除的私有字段（无类声明且非 `_vsRows` 白名单）即红，防「删字段漏清测试」漂移

### 搜索过滤与渲染管线

搜索过滤在 `render.ts` 的 `buildTree` 函数中实现，两条过滤路径为 **AND 关系**：

1. **`_search`（关键词匹配）**：`trim().toLowerCase()` 后按 `relPath.includes(query)` 匹配模型路径（非仅文件名），匹配结果目录自动展开
2. **`_filterPaths`（精确路径交集）**：按 `fullPath` 精确匹配 Set，来自高级筛选弹窗的标签 ∩ 搜索条件交集

渲染时，搜索态走 `hl(e.name, search)`（utils/dom/html.ts）高亮命中文字，非搜索态走 `renderDisplayName()`（治理红线 4.3）。
- **MMD 子目录分组展示（ADR-096 P3）**：`loader.ts` 的 `loadEntries` 在加载 MMD 类型扫描结果时，若 `ModelEntry.subdir` 非空（如 `SceneModel`），拼接到 `relPath` 前缀，文件树自动按子目录分组（无需改 `render.ts` 建树逻辑）；网页版 `scanWebModels`（`backend/web-fs.ts`）同步从 `name` 字段提取 `subdir` 字段
- `_initKeyboardShortcuts` / `_deleteSelected` — 键盘快捷键 / 批量删除
- **3D 全屏快捷键门禁（2026-08-29）**：`_onKeydown` 开头检查 `document.getElementById(PREVIEW_OVERLAY_ID)`（`ui/ui-constants.ts` 常量的 `ysm-overlay-3d`，与 mount-preview-core overlay 同源）——3D 全屏打开期间树面板不接管任何全局按键（Ctrl+F 不抢焦点、Delete 不误删选中模型、方向键不与 3D 相机平移冲突）；overlay 移除后快捷键恢复
- 子模块：`bus-handlers.ts`（事件处理）/ `events.ts`（委托）/ `virtual-scroll.ts`（虚拟滚动）/ `loader.ts`（数据加载抽象层）/ `authors.ts`（作者列表加载）/ `toolbar-events.ts`（工具栏 UI 绑定）

### 渲染性能要点（2026-08-24）

- **搜索输入 debounce 150ms**（`toolbar-events.ts`）：`input` 事件里 `_search` 立即更新（后续其他渲染读取到最新值），仅 `_renderTree` 延迟合并——万级条目打字不再每字符全量 buildTree+渲染。测试用 `vi.useFakeTimers()` + `advanceTimersByTime` 推进。
- **文件夹启禁用短路判定**（`render.ts` `hasFlag`）：文件夹行的 `hasEnabled/hasDisabled` 用短路递归（命中即停、不建数组）替代 `dirEntries().some()`——旧实现为算两个布尔对每个文件夹递归展开全子树，深层嵌套 O(n·depth)。行为不变（ckCls：全启 `" on"`、混合 `" on partial"`、全禁空）。
- **方向键导航（P2 观察）**：`selectSingle` 后仍全量 `_renderTree`，但行 HTML 预缓存 + 可见区 slice<100，实际开销低，未优化。

## 响应式属性与代际守卫

- `observedAttributes` 仅声明 `root` 属性，`attributeChangedCallback` 响应 root 值变更，触发 `_load` → `_renderTree` 重新加载并渲染
- 挂载时序保护：`_ready` 标志区分首次挂载与后续属性变更——`attributeChangedCallback` 在 `_ready=false` 时不启动加载，改为置 `_pendingRoot=true`，`connectedCallback` 的 `_load` 完成后检测并补加载最新 root（防「树停在 spinner」）
- 代际守卫 `_gen`：`connectedCallback` 入口和 `attributeChangedCallback` 内均 `++_gen` 生成代际号；异步 `_load` 完成后用 `gen === this._gen` 校验，若期间 root 已切换则丢弃本次过期加载的渲染（防旧类型数据覆盖新类型树），是 app-tree 多资源类型快速切换的核心机制

## 工具栏功能（toolbar-events.ts）

`bindToolbarEvents`（toolbar-events.ts）绑定工具栏所有 UI 入口，对外功能清单：

| 功能 | 触发元素 | 说明 |
|------|----------|------|
| 高级筛选弹窗 | `#btn-adv-filter` 点击 → `openAdvFilterDialog`（toolbar-search.ts） | 弹窗输入关键词/标签/骨骼/立方体/纹理数值范围，回填 inline 面板并调用后端 SearchModels |
| 排序下拉 | `#sort` change | name/size/date 排序 |
| 视图模式切换 | `#btn-view-mode` click | grid ⇄ list 切换，持久化到 localStorage |
| 作者下拉菜单 | `#menu-authors` pointerenter/click → `fillAuthorMenu` | 点击作者名自动填入搜索框并触发搜索 |
| 全选 / 反选 | `#sel-all` click | 基于当前可见行切换 `selectState.keys` |
| 导出骨骼名 | `#repo-export` click | 调用 Go `ExportBoneStructures`，Blob 下载 |
| 生成仓库索引 | `data-more="genindex"` | 调用 Go `GenerateRepoIndex`，网页版触发下载，桌面端写盘 |

`_loadAuthorsAsync` 在 `connectedCallback` 内延迟调用 `loadAuthors` 加载作者列表至 `_authors`，供 `fillAuthorMenu` 填充下拉。

## 与其他子系统关系

- `app-content/`: 选中节点内容在 content 区域渲染
- `app-sidebar/`: 侧栏面板状态联动
- `core/context-menus.ts`: 右键菜单事件路由
- 通过 bus 发出节点选择事件

## 不变量

- 文件名显示统一走 `renderDisplayName()`（治理红线 4.3）；搜索态走 `hl(e.name, search)`（utils/dom/html.ts，同源转义但美化样式在搜索时丢失——P3 观察）
- **「📂 打开文件夹」/「📁 导入文件夹」Android 双端桥（ADR-046）**：两按钮均不可调 Wails Dialog（`SelectDirectory`/`OpenFolder` 在 Android 由官方/Go 守卫报错）——Android 分支统一走 `resolveAndroidRepoDir()`（directory-picker.ts，授权引导 + 定位公共仓库目录 + toast 提示路径），桌面行为不变
- 使用 Shadow DOM 隔离样式
- 组件拆分遵循 app-xxx 规范（index/tpl/row-tpl/data/render/events）
- 动态 import 链路带 `.catch` 兜底（如 ha-preview 解析模块加载失败以 toast 提示，见 events.ts）
- **事件层 toast/弹窗文案全量 i18n（2026-08-31）**：`events.ts` / `bus-handlers.ts` / `toolbar-events.ts` / `toolbar-search.ts` / `index.ts` / `render.ts` 53 处裸中文收敛到 `tree.*` key（含复用 `ctx.busyWait`/`ctx.renameFail`/`ctx.fileRecycleTitle` 与既有 `tree.recycled`/`tree.dirEmpty`/`tree.noAuthor`/`tree.copied`/`tree.browserFailed`/`tree.inputNewFolder` 等）；新增 key 集中在 zh-CN.ts 的「文件树动作 toast/弹窗」注释段，改动 UI 文案只改三语言包即可
- **选中态在数据变更链路（回收/重命名）成功后必须清空**（P2 修复：`selectState` 是模块级单例，bus-handlers 的 dir:recycle / batch:rename / dir:batch-rename 成功后清 keys+lastKey——原旧路径滞留会显示「已选 N 个文件」并对已不存在路径误删）
- **instance-actions 契约口径（2026-08-09 收敛）**：① 同步键口径 = Go `sync_push.go` `SyncCustomToRepo` 的去重规则（Hash 优先 + 原始 Name 兜底、复制保留相对路径）——前端**不**自行按 `.ban` 剥离裸名 Set 计数，`uploaded` 直接信任 Go 返回值（单一事实来源，防「📤 N」撒谎/漏同步）；② `AddImportLog` 调用源已迁移至 `core/handlers/sync.ts`（原 `instance-actions.ts` 模块已删除，知识卡保留此标注供追溯）；sourcePath=源、targetDir=目标，调用方不得装反/漏传

## 相关

- `frontend/src/utils/dom/display.ts` — 文件名渲染
- `frontend/src/views/app-tree/` — 组件目录