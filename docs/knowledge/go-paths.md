---
kind: go-paths
name: 路径安全 go/paths
tier: architecture
category: go
source_files:
  - go/paths/
auto_fields:
  symbols_with_lines:
    - ContainsMinecraftMarker
    - ErrEmptyBase
    - ErrEmptyPath
    - ErrNotInside
    - ErrNULByte
    - ErrPathEscalation
    - ErrPathEscalation.Error
    - ErrPathEscalation.Unwrap
    - ErrRelFailed
    - ErrResolveBase
    - ErrResolvePath
    - HasTraversal
    - IsInside
    - IsInsideResolved
    - ResolveOrKeep
  quick_groups:
    - 文件操作与标签
  quick_intents:
    - 路径安全、路径校验、path
    - IsInside / IsInsideResolved
    - 路径穿越
  quick_risk_lines:
    - 路径校验必须走 go/paths 的 IsInside，禁止手写路径安全检查
  pitfalls:
    - 手写路径安全检查 → 越权路径穿越、符号链接绕过；必须经 IsInside
    - 符号链接未解析 → 路径穿越绕过 IsInside；必须用 IsInsideResolved 处理符号链接
  use_when:
    - 路径
    - 安全
    - path
    - 路径校验
  invariant_anchors:
    - go/paths/safe.go|IsInside
    - go/paths/safe.go|IsInsideResolved
quick_groups:
  - 文件操作与标签
quick_intents:
  - 路径安全、路径校验、path
  - IsInside / IsInsideResolved
  - 路径穿越
quick_risk_lines:
  - 路径校验必须走 go/paths 的 IsInside，禁止手写路径安全检查
pitfalls:
  - 手写路径安全检查 → 越权路径穿越、符号链接绕过；必须经 IsInside
  - 符号链接未解析 → 路径穿越绕过 IsInside；必须用 IsInsideResolved 处理符号链接

use_when:
  - 路径
  - 安全
  - path
  - 路径校验
invariant_anchors:
  - go/paths/safe.go|IsInside
  - go/paths/safe.go|IsInsideResolved
status: active
---

# 路径安全 go/paths

## 概览

`go/paths/` 包提供路径安全校验，防止路径穿越攻击和非法路径访问。

## 核心职责

- 路径合法性校验
- 防止路径穿越
- 统一路径处理

## 对外 API / 入口

- `IsInside(root, path)` — 路径越权检查，越权返回 `ErrPathEscalation`（纯词法，不解析符号链接）
- `IsInsideResolved(root, path)` — 解析两侧 symlink 后再判定（BUG-1 修复），拦截 baseDir/path 中指向外部的 symlink 段逃逸；无 symlink 时结论与 `IsInside` 一致
- `ContainsMinecraftMarker` — 检测路径是否含 Minecraft 标记

## 与其他子系统关系

- 所有文件操作包均依赖此包
- `go/fsutil/`: 文件操作

## 不变量

- 所有用户输入的路径必须经过此包校验
- **实际依赖范围**：`go/installer`、`go/recycle` 与 `internal/app/resource_bindings.go` 三处引用本包（grep 核实，知识卡旧文「仅两处」已过时——审计补守卫后 resource_bindings 也 import 了 `paths.IsInside`）；`internal/app` 的 `isPathInRoot`、`go/fileops.CopyModelFile`、`go/download.ResolveSavePath`、`go/importer.sanitizePath` 均各自实现守卫（语义近似但未收敛），「单一咽喉」是理想而非现状——新增文件操作时优先复用本包
- `IsInside` **不解析符号链接**（safe.go 注释声明）：baseDir/path 含指向外部目录的符号链接时可能误判安全，调用方需自行 `filepath.EvalSymlinks`——go/installer 已落地该模式（installer.go `evalSymlinksOrKeep`/`checkDstSymlinkSegments`，Install/InstallDir 在守卫前解析真实路径）
- `IsInsideResolved`（BUG-1 修复）是「`EvalSymlinks` 两侧 → 再 `IsInside`」的规范入口：词法快速失败零 I/O，词法通过才解析真实路径二次复核；`EvalSymlinks` 失败保留原路径不放宽不放窄。仅覆盖**已存在路径**的 symlink 逃逸——**未创建写入目标**的中段 symlink 由 `fileops.checkNoSymlinkInPath` / `installer.checkDstSymlinkSegments` 逐段 Lstat 另判。已迁调用点：`recycle.Delete/moveEx/Restore`、`recycle_clean.ClearInstanceResources`、`resource_bindings.ToggleResourcePack`、`app_files.toggleRootFor`；其余守卫（isPathInRoot 等）仍未解析，属待收敛
- `ContainsMinecraftMarker` 覆盖**首段/单段/中间段/后缀**四种形态（P3 修复：原只查中间段与后缀，`minecraft/mods` 相对路径首段漏检）

## 相关

- `go/fsutil/`
