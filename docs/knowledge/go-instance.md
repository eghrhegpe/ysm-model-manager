---
kind: go-instance
name: 整合包实例 go/instance
tier: architecture
category: go
source_files:
  - go/instance/
auto_fields:
  symbols_with_lines:
    - BuildInstanceStatusCounts
    - BuildSyncItems
    - InvalidateSyncItemsCache
    - RegisterInvalidationHook
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 整合包实例、版本实例、VersionInstance
  - 同步项、BuildSyncItems、资源同步
quick_risk_lines:
  - 整合包实例同步必须走 go/instance 的 ysmsync.SyncResources，禁止在 app 层手写同步逻辑
pitfalls:
  - app 层手写同步 → 与 go/instance 判定不一致；必须经 SyncResources
  - BuildSyncItems 未去重 → 重复同步同一资源；必须在 BuildSyncItems 里做去重

use_when:
  - 整合包
  - 实例
  - 版本实例
  - VersionInstance
  - 同步项
  - BuildSyncItems
  - 资源同步
perf:
  - io-bound
invariant_anchors:
  - go/instance/instance.go|ysmsync.SyncResources
status: active
last_verified: 2026-10-13
---

# 整合包实例 go/instance

## 概览

`go/instance/` 包处理整合包（Minecraft 版本实例）的资源同步项构建与侧栏计数折叠，是 `internal/app/app_install_instance.go` 中 `GetInstanceSyncStatus` / `GetResourceInstanceStatus` Binding 的下沉逻辑（ADR-310 后侧栏计数亦归本包）。

## 核心职责

- 将版本实例 + 资源类型 + 仓库根映射为 `ResourceSyncItem[]`（同步状态列表）。`ResourceTypeInfo` 定义于本包 `instance.go`（go/types 下无此类型，知识卡旧文漂移已修正）

## 对外 API / 入口

