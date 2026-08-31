# ADR-120：Go/Rust 共享已扫描状态：manifest 注入跳过 jwalk

- **状态**：已采纳（Accepted）— 生产触发路径不存在（见 §3 修正说明）
- **日期**：2026-08-24
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/rustbridge/bridge_windows.go|go/scanner/scanner.go|rust-core/src/scan.rs|rust-wails-bridge/src/abi.rs|docs/knowledge/rustbridge.md`

---

## 1. 背景（Context）

ysm-model-manager 的 Windows 生产构建（`rust_backend` tag）下，Rust 扫描器（`ysm_model_manager_core` crate 的 `scan_eager` → `scan_fast` → `scan_impl`）替代 Go `scanner` 做文件系统扫描。

**已坐实的现状**：
- Rust 的「扫描」= `jwalk` 从 `root` **全树发现**所有文件 + 每候选取 `size/mod_time` + `hydrate_hashes`（`rust-core/src/scan.rs:23-99`，`hash.rs:45-51`）。**不解析 PMX/PMD/VMD 内容**——只取路径元数据。
- Go 侧 `scanner.ScanEntriesWithHit(dir)`（`go/scanner/scanner.go`）已分类出「哪些文件是 PMX、在哪个 subdir、rtype 是什么」，并缓存 30s（single-flight）。
- 桥接 `rust_backend_windows.go:18` 的 `scanEntriesWithRust` 只把 `dir + registryJSON` 丢给 Rust（`ysm_scan_json` ABI，`rust-wails-bridge/src/abi.rs:49`）。**Rust 拿到 `dir` 后完全重做了一遍 Go 已完成的路径发现**。

这是「Go/Rust 内存缓存没统一」的真正落点（用户原直觉）。同一棵树在一次刷新内被 Rust 走 1 遍全树 jwalk，Go 又独立扫 1 遍——互不共享已发现状态。

**本 ADR 范围**：消除 Rust 对「Go 已枚举文件」的重复发现。不解决模型内容解析（Rust 本就不解析），不触碰非 Windows / 非 rust_backend 的纯 Go 扫描路径。

## 2. 决策（Decision）

**方案 1（采纳）：Go 传预枚举文件清单（manifest）给 Rust，跳过 jwalk 发现。**

新增 ABI 符号 `ysm_scan_manifest(root, registry, manifest_json, out)`：
- `manifest_json` = Go 已分类的 `[]ModelEntry`（字段：`Path`/`Ext`/`Name`/`subdir`/`rtype`）JSON 序列化
- Rust 侧 `scan_impl_manifest(candidates, policy)`：跳过 `jwalk`，直接对每个候选 path 调 `fs::metadata` 取 `size/mod_time`（`resolve_metadata` 核心逻辑复用）+ `hydrate_hashes`，产出与 `scan_impl` 同构的 `ScanReport`
- Go 侧 `scanEntriesWithRust` 在命中 `scanner.ScanEntriesWithHit(dir)` 缓存时，序列化清单传 Rust；**未命中或候选 ext 不在 `policy.supports_ext` 内则回退 `ysm_scan_json`（jwalk）**

**命名约束**（固化于 `docs/knowledge/rustbridge.md`）：
- `ysm_scan_json` → 基础符号重命名为 `ysm_scan`（去掉焊死的 `_json` 格式后缀；该符号是应用级通用扫描、与 `.ysm` 类型无专属绑定，原名易被误读）
- 新增 `ysm_scan_manifest`（动作+输入形态，与 `ysm_scan` 形成父子关系）
- **ABI 不破坏**：Rust 侧保留 `ysm_scan_json` 的 `#[no_mangle]` 导出 + `pub use` 别名作回退；Go 侧 `NewProc` 先切 `ysm_scan`，旧 `NewProc("ysm_scan_json")` 保留一个 release 周期再删

**拒绝方案 2（Rust 进程内缓存 scan 结果）**：最小改动但首次仍 jwalk，且多 root 内存增长；收益小于方案 1（方案 1 直接利用 Go 已暖缓存，命中时 Rust 完全不走路）。

## 3. 后果（Consequences）

**正面**：
- Rust 从「全树 jwalk + 并行 metadata」降级为「对已知清单取 metadata」，IO 从 O(全树文件数) 降为 O(清单项数)——**作为能力成立**
- ABI 向后兼容，旧符号保留回退

