---
kind: go-sync-relink
name: 重链接 go/sync RelinkDir（ADR-342 四件套）
tier: leaf
category: go
status: active
source_files:
  - go/sync/sync_relink.go
auto_fields:
  symbols_with_lines:
    - RelinkDir
use_when:
  - RelinkDir
  - 重链接
  - relink
  - 整夹替换
  - 链接模式切换
  - ADR-342
pitfalls:
  - 整夹替换成功后直接 RemoveAll 备份 → 实例侧自制贴图/独有子目录不可逆消失且日志为空、计数报全成功（2026-10-14 探针实证 count=1 err=nil logs=[]）
  - 回滚用绝对源路径记账 → os.Rename 掉旧夹后路径当场失效（首版即 100% 回填失败），必须记相对路径
  - 「改名搬运」目标夹已被活夹占用时 RemoveAll(newDir) 会删掉不属于本次重建的活夹（用户既有模型全灭），必须拒绝
  - Windows 的 os.Lstat 产出惰性 fileStat（只存路径不存 FileId），os.SameFile 按名重开恒真——目录身份快照必须走句柄态 dirIdentity
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 重链接 RelinkDir 整夹替换
  - 实例独有文件保全
  - 目录身份快照 dirIdentity
  - relink 备份尸体
invariant_anchors:
  - go/sync/sync_relink.go|collectInstanceOnlyFiles
  - go/sync/sync_relink.go|restoreInstanceOnlyFiles
  - go/sync/sync_relink.go|dirIdentity
  - go/sync/sync_relink.go|relinkLandingKey
  - go/sync/sync_relink.go|rollbackRelinkReplace
  - go/sync/sync_relink.go|pickRelinkSource
---

# 重链接 go/sync RelinkDir（ADR-342 四件套）

## 概览

`sync_relink.go|RelinkDir` 按 SHA256 哈希把整合包实例目录内的模型重新指向仓库版本（设置页「重新应用链接模式 / 切换链接模式」的消费入口，copy 模式同样跑）。文件夹级类型走「备份→重建→回填实例独有文件→失败回滚」的整夹原子替换；根层平铺的 ysm.json/.pmx 退化为 `installer.CopyFile` 单文件路径。ADR-342 四件套 = 保全实例独有文件（D1）+ 句柄态目录身份（D2）+ 同夹多条目去重（D3/D5）+ 备份尸体豁免（D4/D6）。返回结构化 `types.RelinkResult{OK,Failed,FirstError}`（D7′，ADR-342 锐评批 D①）：error 仅前置不满足，条目级失败进 `Failed` + `FirstError`，零成功不是 error。包级总览见 [go-sync](./go-sync.md)。

## 核心职责

- **`RelinkDir`**（入口）：主循环按 `relinkLandingKey`（小写 `dstParent` + 仓库源夹 basename）记 `replacedDirs`，该组合本轮已整夹替换过则后续条目先 `os.Stat` 校验落位夹内该相对路径存在才计成功（身份复验修好后的必需配套）；整段持 `installer.InstallLock`，内部 `installer.Install/InstallDir/CopyFile` 改用 `*Locked` 变体防同 goroutine 重入死锁
- **整夹替换 `relinkReplaceDirTree`**：旧目录 rename 成 `<目录名>.relink-bak-<UnixNano>` 备份（时间戳防覆盖恢复点，与 conflict.go 的 `.bak-<ts>` 同族）→ 重建 → `restoreInstanceOnlyFiles` 从**备份目录**回填实例独有文件 → 成功删备份（`removeRelinkBackup`）、失败 `rollbackRelinkReplace` 整夹回滚。承诺「整目录原子替换」：要么按仓库版重建且独有文件全到位，要么原地不动；半成品态会让游戏里出现残缺模型
- **`collectInstanceOnlyFiles` / `restoreInstanceOnlyFiles`**：替换前递归记账「实例侧有、仓库侧同相对路径没有」的文件**相对路径**（跳过回收站与 `.relink-bak` 子树），替换成功后回填到重建夹。实例侧 `.disabled/.ban` 副本按「独有文件」保留（不静默删除也不静默转正——禁用态跨链统一不在本 ADR 范围）
- **`dirIdentity` / `snapshotRelinkDirTargets` / `verifyDirSnapshot`**：锁外对将搬的 `dstParent` 逐条取句柄态身份快照（`os.Open` + `f.Stat()`，非全量扫描，不违 `TestRelinkDir_ScanNotHeldLock` 契约），锁内 rename 前复验「搬的仍是快照观察到的那个对象」；快照缺失一律拒搬（错误分类：不存在 vs 无法读取）
- **`pickRelinkSource`**：同哈希多候选取**首个**源（relinkLandingKey 去重必须含仓库源夹的原因：第二条目的源可能在另一个仓库夹，只按实例夹去重会把「既没被安装也不在新夹里」计成功 = 对用户说谎）