- `BuildSyncItems(ins, rtypes, repoRoots)` — 构建实例的资源同步项（供同步管理界面展示）；dirLevel 类型（YSM/MMD/蓝图）走 `ysmsync.SyncResourcesDirLevelScan`（注入 `scanner.ScanEntriesWithHit` 复用刷新已缓存的组根扫描结果，消除重复全树 Walk），file-level 类型走 `ysmsync.SyncResourcesWithConfig(globalDir, instDir, nil, scanner.ScanEntries, rt.ID)`——**两分支注入同款 scanner 缓存化 scanFn（内容级判定同一强度）**：fileLevel 注入系 2026-10-15 锐评补漏（原直调 `SyncResources` = scanFn=nil → 恒无哈希 → Size 兜底，同大小异内容的 pack.zip 恒判 Synced 假绿，而同目录对的 `internal/app|App.SyncResources` 绑定早注入哈希——两路对同一事实答案相反；ADR-344 D1 修 dirLevel 时 fileLevel 是漏网），scanFn 命中 scanner 30s 缓存/并行预算，不触 hashlock 红线；非 `CompareGlobalInstanceHashes`（知识卡旧文漂移已修正）。回归锁 `instance_content_diverged_test.go`（同大小异内容 → Diverged / 同内容 → Synced 负向对照）。每个 dirLevel 文件夹的子条目通过 `DiffFolderContentsScan` 做内容级 diff（全局侧复用组根扫描反推，实例侧走 `collectFolderFiles`，已叠 30s 同步目录扫描缓存）。**2026-08-24 新增 30s 同步结果缓存**：`BuildSyncItems` 最终结果按 `实例名+VersionDir+subtype+roots+rtypes` 缓存（TTL 跟随 `scanner.EffectiveCacheTTL()`，写入时刻求值，默认 30s），失效钩子由 app 层 ServiceStartup 显式调 `RegisterInvalidationHook()` 挂到 `scanner.OnCacheInvalidated`（2026-08-26 起不再隐式 `init()` 注册，内部 `sync.Once` 幂等）；`SyncModelToggleStatus`、Push/Pull、`SyncCustomToRepo`、`RelinkCustomDir` 等不走 scanner 失效的入口显式调 `InvalidateSyncItemsCache()`；**`ImportModelFile*` 落在 Go 侧 `ClearScanCache()` 统一收口**，不依赖前端事后失效。
- `BuildInstanceStatusCounts(instances, rtypes, filesRoots) []types.InstanceStatus`（`status_counts.go`，**ADR-310 侧栏计数薄入口**）— 逐实例折 `BuildSyncItems` 的**顶层展示单元**（不递归 children，避免面板父+子重复计数）：`synced`→`Synced`；`missing | diverged`→`MissingCount`（学面板 `tabStatus` 把内容分叉折叠进红）；`optional | legacy`→`Extra`（legacy 在容器聚合里同样算 hasPull）；`disabled`→`Disabled`（中立，不驱动红/橙）。**清单分成两路且一律排序去重**：`Missing` 恒为**仓库侧文件级绝对路径**（缺夹按 `children` 递归展开／无 children 的目录走 `DiffFolderContents`，供 `runDownloadMissing` 逐条 `Install` 的一键安装契约；**绝不吐目录**——目录路径经 `InstallResourceToInstance` 会触发 `InstallDir(父目录)` 过度安装（把兄弟模型包整棵装进实例），对 fileLevel 类型则必判「不支持的文件类型」）；夹内**无任何可逐文件安装的受支持文件**时（如只含 `pack.mcmeta` 的资源包夹、内容全不被 `IsTypeModelFile` 命中的 maid-model 夹）整夹进 `MissingDirs`，由一键安装调用 folder-aware 的 `PushSingleResourceToInstance`（`sync_push.go` 的 `os.Stat().IsDir()` → `InstallDirLocked(该夹)`，装的是这个夹本身）——**每个 `MissingCount` 单元因此都有对应安装路径**，不再出现「徽章恒红、一键安装无动作」。`Extra`（实例侧独有单元）/`Disabled`（`.ban` 单元，实例侧或仓库侧；不推送、不展开）为单元路径。去重的必要性：面板链「混合夹」会把同一平铺文件重复列示（实测容器子项 `flat.pmx` 出现 2 次），不去重会重复安装同一文件。`CustomDir` 单类型时 = `FindInstDir` 解析的实例子目录（与 `processOneResourceType` 同源）。**`Overwrites`（ADR-340-d2）**是 `Missing ∪ MissingDirs` 的**子集**（同格路径）：本次推送会**覆盖实例侧已修改副本**的那些推送目标——叶子文件 diverged、整夹推送（dirs 分支）的分叉夹；分叉夹被展开成内层文件时**不逐文件声称覆盖**（逐文件归因需要实例侧对应夹路径做真实两侧 diff，宁少报不谎报，记在 ADR-340-d2 遗留项）。零新增判定逻辑：diff／禁用／聚合全部复用面板链，30s 缓存随之命中；`GetResourceInstanceStatus` / `GetInstanceStatus` 两绑定换线到此处，签名不变

## 与其他子系统关系

- `internal/app/app_install_instance.go`：薄壳调用（`GetInstanceSyncStatus` 面板链；`GetResourceInstanceStatus` / `GetInstanceStatus` 侧栏计数，ADR-310 换线）
- `go/types/`：`VersionInstance` / `ResourceSyncItem` / `ResourceTypeInfo`（本包定义）
- `go/sync/`：同步比对（`SyncResources`）

## 不变量

