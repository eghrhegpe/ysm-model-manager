---
kind: go_watcher
name: 文件监听 go/watcher
tier: architecture
category: go
source_files:
  - go/watcher/
use_when:
  - 监听
  - 文件变化
  - 刷新
  - watcher
---

# 文件监听 go/watcher

## 概览

`go/watcher/` 包监听资源目录的文件系统变化，触发前端资源树刷新。

## 核心职责

- 监听文件新增/修改/删除
- 去重事件（批量操作只触发一次）
- 通知前端资源树更新

## 对外 API / 入口

- `New` — 创建 `Watcher`
- `Start` / `Stop` — 启动/停止文件监听（`loop` 轮询 + `debounceSync` 防抖合并）
- `IsRunning` — 当前是否运行中
- `syncAll` — 全量同步入口（内部供 loop 调用）

## 与其他子系统关系

- 通过 Wails EventsOn 将变化事件通知前端
- `go/fsutil/`: 文件系统工具

## 不变量

- 文件变化事件必须去重

## 相关

- `go/fsutil/`
