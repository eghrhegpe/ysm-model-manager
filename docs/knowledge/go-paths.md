---
kind: go-paths
name: 路径安全 go/paths
tier: architecture
category: go
source_files:
  - go/paths/
use_when:
  - 路径
  - 安全
  - path
  - 路径校验
invariant_anchors:
  - go/paths/safe.go|IsInside
---

# 路径安全 go/paths

## 概览

`go/paths/` 包提供路径安全校验，防止路径穿越攻击和非法路径访问。

## 核心职责

- 路径合法性校验
- 防止路径穿越
- 统一路径处理

## 对外 API / 入口

- `IsInside(root, path)` — 路径越权检查，越权返回 `ErrPathEscalation`
- `ContainsMinecraftMarker` — 检测路径是否含 Minecraft 标记

## 与其他子系统关系

- 所有文件操作包均依赖此包
- `go/fsutil/`: 文件操作

## 不变量

- 所有用户输入的路径必须经过此包校验
- **实际依赖范围**：`go/installer`、`go/recycle` 与 `internal/app/resource_bindings.go` 三处引用本包（grep 核实，知识卡旧文「仅两处」已过时——审计补守卫后 resource_bindings 也 import 了 `paths.IsInside`）；`internal/app` 的 `isPathInRoot`、`go/fileops.CopyModelFile`、`go/download.ResolveSavePath`、`go/importer.sanitizePath` 均各自实现守卫（语义近似但未收敛），「单一咽喉」是理想而非现状——新增文件操作时优先复用本包
- `IsInside` **不解析符号链接**（safe.go 注释声明）：baseDir/path 含指向外部目录的符号链接时可能误判安全，调用方需自行 `filepath.EvalSymlinks`（**全仓当前无一处调用 EvalSymlinks**，P3 观察——README「用 EvalSymlinks 真实路径校验」与实际不符，属文档漂移）
- `ContainsMinecraftMarker` 覆盖**首段/单段/中间段/后缀**四种形态（P3 修复：原只查中间段与后缀，`minecraft/mods` 相对路径首段漏检）

## 相关

- `go/fsutil/`