- 条目过滤统一走 `packs.IsTypeModelFile`（ADR-064 阶段一收敛，原 `extMatch` 内联实现删除；ADR-144 随识别大脑下沉 packs）；资源包文件夹（`pack.mcmeta`）在三分支放行（`fsutil.IsResourcePackFolder` 兜底，保持 SyncResources 判定的真实状态）
- **兜底 Walk（IsScanInstance）已移除**（ADR-064 阶段二）：`SyncResources` 相对路径对比全树递归收集所有受支持文件（含嵌套），同名不同目录不再 map 去重丢失，原兜底已无新增条目可补，删除防重复列示——`TestBuildSyncItems_FallbackWalk` 语义由 SyncResources 的 Extra 覆盖后仍通过
- 内部参数收敛（2026-08-26）：`resolveItemMeta` 返回 `itemMeta` 结构体（isDirEntry/status/defaultStatus/icon 四元组），`appendOneItem` 升格为 `rtypeCtx` 方法（rt/globalDir/instDir/isDirLevel 上下文），11 参收敛为接收者+路径+meta
- **展示树镜像磁盘层级（仓库是权威源）**：`BuildSyncItems` 对 dirLevel 类型（`IsDirLevelSync`）用 `nestDirLevelTree` 把 `SyncResourcesDirLevel` 的扁平单元按相对路径段重建为嵌套容器树——中间目录（仅含子模型夹、自身非模型文件夹，如 `wine_fox_json`）自动成为可展开容器节点，模型夹/文件为叶子。仓库怎么来，整合包就怎么来。**容器节点必须填 `Type`**（`nestDirLevelTree`/`treeChildren` 接收 rtype）——前端 `applyFilter` 按 `i.type === 选中类型` 过滤，容器缺 Type(=空串)会被整体丢弃，导致整棵嵌套子树（嵌套1→嵌套2→动力臂.ysm）不显示
- **文件夹图标 📁，扁平文件才用类型图标**（💎）；`isDirEntry` 时 icon 默认 `📁`，disabled/legacy 各自覆盖 ⛔/🔗，diverged 聚合夹用 🗂️
- **missing 夹展开显仓库侧预览**：`buildChildrenForDir` 不再要求实例侧存在——仓库是绝对权威源，missing（仓库有整合包无）夹从仓库侧列内部文件清单（全标 missing）供预览待推内容
- **missing/optional 夹保持自身状态，仅 synced 夹提升 diverged**：整体缺失/整体多余不降级成「部分差异」；`aggregateStatus` 保留 optional 语义（纯实例独有容器 → optional 可拉取，非误归 diverged）
- **disabled 归入聚合「中立」而非 hasPush**：禁用项是用户刻意 .ban 的内容，不应驱动容器级 push（防整夹 InstallDir 覆盖 .ban）；含 synced+disabled 无 missing/optional 的容器聚合为 synced、不出现 push。`relOf` 前缀归属带分隔符守卫（`p == basedir || HasPrefix(p, basedir+sep)`），防两根呈前缀嵌套（`D:\repo` vs `D:\repo-instance`）误归属
- **容器 Path 按聚合状态选源侧**：`dirLevelContainerPath`——optional（可拉取）→ 实例根（pull 源），其余（可推送/同步）→ 全局根（push 源），避免混合夹锁错源侧
- **实例侧禁用载体也算 ⛔（ADR-345 D3）**：dirLevel 单元的实例侧路径原为**盲 join**（`filepath.Join(instDir, rel)`）——实例把整夹（**或其祖先容器夹**）改名成 `X.disabled/` 后该路径不存在 → `buildDirLevelChildren` 拿到空实例侧 → 子项全判 missing → 父夹升 `diverged`「待推送」→ 一键/行内推送另建活跃副本，禁用载体残留 = **模型静默复活 + 同一模型两份副本**。现 `appendOneItem` 的实例侧路径过 `fsutil|DisabledAncestorPath(instDir, instPath)`（**上溯祖先**：容器夹被整体禁用时只查单元自身会双双落空，复核 P1-2）：命中则子项**以载体为基准** diff（同内容即 synced），单元标 `SyncStatusDisabled`（⛔，中立桶）——不进待推送/一键清单。另注意 dirLevel 单元键已改**逐段**去禁用后缀（`registry|StripDisableSuffixSegments`），故 Walk 信道下「仓库 `X/sub/` ↔ 实例 `X.disabled/sub/`」是同一个键（不再是幻影 Missing+Extra）。回归锁 `instance_disabled_dir_test.go`（载体 → ⛔ + 子项 synced；嵌套单元在禁用容器下 → ⛔；活跃反向对照 → Synced）
- **目录单元的 Synced ≠ 夹内字节一致（ADR-344 D1/D2）**：dirLevel 顶层单元里**文件**单元比内容（仓库改过内容的平铺 `.ysm` 会进 missing/待推送），**目录**单元仍是存在性判定（scan 信道承载不了折叠指纹，见 [go-sync](./go-sync.md) 不变量）。夹内差异一律由本卡展开层承担：`buildDirLevelChildren` → `DiffFolderContentsScan` → 子项 missing/diverged → `aggregateStatus` 把父夹升 diverged。**故「一键安装推了整夹」不成立**：可推送清单由 `pushTargets` 展开成子文件（夹内无受支持文件才整夹进 `MissingDirs`），容器节点只递归子单元、从不整体推容器——`go/sync` 的 `dropAncestorUnits`（ADR-344 D4）就是照这条口径对齐的
- **同段名叶子/容器冲突防御**：`nestDirLevelTree.insert` 对「同段名先是叶子、又作容器段下钻」用 `selfLeafKey` 子项收容，防覆盖容器与 nil map 写入 panic。**该键是 NUL（`\x00`）前缀常量**（`instance_tree.go|selfLeafKey`，ADR-333）：NUL 被 OS 禁止出现在目录名中，故与真实段名**数学上不可能**碰撞；改前用段名字面量 `"__self"`，真实同名嵌套目录会被防御节点覆盖 → 静默丢整棵子树（变异验证：退回旧键即复现 `keep.ysm` 消失）。**键不外显契约**：防御节点恒为「只有 leaf、无 children」，`treeChildren` 的 leaf 分支输出叶子自身 Name/Path，键只在容器分支参与 `joinRel` → 本键永不进入任何 Name/Path/childRel（回归锁 `instance_helpers_test.go|TestSelfLeafKey_UsesNulPrefix` + 两例行为锁；**分支 A 经实证在旧键下本就安全**，叶子节点 children 必为 nil 不覆盖任何键）
- **同路径自引用 marker 必须并入容器（`absorbSelfMarker`，2026-09 修）**：混合夹（自身直接含平铺模型文件、又含子模型夹）在 `sync_dirlevel.go` 会被登记**两条**——除容器身份外还把自身登记成一条目录条目（目录 marker，用于与对侧同名叶子目录对齐键集，防幻影 Missing+Extra）。展示层若原样吐行就渲染成「同名目录嵌在自己里面」（实测 `2.大学学姐 > 2.大学学姐`）；更糟的是该 marker 的 `Path` 与容器 `Path` 相同，而前端 `dirOpen` 以 `data-path` 为 key —— 点一次容器会**连带展开影子行**。故 `treeChildren` 在算出 `containerPath` 后调 `absorbSelfMarker(children, containerPath)`：`Path == containerPath` 的子项不吐行，把它的**直接子文件**（`Name` 不含 `/`）并入容器（含 `/` 的属子夹，由子夹节点负责展示，上提会把同一批文件列两遍）。**判别式就是 Path 相等**：子夹下的叶子路径必然更深不会误伤；容器聚合为 optional 时 `containerPath` 取实例根、与实例侧同名叶子路径重合 → 同属「同一个夹」，也并入。跨侧同名但**路径不同**的（容器 `globalDir/a` + 实例独有 `instDir/a`）是真实两个对象，`__self` 行保留
- **条目 `Size` 语义按 `IsDir` 区分（`entrySize`，2026-09 修）**：文件 = 自身字节数（`fsutil.FileSize`）；目录 = **子树内容总量**（子项 `Size` 求和）。目录**绝不能**取 `os.Stat(dir).Size()`——那是目录项自身占用（NTFS 通常 0/4096/8192），与内容无关：实测 600 字节的夹报 0、装着 206 MB 的模型夹在同步页显示 `4.0 KB`，纯属误导。总量**零额外 IO**（`buildDirLevelChildren` 已算出子项清单，`DiffFolderContents` 注释明确 synced 条目含在结果中）；空夹 / 夹在磁盘上不存在 → `Size=0`，由前端 `size > 0` 守卫留白。容器节点（`treeChildren`）不填 `Size`，故容器行本就不显示大小。消费面极窄：`Size` 全仓仅 `tpl.ts` 两处行模板消费，**无排序 / 合计 / 推送判定依赖**——改语义不牵连逻辑

