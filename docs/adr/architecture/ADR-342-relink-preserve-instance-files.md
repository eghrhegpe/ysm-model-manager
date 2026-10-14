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
- **回填失败必须整夹回滚（原子替换语义）**：本函数承诺的就是「整目录原子替换」，半成品态（新夹 + 独有文件滞留备份）会让用户在游戏里看到残缺模型且事后无人知道怎么补。故回填失败或重建夹缺失时调 `rollbackRelinkReplace` 回滚（新夹删除 + 备份 rename 回原位）、记日志点名未回填的相对路径、该条目**不计成功**；回滚自身失败时按既有口径保留备份并记日志（恢复点仍在）。

**D2｜目录身份必须用「句柄态 stat」立即固化，不得用 `os.Lstat` 的快照当身份。**
新增 `dirIdentity(path)`：`os.Open` → `f.Stat()`。句柄态 stat 由 `GetFileInformationByHandle` 直接填 vol/FileId 并清掉延迟路径，身份在调用瞬间固化，后续 rename/replace 不会把它改写成别的对象；Unix 侧等价（`fstat` 取 dev/ino）。`snapshotRelinkDirTargets` 与 `verifyDirSnapshot` 一律改走它。

**D3｜同夹多条目共享一次替换结果。**
`RelinkDir` 主循环维护 `replacedDirs`（小写规范化 `dstParent`）：该夹本轮已整夹替换过 → 后续条目**直接计成功**、不再搬动。这是 D2 修好之后的必需配套：复验现在会正确地发现「目录已被替换」，若不承接，relink 会把自己刚做的事报成失败（误报）。语义上也正确——整夹替换后该夹内所有入口文件都已是仓库版本。

**D3｜整夹替换的去重键 = 实例夹 + 仓库源夹，且命中须做「到位校验」。**
`RelinkDir` 主循环维护 `replacedDirs`（键见 `sync_relink.go|relinkLandingKey` = 小写规范化 `dstParent` + 仓库源夹 basename）。这是 D2 修好后的必需配套（复验现在会正确地发现「目录已被替换」，若不承接，relink 会把自己刚做的事报成失败）；但**只按实例夹去重是错的**（对抗复核 A2）：`pickRelinkSource` 取的是同哈希的**首个**候选，第二条目的哈希源可能落在另一个仓库夹——那种情况下它既没被安装、也不在新夹里（只作为「实例独有文件」从备份回了旧内容）。故：① 键必须含仓库源夹；② 命中去重后仍须 `os.Stat` 校验「落位夹内该相对路径存在」，不存在则记日志跳过、**不计成功**。

**D5｜「改名搬运」（仓库夹名 ≠ 实例夹名）只允许搬进空位。**
`newDir = dstBase/<仓库夹名>` 与 `dstParent` 不同名时，若 `newDir` 已被**另一个活夹**占用，一律拒绝（记日志、不动盘）。理由（对抗复核 A1，实测复现）：`installer.InstallDir` 遇已存在目标会复用并合并写入（`dstExisted=true` 时它自己不清树），而任何回滚的 `RemoveAll(newDir)` 都会把这个**不属于本次重建的活夹**整树删掉——用户既有模型 + 其独有文件全灭。这条守卫同时是 D1「整夹回滚」删除边界安全的前提：`newDir` 必为本次新建，`RemoveAll` 的内容 = 仓库版 + 本次回填副本。`rollbackRelinkReplace` 的签名随之从 `(dstBase, srcDir)` 改为显式 `newDir`，把删除边界写在调用点上。

**D4｜`.relink-bak-*` 备份尸体在同步 diff 全通道豁免。**
失败 relink 留下的恢复点不得被判「实例独有（可拉取）」——否则面板显示「多余」，用户点一下就把整个恢复点复制进仓库（垃圾入库 + 恢复点被当模型）。统一复用既有谓词，覆盖四条 collect 通道：dirlevel Walk（`collectEntriesWalk`）、dirlevel scan 反推（`collectEntriesFromScan`，生产链走这里，只修 Walk 等于没修）、file-level Walk（`handleDir`）、夹内子文件（`collectFolderFiles` / `collectFolderFilesFromScan`）。

