---
kind: go-recycle
name: 回收站 go/recycle
tier: architecture
category: go
source_files:
  - go/recycle/
use_when:
  - 回收站
  - 删除
  - 恢复
  - recycle
  - 软删除
invariant_anchors:
  - go/recycle/recycle.go|isCrossDeviceErr
  - go/recycle/recycle.go|deleted_link
---

# 回收站 go/recycle

## 概览

`go/recycle/` 包实现模型的软删除机制，通过硬链接/符号链接判定 + `.recycle` 目录实现可恢复删除。核心是 `TrashManager` 结构体（`New(root)` → `root/.recycle`），包级函数 `Move`/`MoveEx`/`List`/`Restore`/`Delete`/`Empty` 为向后兼容薄封装。

## 核心职责

- 删除资源时转移到 `.recycle` 目录（优先 `rename` 瞬时移动，仅跨设备回退复制）
- 恢复已删除资源
- 永久清空回收站

## 删除策略

| 文件类型 | 处理方式 |
|---------|---------|
| 符号链接 | 直接删除（`deleted_link`） |
| 硬链接 (nlink>1) | 直接删除（`deleted_link`） |
| 普通文件/目录（同分区） | `os.Rename` 直接移入 `.recycle`（`recycled`，不做全量复制） |
| 跨设备（EXDEV / Win ERROR_NOT_SAME_DEVICE=17） | 仅此情形回退：复制后删除源 |

## moveEx 的 EXDEV 回退机制

`moveEx` 是 `Move`/`MoveEx` 的共同内核，落盘顺序：

1. `paths.IsInside(rootDir, src)` 越权校验 → `os.Lstat` 判链接类型（符号链接/硬链接直接 `os.Remove`）
2. 按相对路径在 `.recycle` 下构造 `dst`，重名自动加 `(1)`/`(2)`…；每次构造后复查 `dst` 仍在 `.recycle` 内（防越权）；`os.Stat` 返回的非 "不存在" 错误（权限等）直接报错，不静默跳过冲突检测
3. `tm.renameForMove(src, dst)` 成功即返回 `recycled`
4. rename 失败时 **`isCrossDeviceErr(err)` 判定**：不是跨设备（权限/占用等）→ 直接返回错误，**不做复制**（避免大模型无谓全量复制，也避免「副本已入站、源未删」的重试堆积）
5. 确为跨设备才回退：目录走 `tm.copyDirForMove`（`copyDirRecursive` 递归整棵树）、文件走 `copyFile`；复制失败清理半截 `dst`（`RemoveAll`/`Remove`，清理失败仅记日志）；复制成功后删源，删源失败返回「副本已入站但源删除失败」的明确错误并提示副本位置

`isCrossDeviceErr` 按平台隔离：`isCrossDevice_other.go` 判 `syscall.EXDEV`；`isCrossDevice_windows.go` 额外判 `ERROR_NOT_SAME_DEVICE(17)`（Windows 跨卷错误码与 POSIX EXDEV 不同，必须分平台）。

## 对外 API / 入口

- `New(root) *TrashManager` / `RecycleDir()` — 管理器构造；`renameForMove`/`copyDirForMove` 为**结构体字段形式的测试注入点**（模拟 EXDEV 与复制中途失败），生产恒为 `os.Rename`/`copyDirRecursive`，包内无可变全局
- `Move` / `MoveEx` — 移入回收站（`MoveEx` 返回 `MoveResult{Action, Reason}`，Action ∈ `recycled`/`deleted_link`/`error`；陷阱 #8：符号链接/硬链接直接删）
- `List` — 列出回收站条目（ADR-038 D3.4：含 `ysm.json` 的目录合并为单一条目并 `SkipDir`，`Size` 用 `dirSize` 递归求和；其余按 `.ban` 或受支持扩展名过滤）
- `Restore` — 恢复到原位（目标冲突自动加 `(1)` 后缀；先 `os.Rename`，失败则目录 `copyDirRecursive`、文件 `copyFile` 后删源，复制失败清理半截目标）
- `Delete` — 永久删除单个（目录用 `RemoveAll`，因整组条目 `Path` 指向目录）；`Empty` — 清空回收站（先 `List` 计数 → `RemoveAll` → 重建目录）
- `recycle_clean.go` — 回收站过期清理

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

## 相关

- 致命陷阱 §三 陷阱 #8
