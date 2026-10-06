package scanner

// scan_engine.go — 扫描引擎归属记账。
//
// Rust 后端已删除（2026-10-06，ADR-324 之后 Go 并行遍历追平并反超 Rust 的 19%），
// Go walk 是唯一引擎。保留 ScanEngineStats 供基准/诊断读取走盘次数。
//
// 为什么不做成 `ScanEntries` 的返回值：该函数有十几个调用方，为观测改签名是反向收益；
// 计数器 + 前后差同样精确，且零调用方改动。

// ScanEngineStat 引擎归属计数快照。两次快照之差 = 这期间各引擎各处理了几次扫描。
type ScanEngineStat struct {
	// GoWalk 走盘次数（Go 是唯一后端）
	GoWalk int64
}

// ScanEngineStats 读取引擎归属计数（只增不减；调用方取前后差自行归属）。
func ScanEngineStats() ScanEngineStat {
	return ScanEngineStat{GoWalk: walkCount.Load()}
}

// ResetScanEngineStats 归零引擎归属计数（基准/测试用，避免被历史扫描干扰）。
func ResetScanEngineStats() {
	walkCount.Store(0)
}
