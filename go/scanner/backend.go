package scanner

// backend.go — 扫描后端声明。
//
// Rust 扫描后端已删除（2026-10-06）：Go 并行遍历（walk_parallel.go，ADR-324）在
// Windows 上实测 1.97~3x 于 Rust jwalk，且 jwalk 上游已弃用（官方建议迁 dua-core），
// 1.3GB 编译基础设施不再为 19% 的引擎份额买单。
//
// Go walk 是唯一后端。

// ScanBackend 本次构建实际使用的扫描后端（恒 "go"）。
const ScanBackend = "go"
