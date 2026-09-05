---
kind: go_design_critique
name: Go 后端设计锐评
tier: architecture
category: go
status: snapshot
affected: false            # 锐评快照卡：结论指向具体文件，source_files 只服务存在性校验，不随单次文件变更提示复核
source_files:
  - go/importer/detect_tail.go
  - go/scanner/scanner.go
  - go/fsutil/write.go
  - go/recycle/recycle.go
  - go/avatar/avatar_decode.go
  - internal/app/wasm_decoder.go
  - internal/app/app_download.go
  - go/instance/instance.go
  - go/litematic/nbt.go
  - go/litematic/voxel.go
  - go/ysm/extracted.go
  - go/geometry/archive.go
  - go/fsutil/crossdevice_windows.go
  - go/executil/hidewindow_other.go
auto_fields:
  symbols_with_lines:
    - App.CancelQueue
    - App.DownloadFromGitHub
    - App.EnqueueDownloads
    - App.QueueStatus
    - BuildNbtVoxelData
    - BuildNbtVoxelDataFromRoot
    - BuildSchematicVoxelData
    - BuildSchematicVoxelDataFromRoot
    - BuildSyncItems
    - BuildVoxelData
    - BuildVoxelDataFromRoot
    - ComputeFileHash
    - DecodeYSMData
    - DetectContainerTypeFromBase64Tail
    - EffectiveCacheTTL
    - ErrChmodFailed
    - ErrCloseFailed
    - ErrRenameFailed
    - ErrSyncFailed
    - ErrTempCreateFailed
    - ErrWriteFailed
    - ExtractFirstPNGFrom7z
    - ExtractFirstPNGFromZip
    - FindComponentsInExtractedYSM
    - FindGeometryInExtractedYSM
    - FS
    - GenerateRepoIndex
    - HideWindow
    - InvalidateCache
    - InvalidatePath
    - InvalidateSyncItemsCache
    - IsArmModelName
    - IsCrossDeviceErr
    - IsMainModelName
    - ListModelAuthors
    - Move
    - MoveResult
    - New
    - OnCacheInvalidated
    - OpenGzRootFromBytes
    - ParseComponentsFrom7z
    - ParseComponentsFromZip
    - ParseFrom7z
    - ParseFrom7zEntry
    - ParseFromZip
    - ParseFromZipEntry
    - ReadLimitedEntry
    - RegisterInvalidationHook
    - ScanEntries
    - ScanEntriesLite
    - ScanEntriesWithHit
    - ScanLocalAuthors
    - SetErrorSink
    - SetNodeJS
    - SHA256File
    - TrashManager
    - TrashManager.Delete
    - TrashManager.Empty
    - TrashManager.List
    - TrashManager.Move
    - TrashManager.MoveEx
    - TrashManager.RecycleDir
    - TrashManager.Restore
    - Write
    - WriteFileAtomic
use_when:
  - Go 后端评审
  - Go 锐评
  - Go 可读性审查
  - Go 命名审查
  - Wails 绑定审查
  - 隐式协议审查
pitfalls:
  - 隐式协议（epoch 代际 / *Locked 变体 / \x00 缓存键 / 三态 bool 返回）靠注释续命，编译器零保护——新增字段/分支时静默爆炸
  - 同一 Node+WASM 解码桥在 go/avatar 与 internal/app 各有一份逐字复刻，跨包「无法共享」是伪理由——internal/app 本就 import go/avatar
  - 注册表循环内 compSize 推进只看 local header，大压缩条目后的条目不在扫描范围（DetectZipType 设计取舍，勿误以为遍历完整）
  - Deprecated Wails 绑定保留只为兼容旧绑定面，前端 0 消费但每次 generate:bindings 重新生成到 TS 声明，误调风险 + 绑定面膨胀
  - 警惕把「校验和不重试、截断可重试」这类有意的语义不对称「规范化」成对称——会消耗 GitHub API 配额
quick_groups:
  - Go 后端评审与重构
  - 可读性与命名治理
  - Wails 绑定治理
  - 隐式协议显式化
quick_intents:
  - Go 后端设计评审 / 锐评
  - 找出难懂的 Go 函数
  - Wails 绑定瘦身 / 清理 Deprecated 绑定
  - 隐式协议显式化
quick_risk_lines:
  - 能显式化的不要靠注释说明，能拆分的不要堆在一个函数里（probeNbtDepth 四层闭包 / resolveBedrockGeometryFallback 四层策略 / buildSubModels 7 参数）
  - 命名要向行为诚实：DetectZipType 实际处理 7z 应叫 DetectContainerType；叫 fallback 的实际是 4 层策略链
  - 全仓 6 处手写 LimitReader+1 探测应统一收编 fsutil.ReadLimitedEntry，撤回 ADR-044 的例外说明
