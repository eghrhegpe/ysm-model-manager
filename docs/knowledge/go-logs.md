---
kind: go-logs
name: 导入日志 go/logs
tier: architecture
category: go
source_files:
  - go/logs/logs.go
  - go/logs/runtime.go
  - go/logs/ring.go
auto_fields:
  symbols_with_lines:
    - DefaultRuntimeCap
    - Logger
    - Logger.Add
    - Logger.AddErr
    - Logger.AddOp
    - Logger.AddOpErr
    - Logger.Cap
    - Logger.Clear
    - Logger.Flush
    - Logger.GetAll
    - Logger.Health
    - NewLogger
    - NewRuntimeBuffer
    - RuntimeBuffer
    - RuntimeBuffer.Cap
    - RuntimeBuffer.Clear
    - RuntimeBuffer.GetAll
    - RuntimeBuffer.Write
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
  - 「落盘失败只记系统 log」已不是完整事实 —— 另有 `Health()` 锁存位 + `[meta]` runtime 环保底（ADR-322 D1/D3）；只 log.Printf 等于退回元失败盲区
  - 裁剪逻辑在 op 环与 runtime 环各写一遍 → 两处实现漂移一次即产生「op 环保底而 runtime 环不保底」的半修静默态；一律走 `ring.go` `trimRing`

use_when:
  - 导入日志
  - 操作记录
  - 操作日志
  - import log
  - 历史
perf:
  - io-bound
invariant_anchors:
  - go/logs/logs.go|fsutil.WriteFileAtomic
  - go/logs/ring.go|trimRing
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
- `(*Logger) Health() types.LogChannelHealth` — 通道健康锁存位（ADR-322 D1；`PersistOK` + `Reason` 机器码）
- `(*Logger) Clear()` — 清空并落盘（进程内唯一健康位复位点）
- `NewRuntimeBuffer(capacity int) *RuntimeBuffer` — 创建运行时日志环形缓冲；`capacity <= 0` 时回退 200
- `(*RuntimeBuffer) Write(p []byte) (int, error)` — `io.Writer` 实现，供 `log.SetOutput` 挂载
- `(*RuntimeBuffer) GetAll() []types.RuntimeLog` / `(*RuntimeBuffer) Clear()` — 读取副本 / 清空
- `trimRing[T]`（`ring.go`，包内私有）— 两环共用的分区裁剪口径，详见不变量段 ADR-322 D3 条

## 与其他子系统关系

- 被 `internal/app/app.go` 持有：`logger`（`NewLogger()`）与 `runtimeLogs`（`NewRuntimeBuffer(200)`）两个字段；启动时 `log.SetOutput(io.MultiWriter(os.Stderr, a.runtimeLogs))`（app.go NewLogger）把标准库 log 同时写终端与缓冲
- 被 `internal/app/app_install.go` 在导入/推送/删除各路径记录 success/failed/skipped/warn；该文件同时提供 `AddOpLog` 与 `GetRuntimeLogs` / `ClearRuntimeLogs` 三个 binding
- 前端 `core/error-diary.ts` 监听所有 error toast，自动以 op=`"ui"` 写入日记，使 UI 报错持久化可回溯
- 前端 `views/app-content/diagnostics/logs.ts` 消费两者：操作日志按 `Operation` 字段分组渲染（`OP_META` 给出 import/scan/download/sync/rename/delete/ui 七种中文标签+图标；组头右侧显示「N 条」），行内状态图标**优先读 `Level` 字段**（error→❌ / warn→⚠️ / debug→🔍 / fatal→💀 / info→✅），无 Level 时按 `Status` 兜底（success→✅ / failed→❌ / warn→⚠️ / skipped→⏭️），向后兼容旧日志
- 依赖 `go/types`（`ImportLog` / `RuntimeLog` 结构，含 `Level` 字段）

## 不变量

