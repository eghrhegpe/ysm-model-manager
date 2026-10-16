---
kind: go-scanner
name: 扫描核心 go/scanner
tier: architecture
category: go
source_files:
  - go/scanner/
auto_fields:
  symbols_with_lines:
    - ComputeFileHash
    - EffectiveCacheTTL
    - ExtractAuthor
    - GenerateRepoIndex
    - HashIndex
    - HashIndex.Lookup
    - HashIndex.Prune
    - HashIndex.Record
    - HashIndex.Save
    - HashIndexFor
    - HashIndexPath
    - HashIndexStatsSnapshot
    - InvalidateBrowseCache
    - InvalidateBrowsePath
    - InvalidateCache
    - InvalidatePath
    - ListModelAuthors
    - OnCacheInvalidated
    - OpenHashIndex
    - ResetHashIndexStats
    - ResetScanEngineStats
    - ScanBackend
    - ScanEngineStat
    - ScanEngineStats
    - ScanEntries
    - ScanEntriesBrowse
    - ScanEntriesBrowseCtx
    - ScanEntriesBrowseWithHit
    - ScanEntriesBrowseWithHitCtx
    - ScanEntriesCtx
    - ScanEntriesLite
    - ScanEntriesLiteCtx
    - ScanEntriesWithHit
    - ScanEntriesWithHitCtx
    - ScanLocalAuthors
    - SetErrorSink
use_when:
  - 扫描
  - 文件树
  - 哈希
  - 缓存
  - 作者提取
  - ScanEntries
  - ScanEntriesCtx 取消扫描
  - 索引生成
perf:
  - io-bound
  - concurrent
invariant_anchors:
  - go/scanner/scanner_scan.go|fsutil.IsRecycleDir
  - go/scanner/scanner_scan.go|IsYsmEntryJSON
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 扫描模型、ScanModelEntries
  - 资源类型识别、rtype 判定
  - 仓库审计、健康分
quick_risk_lines:
  - 容器指纹缓存失效需调 ClearScanCache
  - resource_types.json 是唯一事实来源
pitfalls:
  - 容器指纹缓存失效需调 ClearScanCache——文件变更后不失效会导致缓存命中旧数据
  - resource_types.json 是唯一事实来源——修改类型定义后必须重新扫描
  - ScanEntries 排除 .recycle 目录——换用不排 .recycle 的 scanFn 会重新引入误判
  - ScanEntries 排除 `.relink-bak-*` 备份尸体子树（ADR-342 D6，谓词单点在 `go/fsutil`）——否则尸体内模型（哈希恒等于仓库原件）以活跃条目进 ModelEntry，仓库树/搜索/作者提取出现幻影模型
  - ScanEntriesWithHit 缓存 30s TTL——频繁扫描会反复重算
  - 作者提取依赖模型文件中的 metadata.authors 字段——缺失则作者为空
  - 单文件 >500MB 跳过哈希计算——同步对空哈希跳过匹配
  - Go 单引擎扫描口径须自洽——Rust 后端已删除（2026-10-06），不再有跨引擎对照
status: active
---

# 扫描核心 go/scanner

## 概览

`go/scanner/` 包实现仓库文件扫描、哈希计算、缓存失效、作者提取、索引生成（ADR-003 P2 下沉，薄壳 `internal/app/app_scan.go` 仅保留依赖 App 的方法）。

## 核心职责

