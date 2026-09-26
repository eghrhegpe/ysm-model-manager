---
kind: go-repoaudit
name: 仓库审计 go/repoaudit
tier: architecture
category: go
source_files:
  - go/repoaudit/
auto_fields:
  symbols_with_lines:
    - Audit
    - CacheStatus
    - Classify
    - ClassifyWith
    - Completeness
    - DedupSummary
    - DirAuditResult
    - HealthReport
    - HealthReportFor
    - ResourceSummary
    - ScoreVerdict
    - VerdictBad
    - VerdictGood
    - VerdictOk
use_when:
  - 仓库审计
  - 健康分数
  - 完整性检查
  - 缓存命中率
  - repoaudit
  - health-report
  - 去重
perf:
  - io-bound
  - memory-heavy
invariant_anchors:
  - go/repoaudit/repoaudit.go|func Audit
  - go/repoaudit/repoaudit.go|func Classify
  - go/repoaudit/repoaudit.go|extClassifierCache
pitfalls:
  - "CLI 与 GUI 共用同一 Audit 实现——改一处必须同步考虑两端行为"
  - "isModelFileValid 拒绝空对象/数组——畸形 JSON 标记无效不报错"
  - "Classify(ext) 经 extClassifierCache（atomic.Value + 注册表实例指针失效范式，与 go/types 的 extCache 对齐），cache hit 零锁；实例变即重建 map（963d4d36 从 sync.Once 替换，永久缓存空 map 的旧缺陷消失）"
  - "HealthReportFor 包含去重扫描——大仓库可能耗时数秒"
  - "缓存命中率计算基数是可缓存纹理文件数（`registry.IsTextureExt` 过滤后计数），非全部文件数"
  - "Audit 返回的 Result 不含去重结果——去重必须走 HealthReportFor"
quick_intents:
  - "仓库健康审计（Audit）"
  - "完整体检 + 去重（HealthReportFor）"
  - "扩展名→资源类型分类（Classify）"
  - "模型文件完整性验证"
  - "缓存命中率分析 / 仓库评分"
status: active
---

# 仓库审计 go/repoaudit

## 概览

`go/repoaudit/` 包提供仓库健康审计核心逻辑——资源扫描、完整性校验、缓存状态、健康分数、警告生成、去重汇总。从 `go/cli`（原 `resource.go` 的 `collectRepoHealth`）提取为独立包，CLI 与 GUI 绑定（`internal/app`）共用同一实现，消除「前端算一遍、CLI 算一遍」的双轨口径漂移。

## 核心职责

- `Audit(dirPath)` — 一次遍历完成：资源扫描 + 完整性检查（.json/.ysm 合法性验证）+ 缓存状态 + 健康分数 + 警告生成
- `HealthReportFor(dirPath)` — 完整体检：Audit + 去重（`dedup.FindDuplicateFiles`），返回 `HealthReport` 统一载荷
- `Classify(ext)` — 扩展名→注册表资源类型 id 映射，注册表驱动（新增类型只改 `resource_types.json`）；内部经 `extClassifierCache`（`atomic.Value` + 注册表实例指针失效范式，与 `go/types/registry/extensions.go` 的 `extCache` 同款，`963d4d36` 由 `sync.Once` 替换），cache hit 零锁、O(1) 查表；大仓库 per-file 路径禁用本函数（线性放大）
- `ClassifyWith(reg, ext)` — 使用调用方已 hoist 的注册表实例判型（`4277c151` 新增，签名同 `Classify` 但接受外层 reg）——`Audit` 大仓库调用点必须走此函数防 per-file `LoadRegistry` 线性放大（`Audit` 内部已改；CLI 命令/其他调用点若需批量分类，同样走此函数）
- `isModelFileValid` — 模型文件完整性验证：.json/.ysm 必须合法 JSON 且含 `format_version`（或 `minecraft:geometry`/`bones`），拒绝空对象/数组

## 对外 API / 入口

- `Audit(dirPath string) (Result, error)` — 审计核心，返回 `Result`（完整性 + 缓存 + 资源统计 + 分数 + 警告）
- `HealthReportFor(dirPath string) (HealthReport, error)` — 完整体检（审计 + 去重）
- `Classify(ext string) string` — 扩展名分类（导出供 resource-scan 等共用）
- `Result` / `HealthReport` / `Completeness` / `CacheStatus` / `ResourceSummary` / `DedupSummary` — 结果类型

## 与其他子系统关系

- 被 `go/cli/resource.go`（`repo-audit` 命令）和 `go/cli/health.go`（`health-report` 命令）调用
- 被 `internal/app/resource_bindings.go`（GUI 绑定 `RepoHealthAudit`）调用
- 依赖 `go/dedup`（去重扫描）、`go/texture_cache`（缓存统计）、`go/fsutil`（FormatSize）、`go/types`（注册表）

## 不变量

