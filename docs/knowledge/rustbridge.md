---
kind: rustbridge
name: Rust 桥 rustbridge
tier: architecture
category: go
source_files:
  - go/rustbridge/bridge_windows.go
  - go/rustbridge/doc.go
  - go/rustbridge/embedded_windows.go
  - go/rustbridge/types_windows.go
  - go/rustbridge/common.go
  - rust-core/src/model.rs
  - rust-core/src/policy.rs
  - rust-core/src/scan.rs
  - rust-wails-bridge/
tests:
  - rust-core/src/tests.rs
use_when:
  - Rust 扫描器
  - rust_backend
  - 桥 DLL
  - Wails 后端迁移 Rust
perf:
  - io-bound
  - concurrent
invariant_anchors:
  - go/rustbridge/bridge_windows.go|func Scan
---

# Rust 桥 rustbridge

> 窄原生适配器：Wails 后端迁移 Rust 期的临时桥——Windows 生产构建（`rust_backend` tag）下用 Rust 扫描器替代 Go scanner 的窄接口。

## 范围与构建

- **包**：`go/rustbridge/`——全部文件带 `//go:build windows && rust_backend`，非 Windows 或无 tag 编译时被排除
- **桥 DLL**：`rust-wails-bridge/`（Rust crate）编译产出 `ysm_model_manager_wails_bridge.dll`，由 `build/windows/Taskfile.yml` 的 `build:rust-bridge` 构建并拷贝到 `go/rustbridge/bin/`（`platforms: [windows]` 守卫——非 Windows 交叉构建不产 .dll）
- **embed**：`embedded_windows.go` 用 `go:embed` 嵌入桥 DLL + sha256 校验 + 落盘；生产前端不直接 import 本包（doc.go 契约）

## 契约

- **types_windows.go**：`ScanError{Path, Message}` / `ScanResponse{Entries: []types.ModelEntry, Errors}`——对齐 `rust-core`（`ModelEntry` 含 `rtype`，见 `rust-core/src/model.rs`）+ Go `types.ModelEntry`
- **bridge_windows.go**：syscall/unsafe 直调 DLL（JSON 序列化），扫描结果经 `ScanResponse` 返回

## ABI 符号命名约束（ADR-120 已落地）

> 背景：跨栈共享已扫描状态（ADR-120）**能力**已落地——新增 Rust 导出符号 `ysm_scan_manifest`。
> 该符号在生产调用图中当前为**死代码**（见 ADR-120 §3 修正说明）：`ScanEntriesWithHit` 缓存未命中才回源 Rust，进入前已 `scanCache.Delete(dir)`，故 `scanEntriesWithRust` 的 manifest 分支不可达；实际「Go 缓存命中 Rust 不走路」由 `ScanEntriesWithHit` 直接 return 实现，不经 Rust。符号作为预留接口保留。
> 原 `ysm_scan_json` 命名歧义已确认，基础符号重命名（`ysm_scan`）留待下个 release 周期。

- **现状歧义（已记录，待重命名）**：`ysm_scan_json`（`bridge_windows.go` `dll.NewProc("ysm_scan_json")` ↔ `rust-wails-bridge/src/abi.rs` `#[no_mangle] pub unsafe extern "C" fn ysm_scan_json`）——它是**应用级通用扫描入口**（扫整棵树、所有 rtype：PMX/PMD/VMD/YSMParser 全套），**与 `.ysm` 扩展名无专属绑定**。
- **误读风险**：`ysm_` 前缀与「`.ysm` 文件类型」视觉撞车 + `_json` 把「返回 JSON」实现细节焊死进名字 → 易被误解为「扫 `.ysm` 资源的专用接口」。实际语义是「YSM-Model-Manager 这个**应用**的通用扫描、输出 JSON」。
- **ADR-120 落地事实**：
  - 新增 `ysm_scan_manifest`（接收 Go 预枚举清单 JSON、跳过 jwalk）—— `abi.rs` `#[no_mangle] pub unsafe extern "C" fn ysm_scan_manifest`，`scan_impl_manifest` 复用 `resolve_metadata` + `hydrate_hashes`
  - Go 侧 `rustbridge.ScanManifest(root, registryJSON, manifestJSON)`（`bridge_windows.go`）：旧 DLL 不含该符号时 `scanManifestProc=nil` 自动回退 `Scan`（jwalk），ABI 不破坏
  - `ysm_scan_json` 仍保留作回退（Rust `pub use` + Go `NewProc` 均保留）
  - 基础符号 `ysm_scan_json` → `ysm_scan` 的重命名**未执行**（留待下个 release，避免本次改动面过大）
- **约束**：新增 Rust 导出符号一律遵循 `ysm_<动作>` / `ysm_<动作>_<输入形态>` 形态，禁止把文件类型/序列化格式焊进名字。

## 与 Go scanner 的契约对齐（红线）

Rust 扫描路径必须与 Go scanner 单点口径一致（code review 反复核实的教训）：

