//go:build rust_backend

package rustbridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"ysm-model-manager/go/types"
)

// ffiMu 串行化所有 FFI 调用。Rust ysm_scan/ysm_scan_manifest 线程安全性未经验证，
// Go 侧加 Mutex 保证同一时刻只有一个 FFI 调用在飞行——扫描是重操作（IO bound），
// 串行化开销可忽略，但能彻底避免数据竞争/panic 穿透 C 边界。
// Windows（DLL LazyDLL）与 Linux/Darwin/Android（CGO 静态链接）均通过此锁保护。
// 注意：ffiMu 仅保护 FFI 调用段（Lock→Call→append→defer free），不保护 load()（由 loadOnce sync.Once 保护）。
var ffiMu sync.Mutex

// validateOutput 校验 Rust 返回的 YsmBuffer：ptr 非空、len 在合法范围。
// 两个平台桥（Windows DLL / CGO）共用，避免重复逻辑漂移。
func validateOutput(output nativeBuffer) error {
	if output.ptr == nil || output.len == 0 || output.len > uintptr(^uint(0)>>1) {
		return errors.New("Rust scanner returned an invalid buffer")
	}
	return nil
}

// parseResponse 将 Rust 扫描器返回的缓冲区字节解码为 ScanResponse：
// JSON 反序列化 → 透传 Rust 侧业务错误 → 空 Entries 兜底为 []。
// 四个平台（windows/darwin/linux/android）共用此段，避免多份复制漂移。
func parseResponse(data []byte, manifest bool) (ScanResponse, error) {
	label := "response"
	if manifest {
		label = "manifest response"
	}
	var response ScanResponse
	if err := json.Unmarshal(data, &response); err != nil {
		return ScanResponse{}, fmt.Errorf("decode Rust scanner %s: %w", label, err)
	}
	if response.Error != "" {
		return ScanResponse{}, errors.New(response.Error)
	}
	if response.Entries == nil {
		response.Entries = []types.ModelEntry{}
	}
	return response, nil
}
