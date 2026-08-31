//go:build rust_backend

package scanner

import (
	"encoding/json"

	"ysm-model-manager/go/rustbridge"
	"ysm-model-manager/go/types"
)

// scanEntriesWithRust 调用 Rust 扫描后端；不可用时返回 ok=false，由 Go 端兜底。
//
// 本实现覆盖 windows / linux / darwin / android 全部平台。历史上存在四份
// rust_backend_<os>.go 变体，去掉注释与空行后**逐字相同**（ADR-139 §2 L2 实证），
// 故合并为单一事实源——改一处即生效于四端，不再出现「改了 windows 忘改 darwin」。
//
// 合并顺带根除一处构建断裂：Go 的 GOOS=android 同时满足 `linux` 构建约束，
// 原先 android 与 linux 两份变体会被一并纳入，导致本函数重复声明，
// 安卓生产构建（android-build.mjs --production 自动带 rust_backend）必然失败。
// 单文件 + 不带 OS 约束后，该撞车不复存在。
//
// scanCache 是 30s TTL 的进程内存缓存（scanner.go），且 ScanEntriesWithHit 命中即返回、不进本函数。
// 故「能进本函数」与「scanCache 持有未过期条目」在时间上互斥——此处无法复用 Go 缓存作为 manifest。
// Rust 深加工入口 rustbridge.ScanManifest 保留为显式独立 API（见 ADR-120）：仅当业务代码主动持有
// 一份 Go entries 并想让 Rust 在其上深加工时，由调用方显式调用，绝不走本函数的隐式分支。
func scanEntriesWithRust(dir string) ([]types.ModelEntry, bool, bool) {
	registryJSON, err := json.Marshal(types.LoadRegistry())
	if err != nil {
		emitScanError("[scanner] serialize registry for Rust backend: %v", err)
		return nil, false, false
	}
	response, err := rustbridge.Scan(dir, registryJSON)
	if err != nil {
		emitScanError("[scanner] Rust backend unavailable, falling back to Go: %v", err)
		return nil, false, false
	}
	for _, scanError := range response.Errors {
		emitScanError("[scanner] Rust scan error: %s: %s", scanError.Path, scanError.Message)
	}
	if response.Entries == nil {
		response.Entries = []types.ModelEntry{}
	}
	return response.Entries, response.Cacheable, true
}
