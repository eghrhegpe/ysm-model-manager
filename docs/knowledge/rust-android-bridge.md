---
kind: rust-android-bridge
name: Rust Scanner Bridge 全平台支持
tier: architecture
category: core
source_files:
  - go/rustbridge/bridge_cgo.go
  - go/rustbridge/bridge_windows.go
  - go/rustbridge/common.go
  - go/scanner/rust_backend.go
  - scripts/compile-android-rust.ts
  - scripts/compile-rust-static.ts
  - scripts/android-build.ts
  - build/linux/Taskfile.yml
  - build/darwin/Taskfile.yml
auto_fields:
  symbols_with_lines:
    - Scan
    - ScanManifest
  tests:
    - tests/test_rust_bridge_tags.ts
  quick_groups:
    - 后端桥接与数据存储
  quick_intents:
    - Android/Linux/macOS Rust 桥
    - rust_backend、CGO
    - compile-android-rust/compile-rust-static
  quick_risk_lines:
    - Android/Linux/macOS 的 Rust 桥必须走平台桥，禁止硬编码 Windows 路径
  pitfalls:
    - 硬编码 Windows 路径 → Android/Linux 启动失败；必须经平台桥的编译脚本
    - CGO 未静态链接 → Android 缺少依赖库；必须经 compile-rust-static 静态编译
  use_when:
    - Android
    - Linux
    - macOS
    - rust_backend
    - CGO
  invariant_anchors:
    - go/rustbridge/bridge_cgo.go|Scan
tests:
  - tests/test_rust_bridge_tags.ts
quick_groups:
  - 后端桥接与数据存储
quick_intents:
  - Android/Linux/macOS Rust 桥
  - rust_backend、CGO
  - compile-android-rust/compile-rust-static
quick_risk_lines:
  - Android/Linux/macOS 的 Rust 桥必须走平台桥，禁止硬编码 Windows 路径
pitfalls:
  - 硬编码 Windows 路径 → Android/Linux 启动失败；必须经平台桥的编译脚本
  - CGO 未静态链接 → Android 缺少依赖库；必须经 compile-rust-static 静态编译

use_when:
  - Android
  - Linux
  - macOS
  - rust_backend
  - CGO
invariant_anchors:
  - go/rustbridge/bridge_cgo.go|Scan
status: active
---

# Rust Scanner Bridge 全平台支持

L2 合并（2026-09-03，ADR-139 §2 已落地）：`bridge_{darwin,linux,android}.go` 三份 CGO 文件
去注释后逐字相同（含 C 前导块），合并为单一 `bridge_cgo.go`（`//go:build (darwin || linux || android) && rust_backend`）。
`bridge_windows.go` 单列（syscall/DLL，无 cgo，实现真实不同）。

## 架构设计

| 平台 | 文件 | 触发条件 |
|------|------|---------|
| Windows | `bridge_windows.go` | `windows && rust_backend` |
| Linux/macOS/Android | `bridge_cgo.go` | `(darwin || linux || android) && rust_backend` |

> **GOOS=android 隐含 linux**：Go 的 GOOS=android 同时满足 `linux` 约束，单文件构造上
> 消除 android 撞车风险，无需 `!android` 守卫（ADR-139 §1.4）。

## 编译流程

1. Rust 编译（compile-android-rust.mjs）: cargo build --release --target=aarch64-linux-android
2. Go 交叉编译: go build -buildmode=c-shared -extldflags="-L&lt;path&gt; -l:libysm_model_manager_wails_bridge.a"

## 平台陷阱（2026-08-25 全平台排查实录）

- **本地 `go build ./go/...` 只验 Windows**：非 Windows 桥文件不参与本机编译，tag/类型错误全部漏网。防线 = `tests/test_rust_bridge_tags.ts`（tag 与文件名平台一致 + 同包 tag 判重 + Entries 兜底类型一致）；全链接验证仍需 CI / WSL / 真机。
- **Entries 兜底类型**：所有桥统一 `[]types.ModelEntry{}`（对齐 types.ScanResponse.Entries），禁 `[]interface{}{}`（非 Windows 必编译错）。
- **链接器差异**：macOS ld64 不支持 `-l:`，Linux/macOS 统一传完整归档路径 `-extldflags="-L&lt;dir&gt; &lt;dir&gt;/lib….a"`；Android NDK lld 支持 `-l:`。
- **tags 别漏 rust_backend**：android-build.mjs 曾只在 extldflags 判 rustBackend 而 go build tags 未加 → Rust 白编、静默走 Go stub。

## 不变量

- ABI 兼容：所有平台使用同一套 C ABI（YsmBuffer 结构体）
- 错误处理：Rust panic 被 catch_unwind 捕获，返回 JSON error
- 内存管理：Go 负责 free，通过 ysm_buffer_free 回调释放
- 回退机制：bridge 不可用时自动回退到 Go scanner
