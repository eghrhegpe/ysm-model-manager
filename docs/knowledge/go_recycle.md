---
kind: go_recycle
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
---

# 回收站 go/recycle

## 概览

`go/recycle/` 包实现模型的软删除机制，通过硬链接/符号链接 + `.recycle` 目录实现可恢复删除。

## 核心职责

- 删除资源时转移到 `.recycle` 目录
- 恢复已删除资源
- 永久清空回收站

## 删除策略

| 文件类型 | 处理方式 |
|---------|---------|
| 符号链接 | 直接删除 |
| 硬链接 (nlink>1) | 直接删除 |
| 普通文件 | 移入 `.recycle` |
| 跨分区文件 | 复制后删除 |

## 对外 API / 入口

- `Move` / `MoveEx` — 移入回收站（`MoveEx` 返回操作详情；陷阱 #8：符号链接/硬链接直接删，普通文件复制后删进 `.recycle`）
- `List` — 列出回收站文件；`Restore` — 恢复（目标冲突自动加 `(1)` 后缀）
- `Delete` — 永久删除单个；`Empty` — 清空回收站（RemoveAll + 重建目录）

## 与其他子系统关系

- `go/fsutil/`: 文件遍历与属性读取
- `go/paths/`: 路径安全校验

## 不变量

- 硬链接(nlink>1)直接删除而非移入回收站，避免断链（致命陷阱 #8）
- `.recycle` 目录独立于主数据存储

## 相关

- 致命陷阱 §三 陷阱 #8