- `ScanEntries` 递归扫描目录产出 `ModelEntry[]`（支持 `.ban` 后缀还原扩展名）
- **并行遍历引擎（2026-10-06）**：`walkDirParallel`（`go/scanner/walk_parallel.go`）替代 `filepath.WalkDir`——目录工作队列 + NumCPU worker 池并行展开 readdir，回调契约对标 `filepath.WalkDir`（`fs.SkipDir` 跳子树 / `fs.SkipAll` 中止 / ReadDir 失败二次回调）。条目序非确定，扫描后按路径 `sort.SliceStable` 恢复字典序。实测 1.97-3x（walkbench），深窄树（纯目录链无宽度）负收益 0.54x；生产模型库形态均为宽树，正收益。`processScanDirEntry` 回调并行执行，`entries` append 加 `sync.Mutex`、`walkFailed` 用 `atomic.Bool`。**三函数结构是 gocyclo 门槛逼出来的（勿合并回单函数）**：`startParallelWalk`（根目录 Lstat+首次回调）/ `workerLoop`（取队列主循环）/ `handleDirItem`（单目录项 ReadDir+回调+入队）各担分支密集段，`walkDirParallel` 只做编排——单函数塞下全部分支会破 `.golangci.yml` 的 `gocyclo.min-complexity` 20（2026-10-06 实测单函数 25，拆分后 golangci-lint 增量零检出；纯结构拆分，行为契约与 `walk_parallel_test.go` 的 WalkDir 等价断言不变）
- **MMD 子目录分组（ADR-096 P1）**：扫描 MMD group 根时，`scanner.go` 通过 `filepath.Rel` + `strings.Split` 提取第一段路径，命中 `types.IsMMDSubDir` 时填充 `ModelEntry.SubDir`（如 `SceneModel`/`CustomAnim`）；非 MMD 类型 / 根下文件恒为 `""`（`omitempty` 不序列化）
- `.json` 白名单：仅 `ysm.json` 作为模型条目（ADR-038 D2，几何/动画/语言 json 不单独扫描）
- 30s 扫描缓存（**非永久**）+ 路径级失效：`scanCache` 为 `sync.Map`（`string → scanCacheEntry{entries []ModelEntry, expiresAt time.Time}`），记录扫描条目与过期时刻；TTL 默认 30s（可由 `AppConfig.ScanCacheTTLMs` 覆盖，仍是短 TTL），且**纯进程内存——App 重启即全失，不存在「确定仓库永久缓存」**。`keyVersions` 为另一份 `sync.Map`（`string → *atomic.Uint64`），用 `(*atomic.Uint64).Add(1)` 原子递增 per-key 版本戳，防并发 `InvalidatePath` 竞态——P1 修复；单全局 `cacheGen atomic.Uint64` 仅作全量失效的代际短路标记
- SHA256 哈希（同步系统文件匹配用；B1 起经持久哈希索引快路径，见下）
- **持久哈希索引（ADR-348 B1 两阶段扫描投影·身份投影，`hashindex.go`）**：全量扫描哈希段（`hashEntriesParallel` 带 `rootDir` 参）先查 `<root>/.ysm-hash-index.json`（`path → {size, mtime, hash}`，`fsutil.WriteFileAtomic` 原子写、损坏自愈重写）——`(Size, ModTime)` 双指纹命中 → 存哈希免读盘（`hashIndexHits`），未命中真算 SHA256 并回写（`hashComputations`）；收尾按本次路径集 `Prune`（move/delete 自愈）+ dirty 门控 `Save`（稳态近零写）。开关 = `AppConfig.HashIndexDisabled`（`config.Get()` 活读，同 `ScanCacheTTLMs` 先例；**不落配置 JSON 面**——非用户可配开关，零值缺省启用，`SaveAppConfig` 以旧为基自动保全）。对手面：外部保 size+mtime 改内容 → 陈旧哈希滞留至指纹变化（geoCache 同类边界，已裁定接受）。回归锁 `scanner_hashindex_test.go`（三段故事 + 禁用态全真算）+ `hashindex_test.go`（指纹/剪枝/坏表/dirty 门控）；观测 `HashIndexStatsSnapshot`（benchmark/CLI「免哈希率」）
- **浏览投影（止血 2026-10-15 P0-1，`scanner_browse.go`）**：`ScanEntriesBrowse*` 与 `ScanEntries` 同一套过滤口径，但**不计算 SHA256**（Hash 恒空）——哈希只被同步系统的文件内容匹配消费，仓库树（app-tree loader、预览候选）从不读 Hash，原「每次冷加载全库逐文件读全量字节」是纯税。独立 `browseCache`（同 30s TTL、共享 `cacheGen`/`keyVersions` 代际守卫）+ 独立 `inFlightBrowse` 航班表——**无哈希条目不得进 `scanCache`**（同步系统把「哈希为空」当静默跳过匹配），反向在途合并（浏览 owner 的航班被全量 waiter 取走写回 scanCache）不被代际守卫拦截，故浏览器隔离。`InvalidateCache`/`InvalidatePath` 双缓存同时失效（配对闸口径）。app 层 seam = `internal/app/app_scan.go|ScanModelEntriesForBrowse`（薄壳 + 与 Filtered 共享 `finalizeScanEntries` 过滤单点）。**消费方清单（锐评 2026-10-16 扩面）**：仓库树 loader、预览候选、批量重命名对话框之外，`SearchModels`（`app_scan.go`，搜索只消费 Name/Path/几何/hasError——`SearchResult` 无 Hash 字段）与头像链 `BatchExtractCreatorAvatars`/`DebugExtractCreatorAvatar`（`app_avatar.go`）、CLI `scan`/`verify` 与 flow 扫描相位均已切无哈希入口（冷路径免全库 SHA256 税）。真实哈希消费者（watcher 同步链、benchmark B1 被测对象、runList 输出契约）保留带哈希入口。回归锁 = `tests/test_hash_entry_consumers.ts`（派生 fail-closed 闸：带哈希 seam 的每个调用/旁挂位点归 ① 消费 `.Hash` ② seam 定义 ③ LEDGER 精确豁免 三归宿，新位点必归类，豁免条目僵尸反查自动核对命中数）
- 作者提取（`[作者]` 前缀统计，判定单点 `ExtractAuthor`——锐评 2026-10-16 起 app 层不再手抄）、本地作者扫描、`index.json` 生成

