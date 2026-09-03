//go:build windows && rust_backend

package rustbridge

import (
	"errors"
	"fmt"
	"runtime"
	"sort"
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
	if err := validateOutput(output); err != nil {
		return ScanResponse{}, err
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
		// 旧 DLL 不含 ysm_scan_manifest 符号——这是构建期错误，不应在生产环境出现。
		// 生产构建（build/windows/Taskfile.yml build:rust-bridge）会同步编译新 DLL，
		// 若此处触发说明 embed 的 DLL 与当前 Go 代码版本不一致，需重新构建。
		return ScanResponse{}, errors.New(
			"Rust scanner DLL missing ysm_scan_manifest symbol: rebuild with task build:rust-bridge")
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
	if err := validateOutput(output); err != nil {
		return ScanResponse{}, err
	}
	defer freeProc.Call(uintptr(unsafe.Pointer(output.ptr)), output.len, output.cap) //nolint:errcheck

	data := append([]byte(nil), unsafe.Slice(output.ptr, int(output.len))...)
	response, err := parseResponse(data, true)
	if err != nil {
		return response, err
	}
	// manifest 路径 entries 按 path 排序——生产调用图不经此路径（ScanEntriesWithHit 缓存命中
	// 时不进本函数），但测试契约要求输出稳定有序；同时 par_iter 在 hydrate_hashes 后重排
	// errors，此处 sort entries 对称以保证整体确定性。
	sort.Slice(response.Entries, func(i, j int) bool {
		return response.Entries[i].Path < response.Entries[j].Path
	})
	return response, nil
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
		// scanManifestProc 找不到是构建期错误：生产 DLL 必须含 ysm_scan_manifest 符号。
		// 若此处触发说明 embed 的 DLL 与当前 Go 代码版本不一致，需重新执行 build:rust-bridge。
		if scanManifestProc.Find() != nil {
			loadErr = fmt.Errorf("load Rust scanner manifest entry point: %w", scanManifestProc.Find())
		}
		if err := freeProc.Find(); err != nil {
			loadErr = fmt.Errorf("load Rust scanner free entry point: %w", err)
		}
	})
	return loadErr
}
