---
kind: go-installer
name: 模型安装 go/installer
tier: architecture
category: go
source_files:
  - go/installer/installer.go
  - go/installer/
use_when:
  - 安装
  - installer
  - 模型导入
  - 下载模型
---

# 模型安装 go/installer

## 概览

`go/installer/`（单文件 `installer.go`）负责把仓库中的模型/资源文件**落地**到 Minecraft 整合包实例目录：按 `LinkMode`（`copy` / `hardlink` / `symlink`）选择落地方式，落地前做路径安全校验，落地时对已存在目标做原子替换，失败时把系统错误分类成可操作的中文提示。它是被动的执行层，不监听下载/事件、不直接与前端通信。

## 核心职责

- 路径清理与安全校验：`cleanAbs` + `paths.ContainsMinecraftMarker`（目标必须在 `.minecraft` 内）+ `paths.IsInside`（源必须在仓库内）
- 按 `LinkMode` 落地单文件：复制 / 硬链接 / 符号链接，链接目标已存在时原子替换
- 目录树递归安装（`installDirRecursive`），按 `rtype` 白名单过滤扩展名（MMD 配套纹理、YSM 配套 JSON/图）
- 链接失败的错误分类（`linkErr` / `symlinkErr`）：跨分区 / 权限不足 / 其他，均落为 `LINK_FAILED` + 修复建议
- 仓库根目录合法性校验（`IsValidRepoRoot`，拒绝盘符根与系统目录）

## 对外 API / 入口

- `Install(src, customDir, repoRoot, linkMode string) error` — 安装单个模型；按 `src` 相对 `repoRoot` 的位置在 `customDir` 下还原目录结构
- `InstallDir(srcDir, dstDir, repoRoot, linkMode, rtype string) error` — 安装整个文件夹（MMD/YSM 的模型+纹理成组），目标为 `dstDir/{srcDir 基名}`，内部 `installDirRecursive` 递归
- `InstallToGlobal(src, mcRoot string) (string, error)` — 复制到 `{mcRoot}/config/yes_steve_model/custom`（固定复制，不走链接）
- `InstallWithOverlay(src, customDir string) (string, error)` — 带冲突检查的复制；目标已存在时返回 `"CONFLICT:"+dst` 与 `ALREADY_EXISTS` 错误，不覆盖
- `CopyFile(src, dstDir string) (string, error)` — 加锁的单文件复制
- `IsValidRepoRoot(path string) bool` — 仓库根目录合法性校验
- 包内实现：`copyFileLocked` / `linkOrCopyLocked` / `symlinkOrCopyLocked`（`*Locked` 后缀 = 调用方须已持有 `installLock`）及其带锁包装 `linkOrCopy` / `symlinkOrCopy`、`cleanAbs`、`installDirRecursive`、`sameSource`、`errnoIs`、`linkErr` / `symlinkErr`、`isSupportedModelExt`

## 与其他子系统关系

- 被 `internal/app/app_install.go`（安装/全局安装/覆盖安装）与 `internal/app/resource_bindings.go`（资源类型推送）调用
- 被 [go_sync](./go-sync.md) 的 `sync_push.go`（推送）与 `sync_relink.go`（重链接）调用——同步差异算出来后由本包执行落地
- 依赖 [go_paths](./go-paths.md)（`ContainsMinecraftMarker` / `IsInside`）、[go_types](./go-types.md)（`AppError` / `IsSupportedExt` / `AllExts`）
- 与 [go_download](./go-download.md) **无直接调用关系**：下载产物先入仓库，再由上层触发安装

## 不变量

- 所有对外入口先取包级 `installLock`（`sync.Mutex`）串行化，防止安装与后台同步并发写同一文件；`*Locked` 函数不得在未持锁时直接调用
- 目标目录必须包含 `.minecraft` 标记，还原相对目录后**再校验一次**子目录（防路径穿越）；`repoRoot` 非空时源文件必须在仓库内
- 尽管函数名叫 `linkOrCopy` / `symlinkOrCopy`，链接失败时**不会自动回退复制**：返回 `LINK_FAILED` 并在 `Suggestion` 中提示用户切换复制模式，降级由用户决定
- 目标已存在时：`os.SameFile` 判定同源则幂等返回；否则先建 `.link-tmp` / `.symlink-tmp` 再 `os.Rename` 原子替换，替换失败清理临时文件、不破坏原文件；注意替换阶段失败返回的是 `IO_ERROR`（"替换目标文件失败"）而非 `LINK_FAILED`——`LINK_FAILED` 只由建链接本身失败产生
- 错误分类 **errno 优先且分平台**（`errnoIs`，Windows 用 Win32 码、Unix 用 POSIX errno，两者数值语义不同不可混用）：`linkErr` 跨设备 = EXDEV(18) / ERROR_NOT_SAME_DEVICE(17)（`installer.go:393`）、权限 = EACCES(13)、EPERM(1) / ERROR_ACCESS_DENIED(5)（`installer.go:396`）；`symlinkErr` 特权 = EPERM(1) / ERROR_PRIVILEGE_NOT_HELD(1314)、EACCES(13) / ERROR_ACCESS_DENIED(5)（`installer.go:413`）
- 文本兜底匹配已收窄（`installer.go:401`）：只认 `cross-device` / `different device` / `not same device` 三个跨设备特征短语，不再用 `different` 这类过宽子串误伤无关错误；兜底仅作用于 `linkErr` 的跨设备判定，`symlinkErr` 无跨设备分支，只按 `access` / `privilege` / `permission` 归权限类（`installer.go:418`），两者最终都有兜底 `LINK_FAILED`（"硬链接失败" / "符号链接失败"）
- 复制中断/失败会删除半截目标文件，成功后 `chmod 0644`；`src == dst` 直接返回
- **原子文件替换模式**（审计发现）：写入文件时先写入 `.tmp` 临时文件，成功后 `os.Rename` 原子替换目标文件；失败时删除临时文件，不破坏原文件（`linkOrCopyLocked` / `symlinkOrCopyLocked` 的 `.link-tmp` / `.symlink-tmp` 模式）。`copyFileLocked` 同为原子替换（`.copy-tmp` + Rename，失败仅删 tmp）——知识卡旧文「copyFileLocked 失败删除半截目标文件」已被原子替换取代，属陈旧描述。
- **TOCTOU 缩小模式**（审计发现）：文件存在性检查（`os.Stat`）和写入操作（`os.WriteFile`/`os.Rename`）应在**同一函数内**完成，缩小时间窗口。`InstallWithOverlay` 的防覆盖检查在 `InstallWithOverlay` 内（`installer.go:249-251`），靠 `installLock` 临界区闭合 TOCTOU——**未下沉到 `copyFileLocked`**（源码注释明确「不能下沉——会破坏 Install/RelinkDir 的覆盖替换语义」；知识卡旧文「检查已移入 copyFileLocked」记录的是被回退的方案，已修正）。
- `installDirRecursive` 单个文件失败不中断整棵树，逐条记日志并聚合成一条错误返回；扩展名白名单：`mmd-skin` → `.pmx/.pmd/.png/.tga/.spa/.sph`，`ysm` → `.json/.png/.jpg/.jpeg`，其余 rtype 全放行
- 扩展名校验兼容 `.ban` 变体（先剥 `.ban` 再判 `types.IsSupportedExt`）

## 相关

- [go_sync](./go-sync.md) — 差异计算与推送/重链接编排
- [go_paths](./go-paths.md) — 路径安全校验
- [go_recycle](./go-recycle.md) — 删除时按链接类型分流
- AGENTS.md 致命陷阱 §二 #8（硬链接误删）