invariant_anchors:
  - go/importer/detect_tail.go|le16
  - go/litematic/nbt.go|probeNbtDepth
  - internal/app/app_download.go|downloadFileWithQueue
  - go/instance/instance.go|buildSyncItemsKey
---

# Go 后端设计锐评

## 概览

2026-09-03 三路子代理并发只读锐评（IO/扫描域 / 二进制解析域 / Wails 绑定与应用域），主模型对每份报告最强断言逐条实地抽查背书，**无幻觉指控**（3 处过激指控已被主模型仲裁修正，见「仲裁修正」）。安全防御层行业级（OOM/栈溢出/路径逃逸/TOCTOU 四重防线全部到位），可读性债务集中在「隐式协议靠注释续命」。

加权总分 **≈3.1/5**：IO/扫描 3.4 / 解析 3.2 / 应用·绑定 2.8。一句话：注释是技术债说明书——代码不自解释，全靠 20~50 行注释解释「为什么这么做」。

## 三路评分

| 视角 | 分 | 主炮 |
|------|----|------|
| IO/扫描/路径/探测 | 3.4 | DetectZipTypeFromBase64Tail 三态返回 + 无出处魔法数、joinInFlightWaiter 三态 bool、ReadLimitedEntry 吞 IO 错误、recycle 手写穿越检查（3 处事实源） |
| 二进制解析/渲染/缓存 | 3.2 | probeNbtDepth 四层闭包嵌套、resolveBedrockGeometryFallback 四层策略堆一个函数、buildSubModels 7 参数 3 map + 隐式时序、voxel.go:591 `y=int(int64(i-1)/wl64)` X→Z→Y 反推无解释 |
| Wails 绑定/应用层 | 2.8 | processForEpoch 隐式 epoch 协议（3 处递增）、24 处 Deprecated 绑定滞留、*Locked 变体文档约束无运行时断言、buildSyncItemsKey 手写 \x00 键、SyncModelToggleStatus vs ToggleModelEnable 双轨命名 |

## 实证锚点（主模型抽查背书，2026-09-03）

| 指控 | 验证结果 |
|------|----------|
| avatar_decode.go 与 wasm_decoder.go 逐字复刻双胞胎（limitedBuffer×2 / updateMemoryViews 补丁×2 / base64 三明治脚本×2 / FILES_JSON 协议×2 / 200MB·8MB 上限×2 / []int→toBytes×2） | ✅ 铁证（逐行对比）；且 internal/app 本就 import go/avatar + SetNodeJS 注入，「跨包无法共享故本地复制」是伪理由 |
| processForEpoch 的 q.epoch++ 在 3 处递增（app_download.go:65/81/137），defer 比对代际 | ✅ 属实；隐式协议编译器零保护 |
| joinInFlightWaiter 三态 bool (entries, ok, retryNow)（scanner.go:379） | ✅ 属实 |
| ReadLimitedEntry 吞 IO 错误返回 nil（write.go:60-79） | ✅ 属实（有日志留痕，但调用方无法区分超限/EOF/IO 故障） |
| buildSyncItemsKey 手写 \x00 分隔缓存键 + 自嘲式注释「加字段必须同步改 key」（instance.go:64-92） | ✅ 属实 |
| probeNbtDepth 四层闭包嵌套（read/charge/skipName/walkPayload）+ 整数溢出守卫（nbt.go:65+） | ✅ 属实；安全防线核心但可读性极差 |
| DetectZipType 用 compSize 推进（importer_file.go:172-173） | ✅ 属实但降级：只影响条目名收集不涉解压正确性，分类够用 |
| Deprecated Wails 绑定 | ⚠️ 修正：实测 24 处注释标记（子代理报 28），结论方向一致 |
| detect_tail.go / crossdevice_windows.go「魔法常数无一注释」 | ❌ 驳回：4 常量与 errno 17 均有注释说明是什么，只是没写规范出处/为什么是这数 |

## 共识问题榜（三路交集 = 高置信，按毒性排序）

1. **隐式协议靠注释续命**（🔴 最毒）：epoch 代际 / *Locked 变体（~10 个，ResolveConflictsLocked 注释自认「死锁只能运行时发现」）/ \x00 拼接缓存键 / build() 双 map 隐式耦合——全部无编译器/linter 保护，新增一处递增或漏加字段即静默爆炸。
2. **命名不诚实**：DetectZipType 实际还处理 7z（应叫 DetectContainerType）；resolveBedrockGeometryFallback 是 4 层策略链且第一层是直解；SyncModelToggleStatus vs ToggleModelEnable（目录级 vs 文件级零复用）；uniqueDest（拼写即错 + 注释写「索引 6.8b」）。
3. **魔法数字无出处**：0x02014b50/0x06054b50、errno 17、800ms debounce、30s backoff、maxFallbackGeoProbes=20、maxScanZipEntries=2000、500MB、10 跳——有「是什么」注释没有「为什么是这数」；voxel.go:591 X→Z→Y 存储序反推全仓无人解释。
4. **跨域双胞胎复制**：Node+WASM 解码桥两份 200 行逐字复刻，注释互指「与对方同款」；另有全仓 6 处手写 LimitReader+1 绕过已收敛的 fsutil.ReadLimitedEntry。
5. **字节身世曲折**：解码桥输出走 FILES_JSON 文本标记 + JSON 数组，Go 侧 []int 接字节再 toBytes 转回——Data []int 对「读文件内容」的函数是反直觉签名，base64×2 + 文本序列化，200MB 上限对应的峰值内存是真实数据数倍。

