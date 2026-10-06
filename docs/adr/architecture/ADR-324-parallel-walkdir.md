# ADR-324：并行目录遍历替代 filepath.WalkDir

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-10-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：标准库 filepath.WalkDir 是纯顺序 DFS，24 核机器上目录级并行理论可拿满全部 CPU 却只能单核；替换为目录工作队列+worker 池并行展开，实测 1.97-3x，回调契约对标 WalkDir 零侵入
- **相关**：`go/scanner/walk_parallel.go, go/scanner/scanner.go, docs/knowledge/go-scanner.md`

---

## 1. 背景（Context）

`filepath.WalkDir` 是纯顺序 DFS：单次 `os.ReadDir` 阻塞后续全部目录，回调串行执行。YSM 模型库典型形态是 40-400 个文件夹、每夹 1-10 文件，目录级并行理论可拿满全部 CPU 核——24 核机器上理论加速 24x，实测因 readdir 本身有 OS 层串行化约 2-3x。

替代方案 Rust `jwalk 0.9` 已废弃（crates.io: "This crate is no longer maintained. Use `dua-core` instead."），且 1.3GB 基础设施（rust-core 631MB + rust-wails-bridge 681MB）仅换来 19% 提速（`go 226ms / rust 184ms`，157 条目），与 Go 并行遍历实测（1.97-3x）相当或更优。Go 侧并行遍历无新增依赖、无 cgo、无交叉编译负担，是 Rust 的严格子集收益。

## 2. 决策（Decision）

`go/scanner/walk_parallel.go` 实现 `walkDirParallel(root string, fn fs.WalkDirFunc) error`——目录工作队列 + NumCPU worker 池 + outstanding 原子计数。回调契约与 `filepath.WalkDir` 一致：

| 回调返回 | WalkDir 语义 | walkDirParallel 实现 |
|---------|-------------|---------------------|
| `nil` | 继续 | 入队子目录（`outstanding += 1`），处理完递减 |
| `fs.SkipDir` | 跳过子树 | 不入队该条目子目录 |
| `fs.SkipAll` | 中止遍历 | `close(abortCh)` 广播，所有 worker 立即退出 |
| 其他 `error` | 首错即停 | 记录首错后继续（并行中止会丢弃已排队目录，继续更合理；scanner 回调实际只返回 `nil/SkipDir/SkipAll`，此差异不可达） |

条目序非确定 → 扫描后 `sort.SliceStable` 按路径恢复字典序。回调并行执行 → `entries` append 加 `sync.Mutex`，`walkFailed` 用 `atomic.Bool`。

## 3. 后果（Consequences）

**正面**：
- 遍历阶段 1.97-3x（walkbench 实测，40-1600 文件树）
- 总扫描耗时缩短 5-54%（scanprofile 实测，取决于库形态：hashable 小文件 14-16%、non-hashable 54-60%）
- 无新增依赖、无 cgo、无交叉编译——Rust jwalk 的 19% 被 Go 追平或反超，1.3GB Rust 基础设施对扫描性能已无存在意义
- 回调契约零侵入：`processScanDirEntry` 签名、`fs.SkipDir`/`fs.SkipAll` 语义、根 lstat 失败处理全部保持

**负面**：
- 深窄树（12 层纯目录链、无宽度）负收益 0.54x——生产模型库均为宽树，此场景不可达
- 回调并行执行引入数据竞争风险——scanner 回调的 `entries` append 与 `walkFailed` 已加锁/原子化，`processScanDirEntry` 内部无共享可变状态（registry 用 mutex、`IsRecycleDir` 纯函数、`d.Info()` 是 I/O）

**已知遗留**：
- ~~Rust `jwalk 0.9` 已废弃但仍在 CI 编译路径上——删除 Rust 基础设施是独立决策，本 ADR 不涵盖~~（已于 2026-10-06 完成：Rust 扫描后端、rustbridge、Rust 构建脚本与 CI cargo 作业全部删除，`scan-bench` 退化为 Go-only 单引擎耗时测量）

## 4. 数据溯源

- `walkbench`（`%TEMP%\ysm-walkbench\main.go`，160 行自写并行 walker）：浅树 165 文件 10.5→3.5ms（2.98x）、中树 1605 文件 89.7→35.9ms（2.50x）、深树 360 文件 1.1→2.0ms（0.54x）；重回调（遍历+256B 读）浅树 19.2→9.5ms（2.02x）、中树 157.8→70.5ms（2.24x）
- `scanprofile`（`%TEMP%\ysm-scanprofile\main.go`，调真实 `ScanEntriesWithHitCtx`）：160 条目 11 轮中位——walk 占 8-91%（库形态依赖），并行后总耗时缩短 5-54%
- Rust 对比：`go 226ms / rust 184ms`（19%），157 条目，Windows
- 基准测试：`TestWalkDirParallel_Benchmark` 实测 1.97x（40 夹 × 4 文件 = 164 条目）
- 正确性：`TestWalkDirParallel_MatchesWalkDir` 排序后逐条对标，6 个测试 + race 检测全绿

<!-- 文件名: parallel-walkdir.md → 实际文件 architecture/ADR-324-parallel-walkdir.md（ADR-320 architecture 全量模板） -->