## 不变量

- **整夹替换必须保全实例独有文件（ADR-342 D1）**：回填失败必须整夹回滚；回滚自身失败按既有口径保留备份并记日志（恢复点仍在）。回归锁 `TestRelinkDir_RestoreFailureRollsBackWholeDir`（注入「实例侧同名目录 vs 仓库侧同名文件」使回填必失败）
- **同夹多条目共享一次替换结果，但去重键须含仓库源夹 + 做到位校验（ADR-342 D3/D5）**：`relinkLandingKey` 组合本轮已替换则先 `os.Stat` 复验落位，存在才计成功，否则记日志跳过。回归锁 `TestRelinkDir_SameFolderDifferentRepoFolders`（对抗复核 A2 形态）
- **「改名搬运」只进空位（ADR-342 D5，数据丢失防线）**：仓库夹名 ≠ 实例夹名时 `newDir = dstBase/<仓库夹名>` 指向另一路径，而 `installer.InstallDir` 遇已存在目标会复用并合并写入（`dstExisted=true` 时它自己不清树）——随后任何回滚的 `RemoveAll(newDir)` 都会删掉那个不属于本次重建的活夹。故目标已被活夹占用一律拒绝（记日志、不动盘）；这条守卫同时是「整夹回滚」删除边界安全的前提（`newDir` 必为本次新建）。`rollbackRelinkReplace` 显式收 `newDir`，把删除边界写在调用点。变异检查：摘掉守卫 → `TestRelinkDir_RenameMoveRefusesOccupiedLanding` 立即红（实测 `modelB/keep.png` 被删）
- **目录级 rename 前锁内身份复验（ADR-296 D4，机制已被 ADR-342 D2 修正）**：⚠️ 原实现直接用 `os.Lstat` 产物当快照在 Windows 上失效——`os.Lstat` 产出惰性 `fileStat`（只存路径不存 FileId），`os.SameFile` 才由 `loadFileId` 按路径名 `CreateFile` 取 ID（Go stdlib `os/types_windows.go`）→ 两侧都解析成「P 现在是谁」恒真（探针实证同名重建仍判 same）；现统一走 `dirIdentity`（句柄态，身份调用瞬间固化；Unix 等价 fstat dev/ino）。诚实残余：内容漂移不威胁「搬对对象」、InstallLock 不互斥外部进程（窗口已收窄为两条相邻 syscall 之间）。回归锁 `TestRelinkDir_DirLevelSnapshotMissingRefusesRename` / `TestRelinkDir_DirLevelSnapshotReplacedRefusesRename` / `TestDirIdentity_RejectsReplacedDir`
- **`.relink-bak-*` 备份尸体豁免（ADR-342 D4/D6，消费面跨包单点）**：`sync_relink.go|isRelinkBackupPath` 转发 `go/fsutil|IsRelinkBackupPath`（单点事实源），主循环 / repoByHash 构建 / `SyncToggleStatus` WalkDir / `collectEntriesWalk` / `collectEntriesFromScan` / `handleDir` / `collectFolderFiles(+FromScan)` / `go/scanner` / `go/dedup` / `go/repoaudit` 全通道 SkipDir/剔除——不豁免则尸体被判「实例独有（可拉取）」，一键拉取把整个恢复点复制进仓库（完整消费方清单见 [go-sync](./go-sync.md) 不变量「`.relink-bak-*` 备份尸体不参与扫描消费」）
- **`RelinkDir` 失败信号收口（2026-10-14 裁定，D7′）**：零成功且有失败 → `Failed`/`FirstError` 如实结构化；app 层 `RelinkAllInstanceResources` 遇部分失败不中断类型循环、仅**整实例零成功**时上抛（逐条失败在导入日志面板，不用「整实例失败」盖掉计数）。变异检查：摘掉 `sink` 的 firstErr 归集 → 四条 D7 用例的 `FirstError` 断言立即红
- **锁生命周期**：整段持 `InstallLock`，段内 `defer` 释放；锁内调 `installer.*Locked` 变体（非重入 mutex 重入自锁）

## 相关

- [go-sync](./go-sync.md) — 包级总览 / 推送拉取执行循环 / 全通道尸体豁免清单
- [go-sync-resource-diff](./go-sync-resource-diff.md) — 文件夹级 diff 与 collect 信道
- [go-installer](./go-installer.md) — `Install/InstallDir/CopyFile` 落地与 `InstallLock` 锁契约
- [go-instance](./go-instance.md) — 面板链消费
- 回归测试：`go/sync/sync_relink_preserve_test.go`（D1 回填失败整夹回滚 / D5 占位拒搬 / D3 对抗复核 A2 同夹异源夹 / D2 身份拒重建）+ `go/sync/sync_relink_modeswitch_test.go`（ADR-296 D4 快照缺失拒搬 / 被替换拒搬）
