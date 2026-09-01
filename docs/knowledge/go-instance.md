---
kind: go-instance
name: 整合包实例 go/instance
tier: architecture
category: go
source_files:
  - go/instance/
use_when:
  - 整合包
  - 实例
  - 版本实例
  - VersionInstance
  - 同步项
  - BuildSyncItems
  - 资源同步
invariant_anchors:
  - go/instance/instance.go|ysmsync.SyncResources
---

# 整合包实例 go/instance

## 概览

`go/instance/` 包处理整合包（Minecraft 版本实例）的资源同步项构建，是 `app_install.go` 中 `GetInstanceSyncStatus` Binding 的下沉逻辑（知识卡旧文称 `GetResourceInstanceStatus` 为消费方属漂移——该 Binding 走 `ysmsync.GetInstanceStatus`/`CompareGlobalInstanceHashes`，与本包无关）。

## 核心职责

- 将版本实例 + 资源类型 + 仓库根映射为 `ResourceSyncItem[]`（同步状态列表）。`ResourceTypeInfo` 定义于本包 `instance.go`（go/types 下无此类型，知识卡旧文漂移已修正）

## 对外 API / 入口

- `BuildSyncItems(ins, rtypes, repoRoots)` — 构建实例的资源同步项（供同步管理界面展示）；dirLevel 类型（YSM/MMD/蓝图）走 `ysmsync.SyncResourcesDirLevelScan`（注入 `scanner.ScanEntriesWithHit` 复用刷新已缓存的组根扫描结果，消除重复全树 Walk），file-level 类型走 `ysmsync.SyncResources`（ADR-064 相对路径口径）；非 `CompareGlobalInstanceHashes`（知识卡旧文漂移已修正）。每个 dirLevel 文件夹的子条目通过 `DiffFolderContentsScan` 做内容级 diff（全局侧复用组根扫描反推，实例侧走 `collectFolderFiles`，已叠 30s 同步目录扫描缓存）。**2026-08-24 新增 30s 同步结果缓存**：`BuildSyncItems` 最终结果按 `实例名+VersionDir+subtype+roots+rtypes` 缓存（TTL 跟随 `scanner.EffectiveCacheTTL()`，写入时刻求值，默认 30s），失效钩子由 app 层 ServiceStartup 显式调 `RegisterInvalidationHook()` 挂到 `scanner.OnCacheInvalidated`（2026-08-26 起不再隐式 `init()` 注册，内部 `sync.Once` 幂等）；`SyncModelToggleStatus`、Push/Pull、`SyncCustomToRepo`、`RelinkCustomDir` 等不走 scanner 失效的入口显式调 `InvalidateSyncItemsCache()`；**`ImportModelFile*` 落在 Go 侧 `ClearScanCache()` 统一收口**，不依赖前端事后失效。

## 与其他子系统关系

- `internal/app/app_install.go`：薄壳调用（`GetInstanceSyncStatus`）
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
- **同段名叶子/容器冲突防御**：`nestDirLevelTree.insert` 对「同段名先是叶子、又作容器段下钻」用 `__self` 子项收容，防覆盖容器与 nil map 写入 panic

## 已知限制 / 待治理（2026-08-24 审计）

> 修复任一项时删除对应行并补回归测试；跨包 IO 放大问题见 [go_sync](./go-sync.md) 已知限制节。

- **appendItem 前缀检查无分隔符守卫**（instance.go appendItem）：`strings.HasPrefix(p, globalDir)` 未带 `basedir+sep` 守卫——同文件 `relOf`（L233）特意加了守卫防 `D:\repo` vs `D:\repo-instance` 误归属，此处口径不一；当前 p 来自双侧 Walk 结果通常安全，但属防御范式漏网
- **legacy 在容器层被抹平**：`aggregateStatus` 把 legacy（旧硬链接）归入 hasPull → 含 legacy 子项的容器聚合为 optional（📤 可拉取），legacy 语义丢失、legacy tab 下看不到该容器（与前端 applyFilter 不递归叠加，见 [app-sync-manager](./app-sync-manager.md)）
- **`__self` 魔法段名边缘冲突**：真实子目录恰名 `__self` 时与防御性自引用子项同 key 相互覆盖（极低概率，记录在案即可）
- **R34 P2-13 前缀守卫修复**（instance.go:222）：`appendOneItem` 中 `strings.HasPrefix(p, c.globalDir)` 用裸前缀匹配，全局根是另一全局根前缀（`D:\repo\a` vs `D:\repo\abc`）时算出错误实例侧路径。修复：`HasPrefix(p, c.globalDir+sep)` + `TrimPrefix` 同口径，与 `relOf`（L380）一致。
- **sizeOf 静默吞错**：条目尺寸 `os.Stat` 失败返回 0 无告警，显示失真不可察觉

## 相关

- ADR-024（多资源类型联邦架构：按资源类型分目录同步）
