---
kind: rust-android-bridge
name: Rust Scanner Bridge 全平台支持
tier: architecture
category: core
source_files:
  - go/rustbridge/bridge_android.go
  - go/rustbridge/bridge_linux.go
  - go/rustbridge/bridge_darwin.go
  - go/rustbridge/types.go
  - go/scanner/rust_backend.go
  - scripts/compile-android-rust.ts
  - scripts/compile-rust-static.ts
  - scripts/android-build.ts
  - build/linux/Taskfile.yml
  - build/darwin/Taskfile.yml
tests:
  - tests/test_rust_bridge_tags.mjs
use_when:
  - Android
  - Linux
  - macOS
  - rust_backend
  - CGO
invariant_anchors:
  - go/rustbridge/bridge_android.go|Scan
---

# Rust Scanner Bridge 全平台支持

在原有 Windows DLL embed 基础上，新增 Android/Linux/macOS 的 CGO 静态链接支持。

## 架构设计

| 平台 | 方案 | 触发条件 |
|------|------|---------|
| Windows | DLL embed + 动态加载 | windows && rust_backend |
| Android | CGO 静态链接 | android && rust_backend |
| Linux | CGO 静态链接 | linux && rust_backend |
| macOS | CGO 静态链接 | darwin && rust_backend |

## 编译流程

1. Rust 编译（compile-android-rust.mjs）: cargo build --release --target=aarch64-linux-android
2. Go 交叉编译: go build -buildmode=c-shared -extldflags="-L&lt;path&gt; -l:libysm_model_manager_wails_bridge.a"

## 平台陷阱（2026-08-25 全平台排查实录）

- **本地 `go build ./go/...` 只验 Windows**：非 Windows 桥文件不参与本机编译，tag/类型错误全部漏网。防线 = `tests/test_rust_bridge_tags.mjs`（tag 与文件名平台一致 + 同包 tag 判重 + Entries 兜底类型一致）；全链接验证仍需 CI / WSL / 真机。
- **build tag 必须与文件名平台一致**：`bridge_darwin.go` 曾误写 `linux && rust_backend` → Linux 构建 redeclared、macOS 无实现。
- **Entries 兜底类型**：所有桥统一 `[]types.ModelEntry{}`（对齐 types.ScanResponse.Entries），禁 `[]interface{}{}`（非 Windows 必编译错）。
- **链接器差异**：macOS ld64 不支持 `-l:`，Linux/macOS 统一传完整归档路径 `-extldflags="-L&lt;dir&gt; &lt;dir&gt;/lib….a"`；Android NDK lld 支持 `-l:`。
- **tags 别漏 rust_backend**：android-build.mjs 曾只在 extldflags 判 rustBackend 而 go build tags 未加 → Rust 白编、静默走 Go stub。

## 不变量

- ABI 兼容：所有平台使用同一套 C ABI（YsmBuffer 结构体）
- 错误处理：Rust panic 被 catch_unwind 捕获，返回 JSON error
- 内存管理：Go 负责 free，通过 ysm_buffer_free 回调释放
- 回退机制：bridge 不可用时自动回退到 Go scanner