## 仲裁修正（主模型对子代理报告的裁定）

1. 「detect_tail.go 魔法常量无一注释」驳回：4 个常量都有注释说明是 PK\x01\x02 等，缺的是规范出处（ZIP spec 节号），不是缺注释。
2. 「errno 17 无注释」驳回：crossdevice_windows.go:10-11 有注释说明是 ERROR_NOT_SAME_DEVICE，可优化点仅是引用 x/sys/windows 常量而非字面值。
3. Deprecated 绑定数量修正：24 处注释（不是 28）。

## 亮点（锐评也公允）

- ⭐ `paths.IsInside`（go/paths/safe.go）：逐层守卫链各层注释「为什么这层必要」，errors.Is 可分类——Go 错误处理典范
- ⭐ `extractBits`（go/litematic/nbt.go:340）：位操作封装干净、小端位序注释、越界守卫前置 panic 不复活
- ⭐ `Downloader.retryDownload` sentinel error 分类：截断可重试/校验和不重试的语义不对称有文档，防未来被「规范化」
- ⭐ `Logger.save` 双层锁（saveMu 串行 IO + mu 护内存）职责分离正确
- ⭐ `maybePrune` 限频：阈值锁内快照、IO 锁外执行无 TOCTOU，删除失败记账失真也有测试

## 不变量（锐评快照结论，非既有红线）

- 能显式化的不靠注释说明，能拆分的不要堆在一个函数里。
- 命名向行为诚实：函数名必须覆盖其全部职责范围。
- 同一协议只保留一份实现；跨包复用直接 import，不做本地复制 + 注释互指。
- 裸 `LimitReader(rc, limit)` 读取一律走 `+1` 探测显式判超限（fsutil.ReadLimitedEntry 或同款手写）；需区分「超限」与「读错误」的调用方保留精化语义，不得为收编降级。

## 动刀进度（实施记录，2026-09-03 起）

