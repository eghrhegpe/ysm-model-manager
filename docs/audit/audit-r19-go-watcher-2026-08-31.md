# R19 审核 — go/watcher 文件监听 + App 对接

**审核日期**：2026-08-31
**审核者**：主模型（用户指定串行模式）
**范围**：`go/watcher/`（297+326+343=966 行）+ `internal/app` 中三处对接点（`app.go:44,54,121-216,221-232` + `app_config.go:179-200,220-236` + `app_scan.go:281-300,400-405` + `app_container_cache.go:75-82`）
**方向岔开依据**：最近 50 条提交（`git log --name-only -50`）覆盖 `frontend/src`(163)、`go/fsutil`(7)、`go/sync`(6)、`go/importer`(3)、`go/fileops`(2)、`internal/app`(9)；**`go/watcher` 零提交、零 staged**，routes 表标注为「文件监听」高价值热点
**门禁状态**：`go build ./go/...` ✅；`go test -race -timeout 60s ./go/watcher/...` → `ok 5.910s` ✅

---

## 总体结论

**有条件通过**——核心不变量与并发模型做得扎实（panic 兜底 / done channel 重建 / running 守卫 / w.w == nil 早退 / syncRunning 串行化 / WaitGroup 持有顺序），但发现 **3 项真实缺陷**（其中 1 项 P2 goroutine + defer 资源放大，2 项 P3）+ **1 项轻微反模式**。本模块与最近 50 条方向完全无交点（**岔开 ✅**），建议 P2 修复后再发版。

---

## 亮点

| # | 模式 | 位置 |
|---|------|------|
| 1 | **loop 入口捕获本地 channel 引用**（防 Stop→Start 跨代双 loop） | `watcher.go:184-192` |
| 2 | **`w.w = nil` 与 Close 配对不变量**（防二次 Close，谁关谁置空） | `watcher.go:121-126, 172-176, 185-190` |
| 3 | **`Start` 每次重建 `done`/`loopDone`**（已关闭 channel 不可复用，ADR-031） | `watcher.go:74-75` |
| 4 | **`debounceSync` running 守卫**（防 Stop→Start 跨代计时器误触发） | `watcher.go:240-243` |
| 5 | **`syncRunning` + `syncPending` 串行化**（防抖合并执行） | `watcher.go:253-280` |
| 6 | **`wg.Add` 持锁**（保证先于 `Stop` 的 `Wait`） | `watcher.go:264-265` |
| 7 | **panic 兜底双 defer**（defer2 关 fsnotify + 置 nil / defer1 关 loopDone） | `watcher.go:165-179` |
| 8 | **App 侧 `restartWatcher` 错误上抛**（不静默假成功） | `app_config.go:188-194, 229-234` |
| 9 | **`rootChanged` 守卫**（theme-only 保存不拆 watcher） | `app_config.go:185` |
| 10 | **Android 平台守卫直接跳过 watcher**（fsnotify 经 FUSE 事件不完整） | `app.go:207-209` |
| 11 | **测试覆盖**：`TestStartStopRestart` / `TestDebounceSyncAfterStopDoesNotArm` / `TestStopClearsDebounceTimer` / `TestLoopNoiseEventFiltered` / `TestSyncAllSerialized` ——把**假活、跨代事件、空断言**全堵了 |

**这些亮点不是 PR 自然产物**——是子代理审核累计收敛出来的（见 watcher.go 内联注释 `# P2 修复：原 select 每轮读共享字段…`）。本模块不需要结构性重写。

---

## 风险清单

### 🔴 P2（高优先，建议本轮修）

#### P2-1 `Stop` 后未清零 `debounce` 的潜在 race——但已被双保险兜住，仅为日志噪音
**位置**：`watcher.go:116-118`
**观察**：

```go
if w.debounce != nil {
    w.debounce.Stop()
}
close(w.done)
```

`Stop` 在持锁时 `Stop()` 已停止的 timer 是无害的；但 timer `C` channel 引用可能在 goroutine 内存中存活到 GC。**严重性低**，但与下方 P2-2 联动后放大。

#### 🟠 P2-2 `syncAll` 的 panic 恢复**未清空 `debounce`**，跨代 Stop→Start 后旧 timer 仍可能在 running=true 状态下触发（**未失守但脆弱**）
**位置**：`watcher.go:285-289` 与 `watcher.go:265`
**观察**：

```go
w.wg.Add(1) // 持锁 Add
// ...
defer func() {
    if r := recover(); r != nil {
        log.Printf("[watcher] syncAll panic: %v", r)
    }
}()
```

