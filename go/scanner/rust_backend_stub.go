//go:build !rust_backend

package scanner

import "ysm-model-manager/go/types"

// ScanBackend 本次构建实际使用的扫描后端（"rust" | "go"）——见 rust_backend.go 同名常量。
// 本文件是 !rust_backend 变体：Go walk 是唯一后端（scanEntriesWithRust 为 stub，恒 handled=false）。
const ScanBackend = "go"

func scanEntriesWithRust(string) ([]types.ModelEntry, bool, bool) {
	return nil, false, false
}