> **⚠️ 修正说明（2026-08-24 审核）**：`ysm_scan_manifest` / `scan_impl_manifest` / `Go ScanManifest` 作为能力完整且正确，但**生产触发路径不存在**。唯一生产入口 `ScanEntriesWithHit(dir)` 只有在「缓存未命中」时才成为 owner 调 `scanEntriesWithRust(dir)`（`go/scanner/scanner.go:218-266`）；而未命中分支进入前已 `scanCache.Delete(dir)`（L232），故 `scanEntriesWithRust` 内部再 `scanCache.Load` 永远拿到过期/缺失条目 → manifest 分支（`rust_backend_windows.go:22-40`）**无条件不可达**。根因是 `scanCache` 为 **30s TTL 的进程内存缓存**（`scanner.go:71`），**非永久**；「缓存命中时 Rust 不进场（L224-227 直接 return）」与「Rust 进场时缓存已过期」在时间上互斥，「有 Go 缓存但仍需 Rust 结果」在现有架构下逻辑不可能。
>
> **死代码清除（2026-08-24 同次审核）**：已删除 `scanEntriesWithRust` 内的 manifest 隐式分支（`rust_backend_windows.go:22-40`），函数收敛为纯 `rustbridge.Scan(dir)` 转发。该分支既不可达、又曾因「内调 `ScanEntriesWithHit` 会递归回本函数」而自带 single-flight `wg.Wait()` 死锁隐患（原注释自承）。删除后 Rust 深加工入口 `ysm_scan_manifest` 退居**显式独立 API**：仅当业务代码主动持有 Go `[]ModelEntry` 且需 Rust 深加工时由调用方显式调用，**不走** `scanEntriesWithRust` 隐式快路径。其当前唯一真实调用点 = ABI 守门测试 `TestScanManifest_ABI_MatchesJwalk`（锁 P2 `.json` 白名单 / P3 `CompatModelEntry.Type` 契约）。触发「显式调用」的真实前提 = 未来做 Go/Rust 扫描分工（Go 轻扫探路 + Rust 深加工流水线）之日；在那之前它休眠，零维护成本。详情见 `go-scanner.md` Rust 回源条「ScanManifest 调用纪律」。
>
> **P1 复核（同次审核）**：原疑「ToggleModelEnable 仅失效模型夹层级、不覆盖仓库根缓存、存在 30s 陈旧窗口」——**经核实为误判，P1 不成立**。`scanner.InvalidatePath`（`scanner.go:165-191`）的失效逻辑含祖先链：`strings.HasPrefix(key, kstr+sep)` 条件在「失效 dir 是 kstr 后代」时递增 kstr 的 keyVersion 并删 kstr 条目。即禁用 `globalDir/ModelA`（文件级 `filepath.Dir` 直接命中 `globalDir`；目录级 `ModelA` 文件夹 `filepath.Dir` = `base`，仍经祖先链命中 `globalDir`）→ 仓库根 `scanCache[globalDir]` 立即失效。实测目录级禁用后 `BuildSyncItems` 已从 `.ban` 路径重扫，不残留旧条目。**不在 `BuildSyncItems` 入口加冗余 `InvalidatePath(globalDir)`**——`InvalidatePath` 的 keyVersion 祖先链已是长治久安机制（详见 `go-scanner.md` 失效契约节）。

**负面 / 风险**：
- **跨栈改动面宽**：Rust（abi.rs + scan.rs + response.rs + lib.rs 重导出）+ Go 桥（bridge_windows.go + rust_backend_windows.go）+ 双端测试，需重新编译 Rust DLL 并验证 Windows 构建
- **口径对齐风险**：Go `types.IsTypeModelFile` 口径 vs Rust `policy.supports_ext` 口径必须逐字节对齐，否则 Go 传的清单 Rust 不认（回退 jwalk 仍可工作，但失去优化收益）。缓解：Go 桥注入前先校验 ext ∈ `policy.supports_ext`，不匹配即回退
- **disable 后缀处理**：Go `scanner` 已恢复 `.disabled/.ban` 为原 ext；manifest 传 `e.Ext`（已恢复）而非原始文件名，与 Rust `strip_disable_suffix` 对齐
- **`subdir` 字段**：`response.rs:59-61` 桥输出时强制清空 `subdir`（v1.13 flatten）——Go 传不传 `subdir` 对当前桥输出无影响，但 `ModelEntry` 内部仍带，Rust 内部可能用，故 manifest 仍传以保语义完整

**已知遗留**：
- 实例侧 `collectFolderFiles` Walk 仍保留（实例根不在 scanner 缓存体系内，量级小）
- 非 Windows / 非 rust_backend 纯 Go 扫描路径不受影响（改动局限在 `scanEntriesWithRust` 内）

## 4. 数据溯源

- 来源：`rust-wails-bridge/src/abi.rs:49`（ysm_scan_json 现状）、`rust-core/src/scan.rs:23-99`（scan_impl jwalk）、`rust-core/src/hash.rs:45`（scan_eager 调 scan_fast+hydrate_hashes）、`go/rustbridge/bridge_windows.go:75`（NewProc 加载点）、`go/scanner/scanner.go`（ScanEntriesWithHit 缓存）
- 结果：ADR-120 采纳方案 1，作为**能力**落地（Rust 扫描 IO 从 O(全树) 降为 O(清单)），但生产路径下 manifest 分支为死代码（见 §3 修正说明）；Go/Rust 零重复扫描实际由 `ScanEntriesWithHit` 缓存命中直接 return 实现，不经 Rust。
- 关联：`docs/knowledge/rustbridge.md`（ABI 符号命名约束）、`go-sync.md`（根因 D 记录）

<!-- 文件名: go-rust-manifest-jwalk.md → 实际文件 ADR-120-go-rust-manifest-jwalk.md -->