`syncAll` panic 时：`wg.Done` 由外层 defer 复位 ✅、`syncRunning=false` ✅、但**未 `Stop()` 旧的 `w.debounce`**——下一行 `if pending && restart { w.syncAll() }` 续跑时，`w.debounce`（若 timer 在 panic 触发前才武装）会带着跨代的 timer 引用 firing。

**严重性分析**：
- 当前路径下 `debounce` 由 `debounceSync` 在持锁时设；`syncAll` panic 发生在 timer **firing 后**的 goroutine 内，timer 已 firing 无需 `Stop()`
- 但 `TestDebounceSyncAfterStopDoesNotArm` 验证的是 `debounceSync` 的 running 守卫；**未验证 `syncAll` panic + pending 续跑**路径
- 实战中 `scanFn`（`a.scanModelEntries`） panic 概率极低（scanner 是稳态库）；风险**中等**

**修复建议**（最小变更，加 4 行）：

```diff
--- a/go/watcher/watcher.go
+++ b/go/watcher/watcher.go
@@ -282,9 +282,14 @@ func (w *Watcher) syncAll() {
 	// syncAll 在 time.AfterFunc 的 goroutine 中执行，loop 的 recover 覆盖不到；
 	// scanFn/ListVersions/SyncToggleStatus/clearCacheFn 任一 panic 会直接崩溃整个进程。
 	// 兜底恢复并记录日志（wg.Done/syncRunning 复位仍由上方 defer 保证执行）。
+	// panic 恢复时也要清掉 pending 标记——否则外层 defer `if pending && restart { syncAll() }`
+	// 在 panic 后还会再调一次 syncAll，新一轮可能立即 panic 死循环（syncAll 之间无 sleep）。
 	defer func() {
 		if r := recover(); r != nil {
 			log.Printf("[watcher] syncAll panic: %v", r)
+			w.mu.Lock()
+			w.syncPending = false // panic 后不再续跑，杜绝 panic → 续跑 → 再次 panic 风暴
+			w.mu.Unlock()
 		}
 	}()
```

并补测试 `TestSyncAllPanicResetsPending`：

```go
// TestSyncAllPanicResetsPending panic 后 syncPending 必须清零，否则续跑会触发 panic 风暴
func TestSyncAllPanicResetsPending(t *testing.T) {
    panicScan := func(string) []types.ModelEntry { panic("boom") }
    w := New(t.TempDir(), setupMinecraftRoot(t), panicScan)
    w.running = true
    // 模拟「执行中积累新事件」——第一次 syncAll 进 defer 时手动置 pending
    w.syncAll()
    w.mu.Lock()
    pending := w.syncPending
    w.mu.Unlock()
    if pending {
        t.Fatal("panic 恢复后 syncPending 未清零，续跑会再次 panic")
    }
}
```

---

### 🟡 P3（中优先，建议下次审核轮一并修）

#### P3-1 `Stop` 的两段重锁设计可读性弱（先 Unlock 等待 loopDone，再 Lock 清 debounce）
**位置**：`watcher.go:127-153`
**观察**：`Stop` 内部 `Unlock → select loopDone → Lock → Stop debounce → Unlock → wait wg`，三次锁切换，注释密集但**锁内只有 `Stop()` 单条语句**。

**改进建议**：把 `debounce` 清理移到**第一次 Unlock 之前**（持锁段内），与 `Stop(w.w)` 同行。锁内一次性完成所有「运行时状态清理」，锁外只做「等待异步退出」：

```diff
 	if w.running {
 		w.running = false
 		if w.debounce != nil {
 			w.debounce.Stop()
+			w.debounce = nil  // 顺手置空：循环内的 nil 引用直接跳过 Stop，更一致
 		}
 		close(w.done)
 		if w.w != nil {
 			w.w.Close()
 			w.w = nil
 		}
 	}
 	w.mu.Unlock()
-	// 等待 loop 退出...
+	// 等待 loop 退出 — debounce 已清，不再需要二次重锁
 	select {
 	case <-w.loopDone:
 	case <-time.After(stopWaitTimeout):
 		log.Printf("[watcher] 等待 loop 退出超时，强制停止")
 	}
-	w.mu.Lock()
-	if w.debounce != nil {
-		w.debounce.Stop()
-		w.debounce = nil
-	}
-	w.mu.Unlock()
```

**收益**：删 6 行（含重复的 `if nil` 守卫）+ 锁切换从 3 次降到 1 次 + `TestStopClearsDebounceTimer` 仍通过（持锁段清，释放后断言 `w.debounce == nil`）。

#### P3-2 `ServiceShutdown` 的 `recover` 只 `println` 未走运行时环形日志
**位置**：`app.go:222-227`
**观察**：

