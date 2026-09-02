---
kind: go-logs
name: 导入日志 go/logs
tier: architecture
category: go
source_files:
  - go/logs/logs.go
  - go/logs/runtime.go
quick_groups:
  - 文件操作与标签
quick_intents:
  - 导入日志、操作记录、日志
  - import log、历史
quick_risk_lines:
  - 导入日志必须走 go/logs 的 WriteFileAtomic 追加，禁止直接 os.WriteFile
pitfalls:
  - 直接 os.WriteFile → 并发写破坏日志；必须经 WriteFileAtomic 原子追加
  - 日志未轮转 → 单个文件无限膨胀；必须经日志轮转策略

use_when:
  - 导入日志
  - 操作记录
  - 日志
  - import log
  - 历史
perf:
  - io-bound
invariant_anchors:
  - go/logs/logs.go|fsutil.WriteFileAtomic
status: active
---

# 导入日志 go/logs

## 概览

`go/logs/` 包提供两套互不相干的日志设施：**操作日志**（`Logger`，持久化）把导入/扫描/下载/同步/重命名/删除/UI 报错等操作的成败结果写入用户配置目录下的 `ysm-import-logs.json`；**运行时日志**（`RuntimeBuffer`，仅内存）接管标准库 `log` 的输出，把 watcher/sync 等后台组件的 `log.Printf` 收进环形缓冲，供诊断页的「运行时日志」标签页查看。

## 核心职责

- `logs.go` — `Logger` 的加载、追加、截断、落盘（系统标准配置目录：Windows `%APPDATA%`、Linux `~/.config`、macOS `~/Library/Application Support` 下的 `YSM-Model-Manager/`）
- `runtime.go` — `RuntimeBuffer` 环形缓冲：实现 `io.Writer` 供 `log.SetOutput` 接管，一次 `Write` 记一条 `types.RuntimeLog`（消息 + Unix 毫秒时间戳 + `Level=LevelInfo` 默认值），超容量丢弃最旧

## 对外 API / 入口

- `NewLogger() *Logger` — 创建并加载历史日志；配置目录不可得时逐级降级到当前目录
- `(*Logger) Add(modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string)` — 记一条导入日志（op 固定 `"import"`，兼容旧调用）
- `(*Logger) AddOp(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string)` — 记指定操作类型的日志（op: import/scan/download/sync/rename/delete/ui）
- `(*Logger) GetAll() []types.ImportLog` — 返回全部日志的副本
- `(*Logger) Clear()` — 清空并落盘
- `NewRuntimeBuffer(capacity int) *RuntimeBuffer` — 创建运行时日志环形缓冲；`capacity <= 0` 时回退 200
- `(*RuntimeBuffer) Write(p []byte) (int, error)` — `io.Writer` 实现，供 `log.SetOutput` 挂载
- `(*RuntimeBuffer) GetAll() []types.RuntimeLog` / `(*RuntimeBuffer) Clear()` — 读取副本 / 清空

## 与其他子系统关系

- 被 `internal/app/app.go` 持有：`logger`（`NewLogger()`）与 `runtimeLogs`（`NewRuntimeBuffer(200)`）两个字段；启动时 `log.SetOutput(io.MultiWriter(os.Stderr, a.runtimeLogs))`（app.go NewLogger）把标准库 log 同时写终端与缓冲
- 被 `internal/app/app_install.go` 在导入/推送/删除各路径记录 success/failed/skipped/warn；该文件同时提供 `AddOpLog` 与 `GetRuntimeLogs` / `ClearRuntimeLogs` 三个 binding
- 前端 `core/error-diary.ts` 监听所有 error toast，自动以 op=`"ui"` 写入日记，使 UI 报错持久化可回溯
- 前端 `views/app-content/diagnostics/logs.ts` 消费两者：操作日志按 `Operation` 字段分组渲染（`OP_META` 给出 import/scan/download/sync/rename/delete/ui 七种中文标签+图标；组头右侧显示「N 条」），行内状态图标**优先读 `Level` 字段**（error→❌ / warn→⚠️ / debug→🔍 / fatal→💀 / info→✅），无 Level 时按 `Status` 兜底（success→✅ / failed→❌ / warn→⚠️ / skipped→⏭️），向后兼容旧日志
- 依赖 `go/types`（`ImportLog` / `RuntimeLog` 结构，含 `Level` 字段）

## 不变量

- 两个结构各自用 `sync.Mutex` 保护全部读写；`Logger.save()` 只允许在持锁状态下调用（由 `addOp` / `Clear` 保证）
- 操作日志上限 500 条、运行时日志上限 `cap`（应用侧取 200），超出均裁掉最旧
- `Timestamp` 一律 Unix 毫秒
- `Operation` 为空的历史日志前端按 `"import"` 归组；后端不做补齐，`Add()` 写入时固定填 `"import"`
- **`Level` 字段**（`LogLevel`）：`ImportLog` 由 `addOp` 调用 `statusToLevel` 自动派生（`success`→info, `failed`→error, `warn`→warn, `skipped`→debug），`RuntimeLog` 在 `RuntimeBuffer.Write` 默认标记 `LevelInfo`；旧日志无 Level 时前端按 `Status` 兜底，兼容历史数据
- **分组纯属前端呈现**：后端 `GetAll()` 只按写入顺序平铺返回，不排序不分组；前端先 `slice(-500).reverse()` 取最近 500 条转时间倒序，再用 `Map` 按 op 归组，故组的先后 = 该 op 最新一条出现的先后，组内保持时间倒序。后端改变返回顺序会直接改变诊断页组序
- 运行时日志只在内存，不落盘、重启即失；操作日志落盘失败只记系统 log、不向上抛错（日志不阻塞主流程）
- `RuntimeBuffer.Write` 按调用次数分条（标准库 log 一行一次 Write），不解析日志级别，消息保留原始换行
- **落盘原子性 + 损坏恢复**：tmp+rename 原子替换（rename 失败清理 tmp）；损坏 `ysm-import-logs.json` 备份 `.corrupt` 后重建空存储（对齐 tags.go 模式）；JSON `null` 内容守卫已封（`logs.go` null 守卫）
- **RuntimeBuffer 已有测试覆盖**（P3 补测：`runtime_test.go` 覆盖 Write 分条/环形丢弃最旧/cap≤0 回退 200/GetAll 副本/Clear；损坏恢复的 `.corrupt` 备份断言与 load 端 500 裁剪为 P4 待补）

## 相关

- [wails_bridge](./wails-bridge.md) — 日志查询/清空 binding
- [go_types](./go-types.md) — `ImportLog` 定义
