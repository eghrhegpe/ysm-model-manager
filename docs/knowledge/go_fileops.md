---
kind: go_fileops
name: 文件操作 go/fileops
tier: architecture
category: go
source_files:
  - go/fileops/
use_when:
  - 移动
  - 复制
  - 重命名
  - 删除
  - fileops
  - 启用禁用
  - .ban
  - ysm.json 整组操作
---

# 文件操作 go/fileops

## 概览

`go/fileops/` 包实现文件 CRUD + 移动/复制/删除 + 预览提取 + 启用禁用（ADR-003 P3 下沉，薄壳 `internal/app/app_files.go` 仅转发）。

## 核心职责

- 目录/文件创建、重命名、删除（含非法字符校验）
- 模型移动/复制（**目录感知**：`ysm.json` 提升为父目录整组操作，ADR-038 D3）
- 模型删除（目录感知：`ysm.json` 整组删父目录，守卫拒绝时回退单文件）
- 启用/禁用（`.ban` 标记，目录级 `.ban` 整组禁用，ADR-038 D3.7）
- 预览图/纹理提取（zip/7z/ysm/json 容器）

## 目录感知契约（ADR-038 D3.1/D3.6/D3.7）

| 操作 | `src` 为 ysm.json 时 | 守卫 |
|------|---------------------|------|
| `MoveModelFile` | 提升父目录整组移动 | — |
| `CopyModelFile` | 提升父目录整组复制（递归，含 .ban） | root 路径安全校验 |
| `DeleteModelFile(root, path)` | 提升父目录整组删除 | 父目录必须严格深于仓库根；根级回退单文件、仓库外显式拒绝 |
| `ToggleModelEnable(root, path)` | 提升父目录级 .ban | 根级回退文件级 .ban；父目录 .ban 识别对称 |

## 对外 API / 入口

- `CreateDir` / `RenameDir` / `RemoveDir` / `RenameFile` — 基础 CRUD（`RenameFile` 对 `ysm.json` 特判禁止改名）
- `MoveModelFile(src, dstDir)` / `CopyModelFile(root, src, dstDir)` — 模型移动/复制
- `DeleteModelFile(root, path)` — 目录感知删除（D3.6 单入口）
- `ToggleModelEnable(root, path)` / `IsFileBanned(path)` — 启用禁用（D3.7 目录级 .ban）
- `FindPreviewImage` / `ExtractPreviewTexture` / `GetPackInfo` — 预览与包信息

## 与其他子系统关系

- `internal/app/app_files.go` / `resource_bindings.go`：薄壳转发（`ToggleModelEnable` 传 `a.ysmRoot()`、`DeleteResourcePack` 传 `a.ysmRoot()`）
- `go/scanner/`：扫描缓存失效（`InvalidatePath`）
- `go/types/`：`IsYsmEntryJSON` 辅助（`ysm.json` 识别）、`ModelEntry`

## 不变量

- `ysm.json` 是模型目录清单，单文件改名/删除/禁用会散架 → 一律整组操作（ADR-038 D3）
- 目录提升必须带 root 守卫：父目录 = 仓库根 → 回退文件级；父目录在仓库外 → 显式拒绝
- `.ban` 检测大小写不敏感（Windows `.BAN` 兼容）

## 相关

- ADR-003（逻辑下沉）、ADR-038（YSM 文件夹模型契约 D3.1/D3.6/D3.7）
