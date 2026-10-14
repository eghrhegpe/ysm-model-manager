# ADR-342：整合包重链接的实例数据保全与目录身份复验

- **状态**：✅ 已采纳
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：relink 整夹替换会静默删除实例独有文件（不可逆数据丢失），且 ADR-296 D4 的身份复验在 Windows 上恒真失效——数据安全方向性决策，跨 go/sync·installer·展示链
- **相关**：`go/sync/sync_relink.go, go/sync/sync_dirlevel_sync.go, go/sync/sync_dirlevel_diff.go, go/sync/sync_resource.go, ADR-296`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在还是否这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

2026-10-14 整合包同步效果锐评（第 5 轮）实证出两条落在 `RelinkDir` 整夹替换分支上的缺陷，均为「跑得通、报成功、但结果不是用户要的」形态：

**① 整夹替换 = 静默删数据。** `relinkReplaceDirTree` 的序列是「旧夹 rename 成 `<夹名>.relink-bak-<ts>` → `InstallDirLocked` 重建 → 成功即 `removeRelinkBackup`（`os.RemoveAll`，不经回收站）」。触发条件仅是**夹入口文件的哈希匹配仓库**，夹内其余文件从不参与判定 → 用户在实例夹里放的自制贴图、额外子目录随备份一起永久消失。探针实证：实例 `packA/{x.ysm,my-own-texture.png,extra/deep.png}` 走一次 `RelinkDir` → 返回 `count=1 err=nil`、**logger 一条都没有**，自制文件已不在磁盘上。触发路径是设置页「重新应用链接模式 / 切换链接模式」（`RelinkAllInstanceResources`），copy 模式（默认）同样执行；该确认框只提示「可能要一会儿」，无数据损失警告。同仓 `installer.InstallDir` / `fsutil.CopyDirRecursive` 都刻意做了「目标已存在就不整树回滚/删除」的数据保护，本分支绕过了它。

**② ADR-296 D4 的锁内身份复验在 Windows 上恒真。** `verifyDirSnapshot` 的谓词是 `os.SameFile(锁外快照, 锁内现取)`。Windows 的 `os.Lstat` 产出**惰性** `fileStat`（只存路径不存 FileId），`os.SameFile` 才由 `loadFileId` **按路径名 `CreateFile` 取 ID**（Go stdlib `os/types_windows.go:287-336,353-363`）→ 两侧都解析成「P 现在是谁」，比的是自己对自己。探针实证：`Lstat(P)` 取快照 → `P` rename 走 → 同名新建 → `SameFile` 仍为 **true**；而「旧对象先删除再重建」才为 false（差异只在惰性解析）。即 D4 想拦的「锁内搬的不是扫描时观察到的那个对象」在主力平台**拦不住**。副作用：同一夹内两条目录型入口（如 `x.ysm` + `y.ysm`）时，第一条整夹替换后第二条本应被复验拦下，实际「通过」并**白做一次整夹替换**。

两者同族：整夹替换这条路上「什么该被替换、什么必须活下来、凭什么认定搬对了对象」三件事都缺明确纪律。

## 2. 决策（Decision）

**D1｜整夹替换必须保全实例独有文件（替换 ≠ 删除）。**
替换前用 `collectInstanceOnlyFiles(instDir, repoDir)` 记账「实例侧有、仓库侧同相对路径没有」的文件**相对路径**（正斜杠；递归收集使实例独有子目录整体存活；跳过回收站与 `.relink-bak` 子树）；替换成功后由 `restoreInstanceOnlyFiles(backupDir, rels, newDir)` 从**备份目录**回填到重建夹。

- **必须只记相对路径，不得记绝对路径**：调用方紧接着 rename 掉 `instDir`，绝对源路径当场失效（首版实现即踩此坑，回填 100% 失败）。回填源 = 备份目录 + 相对路径。
- **回填失败不得静默**：保留备份目录（恢复点）并在 logger 点名未回填的相对路径；宁留一个 `<夹名>.relink-bak-<ts>`，不无声丢数据。
- 重建夹不存在（异常形态）同样保留备份并记日志。

**D2｜目录身份必须用「句柄态 stat」立即固化，不得用 `os.Lstat` 的快照当身份。**
新增 `dirIdentity(path)`：`os.Open` → `f.Stat()`。句柄态 stat 由 `GetFileInformationByHandle` 直接填 vol/FileId 并清掉延迟路径，身份在调用瞬间固化，后续 rename/replace 不会把它改写成别的对象；Unix 侧等价（`fstat` 取 dev/ino）。`snapshotRelinkDirTargets` 与 `verifyDirSnapshot` 一律改走它。

