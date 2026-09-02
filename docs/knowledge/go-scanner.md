---
kind: go-scanner
name: 扫描核心 go/scanner
tier: architecture
category: go
source_files:
  - go/scanner/
auto_fields:
  symbols_with_lines:
    - ComputeFileHash:521
    - EffectiveCacheTTL:149
    - GenerateRepoIndex:699
    - InvalidateCache:193
    - InvalidatePath:209
    - ListModelAuthors:587
    - OnCacheInvalidated:174
    - ScanEntries:264
    - ScanEntriesLite:544
    - ScanEntriesWithHit:271
    - ScanLocalAuthors:617
    - SetErrorSink:101
  use_when:
    - 扫描
    - 扫描条目
    - 文件树
    - 哈希
    - 缓存
    - 作者提取
    - ScanEntries
    - 索引生成
  perf:
    - io-bound
    - concurrent
  invariant_anchors:
    - go/scanner/scanner.go|fsutil.IsRecycleDir
    - go/scanner/scanner.go|IsYsmEntryJSON
  quick_groups:
    - 模型扫描与仓库管理
  quick_intents:
    - 扫描模型、ScanModelEntries
    - 资源类型识别、rtype 判定
    - 仓库审计、健康分
  quick_risk_lines:
    - 容器指纹缓存失效需调 ClearScanCache
    - resource_types.json 是唯一事实来源
use_when:
  - 扫描
  - 扫描条目
  - 文件树
  - 哈希
  - 缓存
  - 作者提取
  - ScanEntries
  - 索引生成
perf:
  - io-bound
  - concurrent
invariant_anchors:
  - go/scanner/scanner.go|fsutil.IsRecycleDir
  - go/scanner/scanner.go|IsYsmEntryJSON
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 扫描模型、ScanModelEntries
  - 资源类型识别、rtype 判定
  - 仓库审计、健康分
quick_risk_lines:
  - 容器指纹缓存失效需调 ClearScanCache
  - resource_types.json 是唯一事实来源
status: active

  pitfalls:
    - 容器指纹缓存失效需调 ClearScanCache——文件变更后不失效会导致缓存命中旧数据
    - resource_types.json 是唯一事实来源——修改类型定义后必须重新扫描
    - ScanEntries 排除 .recycle 目录——换用不排 .recycle 的 scanFn 会重新引入误判
    - ScanEntriesWithHit 缓存 30s TTL——频繁扫描会反复重算
    - 作者提取依赖模型文件中的 metadata.authors 字段——缺失则作者为空
    - 单文件 >500MB 跳过哈希计算——同步对空哈希跳过匹配
    - Go/Rust 双扫描器口径必须一致——parity_test.go 锁三条谓词
---

# 扫描核心 go/scanner

## 概览

`go/scanner/` 包实现仓库文件扫描、哈希计算、缓存失效、作者提取、索引生成（ADR-003 P2 下沉，薄壳 `internal/app/app_scan.go` 仅保留依赖 App 的方法）。

## 核心职责

- `ScanEntries` 递归扫描目录产出 `ModelEntry[]`（支持 `.ban` 后缀还原扩展名）
- **MMD 子目录分组（ADR-096 P1）**：扫描 MMD group 根时，`scanner.go` 通过 `filepath.Rel` + `strings.Split` 提取第一段路径，命中 `types.IsMMDSubDir` 时填充 `ModelEntry.SubDir`（如 `SceneModel`/`CustomAnim`）；非 MMD 类型 / 根下文件恒为 `""`（`omitempty` 不序列化）
- `.json` 白名单：仅 `ysm.json` 作为模型条目（ADR-038 D2，几何/动画/语言 json 不单独扫描）
- 30s 扫描缓存（**非永久**）+ 路径级失效：`scanCache` 为 `sync.Map`（`string → scanCacheEntry{entries []ModelEntry, expiresAt time.Time}`），记录扫描条目与过期时刻；TTL 默认 30s（可由 `AppConfig.ScanCacheTTLMs` 覆盖，仍是短 TTL），且**纯进程内存——App 重启即全失，不存在「确定仓库永久缓存」**。故「缓存命中时 Rust 不进场、Rust 进场时缓存已过期」两者时间互斥，`scanEntriesWithRust` 内无法复用 Go 缓存作为 manifest（见下方 Rust 回源条）。`keyVersions` 为另一份 `sync.Map`（`string → *atomic.Uint64`），用 `(*atomic.Uint64).Add(1)` 原子递增 per-key 版本戳，防并发 `InvalidatePath` 竞态——P1 修复；单全局 `cacheGen atomic.Uint64` 仅作全量失效的代际短路标记
- SHA256 哈希（同步系统文件匹配用）
- 作者提取（`[作者]` 前缀统计）、本地作者扫描、`index.json` 生成

