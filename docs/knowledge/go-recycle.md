---
kind: go-recycle
name: 回收站 go/recycle
tier: architecture
category: go
source_files:
  - go/recycle/
auto_fields:
  symbols_with_lines:
    - CleanOpLogger
    - DeduplicateEntries
    - Move
    - MoveResult
    - New
    - RemoveRepoDuplicates
    - TrashManager
    - TrashManager.Delete
    - TrashManager.Empty
    - TrashManager.List
    - TrashManager.Move
    - TrashManager.MoveEx
    - TrashManager.RecycleDir
    - TrashManager.Restore
use_when:
  - 回收站
  - 删除
  - 恢复
  - recycle
  - 软删除
perf:
  - io-bound
invariant_anchors:
  - go/fsutil/crossdevice_other.go|IsCrossDeviceErr
  - go/recycle/recycle.go|moveEx
quick_groups:
  - 文件操作与标签
quick_intents:
  - 回收站 / 软删除 / 恢复 / 清空回收站
quick_risk_lines:
  - 删除必须走 .recycle 软删除（硬链接判定），禁止直接 os.Remove
pitfalls:
  - 符号链接/硬链接直接删除（deleted_link）而非移入回收站——手搓删除逻辑会破坏链接语义
  - 回收站清理必须保留原路径结构（相对路径扁平化会导致恢复时路径冲突）
  - 软删除 vs 硬删除：.recycle 目录下的文件仍可被扫描到——需排除 .recycle 目录
  - 恢复操作必须校验目标路径是否已存在——冲突时追加序号后缀
  - 回收站空间上限（配置项）超限时自动清理最旧条目
  - 跨设备移动（硬链接失效）时回收站中的条目变为独立副本
  - 批量清空回收站时需注意文件锁定——被占用文件跳过不报错
status: active
---

# 回收站 go/recycle

## 概览

`go/recycle/` 包实现模型的软删除机制，通过硬链接/符号链接判定 + `.recycle` 目录实现可恢复删除。核心是 `TrashManager` 结构体（`New(root)` → `root/.recycle`）。

**包级函数只剩 `Move`**（`go/cli/dedup.go` 调用）；`MoveEx`/`Restore`/`Delete`/`Empty`/`List` 的包级变体已删除（P4-1：无生产调用方，且每次 `New(filesRoot)` 新建临时 `TrashManager` 绕过 `InstallLock` 绑定，构成未持锁逃逸口）——调用方应直接用 `TrashManager` 方法并确保持锁。

## 回收站在盘上的结构

`.recycle` 内**按源文件相对资源根的 `rel` 逐层镜像**（`<recycleDir>/<rel>`），没有 `info/` 侧车元数据、没有 `.trashinfo`（历史文档曾如此描述，与当前源码树不符，勿按侧车方案设计）。因此：

- 落点即 `rel`，恢复靠 `filepath.Rel(recycleDir, src)` 反推原路径，不需要额外记录原绝对路径
- 同 `rel` 再次移入时用 `(1)`/`(2)`… 后缀落在**同一层目录**内，不覆盖既有落点
- 嵌套路径（`dir/sub/nested/x.ysm`）在回收站内保留同样层级——扁平化会让恢复时路径冲突

## 核心职责

- 删除资源时转移到 `.recycle` 目录（优先 `rename` 瞬时移动，仅跨设备回退复制）
- 恢复已删除资源（按 `rel` 反推原位；符号链接条目恢复链接本身而非跟随目标）
- 永久清空回收站（`recycle.go|TrashManager.Empty`：清空前用 `TrashManager.countEntries` 轻量计数——与 `TrashManager.List` 同过滤口径（含 `ysm.json` 的文件夹模型整组算 1、经 `registry.IsDisableSuffix`/`IsSupportedExt` 过滤后的文件条目 =1）但只计数，不构造 `[]types.ModelEntry`、不递归调 `dirSize`；原实现 `len(tm.List())` 为拿一个计数而全量物化整站）

## 删除策略

| 文件类型 | 处理方式 |
|---------|---------|
| 符号链接 | 直接删除（`deleted_link`） |
| 硬链接 (nlink>1) | 直接删除（`deleted_link`） |
| 普通文件/目录（同分区） | `os.Rename` 直接移入 `.recycle`（`recycled`，不做全量复制） |
| 跨设备（EXDEV / Win ERROR_NOT_SAME_DEVICE=17） | 仅此情形回退：复制后删除源 |

## moveEx 的 EXDEV 回退机制

`moveEx` 是 `Move`/`MoveEx` 的共同内核。**2026-10 gocyclo 清偿把它按职责拆成 5 个具名函数，落盘语义逐条保持**：

| 函数 | 职责 | 拆分前的位置 |
|------|------|-------------|
| `moveEx` | 编排：空回收站守卫 → 前置 → 落点 → rename → 跨设备回退 | 原整体 |
| `prepareMoveSource` | 越权/根级守卫 + `os.Lstat` + 符号链接/硬链接直接 `os.Remove` | 原第 1 步 |
| `resolveTrashDest` | `MkdirAll(recycleDir)` → `Rel` → 构造 `dst` → 越权校验 → 冲突后缀循环 → `MkdirAll(dst 父目录)` | 原第 2 步 |
| `verifyRenamedInside` | rename 成功后的 `IsInsideResolved(recycleDir, dst)` 事后校验 + 回滚 | 原第 3 步后半 |
| `copyThenRemove` | 跨设备回退：复制（目录递归/文件单拷）→ 半截清理 → 删源 → 删源失败回滚 | 原第 5 步 |