| 契约点 | Rust 口径 | Go 单点 |
|--------|----------|---------|
| `.json` 条目门禁 | 仅 `ysm.json`（`is_model_json_name`，**含 TrimSpace** 对齐） | `types.IsYsmEntryJSON`（ADR-038 D2：.json 仅放行 ysm.json；legacy 几何是 FileInventory 分类非扫描条目） |
| 禁用后缀剥离 | `strip_disable_suffix`（.ban/.disabled，大小写不敏感） | `types.StripDisableSuffix`（.disabled 在前 .ban 兼容） |
| 目录级禁用 | `scan_fast` 跳过 `.ban`+`.disabled` 目录；`scan_index` 仅测试引用、下钻 `.ban`/`.disabled`（见下「未接线实验路径」） | `scanner.go` `IsDisableSuffix` 无条件 SkipDir（无 index 模式） |
| 条目名 | ysm.json → 父目录名 | `scanner.go` 同口径重命名 |
| 类型字段 | `ModelEntry.rtype`（registry 首声明优先） | `e.Type`（`SupportedExtsForSubtype` 白名单） |

> **隔离后缀序分歧（无语义差异）**：Go 常量序 `.disabled`→`.ban`，Rust `.ban` 优先；两后缀互不为后缀，剥离结果逐字一致。

> **未接线实验路径（非被依赖契约）**：目录级 `.ban`/`.disabled` 下钻仅存在于 Rust `scan_index`，且**无生产消费方**——rust-wails-bridge 两个生产入口（`ysm_scan_json`→`scan_fast` / `ysm_scan_manifest`→Go 预枚举）都不下钻禁用目录，`scan_index` 只被 `tests.rs` 引用。生产路径遵 Go 口径恒跳禁用目录。若未来「新桌面壳列出并再启用禁用模型」立项，应在**发现权单点**定归属：发现权留 Go（manifest 路径本来就是 Go 扫）则删孤儿 `scan_index` 在 Go 实现，勿双源共存。

- **CI 覆盖**（`.github/workflows/test.yml`）：cargo test（rust-core + rust-wails-bridge）+ 构建桥 DLL + `go test -tags rust_backend`——rust_backend 路径不再零覆盖
- **测试**：`rust-core/src/tests.rs` 的 `scan_preserves_go_filter_contract` 锁条目门禁（main/info.json 不入条目 + rtype 传播）
- **共享契约向量（2026-08-25）**：`tests/parity/go-rust-predicates.json` 为三个纯谓词（`strip_disable_suffix` / `is_ysm_entry_json` / `is_disable_suffix`）的 input→output 单一事实源，被 `go/types/parity_test.go` 与 `rust-core/src/tests.rs`（`parity_*`）双端读取。任一端改口径另一端 CI 当场红，取代人肉 review 兜底。新增谓词/改口径：改 fixture，两端读同一份自动对齐。路径定址：Go 经包目录向上找仓库根，Rust 经 `CARGO_MANIFEST_DIR` 定址，不受 cwd 影响。

## 验证方式（AI 动 Rust 的入口——安全网）

> 很少有 AI 动 Rust——动之前先读本节：改完跑本地验证，语义靠契约测试兜底。

- **本地验证（必跑）**：
  ```bash
  cargo test --manifest-path rust-core/Cargo.toml          # 扫描器核心单测（契约锁在 tests.rs）
  cargo test --manifest-path rust-wails-bridge/Cargo.toml   # 桥 crate
  ```
- **契约锁**：`rust-core/src/tests.rs` 的 `scan_preserves_go_filter_contract`——锁 ysm.json 条目门禁（main/info 不入条目）+ rtype 传播与 Go scanner 一致——**改 Rust 扫描逻辑必须过它**（语义漂移当场红）
- **CI 门禁**（`.github/workflows/test.yml`）：cargo test × 2 crate + `cargo build --release --locked` 产 DLL + `go test -tags rust_backend`（Windows 生产路径——rust_backend 覆盖不再为零）
- **构建**：`build/windows/Taskfile.yml` 的 `build:rust-bridge`（`platforms: [windows]` 守卫——非 Windows 交叉构建不产 .dll）

## Rust 化三闸（防双源歧义 / 滑坡——缺一不批）

> 背景：担心 Go/Rust 双源歧义 + "都塞 Rust 那 C++ 也要"滑坡。三闸是止滑闸——Rust 化是"性能证据驱动的最窄下沉"（scan 并发 4x 是唯一模板）。

1. **性能证据**：`file-bench` / `concurrent-bench` profile 证明该路径是热点（scan 的 serial 17s → parallel 4.5s 是模板）——无证据的 Rust 化是过度工程
2. **契约测试**：Go/Rust 双实现语义等价——tests.rs 断言锁定（`scan_preserves_go_filter_contract` 是模板）——**非热路径禁止双源**（同步/解析/索引保持 Go 单点权威，避免漂移）
3. **不扩散**：Rust 只做并行加速壳——业务逻辑（parseYsmArchive/SyncToggleStatus/索引）不 Rust 化——新增 Rust 模块需三闸 + ADR 决策

## 相关

- ADR：ADR-115（红线范式——跨类型/跨实现不得绕过单点契约）
- 源码：`rust-core/`（Rust 扫描器核心）、`rust-wails-bridge/`（桥 crate）、`go/rustbridge/`（Go 侧窄适配器）