## 白名单口径（ADR-038 D2）

| 扩展名 | 扫描行为 |
|--------|---------|
| `.ysm` / `.zip` / `.7z` / `.nbt` / `.schematic` / `.litematic` | ✅ 扫描 + 哈希 |
| `.json` | `ShouldHashExt` 纳入哈希清单，但 `scanner.go` 按 baseName 过滤（`types.IsYsmEntryJSON`），仅 `ysm.json` 实际参与扫描（ADR-038 D2） |
| `.ban` / `.disabled` 后缀 | 还原原始扩展名后按上述判断 |

> **注意**：CI workflow 模板（`generateIndexWorkflow`）的 `paths:` 触发条件仅列 `**.ysm` / `**.zip` / `**.7z`，与扫描侧 `.json` 白名单口径分工不同——扫描负责全量发现，CI 只感知 YSM/压缩包变更。
> `ensureRepoWorkflow` 用 `fsutil.WriteFileAtomic` 原子写 workflow（ADR-109 §4），不裸 `os.WriteFile`——防止中途崩溃留残缺文件被上方 `os.Stat` 误判为「已存在」而永久静默失效；已存在则不覆盖，保留用户自定义 workflow。⚠️ **该「不覆盖」语义决定修复生效边界**：存量仓库里若已有 `generate-index.yml`，模板修好了也不会自动落到该仓库——需用户手动删掉该文件才会重新生成（2026-10-15 修复批的实际边界，写文档/答疑时勿承诺「升级即生效」）。
>
> **CI 内嵌 genindex.go 与应用内 `ScanEntries` 的同步口径（锐评 2026-10-15 修复批）**：模板是独立 `package main`（跑在 GitHub Actions，无法 import 本包），故两侧口径**靠测试对账**而非靠共享代码，改任一侧都要跑 `workflow_test.go|TestGenerateIndexWorkflow_MatchesScanEntries`（真 `go run` 模板脚本，与 `buildRepoIndexEntries(ScanEntries())` 逐条对账）。该批修掉的四个封锁点：① heredoc 里 import 单行并列（`"crypto/sha256" "encoding/json" …`）是**语法错误** → CI 该步骤自 `f7609e70a` 起恒失败、index.json 从不由 CI 产出；② ysm.json 白名单基准误用 `restored`（普通 ysm.json 无禁用后缀时为空串 → `filepath.Base("") == "."`）→ **全部普通 ysm.json 组条目被丢**；③ `.json` 被扩展名否定链二次拦截（`buildGenerateIndexWorkflow` 生成否定链时**刻意跳过 `.json`**，故模板侧必须写成 `ext != ".json" && …` 才不误杀）——只修 ② 不修 ③ 照样全丢；④ 目录级跳过补 `.recycle` / `.relink-bak-<ts>` / 目录级 `.disabled|.ban` / `.github` 四项与 `ScanEntries` 对齐（否则回收站副本与 relink 尸体被当活跃条目收进索引）。另：`entry.Name` 必须与 `buildRepoIndexEntries` 同口径（ysm.json 组条目取**父目录名**而非 `"ysm.json"`），否则用户本地生成→CI 重生成会来回互改同一文件。