- ✅ **刀① 合并 wasm_decoder/avatar_decode 双胞胎桥**（ADR-164）：`go/avatar` 新增统一实现 `DecodeYSMData`（[]byte 直通 + 剥 /output/ 前缀 + 200MB 输入护栏 + 60s 超时 + 200MB/8MB 输出护栏），旧名 `DecodeYSMFiles`（`[]int` 签名）已**彻底退役**（非薄封装保留），`internal/app` `runYSMNodeJSDecode` 删 166 行变薄封装——FILES_JSON 协议/limitedBuffer/glue 补丁全仓单例化，净 -93 行。`go build ./go/... ./...` + `go test ./go/avatar ./internal/app ./go/fileops ./go/ysm ./go/geometry ./go/importer ./go/scanner ./go/container` 全绿。
- ✅ **刀② joinInFlightWaiter 三态 bool → joinResult struct**：`go/scanner/scanner.go` 新增 `joinResult{entries, hit, retry}` 替代 `([]ModelEntry, bool, bool)` 返回，调用点改 `res.hit / res.retry`——语义与注释同步逐字转移，scanner 单测全绿（含 singleflight 并发测试）。
- ✅ **刀④b uniqueDest → generateConflictFreeDest**：`go/recycle/recycle.go` 纯改名（函数 + 6 处消费点 + 注释），零行为变化，recycle 测试全绿。
- ✅ **刀③ LimitReader+1 收编（修正原「6 处统一收编」断言）**：实地审计 22 处 LimitReader 后修正——`extractYsmRootFromZip`（ysm/summary.go:218 需区分超限/读错误两种文案）、`mcmeta.go`（metaTooLarge 标志区分）、`nbt.go:36`（错误上抛）、`avatar_zip.go:37/70`+`avatar_extract.go:482`（超限 vs 读错误日志区分）**语义均比 fsutil.ReadLimitedEntry 更细，强收编会退化错误处理，保留**；真正的高 ROI 点 = `internal/app/resourcepack_models.go:143/173` 两处裸 `LimitReader` **缺 +1 探测（ADR-033 陷阱残留：恰 64MB 条目静默截断继续用）且 nil 语义与 fsutil 兼容** → 收编 `fsutil.ReadLimitedEntry`，顺带修掉截断 bug。内部 app 测试全绿。**2026-09-03 复查补刀：`internal/app/container_entries.go` GetVoxelDataInContainer 同款裸 LimitReader+无 +1 探测漏网（初审 22 处清单未含）**——收编 `fsutil.ReadLimitedEntry`（超限/读错统一 nil → 显式报错「读取失败/超限」），补 `TestGetVoxelDataInContainer_OverLimit`（64MB+1 全零条目）；至此全仓裸 `io.LimitReader` 无 +1 探测残留清零（updater 对 HTTP body 的 LimitReader 属网络流限长语义，非 zip 条目，不在 ADR-033 范围）。
- ✅ **刀④c resolveBedrockGeometryFallback 拆 4 个具名策略**：`go/ysm/extracted.go` 主函数变 4 行链式调用（fallbackParseDirect / fallbackParseWrapped / fallbackWalkDir / fallbackParseBare），每层策略独立具名——逐字节保留原行为（含 WalkDir 10 层/排除目录/probes 封顶/texSlot=0 口径）。ysm + internal/app + geometry + threejs 测试全绿。
- ✅ **刀⑤ 绑定清理（发版批次落地）+ 刀④a DetectZipType → DetectContainerType**：删除 24 个 Deprecated 绑定（GetModelTexSizes/InstallModelWithOverlay/ImportModelFile{SkipCheck,Overwrite,To,OverwriteTo,ToMMD,OverwriteToMMD}/DeduplicateCustomDir/RelinkCustomDir/MoveToRecycleEx/ClearCustomDir/SavePreviewTempFile/SearchAllModels/GetGlobalCustomDir/ClearTextureCache/Export|ImportWorkshopSitesCSV/ReplaceWorkshopCreatorsFromJSON/SetVoxelMaxBlocks/ToggleResourcePack/IsResourcePackEnabled/SelectImportZip/GetWasmBinary）——替代入口逐一定位：回收站→MoveToRecycle、清理→ClearInstanceResources（逻辑下沉 go/recycle.RemoveRepoDuplicates 已有测试）、截图→SaveScreenshotFile、CSV→JSONFile/SaveWorkshopSites、导入→ImportModelFile/ImportFileAndPushToInstance、体素上限→配置默认值；5 个有 Go 测试消费的绑定（MoveToRecycleEx/ClearCustomDir/SavePreviewTempFile/Export|ImportWorkshopSitesCSV）测试随删除迁移/清理（MoveToRecycleEx 语义并入 MoveToRecycle、previewTemp 孤儿机制整体删除）；同步 e2e mock-data.ts 删 24 stale key、binding-check.ts 白名单清残留、`npm run generate:bindings` 重写绑定面（170 方法）。`DetectZipType→DetectContainerType`（含 importer.DetectContainerType/DetectContainerTypeFromBase64Tail + TS 平移 detectContainerType + web-fs 契约镜像）消除「ZIP 但处理 7z」命名误导，全仓无双轨。go build + go test ./go/... ./internal/app/... + binding-check（170:170 零 issues）+ 前端 typecheck/vite build/vitest 全绿。
- ➖ **processForEpoch epoch → 状态机枚举（暂缓，独立立项 ADR-181）**：并发核心 + 现有测试（Sequential/Error/Cancel/QueueStatus）**未覆盖 cancel-restart 竞态路径**、epoch 三处递增无专门并发测试兜底——按「先写测试再写实现」铁律，需先补竞态测试（withFakeNode 式注入 epoch 推进）再谈枚举化。**2026-09-05 二轮锐评确认：守卫注释已讲清协议（queue.go:113-158），代码可读性可接受；暂缓合并 ToggleModelEnable（桌面零消费，ADR-182 标记技术债）**。

## 动刀进度（实施记录，2026-09-05 二轮增量）

### 视角A：IO/扫描/路径/探测（低风险重构）
- ✅ **resolvedRootCache 组件化**（ADR-134 同构）：`internal/app/app_scan.go:422` 包级全局 `sync.Map` → `App.resolvedRootCache *resolvedRootCache` 字段（`app_resolved_root_cache.go` 新增），`saveConfig` 调 `c.Clear()`。`isPathInRootOrSelf` 改 `a.resolvedRoot(root)`。`app_audit_fix_test.go` 同步更新。零行为变化，全测全绿。
- ✅ **根列表收敛 `allScanRoots()`**：`isPathInRootOrSelf` ↔ `findMoveRoot` 两处逐字重复的 16 行根列表构造 → 1 行调用 `allScanRoots(a.LoadAppConfig())`。recycle/toggle 系列根列表语义不同（ysmRoot vs FilesRoot/McRoot），未强行统一。
- ✅ **isSupportedEntryFile 口径对齐**：`go/fileops/folder_import.go:127` 加 `types.StripDisableSuffix`，与 scanner.go:671 一致。`.ysm.disabled` 文件现在被识别为支持文件（bug 修复）。
- ⚠️ **Toggle 三轨命名**（视角C 核实）：`ToggleModelEnable`（YSM 单根，桌面零消费）/ `ToggleEnable`（多根，桌面唯一入口）/ `SyncModelToggleStatus`（批量同步，整合包专用）。已给 `ToggleModelEnable` 加 `// Deprecated` 注释过渡（ADR-182 标记技术债，本轮不动）。

