# go/rustbridge

> Go ↔ Rust FFI 桥接层，调用 Rust 编写的 YSM 模型扫描器（ysm_scan_json/ysm_scan_manifest）。
> 4 平台独立实现：Windows（syscall.LazyDLL）、Android/Linux/Darwin（CGO extern）。

## 文件结构

- `bridge_windows.go` (126 行) — Windows FFI 桥接（syscall.LazyProc）
- `bridge_android.go` (107 行) — Android FFI 桥接（CGO extern）
- `bridge_linux.go` (104 行) — Linux FFI 桥接（CGO extern）
- `bridge_darwin.go` (101 行) — macOS FFI 桥接（CGO extern）
- `embedded_windows.go` (69 行) — Windows 内嵌 Rust 库释放（SHA256 版本化缓存 + 原子 rename）
- `common.go` (33 行) — 公共解码（parseResponse）
- `types.go` (17 行) — 类型定义（ScanResponse/ScanEntry）
- `types_windows.go` (9 行) — Windows 特定类型（nativeBuffer）
- `doc.go` (3 行) — 包文档

## 不变量

- FFI 内存管理：Rust 分配 → Go 拷贝（`append([]byte(nil), unsafe.Slice(...))`）→ `defer freeProc.Call` 释放。顺序正确：return 求值 `parseResponse(data)` 后 defer 执行 free。
- `unsafe.Slice(output.ptr, int(output.len))` 作为 `append` 源，`output.ptr` 在 append 完成后不再被 Go 侧引用，free 可安全执行。
- `runtime.KeepAlive(root)` / `runtime.KeepAlive(registryJSON)` 防止 GC 在 FFI 调用期间回收 Go 字符串/字节切片。
- `load()` 用 `sync.Once`，首次加载失败后 `loadErr` 被永久缓存，后续所有 `Scan` 调用都返回同一错误，无重试机制。DLL 是内嵌的、缓存目录是用户私有的，加载失败基本是永久性的。
- `materializeDLL` 依赖 `os.MkdirAll(dir, 0o700)` 的目录级 ACL 限制隔离临时文件。**不调用 os.Chmod**（Windows 上只切换 `FILE_ATTRIBUTE_READONLY`，不处理 Unix 权限位）。
- `ScanManifest` 是 ADR-120 预留接口，生产调用图不可达（仅测试调用）。旧 DLL 不含 `ysm_scan_manifest` 符号时回退到 `Scan(root, registryJSON)`。

## R32 修复链（2026-08-31）

- **P2-1 临时文件权限**：`os.CreateTemp` 权限继承 umask（可能 0644）。code_review P2 修正：`os.Chmod(0o600)` 在 Windows 上无效（只切换 `FILE_ATTRIBUTE_READONLY`），真正的隔离由 `os.MkdirAll(dir, 0o700)` 的目录级 ACL 限制提供。移除无效 `os.Chmod`。
- **P3-1 FFI 调用序列化**：四平台 `Scan`/`ScanManifest` 对 FFI 调用无并发序列化保护，若 Rust 侧非线程安全会触发数据竞争或 panic。修复：加 `ffiMu sync.Mutex`，`Scan`/`ScanManifest` 入口 `ffiMu.Lock()`+`defer ffiMu.Unlock()`（Windows 平台已修，Android/Linux/Darwin 待后续 build tag 验证）。
- **P4 四平台函数体逐字重复**：CGO `import "C"` 的特殊性使完全去重困难，但函数体可抽公共到 `bridge_cgo_common.go`（build tag: `(linux || darwin || android) && rust_backend`）。待后续重构。

## 相关

- ADR-120（manifest 扫描预留接口）
- ADR-139（Android 隐含 linux build tag）
- `go/scanner/rust_backend.go` — scanner 侧 Rust 后端入口