**D7｜失败必须可分类上报，但不得用「整实例失败」覆盖已成功计数（对抗复核 C1 收口）。**
`RelinkDir` 统计失败条目；**零成功且有失败**时返回 `ErrPartialSync`（原先只记日志、返回 `(0, nil)`，前端唯一失败通路是按实例计的 Go error → 弹「已重新链接 0 个文件」的成功 toast）。app 层 `RelinkAllInstanceResources` 相应分流：遇 `ErrPartialSync` **不中断**类型循环（各类型目录相互独立）继续累计，仅在**整实例零成功**时才把首个错误上抛；有任何成功则返回 `(total, nil)`——逐条失败已由 go/sync 经 logger 写进导入日志面板，用「整实例失败」覆盖成功计数是另一种对用户说谎。契约变化同步到既有回归：`sync_complexity_char_test.go` 的两条特征用例（平铺失败记账 / 目录替换回滚）与 `sync_relink_modeswitch_test.go` 的两条拒搬用例，其 `NoError` 断言改为 `ErrorIs(…, ErrPartialSync)`，行为断言（count 不增、日志点名、文件毫发无损、无备份残留）原样保留。
**D6｜尸体谓词下沉 `go/fsutil`，扫描/去重/体检三处共用（对抗复核 A4 收口）。**
`IsRelinkBackupPath` 原为 `go/sync` 包私有 → 下沉 `go/fsutil/relink_backup.go` 作单点事实源（`go/sync` 保留转发函数以缩小改动面），三处包外消费方接入：

- **`go/scanner`**（`processScanDirEntry` 目录分支）：尸体内模型哈希恒等于仓库原件，不跳过就以**活跃条目**进 `ModelEntry` → 仓库树 / 搜索 / 作者提取出现幻影模型（`ScanEntries` 与 `ScanEntriesLite` 共用本函数，一处修两处生效）。
- **`go/dedup`**（`collectFiles` 目录分支）：**无条件**跳过（与 `skipRecycle` 开关无关）。**这是数据丢失形状**：尸体与仓库原件同哈希 → 进同一重复组；`cli dedup clean` 保留 `Group.Files[0]`（按 Path 排序），而 `a.relink-bak-1\a.ysm` 的 `'.'`(0x2E) < `'\'`(0x5C) 使它排在活文件**之前** → 保尸体、把活模型 `recycle.Move` 进回收站。实证：修前分组 `Files[0]` 确为尸体路径。
- **`go/repoaudit`**（`AuditCtx` 目录分支）：尸体计入会虚高 `TotalFiles`、扭曲命中率与评分；同时把该处的 `.recycle` 判定从 `d.Name() == ".recycle"`（大小写敏感，与同处注释自称的口径一致不符）改为 `fsutil.IsRecycleDir(path)`。

## 3. 后果（Consequences）

**正面**
- 不可逆数据丢失路径关闭：改链接模式不再吃掉实例独有文件；回填失败则整夹回滚（实例夹原地不动，原子性成立），实证 `count=1 err=nil` 且自制贴图/子目录存活、无备份残留、无日志。
- 原子性有回归锁：`TestRelinkDir_RestoreFailureRollsBackWholeDir`（注入「实例侧同名目录 vs 仓库侧同名文件」使回填必失败 → 断言整夹未被替换、旧内容原位、日志点名、无残留）。
- ADR-296 D4 的防护在主力平台**真生效**（`TestDirIdentity_RejectsReplacedDir`：同名重建判否；反向对照「同一目录两次取身份相等」防恒不等假修复）。
- 同夹多条目不再白搬一次、不再误报；relink 计数值与实际落盘一致。
- 恢复点不再污染同步面板，也不会被「一键拉取」搬进仓库。

**负面 / 代价**
- 整夹替换多一次 O(夹内文件数) 的 walk 记账（relink 本身已全量扫描+哈希，量级可忽略）；回填是按需复制（仅独有文件）。
- 语义变化：实例独有文件现在**存活**于重建夹内 —— 意味着「实例夹 = 仓库版」不再是严格镜像。这是刻意的：镜像不是删除用户数据的理由。
- 已知边界（留给后续刀）：实例侧 `.disabled/.ban` 副本同样按「独有文件」被**保留**（不静默删除，也不静默转正）——禁用态的跨链口径统一不在本 ADR 范围（见锐评批 C）。