### 视角B：二进制解析/渲染/缓存（中风险改动）
- ✅ **纹理扩展名口径统一**：新增 `go/types/texture.go` 双层事实源——`SupportedTextureExts()`（收集用，含 .tga）+ `RenderableTextureExts()`（渲染用，不含 .tga 因浏览器不认）+ `TextureMIME(ext)` 返回 MIME 或空串。`extracted.go`/`summary.go`/`avatar_extract.go` 四文件替换硬编码。`.jpeg` 纹理现在被 collectTextureFiles 收集；顺手修了 `avatar_extract.go` L194 隐性 bug（.jpeg 文件之前错标 `image/png`）。
- ✅ **ResourceTypeInfo 下沉 go/types**：删除 `go/instance.ResourceTypeInfo`（27 行），`BuildSyncItems` 入参改 `[]types.ResourceType`，`app_install_instance.go:520-533` 删除 13 行手动转换循环。净减 22 行。
- ⚠️ **知识卡 drift**：`go-avatar-decode.md` / `go-avatar.md` / `ysm-wasm.md` / `go_design_critique.md` 同步更新 `DecodeYSMFiles`→`DecodeYSMData`（ADR-164 后已彻底退役，非薄封装保留）。

### 视角C：Wails 绑定/应用层（高风险评估，不动代码）
- ✅ **install_domain_split ADR-179 P1 落地核实**：queue（processForEpoch）已迁 `internal/app/install/queue.go`，快照未记录此迁移。install 子包零 `*App` 反向指针，ConfigDeps 闭包注入。
- ➖ **SearchModels 8 参数封装**：前端真实消费仅 1 处（toolbar-search.ts:195），60+ 处改动面（含 40+ 测试）。标记技术债，补注释「参数固定 8 个，扩展走 types.SearchFilters struct」。
- ➖ **resolvedRootCache 范式分裂纠正**：已随视角A 组件化落地，ADR-134 清零结论恢复一致。

## 动刀进度（实施记录，2026-09-06 三轮增量）

### 视角A：测试质量审计（新维度）
- 🆕 **测试质量评分 3.7/5**：失败注入工程扎实（`write_fail_test.go` 用包级函数变量 swap 模拟 ENOSPC/EIO，`t.Cleanup` 恢复），断言精度在线（`errors.Is` / `errors.As` 全覆盖）。
- ⚠️ **主模型仲裁修正：importer `DetectContainerType` 并非裸奔**（子代理 1 报「零测试」系幻觉）——实地 `container_parity_test.go` + `detect_tail_test.go` + `importer_reverse_test.go` + `importer_file_test.go` 四文件 29 处覆盖充分（含双端 fixture 对账）。下载队列 `queue_test.go` 有 4 测试，但确缺 cancel-restart 竞态路径（已记 ADR-181 暂缓项，非新发现）。
- 🔴 **P0 缺口 — 全仓零 `t.Parallel()`**：`go/` 与 `internal/app/` 全测试文件**0 个调用 `t.Parallel()`**。CI 串行执行 + race detector 仅检测手动 goroutine 而非并行测试，并发竞态检测力大打折扣。
- 🟡 **watcher 14 个 `time.Sleep` 硬等待**：`watcher_test.go` 独占 10 处（最大 500ms debounce 窗口），无虚拟时钟 / 事件通道同步。测试耗时膨胀且 flaky 隐患。
- 🟡 **scanner `setWalkStartHook` 用 defer 非 t.Cleanup**：`TestScanEntriesWithHit_ConcurrentSameDir_SingleWalk` 恢复钩子靠 defer，若测试 panic（非 Fatal）可能漏恢复污染后续测试。
- ⚠️ **sync 非 Windows 并发竞态测试缺**：`sync_push_lock_windows_test.go` 仅 Windows，push/pull 的并发互斥保护在 Linux/macOS 无覆盖。
- 🟢 **Fixture 质量优秀**：litematic 全内存 fixture（`nbtTag`/`makeLitematicGz` helper），零二进制依赖。geometry 12 文件 0.08MB 轻量。