- 两个结构各自用 `sync.Mutex` 保护全部读写；`Logger.save()` 只允许在持锁状态下调用（由 `addOp` / `Clear` 保证）
- 操作日志上限 500 条、运行时日志上限 `cap`（应用侧取 200），超出按 ADR-322 D3 分区裁剪（见下）而非一律丢最旧
- `Timestamp` 一律 Unix 毫秒
- `Operation` 为空的历史日志前端按 `"import"` 归组；后端不做补齐，`Add()` 写入时固定填 `"import"`
- **`Level` 字段**（`LogLevel`）：`ImportLog` 由 `addOp` 调用 `statusToLevel` 自动派生（`success`→info, `failed`→error, `warn`→warn, `skipped`→debug）；`RuntimeLog` 的 `Level` 与 `Tag` 由 `RuntimeBuffer.Write` **从消息推断**（ADR-289，见下条）；旧日志无 Level 时前端按 `Status` 兜底，兼容历史数据
- **分组纯属前端呈现**：后端 `GetAll()` 只按写入顺序平铺返回，不排序不分组；前端先 `slice(-500).reverse()` 取最近 500 条转时间倒序，再用 `Map` 按 op 归组，故组的先后 = 该 op 最新一条出现的先后，组内保持时间倒序。后端改变返回顺序会直接改变诊断页组序
- 运行时日志只在内存，不落盘、重启即失；**操作日志落盘失败不向上抛错（不阻塞主流程），但置通道健康锁存位 `Health()`（ADR-322 D1）**——`NewLogger` 遇 `configDir==""` 或 `MkdirAll` 失败、save 遇 Marshal/Mkdir/Write 失败时 `markPersistFailure(reason)` 锁存 `LogChannelHealth{PersistOK:false, Reason: 机器码}`，只 `log.Printf("[meta] ...")` 进 runtime 环。**锁存不回弹**（防间歇性失败致诊断条闪烁；「曾经不可靠」本身即用户须知事实），进程内唯一复位点是 `Clear()`（且仅落盘态复位，内存态复位会谎报可用）。改回「静默不落盘且无任何信号」等于退回 ADR-322 §1 缺口 4
- **op 环按类分配额，界面日记不可被整类挤没**（ADR-322 D3）：`ring.go` `trimRing[T](ring, limit, isProtected)` 为两环共用的唯一裁剪口径——op 环受保护谓词 `isUIOpLog`（`Operation=="ui"`，即 error-diary 写的元失败条目），runtime 环受保护谓词 `isMetaLog`（`Tag=="meta"`，即通道自身失效时以 `[meta]` 前缀写的 `log.Printf`）；受保护类封顶 `limit/4`（`protectedShareNum`，最小 1），业务类吃剩余配额、超出照样丢最旧。**区内仍丢最旧**（同类重复信息量近似，「第一次出错」的价值由类边界保全而非头保留——头保留会让隔天首条 import 霸占窗口且与 `TestLogger_Load_Over500Trim` 冲突）。**为何不「把 cap 调大」**：那只是把问题推后，且挤掉的仍是同一批证据
- **通道健康只读、不改写侧契约**（ADR-322 D1）：`Health()` 是只读观测面，`AddOpLog` 仍无 `error` 返回值（「日志不阻塞主流程」是既有正确取舍，改成返回 error 等于推翻它，否决方案见 ADR-322 §2）。零值 `&Logger{}`（测试直构、未走 `NewLogger`）返回不健康——`healthSet` 布尔位区分「已初始化且健康」与「Go 零值 false」，无此位会把落盘态 logger 误报不健康
- **`RuntimeBuffer.Write` 解析 tag 与推断级别**（ADR-289，2026-09-20）：按调用次数分条（标准库 log 一行一次 Write），消息**原样保留**（含换行），同时顺带做两件事——① `extractRuntimeTag` 取**行首** `[tag]` 前缀写入 `Tag`（无前缀留空，不报错不丢弃）；② `inferRuntimeLevel` 按词表推断 `Level`（fatal > error > warn > info，保守优先）。**为何在捕获层做**：标准库 log 无级别无结构，但全仓 247 个调用点中 **225 个（91.1%）已自发携带 `[tag]` 前缀**、并普遍含「失败/警告/⚠️」等词——在此读出来（每条一次）即让前端可分级筛选与按 tag 检索，**而无需改动任何一个调用点**。推断是启发式非真实级别（实测分布 fatal 2% / error 60% / warn 12% / info 26%，error 高是真实分布——Go 只在出问题时写日志）。前端解析 Message 被否：违反「语义单一事实源在 Go」且 200 条每次渲染重复解析
- **落盘原子性 + 损坏恢复**：tmp+rename 原子替换（rename 失败清理 tmp）；损坏 `ysm-import-logs.json` 备份 `.corrupt` 后重建空存储（对齐 tags.go 模式）；JSON `null` 内容守卫已封（`logs.go` null 守卫）
- **RuntimeBuffer 已有测试覆盖**（P3 补测：`runtime_test.go` 覆盖 Write 分条/环形丢弃最旧/cap≤0 回退 200/GetAll 副本/Clear；ADR-289 补 `TestRuntimeBuffer_TagExtraction`（6 例含「前缀不在行首」「空方括号」边界）/`TestRuntimeBuffer_LevelInference`（10 例）/`TestRuntimeBuffer_LevelPriority`（error 优先于 warn）；损坏恢复的 `.corrupt` 备份断言与 load 端 500 裁剪为 P4 待补）

## 相关

- [wails_bridge](./wails-bridge.md) — 日志查询/清空 binding
- [go_types](./go-types.md) — `ImportLog` 定义
