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
    - App.GetModelTexSizes
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
    - DecodeYSMFiles
    - DetectZipTypeFromBase64Tail
    - DownloadQueue
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
    - NewDownloadQueue
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
    - ResourceTypeInfo
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
  - Wails 绑定治理
  - 可读性与命名治理
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
  - internal/app/app_download.go|processForEpoch
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

- ✅ **刀① 合并 wasm_decoder/avatar_decode 双胞胎桥**（ADR-164）：`go/avatar` 新增统一实现 `DecodeYSMData`（[]byte 直通 + 剥 /output/ 前缀 + 200MB 输入护栏 + 60s 超时 + 200MB/8MB 输出护栏），`DecodeYSMFiles` 保留签名变薄封装（toInts 转回），`internal/app` `runYSMNodeJSDecode` 删 166 行变薄封装——FILES_JSON 协议/limitedBuffer/glue 补丁全仓单例化，净 -93 行。`go build ./go/... ./...` + `go test ./go/avatar ./internal/app ./go/fileops ./go/ysm ./go/geometry ./go/importer ./go/scanner ./go/container` 全绿。
- ✅ **刀② joinInFlightWaiter 三态 bool → joinResult struct**：`go/scanner/scanner.go` 新增 `joinResult{entries, hit, retry}` 替代 `([]ModelEntry, bool, bool)` 返回，调用点改 `res.hit / res.retry`——语义与注释同步逐字转移，scanner 单测全绿（含 singleflight 并发测试）。
- ✅ **刀④b uniqueDest → generateConflictFreeDest**：`go/recycle/recycle.go` 纯改名（函数 + 6 处消费点 + 注释），零行为变化，recycle 测试全绿。
- ✅ **刀③ LimitReader+1 收编（修正原「6 处统一收编」断言）**：实地审计 22 处 LimitReader 后修正——`extractYsmRootFromZip`（ysm/summary.go:218 需区分超限/读错误两种文案）、`mcmeta.go`（metaTooLarge 标志区分）、`nbt.go:36`（错误上抛）、`avatar_zip.go:37/70`+`avatar_extract.go:482`（超限 vs 读错误日志区分）**语义均比 fsutil.ReadLimitedEntry 更细，强收编会退化错误处理，保留**；真正的高 ROI 点 = `internal/app/resourcepack_models.go:143/173` 两处裸 `LimitReader` **缺 +1 探测（ADR-033 陷阱残留：恰 64MB 条目静默截断继续用）且 nil 语义与 fsutil 兼容** → 收编 `fsutil.ReadLimitedEntry`，顺带修掉截断 bug。内部 app 测试全绿。
- ✅ **刀④c resolveBedrockGeometryFallback 拆 4 个具名策略**：`go/ysm/extracted.go` 主函数变 4 行链式调用（fallbackParseDirect / fallbackParseWrapped / fallbackWalkDir / fallbackParseBare），每层策略独立具名——逐字节保留原行为（含 WalkDir 10 层/排除目录/probes 封顶/texSlot=0 口径）。ysm + internal/app + geometry + threejs 测试全绿。
- ➖ **绑定清理 + DetectZipType 改名降级为发版批次**（推迟，非放弃）：21 个 Deprecated 绑定中 5 个仍有 Go 测试消费（SavePreviewTempFile/ClearCustomDir/MoveToRecycleEx/ExportWorkshopSitesCSV/ImportWorkshopSitesCSV 各有专项测试做行为抓手）、e2e mock-data.ts 有 MissingMockKeys/StaleMockKeys 类型级守卫强制绑定面同步、删除后必须重新 generate:bindings 重写 frontend/bindings/ 且工作区已有未提交前端改动——独立发版级改动，不在锐评批次内混动。`DetectZipType→DetectContainerType` 因是 Wails 绑定名（前端 40 处消费面）同批降级，避免「绑定名 vs 内部名」双轨。
- ➖ **processForEpoch epoch → 状态机枚举（暂缓，需 ADR 级评估）**：并发核心 + 现有测试（Sequential/Error/Cancel/QueueStatus）**未覆盖 cancel-restart 竞态路径**、epoch 三处递增无专门并发测试兜底——按「先写测试再写实现」铁律，需先补竞态测试（withFakeNode 式注入 epoch 推进）再谈枚举化，独立立项。

## 相关

- [frontend_design_critique](frontend_design_critique.md)：前端侧同方法论锐评（三子代理并发 + 主模型抽查）
- [go-avatar-decode](go-avatar-decode.md)：avatar 包「纯 Go vs Node+WASM」两条路分界（本卡双胞胎桥的消费端）
- [safe_error_msg](safe_error_msg.md)：错误契约统一
- 各包知识卡：go-scanner / go-fsutil / go-importer / go-litematic 等