- CLI 与 GUI 共用同一 `Audit` 实现，审计口径唯一（防双轨漂移）
- 目录不存在/不可用必须先报错——`filepath.Walk` 对不存在目录只回错误回调却返回 nil，会静默产出「空报告 = 假绿」
- 符号链接守卫：拒绝根目录符号链接，跳过子树内符号链接（与 dedup 包对齐）
  - **R34 P2-3 根 symlink 守卫 filepath.Clean 修复**（repoaudit.go:159）：原 `path == dirPath` 字符串比较，含尾斜杠/`..`/未 clean 路径时比较失败，根符号链接被静默跳过，产出空报告。修复：`path == filepath.Clean(dirPath)`。
- 健康分数有下限 `scoreFloor = 30`，避免多问题叠加直接归零失去区分度
- `Classify` 未命中任何注册表类型 → `"other"`（不报错）
- **`Resources.ByType` 只在 walk 结束后一次性赋值（2026-09 落地）**：`DirAuditResult` 字面量初始化时不再预 `make` `ByType` map——原实现先 make 一个随即被下方 `result.Resources.ByType = resources`（局部 map 累积结果）整体覆盖，属无谓分配。后续改动须保持「局部 map 累积 → walk 后赋值」形态，勿在字面量里提前构造。
- **缓存命中率 = 真口径（2026-09 重写；勿退回旧算法）**：`measureCacheHitRate` 逐纹理 `TextureHash(内容)` → 查缓存集 → 真实命中计数，分子分母**同为「本仓库纹理」**，故命中率天然 ∈ [0,100]、无需截断。与 `cache-verify` 命令同口径。
  - **旧算法（已废，识别特征）**：`HitRate = GetCacheStats().FileCount / 本仓库纹理数`——分子是**全局缓存目录文件数**（内容哈希键，跨仓库跨类型共享，所有导入过的模型都堆同一目录），与分母不同源无因果关系；`Hits=FileCount` 更把「缓存里有 N 个文件」当作「本仓库命中 N 次」。比例随缓存增长必然 >100%，靠 `if hitRate > 100 { hitRate = 100 }` 掩盖 → 体检页长期显示「命中率 100%」**假绿**。回归护栏：`TestAudit_CacheHitRate_GlobalCacheDoesNotInflate`（缓存目录塞 50 个无关条目、仓库仅 1 个未缓存纹理 → 命中率必须为 0%，旧算法在此算成 100%）。
  - **性能设计**：每个纹理都要 SHA256 全文件内容（与 `cache-verify` 同量级），但体检是 GUI 交互路径。故 ① 纹理样本由 `cacheHitSampleLimit` 截断（默认 1000，超限置 `CacheSampled` → 前端显示「≈」）；② 缓存集一次 `ListCacheFiles()` 建好供只读查询，替代逐纹理 `os.Stat`（`HasCached` 内部即 Stat）；③ 哈希计算按 `cacheHitWorkers`（默认 4）**分块**并发——不用 `conc.ParallelCtx` 是因为其 worker 数固定 `NumCPU` 不可外部传，无法落实限流（不与前台操作争抢全部 CPU）。两参数均为包级 var 供测试注入。
  - **失败语义**：哈希/探测失败**不计入**分子也不计入分母，只累加 `CacheScanErrors`——「探测故障」≠「未缓存」，否则磁盘/权限故障会被误读成「贴图没缓存」、用户据此白重编码一遍。缓存目录不可列时全部计为失败（不静默当 0% 命中）。

## 已知问题 / 待治理（R34 审计记录）

- **无界 JSON 解码 OOM 风险（已修复 2026-09-14）**：`isModelFileValid` 现走 `fsutil.ReadLimitedEntry(f, modelFileReadLimit)`（默认 `registry.MaxReadLimit` 50MB，limit+1 探测截断，超限判无效）——与 go/ysm `readFileLimited` 同族口径；包级 var 供测试注入小值（`TestIsModelFileValid_SizeLimit` 钉住）。
- **无 context/超时**（repoaudit.go:125/256，R34 P3-5 待修）：`Audit` 与 `HealthReportFor` 无 `context.Context`/超时，大仓库审计可能长时阻塞 GUI 绑定层。
- **P2-4 WalkDir 回调对 `err != nil`**（无权限目录）仅 `append` warning 后 `return nil`，部分目录不可达时 `TotalFiles` 偏低但分数仍可能 100，静默偏绿。修复方向：累计访问异常计数，超过阈值标记 `partial=true`。
- **P2-5 `isModelFileValid` 对未识别扩展名 `return true` 放行**，若未来调用方放宽 gate，未知扩展名被误判有效。修复方向：函数内对未识别扩展名 `return false` 防御性收紧。
- **P3-6 `HealthReportFor` 中 dedup 扫描失败直接 `return HealthReport{}, err`**，丢弃已成功的 `audit` 结果。修复方向：dedup 失败时保留 audit 部分、Dedup 置零并在 warnings 追加。

## 相关

- [go-dedup](./go-dedup.md) — 去重核心（HealthReportFor 调用）
- [go-fsutil](./go-fsutil.md) — 文件工具（FormatSize）
- CLI 命令 `audit-split` / `rollback-impact` — 操作此包