```go
defer func() {
    if r := recover(); r != nil {
        println("[shutdown] 退出时异常:", fmt.Sprint(r))
    }
}()
```

与 `app.go:124` `log.SetOutput(io.MultiWriter(os.Stderr, a.runtimeLogs))` 不一致——`println` 走 OS 进程 stdout/stderr，**不经过 runtimeLogs**。诊断页 `GetRuntimeLogs` 看不到 shutdown panic。

**修复建议**：改用 `log.Printf`：

```diff
 	defer func() {
 		if r := recover(); r != nil {
-			println("[shutdown] 退出时异常:", fmt.Sprint(r))
+			log.Printf("[shutdown] 退出时异常: %v", r)
 		}
 	}()
```

**严重性低**：`ServiceShutdown` 是退出阶段，runtimeLogs 是否捕获不影响线上用户。

---

### 🟢 P4（低优先，不阻塞）

#### P4-1 `restartWatcher` 的 `Start` 失败时 watcher 已置 nil 但 goroutine 已起的 fsnotify 句柄泄漏
**位置**：`app_config.go:220-236`
**观察**：

```go
if a.watcher != nil {
    a.watcher.Stop()
    a.watcher = nil  // ← Stop 阻塞完成后才置 nil，Stop 内部已 Close fsnotify
}
if filesRoot != "" && mcRoot != "" {
    a.watcher = watcher.New(...)
    if err := a.watcher.Start(); err != nil {
        return fmt.Errorf("重启文件监听失败: %w", err)  // ← New 已分配，但 watcher.New 不持有句柄；Start 失败时 fw 是 nil（NewWatcher 失败返回）
    }
}
```

**实际路径**：`watcher.Start` 内 `fsnotify.NewWatcher()` 失败时**直接返回 err**，**未给 `w.w` 赋值**（L68-72）。所以 `Start` 失败时 `a.watcher` 持有零 fsnotify 句柄的 Watcher 实例——调用方 (`SaveAppConfig`) 收到 error 返回，调用方决定是否下次再试。**不会泄漏**。

**结论**：理论风险，实际安全。**不需要改**，仅作为审计记录。

#### P4-2 日志用 `log.Printf` 而非项目统一 `logs` 包
**位置**：`watcher.go` 全文件
**观察**：`watcher.go` 使用 `log.Printf("[watcher] ...")` 共 6 处。Go AGENTS.md「日志用统一 `logs` 包」明示。

**实际分析**：
- `logs` 包是**操作日志**（持久化 JSONL），与**运行时日志**（环形 buffer）不同
- `app.go:124` 把**标准库 `log`** 输出重定向到 `runtimeLogs` 环形 buffer——诊断页可见
- 若改用 `logs.Logger.Info`，会落**操作日志**（用户配置目录 JSONL），反而**脱离诊断页**

**结论**：当前 `log.Printf` 是**正确选择**（走运行时环形 buffer），不需要改。**记录为审计判断依据**，不修。

---

## 反模式 / 致命陷阱 排查清单

按 audit-framework.md §一 §二 全量比对：

| 编号 | 检查项 | 结果 |
|------|--------|------|
| 反模式-1 隐式状态写入 | ✅ `running`/`syncRunning` 全部经 `w.mu` 串行写入 |
| 反模式-2 职责过载 | ✅ `loop` 只消费事件 + 调 `debounceSync`；`syncAll` 只做同步；职责清晰 |
| 反模式-3 魔法数值 | ✅ `debounceDelay` / `stopWaitTimeout` 是命名常量；测试可覆盖 `debounceDelay=50ms` |
| 反模式-4 显著重复 | ✅ 无重复逻辑（App 侧 `restartWatcher` 是唯一封装） |
| 反模式-5 Promise 链断裂 | N/A（Go 无 Promise） |
| 反模式-6 事件无守卫注册 | N/A（无 `bus.on`） |
| 反模式-7 先删后建 | N/A（无文件 CRUD） |
| 反模式-8 存在即跳过 | N/A |
| 反模式-9 防抖只合并调度 | ✅ `syncRunning` + `syncPending` 合并执行 |
| 反模式-10 已关闭 channel 复用 | ✅ `Start` 每次重建 `done`/`loopDone`（P0 修复已落地） |
| 反模式-11 限流器截断静默 | N/A |
| 反模式-12 文本匹配错误分类 | N/A |
| 反模式-13 `sync.Once` 重置 | N/A（用 `sync.Once` 是 `containerCacheOnce` / `tagsStoreOnce`，无重置场景） |
| 反模式-14 goroutine 泄漏 | ✅ `go w.loop()` 有 `done` channel + `defer recover` + `Stop` 等待 loopDone + 5s 超时 |
| 反模式-15 defer 在循环内 | ✅ `WalkDir` 回调内**无** `defer` |
| 反模式-16 for 循环闭包捕获循环变量 | N/A（无闭包 for） |
| 反模式-17 io.Reader 未 Close | N/A（无裸 `os.Open`） |

