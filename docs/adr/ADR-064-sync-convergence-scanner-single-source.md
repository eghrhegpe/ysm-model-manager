# ADR-064：同步层对比收敛：scanner 单一扫描源，对比实现单点化

- **状态**：✅ 已采纳
- **日期**：2026-08-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/knowledge/go-sync.md`、`go/sync/sync.go`、`go/sync/sync_hash.go`、`go/sync/sync_dirlevel.go`、`go/sync/sync_push.go`、`go/scanner/scanner.go`、`go/instance/instance.go`
- **后继**：[ADR-310](./ADR-310-instance-sync-count-single-source.md) 明确本 ADR §2.4「保留两条策略」的豁免边界——仅对比算法选型，不含计数聚合口径；计数统一另案裁决

---

## 1. 背景（Context）

### 1.1 四套同步对比逻辑并存，两套自 Walk

同步层存在 **4 套对比逻辑**，扫描方式与对比口径各不相同：

| 逻辑 | 扫描方式 | 对比口径 | 消费方 |
|------|---------|---------|--------|
| `GetInstanceStatus`（sync.go:26-144） | **scanFn（scanner）** | SHA256 哈希 | 侧栏整合包卡片 |
| `CompareGlobalInstanceHashes`（sync_hash.go:47-135） | **scanFn（scanner）** | 文件名 + 大小 | 同步下载 handler（`GetResourceInstanceStatus`） |
| `SyncResources`（sync.go:291-422） | **自 `filepath.Walk`** | 文件名 + 大小 | 同步管理器（`BuildSyncItems`）+ 文件级推拉 |
| `SyncResourcesDirLevel`（sync_dirlevel.go:58-125） | **自 `filepath.Walk`** | 文件夹名 | 文件夹级推拉（YSM/MMD/蓝图） |

仓库树（app-tree）展示走 `scanner.ScanEntries`（递归 + 扩展名过滤 + SHA256 + 30s TTL 缓存），而同步层只有前两套吃了 scanner，后两套**自己重新实现了一遍扫描**——这就是「仓库树是树状的，同步却搞一堆奇葩判断」的直接来源。

### 1.2 同义实现重复（口径漂移的土壤）

- **扩展名过滤 5 处**：`scanner.go:206-217`（内联）、`isSyncAllowed`（sync_hash.go:20-35）、`isModelFile`（sync_dirlevel.go:40-51）、`instance.extMatch`（instance.go:31-50）、`types.IsSupportedExt`。
- **`.json` 特判 4 处**：2 处已收敛到 `types.IsYsmEntryJSON`，另 2 处手写字符串比较（sync_hash.go:26-28、instance.go:41）。
- **文件名归一化 4 处**：`syncNameKey`（sync_hash.go:139-144）、sync.go:353-356 内联、`stripDisableSuffix`（scanner.go:285-294）、instance.go:36-39 内联。
- **`.recycle` 排除 4 处**，且 `SyncToggleStatus` 用 `strings.Contains` 口径更宽（已发现未修）。

### 1.3 手工对齐口径 = 连环补丁的根源

`sync_hash.go:42` 注释明写：*「匹配口径与右侧同步管理器统一为文件名+大小」*——两套逻辑靠**手工对齐**。改 `SyncResources` 忘了同步另一边，或 `SyncResources` 内部加补丁时另一侧没跟上，bug 就来了。近期连环补丁均为其代价：

- **P3 深度守卫**（sync.go:316-349）：Sable Schematics 嵌套 `.nbt` 被全递归收集 → `mapSrcToGlobal` 顶层语义误判越界 → 加"文件级只扫顶层"守卫。
- **P5 pack.mcmeta 门控**（sync.go:324/338/378）：蓝图仓库误放的资源包文件夹被当 missing 显示"推送" → 限定 `detector == "mcmeta"` 才收集。
- **FindInstDir 兜底**（extensions.go）：标准 `schematics` 目录存在但空、实际蓝图在 `Sable-Schematics/` → 识别不到 → 补"标准目录无文件时继续兜底扫描"。

每个补丁都在解决「两套口径不一致」的产物，而非补丁本身该管的事。

### 1.4 必要差异（不可合并，需保留）

- **`scanner.ScanEntries` 只产 `ModelEntry{Name,Path,Size,Hash}`，无层级信息、无 pack.mcmeta 文件夹信号**——`SyncResources` 的深度守卫、资源包文件夹判定、文件夹语义都依赖 `os.FileInfo.IsDir()` + 相对路径计算，这是它必须自 Walk 的**唯一不可替代原因**。
- **`SyncResourcesDirLevel` 文件夹级语义**（"一个文件夹 + 纹理 = 整体"）scanner 无法表达。
- **哈希 vs 文件名+大小**是**有意差异**：`ShouldHashExt` 只对 hashable 类型算哈希（MMD/VRC 大文件跳过），哈希对比对它们恒空，只能走文件名+大小。

### 1.5 现状缺口

现有 ADR（ADR-003 职责下沉、ADR-040 大文件拆分）只做**职责拆分**，从未做**口径合并**——「统一到 scanner + 单点对比」无既有决策背书。

**落地后的已知漏网内联（2026-08-23 审计）**：`sync.go:210`（`strings.TrimSuffix(strings.ToLower(e.Name), ".ban")`——repoName 匹配 key）是归一化收敛后的**新内联**，不在阶段一/二点名的 4 处之内。它与 `NormalizeResourceName` **语义不等价**（后者额外剥 `.disabled`）——直接替换会改变 repoName key 与 banned 匹配行为（「同名不同文件夹」的复制/重命名/匹配消费路径，sync.go:198-215）。**暂不归一**（需先加单测锁定 repoName key 语义，含 `.disabled` 文件的 banned 记录行为）；现状分布与警告详见 [go-sync](../knowledge/go-sync.md) 知识卡。

## 2. 决策（Decision）

**以 `scanner.ScanEntries` 为唯一文件级扫描源，对比实现收敛为单点，分两阶段落地：**

1. **阶段一（文件级对比单点化，无行为变更）**：
   - `SyncResources` 的文件级分支**改吃 scanFn（scanner）**，归并逻辑（文件名 + 大小，`syncNameKey` 口径）与 `CompareGlobalInstanceHashes` **共享同一实现**（抽 `ResourceDiff` 公共函数），彻底消除两套手工对齐。
   - 扩展名过滤/归一化收敛到 `types`：`ResourceFilter(rtype)`（合并 `isSyncAllowed`/`isModelFile`/scanner 内联）+ `NormalizeResourceName(name)`（合并 `syncNameKey`/`stripDisableSuffix`/内联）。
   - 深度守卫（顶层语义）在阶段一**保留原行为**（`ResourceDiff` 接受"仅顶层"选项），不做语义变更。
2. **阶段二（相对路径对比，树状语义，行为变更需门控）**：
   - 文件级对比从「文件名」升级为「**相对路径**」——嵌套文件天然区分、无同名冲突、与仓库树语义一致。
   - `mapSrcToGlobal` 已具备 `filepath.Rel` 相对路径映射（sync_push.go:249-258），直接承接；`PullResources`/`PullSingleResource` 的 `Base()` 落地拼法改为保留层级。
   - **深度守卫随之取消**（阶段一的"仅顶层"选项移除）。
   - 处理 `BuildSyncItems` 兜底 Walk（instance.go:118-169）与层级化 `SyncResources` 的**重复列示**风险（seenNames 去重补全）。
3. **保留** `SyncResourcesDirLevel` 自 Walk（目录级语义 scanner 无法表达），内部判定继续向注册表/`types.IsSupportedExt` 收敛。
4. **保留** `GetInstanceStatus`（哈希）与文件名+大小两条对比策略（有意差异），共享 diff-map 算法骨架。
5. **前端契约不变**：`ResourceSyncItem`/`InstanceStatus` 结构、绑定签名不变则前端零改动（`Path` 字段值域变化属阶段二语义变更，前端无编译错误）。

## 3. 后果（Consequences）

**正面**：
- 消除口径漂移：P3/P5/FindInstDir 这类「两套口径不一致」的 bug 失去土壤。
- 过滤/归一化单一实现，`.json`/`.ban`/`.recycle` 口径一处维护。
- 复用 scanner 的 30s 缓存与哈希，同步扫描性能与仓库树一致。
- 阶段二落地后，嵌套蓝图（Sable Schematics 等）在同步管理器**可见可拉取**，与仓库树树状语义一致。

**负面**：
- 阶段一需迁移约 **15-25 个测试**（`TestSyncResources_FileLevelDepthGuard`、`TestSyncResources_PackFolderOnlyForPackType`、`TestBuildSyncItems_*` 系列、`TestIsSyncAllowed_*`/`TestIsModelFile_*` 等），断言点从"SyncResources 自 Walk 行为"迁移到"ResourceDiff 行为"。
- 阶段二是**用户可见行为变更**（嵌套文件从"不可见"变"可见可推拉"、拉取落地从顶层平铺变层级保留），需门控确认 + 更新 `docs/releases/`。
- 阶段二与兜底 Walk 的去重需仔细设计，防止重复列示。

**已知遗留**：
- `SyncResourcesDirLevel` 自 Walk 保留（目录语义），与 scanner 的文件级扫描并存——这是必要差异，非重复。
- `GetInstanceStatus` 哈希对比与文件名+大小对比两条策略保留（hashable 限制所致的有意差异）。
- `SyncToggleStatus` 的 `.recycle` 判定用 `strings.Contains`（口径更宽）在本次收敛中一并对齐到 `fsutil.IsRecycleDir`（低风险顺带项）。

## 4. 数据溯源

来源：AI 子代理双线调研（2026-08-15）→ 结果：
- 调研 A（`go/sync` + `go/scanner`）：确认 4 套对比逻辑、5 处过滤/4 处 `.json`/4 处归一化重复、scanner 无层级与 pack.mcmeta 信号为必要差异、无既有统一 ADR 决策、最小改动面 = `SyncResources` 改吃 scanFn + 过滤收敛（约 25 测试迁移）。
- 调研 B（消费方 + 前端契约）：确认 4 组入口 / 5 个前端消费点 / 4 处顶层语义约束、`mapSrcToGlobal` 已支持层级映射（瓶颈在上游过滤与落地拼法）、兜底 Walk 重复列示风险、前端结构不变则零改动。
- 用户反馈（触发调研）：「仓库树明明是树状的，为啥同步后搞了一大堆奇葩判断，不是统一采用仓库树的扫描 lib，各环节共享吗？」
- 结论：ADR-064 立项，编码按 §2 分两阶段（阶段一无行为变更收敛 → 阶段二相对路径语义升级门控）。
- **实现说明（2026-08-15 审核补注）**：阶段一与阶段二在代码上**合并一次性落地**（d05afa3e），阶段一过渡态未单独提交——relKey 相对路径对比直接替换文件名对比，对顶层文件语义等价、对嵌套文件是 ADR 声明的扩展行为，无行为回归。审核后补充修复（`SyncResources` binding 补传 rtype、dir-level 展示与操作统一走 `SyncResourcesDirLevel`、`PullResources` 目录条目复制兜底、`IsScanInstance` 标记废弃、补 relKey/归一化边界测试）。

<!-- 文件名: sync-convergence-scanner-single-source.md → 实际文件 ADR-064-sync-convergence-scanner-single-source.md -->
