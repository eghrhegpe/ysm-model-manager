# ADR-031：文件监听生命周期与同步串行化加固

- **状态**：✅ 已采纳
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/watcher/watcher.go, internal/app/app_scan.go`

---

## 1. 背景（Context）

扫描器模块（`go/watcher` + `app_scan.go`）审核发现四个缺陷：

1. **Stop 后重启假活**：`Stop()` 中 `close(w.done)` 后再次 `Start()` 复用已关闭的 channel，`loop` 立即退出——`IsRunning()` 仍返回 true，但文件监听已失效；
2. **syncAll 无执行串行化**：防抖（800ms）只合并"调度"不合并"执行"——`syncAll` 运行期间（全量扫描 + 多实例同步，可达数百 ms）新事件再触发新 timer，多个 `syncAll` 并发操作同一批整合包目录的 `.ban` 文件；
3. **Stop 不等 in-flight 同步**：已触发的 `syncAll` 无法取消，退出后仍有后台写盘；
4. **index.json 跨平台不可用**：`GenerateRepoIndex` 用 `filepath` 原生分隔符（Windows 反斜杠）写入，GitHub Actions（Linux）消费失败，违反 ADR-011 正斜杠红线；`ClearScanCache` / `InvalidateScanCache` 双实现清同一缓存，职责重叠。

## 2. 决策（Decision）

1. **done channel 每次 Start 重建**：支持 Stop→Start 重启，`IsRunning` 语义回归真实；
2. **syncAll 执行串行化**：`syncRunning` / `syncPending` 标志——已有同步在跑时仅标记待续跑，当前轮结束后**串行再跑一轮**；`wg.Add(1)` 在持锁段内、`Stop` 的 `wg.Wait()` 在 Unlock 后，由 `w.mu` 串行化保证"Add 必先于 Wait 或直接因 `!running` 退出"，规避 WaitGroup misuse；
3. **`GenerateRepoIndex` 统一正斜杠**：`filepath.ToSlash` 输出，index.json 可在 GitHub Actions（Linux）直接使用；
4. **缓存清空收敛单入口**：`ClearScanCache` 委托包级 `InvalidateScanCache`。

## 3. 后果（Consequences）

**正面**：

- Stop→Start 重启后监听恢复，`TestStartStopRestart` 锁定回归；
- 并发触发同步（模拟连点/批量写盘）串行执行，`TestSyncAllSerialized` 断言最大并发 = 1；
- `Stop` 阻塞等待 in-flight 同步完成（`TestStopWaitsForSync` 锁定），退出无残留写盘；
- index.json 跨平台消费；缓存清空行为单一化。

**负面 / 已知遗留**：

- `syncAll` 续跑由调用链串行完成，极端高频事件下可能连续多轮同步（正确性优先于吞吐的设计取舍）；
- watcher 事件测试依赖固定 sleep（500ms + 1500ms），套件耗时 ~9s，未改条件等待；
- `internal/app` 尚有 5 个文件未 gofmt（app.go / app_config.go / app_scan.go / bundled_data.go / cli.go），与本次无关，待独立 chore 提交。

## 4. 数据溯源

- **来源**：扫描器模块审核报告（2026-08-04）——P1 Stop→Start 假活 / P1 syncAll 并发 / P2 Stop 不等 in-flight / P3 索引分隔符与缓存双入口；
- **决策落地**：commit `6ce3fd7`（`fix(watcher): 监听器生命周期与同步串行化`）；
- **验证**：`go build ./go/... ./internal/app/...` 通过；`go test ./go/watcher/` 12/12 PASS（新增 3 个：重启回归 / 串行化 / Stop 等待）；`go test ./go/...` 全过。

<!-- 文件名: watcher-lifecycle-sync-serialization.md → 实际文件 ADR-031-watcher-lifecycle-sync-serialization.md -->