## 对外 API / 入口

- `ScanEntries(dir)` — 单返回值薄壳：内部 `ScanEntriesWithHit(dir)` 丢弃 `bool` 后返回条目
- `ScanEntriesWithHit(dir)` — 扫描核心（缓存 30s，`.recycle` 跳过），返回 `(entries []ModelEntry, hit bool)`，调用方据此决定是否记录扫描日志，避免 30s 内重复访问同一目录时刷屏操作日志面板
- **ctx 变体（ADR-197，2026-09-06）**：`ScanEntriesCtx` / `ScanEntriesWithHitCtx` / `ScanEntriesLiteCtx` 带 context 取消——walk 回调内 ctx.Done 即 `fs.SkipAll`；取消产生的部分结果**只返回不写入缓存**（防 30s TTL 污染）。旧签名委托 `context.Background()`。CLI/watcher 后续按需接入
- **在途合并（single-flight，2026-08-21）**：缓存「扫完才 Store」，同目录并发请求在途重叠时会双双真扫（点击整合包时前端多组件并发要状态 → 操作日志同秒重复条目）。`inFlight`（`sync.Map: dir → *scanFlight`）让首个调用方注册航班走盘，后续调用方 `wg.Wait()` 并入航班取**克隆**结果且返回 `hit=true`（薄壳不重复记日志）；唯一 owner 返回 `hit=false`。`walkCount`/`flightJoins` 为诊断计数。测试 `scanner_singleflight_test.go`（walkStartHook 制造确定性重叠；文件头仍挂 `//go:build !rust_backend` 是 Rust 后端删除前遗留的死 tag，`rust_backend` 已不再构成构建变体——tag 本身无害但已失语义，留待后续清理）
- `InvalidateCache()` / `InvalidatePath(dir)` — 缓存失效（导入/启用禁用后调用）。两者都**双缓存**（`scanCache` + 浏览投影 `browseCache`）同时失效——新增第三类扫描缓存时必须补配对（写面派生闸口径）
  - **`InvalidatePath` 祖先链覆盖（长治久安核心）**：`go/scanner/scanner.go|InvalidatePath` 不只删 `dir` 自身，还遍历 `keyVersions` / `scanCache` 删所有**互前缀** key——含 `strings.HasPrefix(key, kstr+sep)`（失效 dir 是 kstr 的后代时，递增 kstr 版本并删 kstr 条目）。即「禁用 `globalDir/ModelA` → `InvalidatePath(filepath.Dir(ModelA))` = `InvalidatePath(globalDir)`（文件级）或 `InvalidatePath(base)`（目录级 ModelA 文件夹）→ 仍经祖先链命中并失效 `globalDir` 仓库根缓存」。所以 sync 层消费的 `scanCache[globalDir]` 在 Toggle 后立即失效，**无 30s 陈旧窗口**。`BuildSyncItems` 入口无需额外失效（冗余）。
  - **兄弟目录不再被误核平（止血 2026-10-15 P0/A2）**：原删除臂按「ancestors 全体的后代」匹配（`HasPrefix(kstr, anc+sep)`，anc 遍历 key 的祖先链）——`InvalidatePath(base/ysm)` 会把 `base/mmd-shader` 乃至**同盘符全部**缓存 key 删光（与「互前缀」注释意图漂移，既有的 UnrelatedKeyUntouched 测试因「重扫恰好同数」假绿未察觉）。修复：删除判据收敛单点 `scanner.go|isInvalidationRelated(key, kstr)`（`kstr == key` / kstr 是 key 的严格子孙 / kstr 是 key 的严格祖先；**兄弟目录不失效**），`browseCache` 删除同源。判别回归锁：`scanner_test.go|TestInvalidatePath_UnrelatedKeyUntouched`（加 hit 断言防假绿）+ `app_scan_browse_test.go|TestInvalidateScanPath_Targeted`。
  - ⚠️ **复核（2026-08-24 审核 P1）**：此前疑「ToggleModelEnable 仅失效模型夹层级、不覆盖仓库根祖先 key、存在 30s 窗口」——经核实为误判。`InvalidatePath` 的 keyVersion 祖先链（`go/scanner/scanner.go|InvalidatePath` 的第二个 `HasPrefix` 条件）已覆盖仓库根；目录级禁用 `path=globalDir/ModelA` 时 `filepath.Dir` = `base`，`InvalidatePath(base)` 仍经 `HasPrefix(key, kstr+sep)` 命中 `globalDir`。实测目录级禁用后 `BuildSyncItems` 结果已从 `.ban` 路径重扫，不残留旧条目。P1 不成立，不引入额外失效代码。
