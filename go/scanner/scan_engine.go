package scanner

// scan_engine.go — 扫描引擎归属记账 + 跨引擎对照所需的「强制 Go」开关（ADR-262 D3）。
//
// 立因（诚实红线）：`rust_backend` 构建下 Rust 仍可能**运行期不可用**（DLL 缺失/版本不符），
// 此时生产路径静默回退 Go（`rust_backend.go` 返回 handled=false）——报告若不区分这两件事，
// 就会把 Go 的耗时记在 Rust 头上，正是「数字不可信」的来源。故本文件只做两件事：
//  1. 记账「本次扫描由哪个引擎**真正**处理」（计数器差值，不靠猜、不新增签名）；
//  2. 给基准一个「强制走 Go」的开关，让对照的两端跑同一条生产管线、只换引擎。
//
// 为什么不做成 `ScanEntries` 的返回值：该函数有十几个调用方，为观测改签名是反向收益；
// 计数器 + 前后差同样精确，且零调用方改动。

import "sync/atomic"

// forceGoEngine 基准专用：true = 跳过 Rust 快路径强制走 Go walk（生产恒 false）。
//
// 它不新增生产语义——`tryRustScan` 本来就允许返回 handled=false 让调用方走 Go 兜底
// （Rust 不可用时正是这条路），本开关只是把「兜底」变成可控的。
var forceGoEngine atomic.Bool

// SetForceGoEngine 设置「强制 Go 引擎」（跨引擎对照基准专用；用完必须复位，勿在生产路径调用）。
func SetForceGoEngine(v bool) { forceGoEngine.Store(v) }

// ForceGoEngine 读取开关状态（基准/测试自检用）。
func ForceGoEngine() bool { return forceGoEngine.Load() }

// rustHandledCount Rust **真正处理完**一次扫描的次数。
// 与 `walkCount`（Go walk 次数）配对：一次扫描必落入其一，差值即引擎归属。
var rustHandledCount atomic.Int64

// ScanEngineStat 引擎归属计数快照。两次快照之差 = 这期间各引擎各处理了几次扫描。
type ScanEngineStat struct {
	// Rust Rust 快路径处理次数（handled=true）
	Rust int64
	// GoWalk 走盘次数（含 Rust 不可用时的兜底、以及强制 Go）
	GoWalk int64
}

// ScanEngineStats 读取引擎归属计数（只增不减；调用方取前后差自行归属）。
func ScanEngineStats() ScanEngineStat {
	return ScanEngineStat{Rust: rustHandledCount.Load(), GoWalk: walkCount.Load()}
}

// ResetScanEngineStats 归零引擎归属计数（基准/测试用，避免被历史扫描干扰）。
func ResetScanEngineStats() {
	rustHandledCount.Store(0)
	walkCount.Store(0)
}