### 视角B：并发安全与错误处理（新维度）
- 🆕 **并发安全评分 3.3/5**：代际机制（epoch）设计精良——`Cancel()` 持锁递增 epoch + 替换 ctx，`processForEpoch` 启动/退出双校验，所有状态转换在锁内完成，无 TOCTOU 窗口。
- 🔴 **致命 — `processForEpoch` 无 recover 护体（已修复，见下「刀①」）**：`internal/app/install/queue.go` 的 defer 只复位 running / 重启 worker，**无 recover**。`downloadFn` / `emitFn` 回调若 panic，goroutine 直接崩溃，整个进程陪葬。讽刺的是 `conc.pool.go`、`watcher.go`、`dedup.go` 的 worker 都知道 recover，唯独串行消费的核心管道忘了。
- 🟡 **single-flight `wg.Wait()` 永久阻塞**：`go/scanner/scanner.go:442-458` 的 waiter `other.wg.Wait()` 依赖 owner goroutine 的 `wg.Done()`。若 owner 在 `tryStoreScanCache` 中 panic（无 recover），所有 waiter 永久阻塞 → goroutine 泄漏。
- 🟡 **`DecodeYSMData` 用 `context.Background()` 不可取消**：`go/avatar/avatar_decode.go:155` 未接收 ctx 参数，应用退出（ServiceShutdown → appCancel）时 Node/WASM 子进程无法通过 ctx 取消（60s timeout 兜底但 60s 内存占用是真实代价）。
- 🔴 **`InstallLock` 整段持锁做 I/O 是架构级性能天花板**：`go/sync/sync_push.go:33-34` 在锁内遍历所有 missing 文件逐个复制。数百 MB 仓库持锁数秒~数十秒，期间所有安装/同步操作全局串行。ADR-056 的「共享单锁」设计正确但粒度过粗。
- 🟡 **`fileLocks sync.Map` 永不清理**：`go/download/download.go:44-48` 注释自认「删除会引入 Unlock→Delete 竞态窗口」，设计正确但长期运行缓慢增长（每条目 ~48B + mutex）。
- 🟢 **defer 链 LIFO 正确**：`watcher.syncAll` 双 defer（recover → wg.Done）、`downloadTo` 七阶段 defer 链均 LIFO 安全。
- 🟢 **errors.Is / errors.As 全面收敛**：download 包 sentinel error 分类（ErrTruncated / ErrChecksumMismatch / ErrUnsupportedScheme）+ `errors.As` 精确匹配，替代文本 contains 反模式。

### 视角C：包边界与耦合度（新维度）
- 🆕 **包边界评分 3.475/5**：依赖方向整体健康（`internal/app` → `go/` 单向、`internal/app/install` 不反向 import `internal/app`、21 个 ADR 全部落地），但 `go/types` 是实锤的上帝包。
- 🔴 **致命 — `go/types/` 上帝包**：全仓 import `go/types` 的文件 77 个（子代理报「21 包」系低估）。`types.go` + `resource.go` + `extensions.go` 等非测试共 1715 行，DTO + 注册表加载 + 扩展名工具函数三层抽象混杂。`LoadRegistry` 耦合 JSON 加载、`StripDisableSuffix` 耦合扩展名判定，与纯 DTO 应分家。
- ⚠️ **主模型仲裁修正：「go/cli 绕过 AppService 直调 go/ysm」系幻觉**（子代理 3 报 🔴）——实地 `appservice.go` 的 import `go/ysm` 是接口签名要引用返回类型 `ysm.YSMModelMeta`（`AnalyzeYSMMod` 方法），不是绕过接口直调格式解析器。依赖倒置（ADR-145）成立。
- 🟡 **`go/sync`→`go/ysm` 逆向依赖（已随刀②收敛）**：原 `sync.go` 调用 `ysm.HasYSMMod()` 填充死字段 `HasYSM`，反向依赖 YSM 格式专属逻辑——现 `HasYSM` 字段 + `HasYSMMod` 已删，sync 不再依赖 go/ysm。残留 `go/fileops`→`go/ysm`（`DecodeYSM` 解码封面，合理，本就走注入解码器）。
- 🟡 **`go/ysm/extracted.go` 906 行**：「解压后 YSM 目录中的 geometry/纹理查找」把 YSM 目录读取、geometry 解析、纹理查找、载具/投射物纹理声明解析全塞一起。
- 🟢 **fsutil 收敛标杆级落地（ADR-044）**：84 处 `SHA256File`/`WriteFileAtomic`/`CopyFile`/`CopyDirRecursive` 全面收敛，零未收敛手写实现残留。
- 🟢 **ADR 遵从度优秀**：ADR-002/044/056/068/144/179 全部落地，仅 `app_download.go` 命名漂移（实为 install 转发层，非 download 实现）。

## 三轮锐评总加权

| 轮次 | 视角 | 评分 |
|------|------|------|
| 第一轮（2026-09-03） | IO/扫描/解析/绑定 三路 | 3.1/5 |
| 第二轮（2026-09-05） | 增量补刀 LimitReader+1 / Toggle 三轨 / 纹理口径 | — |
| 第三轮（2026-09-06） | 测试质量 3.7 / 并发安全 3.3 / 包边界 3.475 | **3.49/5** |

