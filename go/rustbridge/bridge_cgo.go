//go:build (darwin || linux || android) && rust_backend

package rustbridge

import (
	"errors"
	"fmt"
	"runtime"
	"sort"
	"unsafe"
)

// CGO 静态链接桥接：Linux / macOS / Android 使用同一份 C ABI（YsmBuffer），
// Rust .a 由 compile-rust-static.mjs 或 compile-android-rust.mjs 编译后链接进可执行文件。
// 三份平台变体（原 bridge_linux.go / bridge_darwin.go / bridge_android.go）去注释后
// 逐字相同（ADR-139 实证），合并为单一文件由 (darwin || linux || android) && rust_backend
// 覆盖——GOOS=android 同时满足 linux 约束，单文件构造上消除 android 撞车风险，
// 无需 !android 守卫。

/*
#include <stdint.h>

typedef struct {
  uint8_t* ptr;
  uintptr_t len;
  uintptr_t cap;
} YsmBuffer;

extern int32_t ysm_scan(const uint8_t* root_ptr, uintptr_t root_len,
                              const uint8_t* registry_ptr, uintptr_t registry_len,
                              YsmBuffer* out);
extern int32_t ysm_scan_manifest(const uint8_t* root_ptr, uintptr_t root_len,
                                  const uint8_t* registry_ptr, uintptr_t registry_len,
                                  const uint8_t* manifest_ptr, uintptr_t manifest_len,
                                  YsmBuffer* out);
extern void ysm_buffer_free(uint8_t* ptr, uintptr_t len, uintptr_t cap);
*/
import "C"

type nativeBuffer struct {
	ptr *byte
	len uintptr
	cap uintptr
}

func Scan(root string, registryJSON []byte) (ScanResponse, error) {
	if len(registryJSON) == 0 {
		return ScanResponse{}, errors.New("Rust scanner registry is empty")
	}
	// ffiMu 由 common.go 统一管理，四平台共享串行化保护。
	ffiMu.Lock()
	defer ffiMu.Unlock()

	var rootPtr *byte
	if len(root) > 0 {
		rootPtr = unsafe.StringData(root)
	}
	registryPtr := unsafe.SliceData(registryJSON)
	var output nativeBuffer
	status := C.ysm_scan(
		(*C.uchar)(unsafe.Pointer(rootPtr)), C.size_t(len(root)),
		(*C.uchar)(unsafe.Pointer(registryPtr)), C.size_t(len(registryJSON)),
		(*C.struct_YsmBuffer)(unsafe.Pointer(&output)),
	)
	runtime.KeepAlive(root)
	runtime.KeepAlive(registryJSON)
	if status != 0 {
		return ScanResponse{}, fmt.Errorf("Rust scanner ABI status %d", status)
	}
	if err := validateOutput(output); err != nil {
		return ScanResponse{}, err
	}
	defer C.ysm_buffer_free((*C.uchar)(output.ptr), C.size_t(output.len), C.size_t(output.cap)) //nolint:errcheck
	data := append([]byte(nil), unsafe.Slice((*byte)(unsafe.Pointer(output.ptr)), int(output.len))...)
	return parseResponse(data, false)
}

func ScanManifest(root string, registryJSON, manifestJSON []byte) (ScanResponse, error) {
	if len(registryJSON) == 0 {
		return ScanResponse{}, errors.New("Rust scanner registry is empty")
	}
	if len(manifestJSON) == 0 {
		return ScanResponse{}, errors.New("Rust scanner manifest is empty")
	}
	// ffiMu 由 common.go 统一管理，四平台共享串行化保护。
	ffiMu.Lock()
	defer ffiMu.Unlock()

	var rootPtr *byte
	if len(root) > 0 {
		rootPtr = unsafe.StringData(root)
	}
	registryPtr := unsafe.SliceData(registryJSON)
	manifestPtr := unsafe.SliceData(manifestJSON)
	var output nativeBuffer
	status := C.ysm_scan_manifest(
		(*C.uchar)(unsafe.Pointer(rootPtr)), C.size_t(len(root)),
		(*C.uchar)(unsafe.Pointer(registryPtr)), C.size_t(len(registryJSON)),
		(*C.uchar)(unsafe.Pointer(manifestPtr)), C.size_t(len(manifestJSON)),
		(*C.struct_YsmBuffer)(unsafe.Pointer(&output)),
	)
	runtime.KeepAlive(root)
	runtime.KeepAlive(registryJSON)
	runtime.KeepAlive(manifestJSON)
	if status != 0 {
		return ScanResponse{}, fmt.Errorf("Rust scanner manifest ABI status %d", status)
	}
	if output.ptr == nil || output.len == 0 || output.len > uintptr(^uint(0)>>1) {
		return ScanResponse{}, errors.New("Rust scanner returned an invalid buffer")
	}
	defer C.ysm_buffer_free((*C.uchar)(output.ptr), C.size_t(output.len), C.size_t(output.cap)) //nolint:errcheck
	data := append([]byte(nil), unsafe.Slice((*byte)(unsafe.Pointer(output.ptr)), int(output.len))...)
	response, err := parseResponse(data, true)
	if err != nil {
		return response, err
	}
	// manifest 路径 entries 按 path 排序，与 scan_json（eager）路径对称——保证输出稳定、
	// 避免依赖 Go 传入顺序；生产调用图不经此路径（ScanEntriesWithHit 缓存命中时不进本函数），
	// 但测试和预留接口需行为一致。
	sort.Slice(response.Entries, func(i, j int) bool {
		return response.Entries[i].Path < response.Entries[j].Path
	})
	return response, nil
}