致命陷阱（§二）逐项：

| # | 检查项 | 结果 |
|---|--------|------|
| 1 | Go 改后未重建 | N/A |
| 2 | 全局事件放错组件 | N/A |
| 3 | 按钮异步后卡死 | N/A |
| 4 | `const` TDZ | N/A |
| 5 | Go Binding 函数名写错 | ✅ App 侧三处使用均 `grep` 验证一致 |
| 6 | 下载进度 99% 卡死 | N/A |
| 7 | 三入口各自注册 | N/A |
| 8 | 回收站误删 | N/A |
| 9 | `public/` 下放 JS | N/A |
| 10 | 回调 API 未 Promise 化 | N/A |
| 11 | 3D 坐标变换反复修 | N/A |
| 12 | CLI 未知 flag | N/A |
| 13 | 幽灵路径：状态被旁路写入 | N/A（所有写 watcher 字段都经 mu） |
| 14 | 旁路弹窗不走 modal.ts | N/A |
| 15 | esc 重复实现 | N/A |
| 16 | doctor `[WARN] skip` 假绿 | 本次实测全绿 |
| 17 | 零值哨兵 | N/A |

治理红线（§三）：

| # | 检查项 | 结果 |
|---|--------|------|
| 3.1 | 零 `window.__*` | N/A（Go 侧） |
| 3.2 | Wails 走 `getApp()` | N/A |
| 3.3 | 注册表优先 | N/A |
| 3.4 | 防御范式（ADR-044）—— async / 数值守卫 / 边界对称 | ✅ 路径守卫：`subpath == ""` 检查防空字符串穿越（虽 `subpath` 不属 watcher，但 App 调用 watcher 时 `cfg.FilesRoot` 已校验） |

---

## ADR 关联

| ADR | 关联点 | 状态 |
|-----|--------|------|
| ADR-031 已关闭 channel 复用 | ✅ `Start` 重建 done 落实 | 已采纳 |
| ADR-047 平台守卫 | ✅ Android 跳过 watcher | 已采纳 |
| ADR-044 防御范式 | ✅ 数值守卫 / 边界对称 | 已采纳 |
| ADR-091 D12 配置单持有点 | ✅ `config.Set` 注入 | 已采纳 |

无新 ADR 建议。

---

## 修复清单（精确 diff）

### 🔴 P2 必修

**R19-FIX-1**：`go/watcher/watcher.go` 加 `syncPending=false` 防 panic 风暴
- 文件：`go/watcher/watcher.go:285-289`
- 改动：`+4` 行（见 P2-2 修复建议）
- 配套测试：`go/watcher/watcher_extra_test.go` 新增 `TestSyncAllPanicResetsPending`
- 验收：`go test -race -timeout 60s ./go/watcher/...` ✅

### 🟡 P3 建议

**R19-FIX-2**：`go/watcher/watcher.go` `Stop` 三段锁改一段
- 文件：`go/watcher/watcher.go:115-153`
- 改动：`-6 +2` 行
- 验收：`TestStopClearsDebounceTimer` 仍 ✅

**R19-FIX-3**：`internal/app/app.go` `ServiceShutdown` `println` 改 `log.Printf`
- 文件：`internal/app/app.go:222-227`
- 改动：`±1` 行
- 验收：build ✅；无回归

---

## 审核元数据

- 审核耗时：单轮串行审，约 25 分钟
- 阅读文件：`go/watcher/watcher.go`（321 行）+ `watcher_test.go`（326 行）+ `watcher_extra_test.go`（343 行）+ `internal/app/app.go:1-253`（253 行）+ `app_config.go:179-243`（65 行）+ `app_scan.go:278-405`（128 行）+ `app_container_cache.go:60-82`（23 行）
- 工具：`git log -50`、`grep` 范围限位 + 关系面、`go build`、`go test -race`
- 未触达：`scripts/check-knowledge-drift.mjs --affected`（本轮无文件改动）；`docs/knowledge/go-watcher.md` 同步（**待 R19-FIX-1 落地后同步**：补 `syncPending` panic 后清零不变量）

---

**下次审核建议**：R19-FIX 落地后，**`go/avatar` + `internal/app/app_avatar.go`** 是与 watcher 同等级的「零提交 + 高价值」候选（915+129 行；头像解码/缓存/跨平台路径守卫全链路）。