三轮加权约 **3.3/5**——安全防御层行业级（OOM/栈溢出/路径逃逸/TOCTOU/代际防竞态 四重防线全部到位），技术债集中在「隐式协议靠注释续命 + 上帝包 + 核心路径无测试」三块。

### 2026-09-07 四路子代理「全能 vs 确定」摸排 + 刀口执行

**三评加权评分演进：**

| 轮次 | 维度 | 初始 | 修复后 |
|------|------|------|--------|
| 第一轮（三路锐评） | IO/扫描/解析 | 3.4/5 | — |
| | 二进制解析/渲染 | 3.2/5 | — |
| | Wails绑定/应用层 | 2.8/5 | — |
| 加权 | 三轮综合 | **3.3/5** | — |
| 第二轮（全能vs确定摸排） | 全能函数堆积 | 2/5 | 2/5（已修复项扎实） |
| | 隐式状态散落 | 2/5 | **1.5/5** ✅ |
| | 错误语义模糊 | 3.5/5 | **1.5/5** ✅ |
| 加权 | 二轮综合 | — | **1.8/5** ✅ |

**本轮刀口（5 个 commit）：**

- ✅ **P0#1 fbx 导入策略断链**：`go/importer/importer.go` init() 补 `Register(NewSimpleCopy("fbx"))`；`importer_test.go` 加 fbx 断言；契约测试 `importer_registry_test.go` 新创建（遍历注册表全量 id 断言 importer.Get(id)!=nil + Handler种类↔isDir 一致性）
- ✅ **P0#2 panic 后假 done**：`queue.go:163` 条件补 `!panicked`；`queue_test.go` 补「panic 后不发 done」断言
- ✅ **P0#3 ResolveConflict 路径穿越**：`conflict.go` 加 `paths.RelInside` 双侧守卫
- ✅ **P0#4 clampTexDim 注释撒谎**：`texsize.go` 删「口径一致」假声明，显式化统计面板钳 65536 vs geometry UV 归 0 的语义差异
- ✅ **P0 Handler.Import error 化**：`Handler.Import` 签名 `string→error`；`ImportByType` 同步改 `(string,error)`；`adr143_importbytype_test.go` 反转结论（error 透传保留结构化链路）；前端 `toolbar-events.ts` 适配
- ✅ **P1#5 同包双胞胎**：`summary.go` 删 `extractTexSizeFromGeometry`，改调 `extractTexSizeFromGeometryBytes`
- ✅ **P1#6 looseAnims 排序**：`summary.go` map 遍历改先排序再收集
- ✅ **P1#7 TOCTOU 修复**：`summary.go` 裸 JSON 分支 Stat+ReadFile 改 ReadLimitedEntry 一步
- ✅ **P1#10 ToggleModelEnable 注释修正**：`app_files.go` 修正「前端 0 消费」为「桌面 UI 零消费，网页版 browser-adapter 在用」
- ✅ **P1 repoaudit 缓存**：`extToTypeID sync.Once → atomic.Value+实例指针失效`
- ✅ **P1 ErrPartialSync**：`sync_push.go` 部分失败加 sentinel
- ✅ **P1 queueEpoch**：`epoch uint64 → queueEpoch` 具名类型
- ✅ **P2 saveConfig watcher 拆分**：`rebuildWatcherAndDirs` 独立函数，职责分离

## 动刀进度（实施记录，2026-09-06 三轮仲裁后落地）