## 白名单口径（ADR-038 D2）

| 扩展名 | 扫描行为 |
|--------|---------|
| `.ysm` / `.zip` / `.7z` / `.nbt` / `.schematic` / `.litematic` | ✅ 扫描 + 哈希 |
| `.json` | `ShouldHashExt` 纳入哈希清单，但 `scanner.go` 按 baseName 过滤（`types.IsYsmEntryJSON`），仅 `ysm.json` 实际参与扫描（ADR-038 D2） |
| `.ban` / `.disabled` 后缀 | 还原原始扩展名后按上述判断 |

> **注意**：CI workflow 模板（`generateIndexWorkflow`）的 `paths:` 触发条件仅列 `**.ysm` / `**.zip` / `**.7z`，与扫描侧 `.json` 白名单口径分工不同——扫描负责全量发现，CI 只感知 YSM/压缩包变更。
> `ensureRepoWorkflow` 用 `fsutil.WriteFileAtomic` 原子写 workflow（ADR-109 §4），不裸 `os.WriteFile`——防止中途崩溃留残缺文件被上方 `os.Stat` 误判为「已存在」而永久静默失效；已存在则不覆盖，保留用户自定义 workflow。

## 对外 API / 入口

- `ScanEntries(dir)` — 单返回值薄壳：内部 `ScanEntriesWithHit(dir)` 丢弃 `bool` 后返回条目
- `ScanEntriesWithHit(dir)` — 扫描核心（缓存 30s，`.recycle` 跳过），返回 `(entries []ModelEntry, hit bool)`，调用方据此决定是否记录扫描日志，避免 30s 内重复访问同一目录时刷屏操作日志面板
- **在途合并（single-flight，2026-08-21）**：缓存「扫完才 Store」，同目录并发请求在途重叠时会双双真扫（点击整合包时前端多组件并发要状态 → 操作日志同秒重复条目）。`inFlight`（`sync.Map: dir → *scanFlight`）让首个调用方注册航班走盘，后续调用方 `wg.Wait()` 并入航班取**克隆**结果且返回 `hit=true`（薄壳不重复记日志）；唯一 owner 返回 `hit=false`。`walkCount`/`flightJoins` 为诊断计数。测试 `scanner_singleflight_test.go`（walkStartHook 制造确定性重叠）
- `InvalidateCache()` / `InvalidatePath(dir)` — 缓存失效（导入/启用禁用后调用）
  - **`InvalidatePath` 祖先链覆盖（长治久安核心）**：`scanner.go:209-259` 的 `InvalidatePath` 不只删 `dir` 自身，还遍历 `keyVersions` / `scanCache` 删所有**互前缀** key——含 `strings.HasPrefix(key, kstr+sep)`（失效 dir 是 kstr 的后代时，递增 kstr 版本并删 kstr 条目）。即「禁用 `globalDir/ModelA` → `InvalidatePath(filepath.Dir(ModelA))` = `InvalidatePath(globalDir)`（文件级）或 `InvalidatePath(base)`（目录级 ModelA 文件夹）→ 仍经祖先链命中并失效 `globalDir` 仓库根缓存」。所以 sync 层消费的 `scanCache[globalDir]` 在 Toggle 后立即失效，**无 30s 陈旧窗口**。`BuildSyncItems` 入口无需额外失效（冗余）。
  - ⚠️ **复核（2026-08-24 审核 P1）**：此前疑「ToggleModelEnable 仅失效模型夹层级、不覆盖仓库根祖先 key、存在 30s 窗口」——经核实为误判。`InvalidatePath` 的 keyVersion 祖先链（`scanner.go:242` 第二个 `HasPrefix` 条件）已覆盖仓库根；目录级禁用 `path=globalDir/ModelA` 时 `filepath.Dir` = `base`，`InvalidatePath(base)` 仍经 `HasPrefix(key, kstr+sep)` 命中 `globalDir`。实测目录级禁用后 `BuildSyncItems` 结果已从 `.ban` 路径重扫，不残留旧条目。P1 不成立，不引入额外失效代码。
