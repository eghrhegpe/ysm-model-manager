//go:build windows && rust_backend

package rustbridge

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"unsafe"
)

var (
	loadOnce sync.Once
	loadErr  error
	scanProc *syscall.LazyProc
	// scanManifestProc 是 ADR-120 新增的 manifest 扫描入口（Go 预枚举清单跳过 jwalk）。
	// 旧 scanProc (ysm_scan) 保留作回退，ABI 不破坏。
	scanManifestProc *syscall.LazyProc
	freeProc         *syscall.LazyProc
	// R32 P3-1：FFI 调用序列化由 common.go 的 ffiMu 统一管理（四平台共享）。
)

func Scan(root string, registryJSON []byte) (ScanResponse, error) {
	if err := load(); err != nil {
		return ScanResponse{}, err
	}
	if len(registryJSON) == 0 {
		return ScanResponse{}, errors.New("Rust scanner registry is empty")
	}

	// R32 P3-1：FFI 调用序列化，防 Rust 侧非线程安全导致数据竞争/panic。
	ffiMu.Lock()
	defer ffiMu.Unlock()

	var rootPtr *byte
	if len(root) > 0 {
		rootPtr = unsafe.StringData(root)
	}
	registryPtr := unsafe.SliceData(registryJSON)
	var output nativeBuffer
	status, _, callErr := scanProc.Call(
		uintptr(unsafe.Pointer(rootPtr)), uintptr(len(root)),
		uintptr(unsafe.Pointer(registryPtr)), uintptr(len(registryJSON)),
		uintptr(unsafe.Pointer(&output)),
	)
	runtime.KeepAlive(root)
	runtime.KeepAlive(registryJSON)
	if status != 0 {
		return ScanResponse{}, fmt.Errorf("Rust scanner ABI status %d: %w", status, callErr)
	}
	if output.ptr == nil || output.len == 0 || output.len > uintptr(^uint(0)>>1) {
		return ScanResponse{}, errors.New("Rust scanner returned an invalid buffer")
	}
	defer freeProc.Call(uintptr(unsafe.Pointer(output.ptr)), output.len, output.cap) //nolint:errcheck
	// 注：free 失败（DLL 未正确导出 ysm_buffer_free）仅记 warn，不阻塞调用——
	// Rust 侧的 Vec 已 forget 转移所有权，Go 必须释放，但生产环境此路径不应触发。

	// append 先于 defer 执行：拷贝 Rust 侧分配的缓冲区到 Go 堆，defer 在函数返回时释放。
	// 若 defer 先于 append 执行则 freeProc 会释放尚未被拷贝的内存——此处顺序必须保证。
	data := append([]byte(nil), unsafe.Slice(output.ptr, int(output.len))...)
	return parseResponse(data, false)
}

// ScanManifest 使用 Go 预枚举的文件清单调用 Rust，跳过 Rust 侧的文件系统发现（jwalk）。
// 清单条目须与 types.ModelEntry 字段对齐（Path/Ext/Name/Subdir/Rtype）。ADR-120。
func ScanManifest(root string, registryJSON, manifestJSON []byte) (ScanResponse, error) {
	if err := load(); err != nil {
		return ScanResponse{}, err
	}
	if len(registryJSON) == 0 {
		return ScanResponse{}, errors.New("Rust scanner registry is empty")
	}
	if len(manifestJSON) == 0 {
		return ScanResponse{}, errors.New("Rust scanner manifest is empty")
	}
	if scanManifestProc == nil {
		// 旧 DLL 不含 ysm_scan_manifest —— 回退到 Scan（jwalk），保证向后兼容
		return Scan(root, registryJSON)
	}

	// R32 P3-1：FFI 调用序列化，防 Rust 侧非线程安全导致数据竞争/panic。
	ffiMu.Lock()
	defer ffiMu.Unlock()

	var rootPtr *byte
	if len(root) > 0 {
		rootPtr = unsafe.StringData(root)
	}
	registryPtr := unsafe.SliceData(registryJSON)
	manifestPtr := unsafe.SliceData(manifestJSON)
	var output nativeBuffer
	status, _, callErr := scanManifestProc.Call(
		uintptr(unsafe.Pointer(rootPtr)), uintptr(len(root)),
		uintptr(unsafe.Pointer(registryPtr)), uintptr(len(registryJSON)),
		uintptr(unsafe.Pointer(manifestPtr)), uintptr(len(manifestJSON)),
		uintptr(unsafe.Pointer(&output)),
	)
	runtime.KeepAlive(root)
	runtime.KeepAlive(registryJSON)
	runtime.KeepAlive(manifestJSON)
	if status != 0 {
		return ScanResponse{}, fmt.Errorf("Rust scanner manifest ABI status %d: %w", status, callErr)
	}
	if output.ptr == nil || output.len == 0 || output.len > uintptr(^uint(0)>>1) {
		return ScanResponse{}, errors.New("Rust scanner returned an invalid buffer")
	}
	defer freeProc.Call(uintptr(unsafe.Pointer(output.ptr)), output.len, output.cap) //nolint:errcheck

	data := append([]byte(nil), unsafe.Slice(output.ptr, int(output.len))...)
	return parseResponse(data, true)
}

func load() error {
	loadOnce.Do(func() {
		path, err := materializeDLL()
		if err != nil {
			loadErr = err
			return
		}
		dll := syscall.NewLazyDLL(path)
		scanProc = dll.NewProc("ysm_scan")
		scanManifestProc = dll.NewProc("ysm_scan_manifest")
		freeProc = dll.NewProc("ysm_buffer_free")
		if err := scanProc.Find(); err != nil {
			loadErr = fmt.Errorf("load Rust scanner entry point: %w", err)
			return
		}
		// scanManifestProc 找不到不致命：旧 DLL 不含该符号，ScanManifest 自动回退 Scan
		if scanManifestProc.Find() != nil {
			scanManifestProc = nil
		}
		if err := freeProc.Find(); err != nil {
			loadErr = fmt.Errorf("load Rust scanner free entry point: %w", err)
		}
	})
	return loadErr
}