- ✅ **刀① `processForEpoch` 加 recover 兜底**：`internal/app/install/queue.go` 的 defer 首行加 `recover`，捕获 `downloadFn`/`emitFn`/`logFn` 回调 panic 后置 `panicked=true`（log 记账）+ 参与 `restart` 判定（`!panicked`）——防「panic → 重启 → 又 panic」无限重启循环，fail-stop 停在本任务。与 `conc.Pool`/`watcher.loop`/`dedup.worker` 三兄弟兜底口径对齐。新增 `queue_test.go` `TestDownloadQueue_DownloadPanicRecovered` 锁住：running 复位、剩余任务不消费、panic 不当普通失败记导入日志。`go build ./...` + `go test -race ./internal/app/install/` 全绿。
- ✅ **刀② mod 检测轨道收敛（删三份冗余实现 + 死字段）**：实地挖出「mod 检测」散落三轨——① `sync.go` 填死字段 `InstanceStatus.HasYSM`（前端 `src/` 零消费，纯浪费）；② `App.HasYSMMod` 死绑定（纯子串 `Contains("ysm")` 语义最宽松，前端零调用）；③ `go/ysm.HasYSMMod` 硬编码特例（内容检测，语义等价 `HasModInDir(dir, "ysm")` 注册表驱动）。**收敛动作**：删 `InstanceStatus.HasYSM` 字段（types.go）、删 `sync.go` 的 `HasYSM` 赋值 + `import go/ysm`、删 `App.HasYSMMod` 死绑定（app_install_instance.go）、删 `go/ysm.HasYSMMod` 硬编码（ysm.go + 测试）、`frontend/e2e/mock-data.ts` 删 `HasYSM`/`HasYSMMod` stale key。**唯一事实源 = `HasModInDir(dir, rtype)`（ADR-110 注册表驱动）**。重新 `generate:bindings -ts`（171 方法，`HasYSMMod` 消失）。`go build ./...` + `go test ./go/types ./go/sync ./go/ysm ./internal/app` + 前端 `typecheck`/`vite build` + `binding-check`（171:171 零 issues）全绿。
- ✅ **刀③ `CompareGlobalInstanceHashes` 死代码清理**：核实无 `internal/app` 生产调用（仅 3 个测试 + 文档），已被 `GetInstanceStatusWith` 取代（ADR-064 的 `GetResourceInstanceStatus` handler 实际走 `GetInstanceStatus` 而非它）。删 `CompareGlobalInstanceHashes` + `HasModInDirFn` 类型 + 3 个死测试（`sync_hash.go` 净删至只留 `computeHash`，被 `sync.go` 活跃使用）；`sync_diff.go` 注释同步修正为「唯一实现」。净删 186 行。`go build ./...` + `go test ./go/sync` + drift errors=0 全绿。
- ➖ **刀③ `InstallLock` 锁粒度**（标记技术债，不动）：ADR-056 共享单锁是明确设计决策，细粒度化引入死锁风险；是性能天花板非正确性 bug，属推倒重来心态。
- ➖ **纯技术债清单（不做）**：全仓零 `t.Parallel()`（渐进式）；`go/types` 1715 行上帝包（77 文件 import，需独立立项拆包）；watcher 14 个 `time.Sleep`（虚拟时钟改造）。`CompareGlobalInstanceHashes` 死代码已清理（见刀③）。
- ➖ **P2 技术债（标记，不阻塞发版）**：`InstallLock` 注释契约 >10 处（ADR-056 设计决策，细粒度化引入死锁风险）；`ToggleModelEnable` bool 语义混用（改动面大，前端 banned 状态由扫描结果下发不依赖返回值）；`YSGP` 检测三胞胎合一（返回形态各不同，合并成本高）；`wasm_decoder.go` init 注入（ADR-047 设计决策，改风险高）。

## 动刀进度（实施记录，2026-09-08 四轮锐评刀口）

### 视角A：IO/扫描/路径/探测域
- ✅ **刀① 回收站读废弃字段清理**：`internal/app/app_install_recycle.go` 的 `findRecycleRoot` 和 `allRecycleRoots` 删除对 `cfg.ResourcepackRoot`/`cfg.ShaderpackRoot`/`cfg.SchematicRoot`/`cfg.LitematicRoot`/`cfg.MmdRoot`/`cfg.VrcRoot` 等已清空废弃字段的读取，改为只读 `CustomRoots`（唯一事实源）。测试 `TestFindRecycleRoot_MultiType` 同步迁移到 `CustomRoots` 写法。消除迁移后资源包文件被错误移入 ysm `.recycle` 的错桶风险。

### 视角B：二进制解析/渲染/缓存域
- ✅ **刀② parseModelOrder break/continue 行为分叉修复**：`go/geometry/ysm_parser.go:216-229` 的 map 格式解析将 `break` 改为 `continue`，与 `go/ysm/extracted.go:153-171` 的 `parsePlayerModel` 同口径。修复 zip/7z 路径在首个畸形 value 后丢弃 main 等全部后续模型的行为分叉。

### 视角C：Wails绑定/应用层域
- ✅ **刀③ DoUpdate 返回 error 替代字符串错误通道**：`internal/app/app_config.go` 的 `DoUpdate` 签名由 `string` 改为 `(string, error)`，错误路径走 reject 而非字符串返回。`ErrExitRequested` 路径仍会 `os.Exit(0)`（helper 替换 exe 需要主进程退出，无法避免），但手动清理临时文件（os.Exit 会跳过 defer）。前端 `version-updater.ts` 适配：不再判断 `result !== "success"`，错误自然走 catch。同步 `binding-check.ts` 白名单将 `DoUpdate` 移出真字符串档、`binding_json_cleanup.md` 计数 16→15、`e2e/mock-data.ts` 保留（undefined mock 兼容）。`generate:bindings -ts` 重写绑定面。

## 相关

- [frontend_design_critique](frontend_design_critique.md)：前端侧同方法论锐评（三子代理并发 + 主模型抽查）
- [go-avatar-decode](go-avatar-decode.md)：avatar 包「纯 Go vs Node+WASM」两条路分界（本卡双胞胎桥的消费端）
- [safe_error_msg](safe_error_msg.md)：错误契约统一
- 各包知识卡：go-scanner / go-fsutil / go-importer / go-litematic 等