# ADR-310：整合包同步计数口径统一

- **状态**：✅ 已采纳（Accepted，2026-09-25；用户「继续」拍板开工）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-25
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/knowledge/go-sync.md`、`docs/knowledge/app-sidebar.md`、`docs/knowledge/app-sync-manager.md`、`go/sync/sync.go`、`go/instance/instance.go`、`frontend/src/views/app-sidebar/loader.ts`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

### 1.1 两条计数链并存，用户可见数字分叉

整合包管理页有**两套「同步状态计数」消费端**，各自走一条独立的 Go 链：

| 端 | 消费 UI | 绑定入口 | 底层对比 | 输出形态 |
|---|---|---|---|---|
| 侧栏卡片三徽章 | app-sidebar | `GetResourceInstanceStatus` | `go/sync` `GetInstanceStatusWith` → `compareHashMode`/`compareRelKeyMode` | 每实例三个数（synced/missing/extra） |
| 同步面板六 tab | app-sync-manager | `GetInstanceSyncStatus` | `go/instance.BuildSyncItems` → `SyncResourcesDirLevelScan`/`SyncResources` → `ResourceDiff` + `resolveItemMeta` + `aggregateStatus` | 逐条目六态树（synced/missing/disabled/optional/legacy/diverged） |

两条链**不共享任何 diff 实现**，唯一交集是 `scanner` 的 30s TTL 缓存。侧栏链是前 ADR-064 时代的布尔集合运算，面板链是 ADR-064 之后持续投资的三桶 + 六态方向（dirLevel 单点 diff、`nestDirLevelTree`、子项级 diverged）。

### 1.2 七类必然不一致 + 四类条件性不一致（2026-09 子代理审计实证）

**结构性（同一磁盘状态必然不一致）**：

- **S1 方向性相反（最严重）**：hashable 类型的实例文件被用户改过内容——侧栏哈希不中 `ByHash`/`BannedHash` → 计 **extra（橙「可拉取」）**；面板同键异哈希 → `ResourceDiff` 判入 `Missing` → **missing（红「待推送」）**。**同一个文件，侧栏引导「拉下来覆盖你的修改」，面板引导「推上去」——修复暗示相反**。
- **S2 计数单位不同**：侧栏按文件（哈希模式）或 relKey（带扩展名）；面板 dirLevel 按模型文件夹（`relKeyDirLevel` 剥扩展名 + 目录键）。仓库 `A/char.pmx` vs 实例 `A/char.pmd`：侧栏 missing=1+extra=1，面板父 synced。
- **S3 MMD 聚合层分叉**：侧栏在前端做 `groupMmdVariants`（Missing 按父目录去重、Extra 按 basename 去重，两集合无配对）；面板由 Go dirLevel 聚合（键集天然配对）。多级目录时两侧组数发散。
- **S4 disabled 蒸发**：实例侧 `.ban` 文件——relKey 模式剥后缀命中键 → **计成 synced**；hash 模式 `Disabled` 桶有值但 `loader.ts` 硬编码 `disabled: 0` 整体丢弃。面板有 disabled tab 计数。侧栏三徽章无 disabled 位。
- **S5 大文件隐形**：>500MB 跳哈希（scanner 既定口径）→ 侧栏 `compareHashMode` 对空哈希条目**整体跳过**（synced/missing/extra 都不计），该文件在侧栏任何徽章下不存在；面板 `contentDiffers` 回退比 Size → 计 synced、列表可见。
- **S6 diverged 归属**：面板 `tabStatus` 把 diverged 折叠进 missing tab（红）；侧栏无 diverged 概念，内容分叉被 S1 吞成 **orange extra**——颜色与语义双反。
- **S7 relink 备份尸体**：`.recycle` 之外的备份目录残留，两端都脏但脏法不同（依赖哈希命中与否）。

**条件性**：legacy（硬链接）面板单列、侧栏计 synced；仓库目录级 `.ban` 文件夹面板嵌套回退 Walk 不排禁用目录；面板多叠 `syncItemsCache` 一层、写操作后 30s 窗口可闪不一致。（正面确认：`FindInstDir` 目录解析层两端同入口，不产生分歧。）

### 1.3 文档零覆盖与「有意差异」豁免边界

grep `docs/adr` + `docs/knowledge` 全量：**没有任何 ADR/知识卡记录「两端数字会不一致」**。ADR-064 §2.4 的「保留两条对比策略属有意差异」只豁免了**对比算法选型**（哈希 vs 文件名+大小），未豁免**聚合粒度、disabled 呈现、diverged 归属、计数单位**四个维度——后者正是 §1.2 的失配来源，且容易被误读为「计数口径已整体豁免」。

## 2. 决策（Decision）

**计数口径以面板链为单一事实源，侧栏向面板收敛。分两层，不推倒重来：**

1. **数据层（Go）**：`go/instance` 新增薄计数入口（暂名 `BuildInstanceStatusCounts`），逐实例输出 `{synced, missing, extra, disabled, diverged}` 五个数——内部**复用面板既有产物**（`SyncResourcesDirLevelScan`/`SyncResources` + `resolveItemMeta` 三桶 + 与 `tabStatus` 同一条折叠规则），替代侧栏链 `compareHashMode`/`compareRelKeyMode` 的私有集合运算。`GetResourceInstanceStatus` **签名不变**（仍返回 `types.InstanceStatus[]`），只换内部实现；其 `Missing` 路径清单消费者（`sync:download:missing` 一键安装）保持可用——计数与清单可同迭代产出。
2. **展示层（前端，零新增徽章位）**：`loader.ts` 消费 `Disabled` 字段（废除硬编码 `disabled: 0`）；diverged **学面板 `tabStatus` 折叠进红徽章**（红=有待推送差异含分叉，橙=纯实例独有），不补第四色。三徽章的 title 语义锚点（已落地）与折叠后口径天然对齐。
3. **保留不并**（承 ADR-064 §2.4，本 ADR 不翻案）：两条对比**算法**（哈希 vs relKey/Size）仍是两条——只是让两条策略喂给两端的数字**先经过同一个聚合器折一次**。聚合粒度、disabled 呈现、diverged 归属、计数单位四个维度自本 ADR 起归面板口径统一。
4. **禁止反向收敛**：不把六态树直接搬进侧栏徽章（徽章语义越简单越好），不借本 ADR 给侧栏补第四徽章位。

**理由**：面板链信息严格更富（六态 ⊃ 三态、dirLevel 配对聚合、Size 回退不隐形大文件），侧栏缺的每一维都是它的子集；反向收敛等于扔掉 ADR-064 之后的全部投资。S1 的「双端相反暗示」是用户可感知的正确性事故，修复方向唯一：让侧栏看见与面板相同的判定。

## 3. 后果（Consequences）

**正面**：
- S1/S2/S3/S5（+S7 大半）五类结构性差异随「同一份键集 + 同一套三桶 + 禁用判定」消灭；S4 靠消费 `Disabled` 止血；S6 靠统一折叠规则消解。
- 侧栏徽章第一次有了 disabled 语义（此前 relKey 模式把 `.ban` 计成 synced，属正确性 bug 而不仅是口径差）。
- MMD 组聚合从**前端本地重算**（`groupMmdVariants`）回归 Go——对齐根 AGENTS「筛选/去重/聚合归 Go」职责红线。

**负面 / 代价**：
- 侧栏徽章数字会**系统性变化**（用户可见）：文件数 → 模型/文件夹单元数、大文件从隐形变计入、`.ban` 从 synced 移出。需在 release note 说明，避免「数字变了=又坏了」的观感。
- `BuildInstanceStatusCounts` 逐实例跑 dirLevel 扫描，侧栏 `loadInstances` 的全量成本上升——依赖 scanner 30s 缓存 + `syncItemsCache` 命中兜住；落地时实测多实例（>10）首帧延迟，必要时把五计数折叠并入一次扫描产出（`InstanceStatus` 已有扩展位，签名不变）。**落地记录：薄入口直接复用 `BuildSyncItems` 产物与缓存（不另起扫描/缓存层），折叠本身是内存操作，故无需「并入一次扫描」的分支**。
- 一键安装消费的 `Missing` **文件路径清单**（前端 `features/sync/sync.ts` `runDownloadMissing` 逐条装缺失文件）需保持与旧 `compareHashMode` 输出**同为文件路径**的语义——面板 dirLevel 的 missing 是文件夹单元，落地时需在薄入口里决定清单口径（建议：保留文件级清单 + 计数走聚合，或一键安装改走面板条目流）。**本 ADR 不预设，实施时补决策记录。**
  - **落地决策（2026-09 实施，采纳「保留文件级清单 + 计数走聚合」）**：计数为**顶层展示单元**（dirLevel 模型夹 / fileLevel 文件，不递归 children）；`Missing` 清单由待推送单元的 children（或整夹缺失时 `DiffFolderContents`）展开为**仓库侧文件级绝对路径**，`runDownloadMissing` 逐条 `installer.Install` 的行为零变化。代价与护栏：`len(Missing) > MissingCount` 是**预期**（一个缺夹 → 多条文件路径），故计数新增独立字段 `InstanceStatus.MissingCount`（含 diverged 折叠），前端徽章只认它、不得再用 `array.length`；该粒度差已在 `go/instance/status_counts_test.go` 双向钉死（单元 1 / 清单 2 同测例）。
- 迁移既有测试：`go/sync` 侧 `GetInstanceStatusWith` 系单测断言点从私有集合运算迁移到新入口。

**已知遗留（本 ADR 不解决）**：
- P3 失效时序双缓存闪窗（30s 内可闪不一致）——收敛后仅剩「缓存刷新先后」一类时序噪声，无结构差异，暂不处理。
- 同步面板自身 `collectCounts` 对 dirLevel 树**父单元与子文件重复计数**（徽标数=可见行数，与列表自洽但与侧栏「单元数」不可比）——收敛后侧栏数可能小于面板 `total`，属展示口径差，记录在案不动。

## 4. 数据溯源

- **来源**：2026-09-25 子代理只读审计（`GetResourceInstanceStatus` vs `GetInstanceSyncStatus` 全判定链逐行核对，见本会话报告），关键锚点：`go/sync/sync.go` `compareHashMode`/`compareRelKeyMode`（哈希 miss → extra 判定的全链）、`go/sync/sync_diff.go` `ResourceDiff`/`contentDiffers`（同键异哈希 → Missing）、`go/instance/instance.go` `BuildSyncItems`/`resolveItemMeta`/`aggregateStatus`（六态与父+子计数）、`frontend/src/views/app-sidebar/loader.ts`（`groupMmdVariants` 前端聚合、`disabled: 0` 硬编码）、`frontend/src/views/app-sync-manager/store.ts` `tabStatus`（diverged→missing 折叠先例）。
- **佐证**：ADR-064 §2.4「保留两条策略」豁免范围（本 ADR §1.3 划界）；`docs/knowledge/app-sidebar.md`（徽章链）、`app-sync-manager.md`（面板链）各自成文互不提及。
- **既有修复铺路**：徽章 title 语义锚点 + `✓` 徽章（提交 `1f3c44d5b`）、`GetInstanceSyncStatus` rtype 路径限定死代码接线（提交 `531cd78a6`）——均在计数收敛前把两端的**输入正确性**钉牢，本 ADR 实施时不必回头再查。