- `OnCacheInvalidated(fn)` — 注册扫描缓存失效钩子；`InvalidateCache` / `InvalidatePath` 完成清理后同步调用。注册方自行保证幂等：`go/instance` / `go/sync` 各导出 `RegisterInvalidationHook()`（内部 `sync.Once`），由 app 层 ServiceStartup 显式调用（2026-08-26 起不再隐式 `init()` 注册，导入无跨包副作用）。
- `EffectiveCacheTTL()` — 当前生效的扫描缓存 TTL（`AppConfig.ScanCacheTTLMs` 覆盖否则默认 30s）；**派生缓存刷新周期单一事实源**——instance/sync 写缓存过期时刻时取同一口径（写入时刻求值，勿包级初始化固化默认值）。
- **Rust 回源 `scanEntriesWithRust(dir)`（ADR-120）**：`ScanEntriesWithHit` 缓存未命中时回源调 Rust（Windows + `rust_backend` tag）。该函数**仅**转发 `rustbridge.Scan(dir, registryJSON)`（jwalk 全树发现），不再内读 `scanCache`。
  - ⚠️ **死代码清除（2026-08-24）**：原实现在 `scanEntriesWithRust` 内先 `scanCache.Load(dir)`、命中未过期则走 `rustbridge.ScanManifest` 隐式快路径——经审核该分支**逻辑不可达**：`ScanEntriesWithHit` 仅在「缓存未命中」时成为 owner 调本函数（`scanner.go:271+`），且未命中进入前已 `scanCache.Delete(dir)`（L288-290 附近），故本函数内部再 `Load` 永远拿到过期/缺失条目；而缓存命中时 `ScanEntriesWithHit` 直接 return 不经 Rust。两者时间互斥，「有 Go 缓存但仍需 Rust 结果」在现有架构下不存在。该隐式分支已删除，`scanEntriesWithRust` 收敛为纯 `rustbridge.Scan` 转发。
  - **`rustbridge.ScanManifest` 调用纪律（显式独立出口）**：Rust 侧 `ysm_scan_manifest` 保留，但**只作显式 API**，由业务代码在「已持有一份 Go `[]ModelEntry`、想让 Rust 在其上深加工（Go 算不了的重模型解析等）」时主动调用。**禁止**在 `scanEntriesWithRust` 内以隐式快路径形式回读 `scanCache` 调用它（既不可达，又曾因递归 `ScanEntriesWithHit` 触发 single-flight 死锁隐患）。触发前提 = 未来做 Go/Rust 扫描分工（Go 轻扫探路 + Rust 深加工流水线）之日；在那之前它是休眠的 ABI 守门出口（测试 `TestScanManifest_ABI_MatchesJwalk` 已锁 P2/P3 契约）。详见 ADR-120 §3。