**D3｜同夹多条目共享一次替换结果。**
`RelinkDir` 主循环维护 `replacedDirs`（小写规范化 `dstParent`）：该夹本轮已整夹替换过 → 后续条目**直接计成功**、不再搬动。这是 D2 修好之后的必需配套：复验现在会正确地发现「目录已被替换」，若不承接，relink 会把自己刚做的事报成失败（误报）。语义上也正确——整夹替换后该夹内所有入口文件都已是仓库版本。

**D4｜`.relink-bak-*` 备份尸体在同步 diff 全通道豁免。**
失败 relink 留下的恢复点不得被判「实例独有（可拉取）」——否则面板显示「多余」，用户点一下就把整个恢复点复制进仓库（垃圾入库 + 恢复点被当模型）。统一复用既有谓词 `isRelinkBackupPath`，覆盖四条 collect 通道：dirlevel Walk（`collectEntriesWalk`）、dirlevel scan 反推（`collectEntriesFromScan`，生产链走这里，只修 Walk 等于没修）、file-level Walk（`handleDir`）、夹内子文件（`collectFolderFiles` / `collectFolderFilesFromScan`）。

## 3. 后果（Consequences）

**正面**
- 不可逆数据丢失路径关闭：改链接模式不再吃掉实例独有文件；回填失败也留下可手工取回的恢复点（实证：`count=1 err=nil` 且自制贴图/子目录存活、无备份残留、无日志）。
- ADR-296 D4 的防护在主力平台**真生效**（`TestDirIdentity_RejectsReplacedDir`：同名重建判否；反向对照「同一目录两次取身份相等」防恒不等假修复）。
- 同夹多条目不再白搬一次、不再误报；relink 计数值与实际落盘一致。
- 恢复点不再污染同步面板，也不会被「一键拉取」搬进仓库。

**负面 / 代价**
- 整夹替换多一次 O(夹内文件数) 的 walk 记账（relink 本身已全量扫描+哈希，量级可忽略）；回填是按需复制（仅独有文件）。
- 语义变化：实例独有文件现在**存活**于重建夹内 —— 意味着「实例夹 = 仓库版」不再是严格镜像。这是刻意的：镜像不是删除用户数据的理由。
- 已知边界（留给后续刀）：实例侧 `.disabled/.ban` 副本同样按「独有文件」被**保留**（不静默删除，也不静默转正）——禁用态的跨链口径统一不在本 ADR 范围（见锐评批 C）。

**已知遗留**
- `verifyDirSnapshot` 的残余窗口不变（内容漂移不威胁「搬对对象」、InstallLock 只互斥本进程）——D2 只修「按名重开导致恒真」，不放宽这两条已声明的接受项。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 探针 `RelinkDir` + 实例独有文件（repo `packA/x.ysm` vs inst `packA/{x.ysm,my-own-texture.png,extra/deep.png}`） | `count=1 err=nil logs=[]` 且两个独有文件消失 → D1 |
| 探针 `Lstat(P)` → rename 走 → 同名新建 → `os.SameFile` | `true`（应为 false）；「先删后建」才 `false` → D2 |
| Go stdlib `os/types_windows.go:287-336` `loadFileId`（按路径名 `CreateFile`）+ `:353-363` `sameFile` | 恒真机制坐实：比的是「P 现在是谁」对「P 现在是谁」 |
| 探针 `SyncResourcesDirLevel`（inst 侧 `packA.relink-bak-1700…/x.ysm`） | `Extra=[…packA.relink-bak-…]` → D4 |
| 一过 `RelinkDir` 日志「实例独有文件回填失败 2 个（extra/deep.png、my-own-texture.png），已保留备份 …」 | 首版用绝对源路径必失败 → D1「只记相对路径」条 |
| 回归测试 `go/sync/sync_relink_preserve_test.go` / `sync_corpse_exempt_test.go`（7 例，改前全红、改后全绿 + `go/sync`·`go/instance`·`go/installer`·`go/watcher` 四包全绿） | 落地验证 |

<!-- 文件名: relink-preserve-instance-files.md → 实际文件 architecture/ADR-342-relink-preserve-instance-files.md（ADR-320 architecture 全量模板） -->