- `OnCacheInvalidated(fn)` — 注册扫描缓存失效钩子；`InvalidateCache` / `InvalidatePath` 完成清理后同步调用。注册方自行保证幂等：`go/instance` / `go/sync` 各导出 `RegisterInvalidationHook()`（内部 `sync.Once`），由 app 层 ServiceStartup 显式调用（2026-08-26 起不再隐式 `init()` 注册，导入无跨包副作用）。
- `EffectiveCacheTTL()` — 当前生效的扫描缓存 TTL（`AppConfig.ScanCacheTTLMs` 覆盖否则默认 30s）；**派生缓存刷新周期单一事实源**——instance/sync 写缓存过期时刻时取同一口径（写入时刻求值，勿包级初始化固化默认值）。
- **Rust 扫描后端已删除（2026-10-06，ADR-324）**：原 ADR-120 引入的 `scanEntriesWithRust`（`rustbridge.Scan` 转发）与 `rust_backend` 构建变体已整体移除——Go 并行遍历（`walkDirParallel`）实测追平并反超 Rust 19% 后决策删除，`go/rustbridge/` 目录与 `rust_backend*.go` 文件均已不在。扫描现在只有 Go walk 一个后端；此前的「Rust 快路径 / 缓存互斥 / 死代码清除」讨论全部成为历史注记，不再适用。
- **引擎归属记账（`scan_engine.go`，2026-10-06 精简）**：原为 Go/Rust 双引擎对照（ADR-262 D3）而设；Rust 扫描后端删除后只剩 Go walk 一个引擎，`ScanEngineStats()` 现只返回 `{GoWalk}`（`walkCount` 复用既有诊断计数），调用方取**前后差**判断「这一次扫描是否真的走了引擎」（区分「扫过」与「30s 缓存命中」——后者不算测量）。不做成返回值：`ScanEntries*` 有十几个调用方，为观测改签名是反向收益；计数器 + 前后差同样精确且零调用方改动。消费方 = `go/cli/scan_bench.go`（`scan-bench` 命令，已改为 Go-only 扫描基准）。
- `ComputeFileHash(path)` — SHA256
- `ScanEntriesLite(dir)` — 轻量遍历（2026-08-26，作者提取专用）：与 `ScanEntries` 同过滤口径（recycle/.github/禁用目录跳过、扩展名白名单、ysm.json 判定、`.ban` 恢复），但**不读文件信息（Size/ModTime/Hash 恒零值）、不读不写共享 scanCache**——无哈希条目入缓存会被同步系统当「哈希为空」静默跳过。实现为 `processScanDirEntry(wantMeta=false)`；测试 `scanner_lite_test.go`（过滤同口径 + 双向缓存隔离）。作者路径跳过逐文件 open+hash 后冷扫成本降为纯目录枚举
- `ListModelAuthors` / `ScanLocalAuthors` — 作者统计：均走 `ScanEntriesLite` 轻量遍历（原走全量扫描陪绑 SHA256，大库下拖慢创作者频道首屏）。`ScanLocalAuthors` **返回 `types.LocalAuthor`（Name + RTypes），与 `WorkshopCreator` 刻意分开**——后者 `Type` 是站点 id，这里的是资源类型 rtype，两套词表零交集（ADR-337；复用 WorkshopCreator 曾致 rtype 被并入创作者站段）。其 `mergeOrAppendLocalAuthor` 用 `nameIndex map[string]int` 做 O(1) 同名 author 定位（2026-09-14 落地：原线性扫描导致大库首屏作者提取 O(作者数×文件数) 二次放大，加索引后纯行为保持重构）
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
- **`.github` 目录跳过（目录级单口径）**：Go 侧 `scanner_scan.go|processScanDirEntry` 按 `d.Name() == ".github"` → `SkipDir`；CI 内嵌脚本同用**目录级** `SkipDir`（2026-10-15 删除了原先的文件级「`path` 含 `/.github`」判定——目录级已让该子树根本不被访问，文件级那条是不可达死代码，同口径留两处反而会漂移；守护由 `workflow_test.go` 的目录级整行判据承担）。目的：避免 `.github` 内合法扩展名进入 index（ADR-011）。
- **`.relink-bak-*` 备份尸体子树跳过（ADR-342 D6，2026-10-14）**：`processScanDirEntry` 的目录分支在 recycle 之后追加 `fsutil.IsRelinkBackupPath(p)` → `SkipDir`（`ScanEntries` 与 `ScanEntriesLite` 共用本函数，一处修两处生效）。背景：失败 relink 留下的 `<夹名>.relink-bak-<ts>` 内模型哈希恒等于仓库原件，原实现让其作为活跃条目进 `ModelEntry` → 仓库树/搜索/作者提取显示**幻影模型**；谓词原先只在 `go/sync` 包内，现已下沉 `go/fsutil` 单点。回归测试 `scanner_corpse_test.go`（走盘 + 轻量两路）
- **R31 修复链（2026-08-31）**：
  - P2-1 WalkDir error 忽略：根 lstat 失败时 WalkDir 不调 callback 直接返回 error，旧实现忽略返回值导致 walkFailed 恒 false，空结果照常缓存 30s。修复：`if werr := WalkDir(...); werr != nil { walkFailed = true }`。
  - P2-2 InvalidatePath 祖先脏读：`InvalidatePath("/a/b")` 时 `/a` 的版本不会递增，父缓存 30s TTL 命中返回陈旧数据。修复：同时递增所有祖先 key 的版本 + 删除祖先缓存条目 + 恢复 descendant keyVersion 递增（code_review P1-1）。
  - P2-3 errorSink data race：裸变量 SetErrorSink 无锁写、emitScanError 无锁读。修复：改 RWMutex 保护（code_review 修正：atomic.Pointer 泛型语法在测试中有类型匹配问题）。
  - code_review P1-2 Windows 盘符根路径无限循环：ancestor walk 在 `C:\` 上 filepath.Dir 不变，旧循环无 `parent==prev` 守卫会无限循环。修复：加 prev 守卫 + `parent==Separator` 提前 break。
- **ADR-176 决策与落地（2026-09-04）**：
  - **维持进程单例（决策）**：`scanCache/cacheGen/keyVersions/inFlight` 是进程固有唯一态，**不做 struct 化**；`InstallLock` 为跨 installer/sync/conflict/app 的串行契约，保持。理由：struct 化只换句柄、单例语义不变，样板与跨调用破裂风险不成比例。
  - **测试注入收敛（实施）**：`SetWalkStartHook`/`SetRustScanHook` 降为**未导出** `setWalkStartHook`/`setRustScanHook`（仅同包测试 seam），生产/绑定 API 不再暴露可写函数指针。`dedup.computeHash` / `fileops.renameForMove` 仍为包级注入——与「维持单例」决策一致，不强改字段注入。
  - **构建门禁（实施）**：Go 验证改 `go build ./...`（覆盖仓库根 `internal/app` 绑定入口与根 `cli.go`，`./go/...` 会漏主体）。
- **hashEntriesParallel 逐条目 panic 守卫（2026-10-14 锐评 P2，对齐去重侧 R27 修复链）**：单条哈希 panic 不打死 worker（jobs 缓冲后续 job 仍被处理）；该条 Hash 留空走「空哈希跳过匹配」同口径，panic 经 `emitScanError` 进日志面板留痕（裸 panic 栈只进 stderr、GUI 下不可见），措辞与「读错误/超限」区分归因。`hashFn` 为包级注入点（默认 `ComputeFileHash`，`hashFnMu` RWMutex 保护：生产侧 `getHashFn` 按批快照、测试侧 `setHashFn` 互换——scanner 包有 `t.Parallel` 测试走哈希路径，裸互换会 race；与 `walkStartHookFn` 的 `hookMu` 同款范式）。删改须同步 `scanner_hash_panic_test.go`。

## 相关

- ADR-003（逻辑下沉）、ADR-038（ysm.json 白名单统一 D2）、ADR-176（维持单例与测试注入收敛）
