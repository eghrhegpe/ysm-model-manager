---
kind: go_logs
name: 导入日志 go/logs
tier: architecture
category: go
source_files:
  - go/logs/logs.go
use_when:
  - 导入日志
  - 操作记录
  - 日志
  - import log
  - 历史
---

# 导入日志 go/logs

## 概览

`go/logs/` 包提供应用操作日志的持久化记录器，把导入/扫描/下载/同步/重命名/删除等操作的成败结果写入用户配置目录下的 `ysm-import-logs.json`，供前端日志面板回溯。

## 核心职责

- `logs.go` — Logger 的加载、追加、截断、落盘（系统标准配置目录：Windows `%APPDATA%`、Linux `~/.config`、macOS `~/Library/Application Support` 下的 `YSM-Model-Manager/`）

## 对外 API / 入口

- `NewLogger() *Logger` — 创建并加载历史日志；配置目录不可得时逐级降级到当前目录
- `(*Logger) Add(modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string)` — 记一条导入日志（op 固定 `"import"`，兼容旧调用）
- `(*Logger) AddOp(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string)` — 记指定操作类型的日志（op: import/scan/download/sync/rename/delete）
- `(*Logger) GetAll() []types.ImportLog` — 返回全部日志的副本
- `(*Logger) Clear()` — 清空并落盘

## 与其他子系统关系

- 被 `internal/app/app.go` 持有（`logger` 字段，启动时 `NewLogger()`）
- 被 `internal/app/app_install.go` 在导入/推送/删除各路径记录 success/failed/skipped/warn，并经 Wails binding 暴露查询/清空
- 依赖 `go/types`（`ImportLog` 结构）

## 不变量

- 全部读写由 `sync.Mutex` 保护；`save()` 只允许在持锁状态下调用（由 Add/AddOp/Clear 保证）
- 日志上限 500 条，超出裁掉最旧
- `Timestamp` 为 Unix 毫秒
- 落盘失败只记系统 log、不向上抛错（日志不阻塞主流程）

## 相关

- [wails_bridge](./wails_bridge.md) — 日志查询/清空 binding
- [go_types](./go_types.md) — `ImportLog` 定义
