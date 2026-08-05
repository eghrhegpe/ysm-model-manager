---
kind: go-sync
name: 整合包同步 go/sync
tier: architecture
category: go
source_files:
  - go/sync/sync.go
  - go/sync/sync_push.go
  - go/sync/sync_relink.go
  - go/sync/link_windows.go
  - go/sync/link_unix.go
  - go/sync/
use_when:
  - 整合包
  - 同步
  - 实例
  - 硬链接
  - 符号链接
  - 缺失
  - 多余
  - .ban
  - PrismLauncher
---

# 整合包同步 go/sync

## 概览

`go/sync/` 包负责模型库（全局仓库）与 Minecraft 整合包实例之间的同步：发现实例（原版 / PrismLauncher 布局）、按 SHA256 哈希对比出缺失/多余/禁用文件、按文件名或文件夹对比资源包差异、检测目标文件的链接类型（符号链接/硬链接/复制），并**编排推送/拉取/重链接的执行循环**（ADR-003 补充下沉，从 `internal/app/app_install.go` 提取）。单文件的实际落地（复制/硬链接/符号链接）仍由 [go_installer](./go-installer.md) 按 `LinkMode` 完成，本包只负责「算差异 + 决定对哪些条目调用 installer + 计数与失败上报」。

## 核心职责

- `sync.go` — 实例枚举、哈希差异对比、启禁状态同步、资源差异对比、链接类型判定
- `sync_push.go` — 推送/拉取执行循环（`PushResources` / `PullResources` 及单条变体、`SyncCustomToRepo`），失败逐条经注入的 `Logger` 记账、聚合成一条错误返回
- `sync_relink.go` — 重链接执行（`RelinkDir`）：按哈希把实例文件重新指向仓库版本，文件夹级类型用「备份→重建→失败回滚」保证不丢目录
- `link_windows.go` — Windows 硬链接检测（`syscall.GetFileInformationByHandle` → `NumberOfLinks`）
- `link_unix.go` — Unix/macOS 硬链接检测（`syscall.Stat_t.Nlink`）

## 对外 API / 入口

- `GetInstanceStatus(mcRoot, repoDir string, scanFn ScanFunc) []types.InstanceStatus` — 哈希对比模型仓库与各实例 custom 目录，产出 Missing/Extra/Disabled/Files（链接类型）
- `GetInstanceStatusWith(mcRoot, repoDir string, scanFn ScanFunc, listFn ListVersionsFunc)` — 可注入 listFn 的测试变体
- `SyncToggleStatus(instanceCustomDir, repoRoot string, scanFn ScanFunc) (int, int, error)` — 把仓库 `.ban` 启禁状态同步到实例文件（哈希 → 相对路径 → 纯文件名三级匹配，重命名加/去 `.ban` 后缀），返回禁用数、启用数
- `ListVersions(mcRoot string) []types.VersionInstance` — 枚举实例，三种布局：目录本身是 instances（子目录含 `.minecraft`/`minecraft`）、PrismLauncher `{mcRoot}/instances/{name}/.minecraft/`、标准 `{mcRoot}/versions/{name}/`
- `HasDotMinecraftSubdirs(path string) bool` / `FindMinecraftDir(parentDir string) string` — 实例布局探测辅助
- `SyncResources(globalDir, instanceDir string) types.ResourceSyncResult` — 按文件名对比全局 ↔ 整合包资源（资源包/光影包等）；含 `pack.mcmeta` 的文件夹作为整体单元、不递归
- `SyncResourcesDirLevel(globalDir, instanceDir, rtype string) types.ResourceSyncResult` — 按文件夹名对比（YSM 的 ysm.json 文件夹 / MMD 的 .pmx/.pmd 文件夹），同名时文件夹优先于平铺文件
- `CompareGlobalInstanceHashes(mcRoot, globalDir, subDir, rtype string, scanFn ScanFunc, listFn ListVersionsFunc, hasModFn HasModInDirFn) []types.InstanceStatus` — 非 YSM 资源类型的通用实例哈希对比
- `GetLinkType(path string) types.LinkType` — 判定 `symlink` / `hardlink` / `copy` / `unknown`
- `SortEntries(entries []types.ModelEntry)` — 按名称排序
- `PushResources(rtype, globalDir, targetDir, linkMode string, logger Logger) (int, error)` — 推送缺失资源；`ysm` / `mmd-skin` 走文件夹级（`SyncResourcesDirLevel` + `installer.InstallDir`），其余走文件级（`SyncResources` + `installer.Install`）
- `PullResources(rtype, globalDir, targetDir string, logger Logger) (int, error)` — 把实例侧 Extra 拉回仓库（纯复制，不建链接）
- `PushSingleResource(filePath, customDir, globalDir, linkMode, rtype string) error` / `PullSingleResource(globalDir, targetDir, srcPath string) error` — 单条推送/拉取；`.json`/`.pmx`/`.pmd` 与目录按整文件夹处理
- `SyncCustomToRepo(customDir, repoDir string, scanFn, logger) (int, error)` — 把实例 custom 目录的模型收编回仓库，同哈希/同名跳过
- `RelinkDir(customDir, repoRoot, rtype, linkMode string, scanFn, logger) (int, error)` — 按哈希重链接实例目录到仓库版本
- 函数类型：`ScanFunc`（扫描注入，由 internal/app 提供）、`ListVersionsFunc`、`HasModInDirFn`、`Logger`（导入日志回调，薄壳注入 `App.logger.Add`）

