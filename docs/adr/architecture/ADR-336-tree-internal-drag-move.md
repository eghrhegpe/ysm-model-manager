# ADR-336：仓库树内拖拽移动（tree 内部 move）替代右键弹窗整理

- **状态**：📝 提议中（Proposed）
- **日期**：2026-10-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：模型仓库核心组织操作（按作者/作品归目录）现为右键弹窗手输路径的多步流，拖拽移动是行业默认心智；实现跨 DnD 基建复用、虚拟滚动行定位、乐观更新与 recycle/回收站四域，方向选定后不可低成本逆转
- **相关**：`frontend/src/features/dnd/import-dnd.ts`、`frontend/src/features/dnd-collector.ts`、`frontend/src/views/app-tree/events.ts`、`frontend/src/views/app-tree/index.ts`、`frontend/src/views/app-tree/app-tree-styles.ts`、`frontend/src/views/app-tree/entry-key.ts`、`frontend/src/features/import/executor.ts`、`docs/knowledge/app-tree.md`、`docs/knowledge/global-handlers.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

### 1.1 现状：整理 = 右键 + 弹窗 + 手输路径

仓库树是模型文件的**组织界面**——按作者/作品建目录归类是最高频的整理操作。现行路径（`docs/guide/repository.md` FAQ 明示）：

1. 右键文件 →「📂 移动到…」
2. 弹窗**手输目标文件夹名**（如 `[作者名]`；不存在会自动创建；禁 `..` 与绝对路径）
3. 确认 → `MoveModelFile` IPC → reload

对「把 10 个模型归到 `[某作者]` 文件夹」这种批处理心智，每一步都在对抗直觉：先选中、再右键、再打字、再确认——**目录结构已经可视化在树里，却不能把文件拖过去**。`docs/guide/repository.md` 自认「树节点不支持拖拽移动」，2026-10-13 模型仓库锐评将其列为 P1-3 产品缺口。

### 1.2 已有基建（锐评后的余粮）

2026-10-13 锐评修复批已把树的可复用资产补齐，本 ADR 是**它们的自然延伸**而非从零起灶：

| 资产 | 现状 | 对本 ADR 的意义 |
|------|------|----------------|
| OS 文件拖入导入（`features/dnd/import-dnd.ts|bindTreeDnD`） | 已上线，document 层监听（WebView2 shadow 内 drop 限制的绕道）+ `.droppable` 可放置态 + hint 收口单点 `hideHint()`（2026-10-13 加） | **双通道拖拽的分流基础**：`dataTransfer.types` 含 `Files` = 外部文件（导入）；应用内拖源走另一 `types` 标记（如 `application/x-ysm-tree-move`）即天然互斥 |
| 行选中高亮（`render.ts` 数据渲染唯一出口） | 已接线（f4d590e12 断链根治，`.selected`/`aria-selected` 由 `selectedKeys` 驱动） | 拖拽锚行 = 键空间契约（ADR-222 `entryKey`）现成；拖拽预览态走同一渲染管线加 `dragging`/`drop-target` 类，**不再手写 classList**（pitfalls #28 教训的正面应用） |
| `.droppable` 视觉反馈 | 已上线（accent 虚线 outline + 内发光，摘除单点 `hideHint`） | 文件夹行的 drop-target 高亮是同款范式的行级化 |
| 乐观更新范式（`events.ts` 单文件开关） | 已上线（本地翻位 + 后台 reload 校正 + 代际守卫回滚） | 移动成功后本地改 `entry.path`/`fullPath` 即时反馈的标准范式 |
| 批量并发（`utils/async/batch-all-settled.ts`） | 已收口（rejected[].index 原下标归因） | 多选拖拽 = 批量 MoveModelFile 的现成载体 |
| 回收站（`MoveToRecycle` 链） | 已上线 | 覆盖被移动目标（同盘 fs.Rename 语义）失败时的兜底语义（见 §2.5） |

### 1.3 为什么要立 ADR 而不是顺手做

三重不可逆 + 一重语义冲突：

1. **双通道拖拽分流**是结构性决策：`bindTreeDnD` 现在只认 `Files`，加入应用内拖源后，「拖 OS 文件」与「拖树行」在 dragover/drop 两端都要分流判定，判定写错一处 = 用户拖文件导入被当成移动（或反之）——数据后果不可逆
2. **虚拟滚动下的拖拽定位**（dragover 时 auto-scroll、行命中判定走 `getVsRows` + 行高）是纯新增交互面，与既有滚动同步（`installScrollSync`）有叠加时序
3. **与 DnD 导入的交互语义**（拖 OS 文件悬停在文件夹上 = 导入到该子目录还是仍入根？）是产品级拍板项

## 2. 决策（Decision）

### 2.1 双通道分流：types 标记互斥

- **应用内拖源**：`dragstart` 时 `dataTransfer.setData("application/x-ysm-tree-move", JSON.stringify({ paths: string[], anchor: string }))`；`effectAllowed = "move"`
- **外部文件导入**：现状不变（`types` 含 `Files`）
- **分流判据（唯一）**：dragover 时 `types.includes("application/x-ysm-tree-move")` → 树内移动态；`types.includes("Files")` → 导入态；两者互斥（浏览器保证应用内 setData 的自定义 type 不携带 Files）。
- 树内移动态下 `bindTreeDnD` 的导入链**短路早退**（不显 hint、不加 `.droppable`），改由移动链接管高亮——两条链的事件监听各自独立绑定，靠 types 判定互斥，**不共享 busy 锁之外的状态**

### 2.2 拖源与命中目标

- **拖源 = 文件行**（`.fl`/`.fl-list`）：单行拖 = `entryKey(e)`；多选中拖 = `selectState.keys` 全集（锚行必须在选中集内，否则退化为单行）。文件夹行不可拖（目录移动牵连 storageSubDir 路由与 sync 层级，见 §3.4 遗留）
- **命中目标 = 文件夹行**（`.fh`/`.fh-list`）与**树根容器**（根 = filesRoot 顶层）。文件行不是合法目标
- 目标判定：dragover 时 `e.target.closest(".fh, .fh-list")` 取 `data-dir`（树内拼接路径，与 `dirOpen` 键空间同源自洽——ADR-222 的 folder 侧非对称）；无命中 = 根容器

### 2.3 视觉反馈（延续 2026-10-13 A 档范式）

- 拖源行：`dragging` 类（opacity .5），走 `fileRowFromEntry` 数据渲染通道（`selectedKeys` 同款形参扩充，**禁 classList 手写**——pitfalls #28）
- 命中目标文件夹：`drop-target` 类（accent 边框 + 背景加深），同一行级范式；树根目标复用 `.droppable` 现成样式
- `no-animations` 通配桥自动覆盖（app-tree shadow 已 adopt）

### 2.4 执行链：乐观更新 + 批量 + 回收站兜底

1. `drop` → 收集 `{paths[], targetDir}`（targetDir 为树内相对路径，根 = ""）
2. 过滤自反：`entryKey(e)` 与 targetDir 同前缀的条目跳过（拖进自己所在目录 = no-op，静默）
3. 批量 `MoveModelFile(path, targetDir)` 走 `batchAllSettled`（业务差异：失败项收集进 toast 明细，同 dirRecycle 格式）
4. **乐观更新**：成功项本地改 `entry.path`（相对路径重算）+ `fullPath`（`filesRoot` 重拼），`_renderTree` 即时反馈；后台 `_load()` reload 校正（Go 侧 `MoveModelFile` 已挂 InvalidateCache，2026-10-10 配对审计闭环）——与单文件开关同款范式（`events.ts` P1-2），失败项本地不翻 + error toast
5. 代际守卫同款（`_guard.stale` 时放弃本地翻转）
6. 完成后 `sync:toggle:status`（若 YSM）+ `stats:refresh`——移动改变启用集合的归属，与 move/rename 链同口径

### 2.5 安全面（显式不做）

- **不改 Go 绑定**：`MoveModelFile` 现签名（path + 目标目录）已够用；「移动并重命名」不在本期（拖拽 + F2 重命名是两件事，混在一起会把 drop 判定搅成模式机）
- **不跨 rtype 拖**：root 属性即类型边界，`repo:rtype-changed` 切换即清拖拽会话（`dragend` 兜底）
- **不碰回收站路径**：树内移动是 fs 层 `renameForMove`（同盘），不经过 `MoveToRecycle`；「拖到回收站 tab」这类跨页拖拽不做（导航语义拖拽是另一个量级的交互面）

## 3. 后果（Consequences）

### 3.1 正面

- 整理模型从「选中 → 右键 → 打字 → 确认」四步变「选中 → 拖 → 松手」，与 OS 文件管理器心智一致
- 多选批量移动免费获得（`selectState.keys` + `batchAllSettled` 都是现成件）
- 视觉反馈三件套（droppable/drop-target/dragging）统一走数据渲染管线，无 classList 手写债

### 3.2 负面 / 已知风险

- **双通道判定是新的回归面**：`Files` 与 `x-ysm-tree-move` 的分流若被未来改动破坏（如 types 判定顺序调换），错误方向的后果是「导入写成移动」——须在 e2e 双通道各留一例互斥锁
- **虚拟滚动 + auto-scroll**：拖到容器上下边缘时的自动滚动是体感刚需但实现要与 `installScrollSync` 的 rAF 循环协同；首版可不做（用户可先滚后拖），但要在实现时留 hook 位
- **WebView2 shadow drop 限制**：document 层监听 + composedPath 判定的绕道（`bindTreeDnD` 头注）对应用内拖源同样适用，dragover 命中判定须复用 `isInTree` 而非自造
- **folders 不可拖**是功能残缺（用户会试），首版须在 FAQ 与拖拽 hint 文案上显式说明；文件夹拖拽牵连 `dirLevelSync` 层级与 `SubDirMap` 路由，留二期

### 3.3 验收口径（实现完成的定义）

- e2e：单行拖入文件夹 → 行位移 + toast；多选拖 → 批量计数；双通道互斥（拖 OS 文件仍导入、拖树行不触发导入链）；`no-animations` 下无动画但功能完整
- 回归锁：键空间（drop 后 `selectState` 清空——移动后旧路径失效，与 rename 链同口径）、乐观位回滚、代际守卫
- 知识卡：`app-tree.md` 不变量补「拖拽移动三态类（dragging/drop-target/droppable）唯一出口 = 数据渲染」

## 4. 数据溯源

- 来源：2026-10-13 模型仓库功能设计锐评 P1-3（「树节点不支持拖拽移动」FAQ 自认）→ 修复批先补齐基建四件套（选中高亮/droppable/乐观更新/batchAllSettled）→ 用户拍板「立 adr 吧」
- 交互决策参与：用户明确要求拖拽反馈「要有特效」（A 档先行落地于 75b5a60a8），本 ADR 的视觉范式（§2.3）是 A 档的行级延伸
- 方案选型参照：仓内 `pack-dnd`（实例卡片拖拽推送，ADR-130 repo-first）已有「应用内拖源 + 类型标记」先例可对齐

<!-- 文件名: tree-internal-drag-move.md → 实际文件 architecture/ADR-336-tree-internal-drag-move.md（ADR-320 architecture 全量模板） -->
