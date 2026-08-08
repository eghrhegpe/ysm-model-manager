---
kind: go-watcher
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
- 变更后自动同步启用/禁用状态到整合包 + 清扫描缓存（前端经缓存失效间接感知变化，不直接发 Wails 事件）

## 对外 API / 入口

- `New` — 创建 `Watcher`
- `Start` / `Stop` — 启动/停止文件监听（`loop` 轮询 + `debounceSync` 防抖合并）
- `IsRunning` — 当前是否运行中
- `syncAll` — 全量同步入口（内部供 loop 调用）

## 与其他子系统关系

- 被 `internal/app/app.go` 启动/停止（ServiceStartup / ServiceShutdown），`clearCacheFn` 注入 `App.ClearScanCache`；变更后自动同步整合包 `.ban` 状态（`go/sync` 的 `SyncToggleStatus`），前端刷新靠扫描缓存失效间接感知，不直接发 Wails 事件
- `go/fsutil/`: 文件系统工具

## 不变量

- 文件变化事件必须去重（800ms 防抖 + syncRunning/syncPending 串行化）
- **loop 入口必须一次性捕获本地 channel 引用**（P2 修复：原 select 每轮读共享字段 `w.w.Events`/`w.w.Errors`/`w.done`，Stop→立即 Start（restartWatcher 正是此序列）后旧 loop 读到新 watcher → 双 loop 双倍触发防抖 + `-race` 数据竞争，且旧 loop 的 recover 可能误关新 watcher）
- `Start` 每次重建 `done` channel（已关闭的 channel 不可复用，ADR-031）；`syncAll` 串行化 + `wg.Wait()` 在 Unlock 后等 in-flight 同步

## 相关

- `go/fsutil/`