**已知遗留**
- `verifyDirSnapshot` 的残余窗口不变（内容漂移不威胁「搬对对象」、InstallLock 只互斥本进程）——D2 只修「按名重开导致恒真」，不放宽这两条已声明的接受项。
- **实例独有「空目录」不保留**（`collectInstanceOnlyFiles` 只收文件）：无文件内容的空夹随替换消失，无日志。判为可接受（游戏侧不消费空目录），如需保全再扩到目录条目。
- **断链/指向目录的软链作为独有文件**会让回填必然失败（`fsutil.CopyFile` 拒目录源 / Stat 失败）→ 该夹整夹回滚、本轮不重链（日志点名），用户需先处置该软链或删除它。
- **部分失败只到「计数 + 日志面板」**（D7 的分流口径）：单实例部分成功仍返回 `(total, nil)`，前端弹「已重新链接 N 个文件」，M 项失败只在导入日志面板可见。要做成「N 成功 M 失败」的告警 toast，需把 `RelinkAllInstanceResources` 的返回改成结构化 `{OK, Failed, Errors}`（牵动绑定重生成 + 三语 i18n + 前端用例），留作后续刀。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 探针 `RelinkDir` + 实例独有文件（repo `packA/x.ysm` vs inst `packA/{x.ysm,my-own-texture.png,extra/deep.png}`） | `count=1 err=nil logs=[]` 且两个独有文件消失 → D1 |
| 探针 `Lstat(P)` → rename 走 → 同名新建 → `os.SameFile` | `true`（应为 false）；「先删后建」才 `false` → D2 |
| Go stdlib `os/types_windows.go:287-336` `loadFileId`（按路径名 `CreateFile`）+ `:353-363` `sameFile` | 恒真机制坐实：比的是「P 现在是谁」对「P 现在是谁」 |
| 探针 `SyncResourcesDirLevel`（inst 侧 `packA.relink-bak-1700…/x.ysm`） | `Extra=[…packA.relink-bak-…]` → D4 |
| 一过 `RelinkDir` 日志「实例独有文件回填失败 2 个（extra/deep.png、my-own-texture.png），已保留备份 …」 | 首版用绝对源路径必失败 → D1「只记相对路径」条 |
| 注入「实例侧 `y.ysm` 是目录 / 仓库侧 `y.ysm` 是文件」→ 回填必撞同名文件失败 | 半成品态（新夹 + 独有文件滞留备份）不可接受 → D1 改整夹回滚，`TestRelinkDir_RestoreFailureRollsBackWholeDir` 锁死 |
| 对抗复核 A1：`inst/ysm/{packA/x.ysm, modelB/keep.png}` + `repo/modelB/{x.ysm,y.ysm}`（夹名不同 + 回填必失败） | **变异检查**：临时摘掉「只进空位」守卫 → `modelB/keep.png` 被回滚 RemoveAll 删掉（旧回滚越界）→ D5 守卫 + `TestRelinkDir_RenameMoveRefusesOccupiedLanding`（摘守卫即红） |
| 对抗复核 A2：`inst/packA/{x.ysm(h1),y.ysm(h2)}` + `repo/{modelB/x.ysm(h1), modelC/y.ysm(h2)}` | 旧去重键只含实例夹 → `count=2` 且零日志，而 y.ysm 从未重链 → D3 键含仓库源夹 + 到位校验，`TestRelinkDir_SameFolderDifferentRepoFolders`（count 必须为 1） |
| 对抗复核 B1：改名搬运零覆盖（既有测试两侧同名，走不到 `newDir≠dstParent`） | 补 `TestRelinkDir_RenameMoveIntoVacantLanding`（搬运正例）+ 上面两条反例 |
| 对抗复核 C2：Go 1.26.8 stdlib 实读——`File.Stat()`→`statHandle`→`newFileStatFromGetFileInformationByHandle`（填 vol/idx、path 置空）vs `Lstat`→`GetFileAttributesEx`+`saveInfoFromPath`（惰性） | D2 机制由 stdlib 源码二次确认（不只在行为层） |
| 对抗复核 A4 三处红测试：`go/scanner`（尸体进 ModelEntry）、`go/dedup`（分组 `Files[0]` 是尸体 → `clean` 保尸体删活模型）、`go/repoaudit`（TotalFiles=2） | 谓词下沉 `go/fsutil` + 三消费方接入 → D6（`dedup` 那条命中排序陷阱已实证） |
| 对抗复核 C1：`RelinkDir` 零成功仍返回 `(0, nil)`，前端唯一失败通路是按实例计的 Go error | 失败计数 + 零成功上抛 `ErrPartialSync`；app 层不中断类型循环、仅整实例零成功才上抛 → D7（两条特征用例 + 两条拒搬用例的 `NoError` 断言随之改为 `ErrorIs`） |
| 回归测试 `go/sync/sync_relink_preserve_test.go` / `sync_corpse_exempt_test.go`（7 例，改前全红、改后全绿 + `go/sync`·`go/instance`·`go/installer`·`go/watcher` 四包全绿） | 落地验证 |

<!-- 文件名: relink-preserve-instance-files.md → 实际文件 architecture/ADR-342-relink-preserve-instance-files.md（ADR-320 architecture 全量模板） -->