⚠️ **跨设备「复制后删」回退是刻意保留的必要防线（`go/AGENTS.md` 明写「不要『简化』」）**：同卷 `rename` 是原子操作，跨卷做不到，只能复制 + 删源。`copyThenRemove` 的复制 / 清理 / 回滚三步一律不得合并或删除。`fsutil.IsCrossDeviceErr` 的判定位置严格保持在**「`rename` 失败之后、任何复制动作之前」**——非跨设备错误（权限/占用）必须直接报错、不进复制分支。

落盘顺序（拆前后一致）：

1. `paths.IsInsideResolved(rootDir, src)` 越权校验（解析 symlink 防逃逸，BUG-1），并显式拒绝 `src == rootDir`（`IsInside` 对 `path==baseDir` 放行，不补这刀整树 rename 会把回收站搬进自己）→ `os.Lstat` 判链接类型（符号链接/硬链接直接 `os.Remove`）
2. 按相对路径在 `.recycle` 下构造 `dst`，重名自动加 `(1)`/`(2)`…；初始 `dst` 与每个后缀候选都复查仍在 `.recycle` 内（防越权）；非 "不存在" 错误（权限等）直接返回，不静默跳过冲突检测。**`MkdirAll(dst 父目录)` 在冲突后缀消解之后**创建——它同时是 `RemoveRepoDuplicates` 「清理失败可归因」的确定性落点（落点目录被同名普通文件占用 → 必然 "not a directory"）
3. `tm.renameForMove(src, dst)` 成功即做 `IsInsideResolved` 事后校验（P2-3 TOCTOU 防御），通过才返回 `recycled`
4. rename 失败时 **`fsutil.IsCrossDeviceErr(err)` 判定**：不是跨设备（权限/占用等）→ 直接返回错误，**不做复制**（避免大模型无谓全量复制，也避免「副本已入站、源未删」的重试堆积）
5. 确为跨设备才回退：目录走 `tm.copyDirForMove`（`copyDirRecursive` 递归整棵树）、文件走 `copyFile`；复制失败清理半截 `dst`（`RemoveAll`/`Remove`，清理失败仅记日志）；复制成功后删源，删源失败调 `rollbackAfterSourceRemoveFail` 清理已落地副本、恢复「源还在 + 副本已清理」可安全重试状态

`fsutil.IsCrossDeviceErr` 按平台隔离：`go/fsutil/crossdevice_other.go` 判 `syscall.EXDEV`；`crossdevice_windows.go` 额外判 `ERROR_NOT_SAME_DEVICE(17)`（Windows 跨卷错误码与 POSIX EXDEV 不同，必须分平台）。统一收敛自 recycle 与 installer（installer 的 errnoIs 跨设备分支已复用该原语）。

**`Restore` 同构拆分**（同一套注入点，跨设备分支对称）：`resolveRestoreDest`（守卫+落点+冲突后缀）/ `restoreSymlinkEntry`（历史符号链接条目专路：读链接目标 → 原位置重建 → 删回收站侧旧链接，重建失败回滚回收站侧链接，回滚失败在错误里披露「回收站条目已丢失」）/ `copyBackThenRemove`（复制回原位 + 半截清理 + 删源失败回滚）；`Restore` 只做编排。守卫顺序同样是「越权/根级 → `Rel` → `Join` → `IsInside` → `MkdirAll 父目录` → 冲突后缀」。

## 对外 API / 入口

