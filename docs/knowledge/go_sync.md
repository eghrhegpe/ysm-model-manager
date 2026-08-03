---
kind: go_sync
name: 整合包同步 go/sync
tier: architecture
category: go
source_files:
  - go/sync/sync.go
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

`go/sync/` 包负责模型库（全局仓库）与 Minecraft 整合包实例之间的同步状态计算：发现实例（原版 / PrismLauncher 布局）、按 SHA256 哈希对比出缺失/多余/禁用文件、按文件名或文件夹对比资源包差异，并检测目标文件的链接类型（符号链接/硬链接/复制）。链接的实际创建（硬链接/符号链接/复制）由 [go_installer](./go_installer.md) 按 `LinkMode` 执行，本包只做检测与差异对比。

## 核心职责

- `sync.go` — 实例枚举、哈希差异对比、启禁状态同步、资源差异对比、链接类型判定
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
- 函数类型：`ScanFunc`（扫描注入，由 internal/app 提供）、`ListVersionsFunc`、`HasModInDirFn`

## 与其他子系统关系

- 被 `internal/app/app_install.go` 调用（状态对比、推送/拉取、启禁同步、`GetLinkType` 决定删除策略）
- 被 `internal/app/app_scan.go` 调用（`ListVersions`）、`internal/app/app_config.go` 引用
- 被 [go_watcher](./go_watcher.md) 调用（文件变更时 `ListVersions` + `SyncToggleStatus` 自动同步启禁）
- 依赖 `go/types`（ModelEntry/InstanceStatus/LinkType 等）、`go/ysm`（`ysm.HasYSMMod` 检测实例 mod）

## 不变量

- `.ban` 后缀 = 禁用模型：仓库侧 `.ban` 文件不进缺失列表；实例中对应哈希的文件标记 Disabled 而非 Extra
- 哈希只读文件前 100MB（`maxHashRead`），超大文件截断哈希
- `SyncToggleStatus` 跳过 `.recycle` 目录；文件被占用（如 Minecraft 锁定）时静默跳过不阻塞
- 硬链接检测跨平台分实现，系统调用失败一律降级 `LinkCopy`
- 链接类型是删除策略依据：硬链接(nlink>1)/符号链接直接删，普通文件才移回收站（致命陷阱 #8）
- 实例 custom 目录固定为 `config/yes_steve_model/custom`

## 相关

- [go_installer](./go_installer.md) — 按 LinkMode 实际创建硬链接/符号链接/复制
- [go_recycle](./go_recycle.md) — 删除时按链接类型分流
- [go_watcher](./go_watcher.md) — 文件监听触发自动同步
- AGENTS.md 致命陷阱 §二 #8（硬链接误删）
