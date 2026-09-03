---
kind: go-watcher
name: 文件监听 go/watcher
tier: architecture
category: go
source_files:
  - go/watcher/
auto_fields:
  symbols_with_lines:
    - New
    - ScanFunc
    - Watcher
    - Watcher.IsRunning
    - Watcher.Start
    - Watcher.Stop
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 文件监听、文件变化、刷新
  - watcher、Events / errs / done
quick_risk_lines:
  - 文件变更监听必须走 go/watcher 的事件流，禁止轮询文件系统
pitfalls:
  - 轮询文件系统 → 延迟高、CPU 浪费；必须经 go/watcher 事件流
  - watcher 未读 errs/done 通道 → goroutine 泄漏；必须 drain 通道

use_when:
  - 监听
  - 文件变化
  - 刷新
  - watcher
perf:
  - io-bound
invariant_anchors:
  - go/watcher/watcher.go|evs, errs, done := w.w.Events
status: active
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
- **loop 入口必须一次性捕获本地 channel 引用**（P2 修复：原 select 每轮读共享字段 `w.w.Events`/`w.w.Errors`/`w.done`，Stop→立即 Start（restartWatcher 正是此序列）后旧 loop 读到新 watcher → 双 loop 双倍触发防抖 + `-race` 数据竞争，且旧 loop 的 recover 可能误关新 watcher）；入口捕获前须判 `w.w == nil` 直接退出——Stop 关闭即置 nil（谁关闭谁置空，与 recover 分支同一不变量，杜绝二次 Close），晚到的 loop 不再触碰已关闭 watcher
- `Start` 每次重建 `done` channel（已关闭的 channel 不可复用，ADR-031）；`syncAll` 串行化 + `wg.Wait()` 在 Unlock 后等 in-flight 同步
- **R34 P2-9 syncPending 续跑竞态修复**（watcher.go:268-280）：原实现 `pending := w.syncPending` 与 `w.syncPending = false` 在同一锁内，但 L259-262 的 `syncPending=true` 设置与 L271 `syncRunning=false` 复位之间存在窗口——若 in-flight 实例的 defer 已越过 pending 读取点，新设置的 pending 被静默丢弃。修复：在 `syncRunning=false` 复位之后、释放锁之前，重新检查 `syncPending`。

## 相关

- `go/fsutil/`