## 与其他子系统关系

- 被 `internal/app/app_install.go` 调用（状态对比、推送/拉取、启禁同步、`GetLinkType` 决定删除策略）
- 被 `internal/app/app_scan.go` 调用（`ListVersions`）、`internal/app/app_config.go` 引用
- 被 [go_watcher](./go-watcher.md) 调用（文件变更时 `ListVersions` + `SyncToggleStatus` 自动同步启禁）
- 依赖 `go/types`（ModelEntry/InstanceStatus/LinkType 等）、`go/ysm`（`ysm.HasYSMMod` 检测实例 mod）
- `sync_push.go` / `sync_relink.go` 反向依赖 [go_installer](./go-installer.md)（`Install` / `InstallDir` / `CopyFile`）——本包→installer 是单向的，installer 不得回调本包

## 不变量

- `.ban` 后缀 = 禁用模型：仓库侧 `.ban` 文件不进缺失列表；实例中对应哈希的文件标记 Disabled 而非 Extra
- 哈希只读文件前 100MB（`maxHashRead`），超大文件截断哈希
- **所有扫描路径都必须排除 `.recycle`**，与 `scanner.ScanEntries` 口径对齐：`SyncResources` 的全局侧（`sync.go:400`）与实例侧（`sync.go:428`）Walk、`SyncResourcesDirLevel` 的 `collectEntries`（`sync.go:539`）均按 `strings.EqualFold(info.Name(), ".recycle")` 返回 `filepath.SkipDir`，`SyncToggleStatus` 用路径子串排除（`sync.go:170`）。漏排会把回收站里的模型当成仓库活跃模型，同步管理器显示 missing 且可被推送回实例（回归测试 `sync_test.go:349` `TestSyncResources_IgnoresRecycleDir`）
- 前两处 SkipDir 带 `path != 根目录` 守卫：若用户把仓库根/实例根本身命名为 `.recycle` 则不跳过，否则整次扫描会直接空掉；`SyncResourcesDirLevel` 一侧无此守卫因为它已先排除 `path == rootDir`
- 哈希对比类入口（`GetInstanceStatus` / `CompareGlobalInstanceHashes`）自身不 Walk 仓库，`.recycle` 的排除依赖注入的 `scanFn`（即 `scanner.ScanEntries`）——换用不排 `.recycle` 的 scanFn 会重新引入误判
- `SyncResources` 同名文件按**大小**判定内容是否变化（复制会改 mtime，mtime 不可靠），大小不同归入 Missing 视为待更新；三个结果列表返回前均 `sort.Strings` 排序
- `isSyncAllowed` 只放行 `types.AllExts()` 的扩展名，`.json` 中仅 `ysm.json` 例外——动画/控制器等散装 JSON 不单独推送
- 文件被占用（如 Minecraft 锁定）时 `isFileLocked` 识别后静默跳过不阻塞（errno 优先：Win ERROR_SHARING_VIOLATION(32) / Unix EBUSY(16)，再按消息兜底）
- `RelinkDir` 处理文件夹级类型时先把旧目录 rename 成 `.relink-bak`，重建成功才删备份、失败则回滚恢复——不能先 `RemoveAll` 再重建，否则失败即整目录丢失
- 硬链接检测跨平台分实现，系统调用失败一律降级 `LinkCopy`；`GetLinkType` 必须先 `os.Lstat` 判 `os.ModeSymlink`（`sync.go:588-594`）——用 `os.Stat` 会跟随链接、把符号链接误判成普通文件，进而按「复制」策略走回收站
- 链接类型是删除策略依据：硬链接(nlink>1)/符号链接直接删，普通文件才移回收站（致命陷阱 #8）
- 拉取侧 `copyFile`（`sync_push.go:221`）是**跟随符号链接**的裸复制：`os.Open` + `io.Copy`，不保留链接语义、不 chmod、失败不清理半截目标文件。`PullResources` / `PullSingleResource` 遍历文件夹时按 `e.IsDir()` 跳过子目录，而指向目录的符号链接 `IsDir()` 为 false 不被跳过，会走进 `copyFile` 并在 `io.Copy` 阶段报错（EISDIR 类）——该条目计 failed 但循环继续，不会中断整组拉取。这与 [go_recycle](./go-recycle.md) 的 `copyDirRecursive` 已改用 `os.Readlink` + `os.Symlink` 保留链接的做法不同，本包尚未对齐
- 实例 custom 目录固定为 `config/yes_steve_model/custom`

## 相关

- [go_installer](./go-installer.md) — 按 LinkMode 实际落地复制/硬链接/符号链接
- [go_recycle](./go-recycle.md) — 删除时按链接类型分流
- [go_watcher](./go-watcher.md) — 文件监听触发自动同步
- AGENTS.md 致命陷阱 §二 #8（硬链接误删）