- `ComputeFileHash(path)` — SHA256
- `ScanEntriesLite(dir)` — 轻量遍历（2026-08-26，作者提取专用）：与 `ScanEntries` 同过滤口径（recycle/.github/禁用目录跳过、扩展名白名单、ysm.json 判定、`.ban` 恢复），但**不读文件信息（Size/ModTime/Hash 恒零值）、不读不写共享 scanCache**——无哈希条目入缓存会被同步系统当「哈希为空」静默跳过。实现为 `processScanDirEntry(wantMeta=false)`；测试 `scanner_lite_test.go`（过滤同口径 + 双向缓存隔离）。作者路径跳过逐文件 open+hash 后冷扫成本降为纯目录枚举
- `ListModelAuthors` / `ScanLocalAuthors` — 作者统计：均走 `ScanEntriesLite` 轻量遍历（原走全量扫描陪绑 SHA256，大库下拖慢创作者频道首屏）
- `GenerateRepoIndex(repoPath)` — 生成 `index.json`（GitHub Actions workflow 模板）

## 与其他子系统关系

- `go/fileops/`：`ToggleModelEnable` 只切换 `.ban` 文件名状态（包内不调用 InvalidatePath）；缓存失效由 `internal/app/app_files.go` 的 `App.ToggleModelEnable` 包装层在调用成功后执行 `scanner.InvalidatePath(filepath.Dir(path))`
- `go/sync/`：`computeHash` 直接委托 `scanner.ComputeFileHash`，并声明 >500MB 穿串、读错空串等口径与 scanner 一致；回收站过滤亦与 `ScanEntries` 对齐
- `internal/app/resource_bindings.go`：资源包启用/禁用切换成功后同样调 `scanner.InvalidatePath`，与 ToggleModelEnable 口径对齐防 30s 陈旧缓存
- `go/types/`：`ModelEntry` / `IsSupportedExt` / `IsYsmEntryJSON`
- `internal/app/app_scan.go`：薄壳转发（`AnalyzeBedrockModel` / `tagsStore` / `AddOpLog` 保留在薄壳）

## 不变量

- 扫描结果受 30s 缓存保护，直接改盘后需显式失效缓存
- `.json` 只允许 `ysm.json` 与 Go importer / 前端 `isImportableFile` 三处口径一致（ADR-038 D2 纵深防御）
- **目录级 `.ban` 整体跳过**（P2 修复：`fileops.ToggleModelEnable` 对文件夹模型整组禁用时把父目录改名 `modelA.ban`，ADR-038 D3.7——原实现只过滤文件级 `.ban`，目录级禁用模型会以活跃身份进入 sync 的 repoHash 被列为 Missing 或被 SyncToggleStatus 重新启用；源码按目录基名匹配 `strings.HasSuffix(strings.ToLower(d.Name()), ".ban")` 跳过）
- **`.github` 目录跳过**：与 CI `genindex.go` 的 `strings.Contains(p, "/.github")` 口径对齐（ADR-011），避免生成仓库索引时把 GitHub Actions .workflow 误入 index
- **R31 修复链（2026-08-31）**：
  - P2-1 WalkDir error 忽略：根 lstat 失败时 WalkDir 不调 callback 直接返回 error，旧实现忽略返回值导致 walkFailed 恒 false，空结果照常缓存 30s。修复：`if werr := WalkDir(...); werr != nil { walkFailed = true }`。
  - P2-2 InvalidatePath 祖先脏读：`InvalidatePath("/a/b")` 时 `/a` 的版本不会递增，父缓存 30s TTL 命中返回陈旧数据。修复：同时递增所有祖先 key 的版本 + 删除祖先缓存条目 + 恢复 descendant keyVersion 递增（code_review P1-1）。
  - P2-3 errorSink data race：裸变量 SetErrorSink 无锁写、emitScanError 无锁读。修复：改 RWMutex 保护（code_review 修正：atomic.Pointer 泛型语法在测试中有类型匹配问题）。
  - code_review P1-2 Windows 盘符根路径无限循环：ancestor walk 在 `C:\` 上 filepath.Dir 不变，旧循环无 `parent==prev` 守卫会无限循环。修复：加 prev 守卫 + `parent==Separator` 提前 break。

## 相关

- ADR-003（逻辑下沉）、ADR-038（ysm.json 白名单统一 D2）