## 已知限制 / 待治理（2026-08-24 审计；2026-10-13 按源码树复核）

> 修复任一项时删除对应行并补回归测试；跨包 IO 放大问题见 [go_sync](./go-sync.md) 已知限制节。
> **本节断言为 2026-08-24 快照，2026-10-13 逐条 grep 源码树复核过**：已治项标 ~~删除线~~ 并注明归宿，未治项注明最新实证。判断现状仍以源码树为准。

- ~~**appendItem 前缀检查无分隔符守卫**~~ **已治（R34 P2-13）**：`appendOneItem` 曾用裸 `HasPrefix(p, c.globalDir)`，全局根互为前缀（`D:\repo\a` vs `D:\repo\abc`）时算出错误实例侧路径。现 `instance.go` 用 `HasPrefix(p, c.globalDir+sep)` + `TrimPrefix`，与 `relOf` 同口径
- **legacy 在容器层被抹平**：`aggregateStatus` 把 legacy（旧硬链接）归入 hasPull → 含 legacy 子项的容器聚合为 optional（📤 可拉取），legacy 语义丢失、legacy tab 下看不到该容器（与前端 applyFilter 不递归叠加，见 [app-sync-manager](./app-sync-manager.md)）
- ~~**`__self` 魔法段名边缘冲突**~~ **已治（ADR-333，2026-10-13）**：防御键已改 NUL 前缀常量 `selfLeafKey`（`instance_tree.go|selfLeafKey`），与真实段名数学上不可能碰撞。**只有分支 B（叶子写入已是容器的同名段）会真覆盖**——需真实容器内已存在同名 `__self` 嵌套子夹；分支 A（`nxt.leaf != nil`）经实证在旧键下本就安全（叶子 children 必为 nil）。变异验证已坐实「退回旧键即复现静默丢子树」，回归锁三例见 `instance_helpers_test.go`
- ~~**sizeOf 静默吞错**~~ **已治**：`sizeOf` 全仓零命中，已被 `instance.go|entrySize` 取代——文件取 `fsutil.FileSize`；目录取子树 `children` 的 `Size` 求和，**子项清单取不到且夹真实存在时回退 `fsutil.DirSize` 递归求和**（仅 `os.Stat` 失败才返回 0），空夹/不存在 → 0 交前端 `size > 0` 守卫留白
- **混合夹平铺文件重复列示（面板链，2026-10-13 复核：当前形态未复现）**：`absorbSelfMarker` 把目录 marker 的直接子文件并入容器，而同一文件又以「平铺文件叶」身份独立注册 → 容器 `children` 里同一路径可能出现两次。侧栏 `BuildInstanceStatusCounts` 已去重（防重复安装）；**面板树的去重仍未做**，但回归锁 `status_counts_test.go` 当前以 `t.Skipf` 形态变化自失效——真实目录形态变化时会重新显形，届时修它须动 `nestDirLevelTree`/`absorbSelfMarker` 并补面板回归
- ~~**无可推送文件的单元只能由面板单行推送修**~~ **已收口（2026-09 审计后）**：改为整夹进 `MissingDirs`，一键安装走 folder-aware 的 `PushSingleResourceToInstance`，计数与可修性一致（见「对外 API」节）

## 相关

- ADR-024（多资源类型联邦架构：按资源类型分目录同步）
