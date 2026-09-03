//go:build darwin && rust_backend

package rustbridge

import (
	"errors"
	"fmt"
	"runtime"
	"unsafe"
)

// Darwin 使用 CGO 静态链接：Rust .a 由 scripts/compile-rust-static.mjs 编译，
// 链接进可执行文件。

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
	if output.ptr == nil || output.len == 0 || output.len > uintptr(^uint(0)>>1) {
		return ScanResponse{}, errors.New("Rust scanner returned an invalid buffer")
	}
	defer C.ysm_buffer_free((*C.uchar)(output.ptr), C.size_t(output.len), C.size_t(output.cap))
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
	defer C.ysm_buffer_free((*C.uchar)(output.ptr), C.size_t(output.len), C.size_t(output.cap))
	data := append([]byte(nil), unsafe.Slice((*byte)(unsafe.Pointer(output.ptr)), int(output.len))...)
	return parseResponse(data, true)
}