- `New(root) *TrashManager` / `RecycleDir()` — 管理器构造；`renameForMove`/`copyDirForMove` 为**结构体字段形式的测试注入点**（模拟 EXDEV 与复制中途失败），生产恒为 `os.Rename`/`copyDirRecursive`，包内无可变全局
- `Move` / `MoveEx` — 移入回收站（`MoveEx` 返回 `MoveResult{Action, Reason}`，Action ∈ `recycled`/`deleted_link`/`error`；陷阱 #8：符号链接/硬链接直接删）
- `List` — 列出回收站条目（ADR-038 D3.4：含 `ysm.json` 的目录合并为单一条目并 `SkipDir`，`Size` 用 `dirSize` 递归求和；其余按 `.ban` 或受支持扩展名过滤）
- `Restore` — 恢复到原位（目标冲突自动加 `(1)` 后缀；先 `os.Rename`，失败则目录 `copyDirRecursive`、文件 `copyFile` 后删源，复制失败清理半截目标）
- `Delete` — 永久删除单个（目录用 `RemoveAll`，因整组条目 `Path` 指向目录）；`Empty` — 清空回收站（先 `List` 计数 → `RemoveAll` → 重建目录）
- `recycle_clean.go` — 回收站过期清理；`RemoveRepoDuplicates(dir, filesRoot, recycleRoot)` 清理整合包中仓库已有副本：**文件名命中 + SHA256 内容一致**才删（scanner.ComputeFileHash，候选哈希带缓存；哈希失败/超限保守保留）——语义归 [go_installer](./go-installer.md)「保留自装」备案；`DeduplicateEntries` 按 SHA256 分组保序留一
  - **守卫链与判据分层（2026-10 拆出）**：`isDedupableDir`（拒绝空路径与文件系统根——Unix `/` 与 Windows 盘符根；该断言直接测 helper 而不经 `RemoveRepoDuplicates`，避免守卫一旦回归、测试自己变成真的去遍历盘符根）→ `buildRepoFileIndex`（文件名小写 → 同名多路径）→ `fileHashCache.sizeOf/hashOf`（惰性缓存，免重复读盘）→ `contentMatchesAnyRepoCandidate`（先比大小免读盘哈希，再比 SHA256；Stat/哈希失败一律保守不匹配）→ `removeDuplicateFile`（在 `recycleRoot` 解析树内走 `Move` 移回收站「可恢复」，否则 `os.Remove` 直接删——仓库侧无损可重推；失败逐条上报 logger 的 `failed` 回调并**不计入清理数**）
  - **幂等性已钉**：同输入第二轮返回 0 且文件系统内容逐字节不变（`RemoveRepoDuplicates` 清掉的是「与仓库逐字节相同的副本」，清完即无候选）

## 与其他子系统关系

- `go/paths/`: 路径安全校验（`IsInside`）
- `go/types/`: `ModelEntry` 条目结构、`IsSupportedExt`
- 前端展示层见 [recycle_bin](./recycle-bin.md)

## 不变量

- 硬链接(nlink>1)直接删除而非移入回收站，避免断链（致命陷阱 #8）
- **只有跨设备错误才允许复制回退**；其他 rename 失败必须直接报错
- `copyDirRecursive` 遇符号链接复制链接本身（`Readlink` + `Symlink`），**不跟随**——symlink-to-dir 走 `copyFile` 会 `os.Open(目录)` + `io.Copy` 触发 EISDIR，中断整棵树复制
- 跨设备回退复制失败时必须清理半截 `dst`，不得在回收站留下损坏副本
- `dst` 每次重算后都要复查仍在 `.recycle` 目录内
- `.recycle` 目录独立于主数据存储
- **冲突后缀循环遇非 IsNotExist 错误必须返回**（P2 修复：Restore 的 `os.Stat(dst)` 返回权限类错误时原实现继续加后缀循环，错误持续则死循环——已对齐 moveEx 的 `else if err != nil { return err }` 处理）
- **`Empty` 入口必须 `Lstat(recycleDir)` 检查 symlink**（R26 P2-1 修复）：`RemoveAll` 是破坏性最强的操作，若 `.recycle` 被替换为指向外部的 symlink，`os.RemoveAll` 会跟随 symlink 删除外部目录树。正常 `.recycle` 是 `MkdirAll` 创建的普通目录，命中 symlink 即说明被篡改，一律拒绝。不用 `IsInsideResolved`：`recycleDir` 尚不存在时 `EvalSymlinks` 失败保留原路径，Windows 8.3 短名与长名解析不一致会让 `IsInside` 误判越权（`TestEmpty_RecycleDirNotExist` 回归）。
- **`moveEx` 跨设备回退源删除失败时必须回滚删除已落地的副本**（R26 P2-2 修复）：旧实现 copy 成功后 `os.Remove(src)` 失败，错误文案说「副本在 dst，请手动清理」，但源文件也还在——误导，且后续重试会堆积更多副本。回滚成功→状态回到「源还在 + 副本已清理」用户可安全重试；回滚失败→错误同时披露源路径与副本路径让上层决策。
- **`moveEx` rename 成功后必须对 dst 做 `IsInsideResolved(recycleDir, dst)` 事后校验**（R26 P2-3 修复）：防御文件系统 TOCTOU——rename 前父目录被换 symlink 可能让文件落到回收站之外。命中时尝试 `os.Rename` 回滚，回滚失败则报错让上层决策。
- **文件系统终态必须有直观看盘的断言**（2026-10 补测，`recycle_fsstate_test.go`）：`List()` 回读条目名只反映 base name，此前无任何用例直接看盘上结构或内容字节。已钉：① 移入后**源不再存在**且 `.recycle` 内按 `rel` 逐层镜像出落点（`<recycleDir>/sub/nested/deep.ysm`），同 rel 再次移入冲突后缀落在**同层**且不覆盖原落点（不丢数据）；② `Move → Restore` **往返**后目录结构逐层还原、每个文件内容**逐字节一致**（含 NUL/高位字节与多字节文件名）、回收站侧不留副本；③ `RemoveRepoDuplicates` 在 `recycleRoot` 内时走**可恢复**路径——文件能在 `.recycle/<rel>` 按原内容找回，而非凭空消失。改 `moveEx`/`Restore`/`RemoveRepoDuplicates` 前先跑这三条。

## 相关

- 致命陷阱 §三 陷阱 #8
