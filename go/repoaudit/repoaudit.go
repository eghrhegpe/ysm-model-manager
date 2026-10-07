// Package repoaudit 仓库健康审计核心——GUI 绑定层与 CLI 共用（防双轨口径漂移）。
//
// 历史：审计逻辑原在 go/cli（resource.go collectRepoHealth），GUI 侧如果自算一套
// 会形成「前端算一遍、CLI 算一遍」的双轨（roadmap 方向 A 遗留）。本包把审计核心
// 抽成独立层：cli 与 internal/app 绑定都调同一实现，后续审计口径只改这一处。
//
// 两层结构语义（命名即边界）：
//   - DirAuditResult = 单目录审计结果（Audit() 返回），CLI repo-audit 命令序列化输出
//   - HealthReport   = 完整体检：审计 + 去重（HealthReportFor() 返回），
//     GUI 体检绑定（RepoHealthAudit）与 CLI health-report 命令共用同一载荷
//
// 2026-10 拆分：原 609 行按职责分为 repoaudit.go（本文件：extClassifier + Audit/AuditCtx）/
// repoaudit_health.go（完整体检 HealthReportFor + 评分 + 告警 + Classify）。
package repoaudit

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"ysm-model-manager/go/conc"
	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types/registry"
)

// extClassifier 缓存 ext→rtype 映射，以注册表实例指针为失效 key。
// 与 go/types/extensions.go 的 extCache 同款 atomic.Value+实例指针范式：
// SetRegistryPath 重置注册表 → LoadRegistry 返回新实例 → 自动重建，永不 stale。
type extClassifier struct {
	reg    *registry.ResourceTypeRegistry
	extMap map[string]string // 单一声明者: ext → rtype id
}

var extClassifierCache atomic.Value // *extClassifier

// buildExtClassifierFrom 以给定注册表实例构建 ext→rtype 映射。
// reg 必须由调用方传入（而非内部 LoadRegistry）——与 ClassifyWith 的「外层已
// hoist reg」契约一致，保证缓存失效比对与构建用同一实例。
func buildExtClassifierFrom(reg *registry.ResourceTypeRegistry) *extClassifier {
	count := make(map[string]int)
	owner := make(map[string]string)
	for _, rt := range reg.ResourceTypes {
		for _, e := range rt.EffectiveExtensions() {
			low := strings.ToLower(e)
			count[low]++
			owner[low] = rt.ID
		}
	}
	m := make(map[string]string)
	for e, n := range count {
		if n == 1 {
			m[e] = owner[e]
		}
	}
	return &extClassifier{reg: reg, extMap: m}
}

// 审计相关阈值常量
const (
	// 完整性阈值：低于此百分比触发警告
	warnCompletenessPct = 95.0
	// 大文件警告阈值：超过此大小触发警告
	warnLargeFileMB = 100
	// 超大文件扣分阈值
	scoreLargeFileMB = 500
	// 缓存大小警告阈值
	warnCacheSizeGB = 1
	// 健康分数下限：多问题叠加不低于此值
	scoreFloor = 30
)

// 命中率统计参数（包级 var 供测试注入小值）。
// 为何要上限：每个纹理都要 SHA256 全文件内容——与 `cache-verify` 命令同量级开销，
// 但体检是 GUI 交互路径（用户点击即触发），超大仓库（数万纹理）不能无界阻塞。
// 超限时按 walk 序取前 N 个纹理采样，CacheSampled 置真供前端标注「≈」。
var (
	// cacheHitSampleLimit 命中率统计的纹理采样上限（超出即采样，结果标注估计）
	cacheHitSampleLimit = 1000
	// cacheHitWorkers 命中率统计的并发 worker 数（IO 密集：读文件算 SHA256）
	cacheHitWorkers = 4
)

// DirAuditResult 单目录审计结果（Audit() 返回；结构对齐原 go/cli repoAuditResult）
type DirAuditResult struct {
	Timestamp    string          `json:"timestamp"`
	Directory    string          `json:"directory"`
	Completeness Completeness    `json:"completeness"`
	Cache        CacheStatus     `json:"cache"`
	Resources    ResourceSummary `json:"resources"`
	Score        int             `json:"score"`
	Warnings     []string        `json:"warnings,omitempty"`
}

// Completeness 完整性统计
type Completeness struct {
	Checked    int     `json:"checked"`
	Valid      int     `json:"valid"`
	Invalid    int     `json:"invalid"`
	Percentage float64 `json:"percentage"`
}

// CacheStatus 缓存状态
//
// 关于「命中率」的口径（2026-09 重写，勿退回到旧实现）：
//   - 旧实现：HitRate = 全局缓存目录文件数 / 本仓库纹理数——**语义错误**。分子
//     （CacheStats.FileCount，内容哈希键、跨仓库跨类型共享）与分母（本仓库纹理数）
//     不同源、无因果关系，比例随缓存增长必然 >100%，被 `>100 截断` 掩盖成「命中率
//     100%」假绿。已于 2026-09-14 删除。
//   - 现实现：逐纹理 TextureHash(内容) → 查缓存集 → 真实命中计数。分子分母同源
//     （都是本仓库纹理），与 `cache-verify` 命令同口径。字段复用旧名但语义已变。
type CacheStatus struct {
	CacheDir   string `json:"cache_dir"`
	CacheFiles int    `json:"cache_files"`
	CacheSize  int64  `json:"cache_size"`
	// ShouldWarn 容量接近上限（texture_cache 阈值），体检页提示清理
	ShouldWarn bool `json:"should_warn,omitempty"`
	// HitRate 本仓库纹理的缓存命中率（0~100）。CacheSampled 为真时是基于采样
	// 的估计值（纹理数超 cacheHitSampleLimit），前端应标注「≈」。
	HitRate float64 `json:"hit_rate,omitempty"`
	// Hits / Misses 本仓库纹理中命中/未命中缓存的**文件数**（非全局缓存条目数）。
	Hits   int `json:"hits,omitempty"`
	Misses int `json:"misses,omitempty"`
	// CacheSampled 命中率是否来自采样（纹理数超上限）。
	CacheSampled bool `json:"cache_sampled,omitempty"`
	// CacheScanErrors 命中率统计过程中的哈希/探测失败数（非文件本身损坏）。
	// 失败纹理不计入分子分母，失败数可见以免「故障」被误读为「全部未缓存」。
	CacheScanErrors int `json:"cache_scan_errors,omitempty"`
}

// ResourceSummary 资源统计
type ResourceSummary struct {
	TotalFiles  int            `json:"total_files"`
	TotalSize   int64          `json:"total_size"`
	Banned      int            `json:"banned"`
	ByType      map[string]int `json:"by_type"`
	LargestFile string         `json:"largest_file,omitempty"`
	LargestSize int64          `json:"largest_size,omitempty"`
}

// DedupSummary 去重维度汇总（HealthReport 追加）
type DedupSummary struct {
	Groups     int   `json:"groups"`
	ExtraFiles int   `json:"extra_files"`
	Reclaim    int64 `json:"reclaim_bytes"`
}

// HealthReport 完整体检：审计 + 去重（GUI 与 CLI health-report 同一载荷）
type HealthReport struct {
	Timestamp    string          `json:"timestamp"`
	Directory    string          `json:"directory"`
	Score        int             `json:"score"`
	Verdict      string          `json:"verdict"`
	Completeness Completeness    `json:"completeness"`
	Cache        CacheStatus     `json:"cache"`
	Resources    ResourceSummary `json:"resources"`
	Dedup        DedupSummary    `json:"dedup"`
	Warnings     []string        `json:"warnings,omitempty"`
}

// 健康分档位（2026-09 对接锐评④：判级阈值单源在 Go，前端只按 verdict 映射颜色/
// 文案。此前 80/60 只存在于 diagnostics/health.ts 的两份三元里，Go 侧无出处，
// 改阈值要前后端两处同步——典型的职责不清）。
const (
	VerdictGood = "good" // score >= verdictGoodMin
	VerdictOk   = "ok"   // verdictOkMin <= score < verdictGoodMin
	VerdictBad  = "bad"  // score < verdictOkMin

	verdictGoodMin = 80
	verdictOkMin   = 60
)

// ScoreVerdict 健康分 → 档位。导出口径统一供 HealthReportFor 与
// internal/app 的多仓合并（mergeAuditResults）共用，防止双实现漂移。
func ScoreVerdict(score int) string {
	switch {
	case score >= verdictGoodMin:
		return VerdictGood
	case score >= verdictOkMin:
		return VerdictOk
	default:
		return VerdictBad
	}
}

// Audit 仓库健康审计核心：资源扫描 + 完整性 + 缓存 + 健康分数 + 警告，一次遍历。
// 这是 repo-audit 与 GUI 绑定 RepoHealthAudit 的唯一实现来源。
// 目录不存在/不可用必须先报错——filepath.Walk 对不存在目录只回错误回调却返回 nil，
// 会静默产出「空报告 = 假绿」（与 dedup.ErrSymlinkRoot 同族陷阱）。
func Audit(dirPath string) (DirAuditResult, error) {
	return AuditCtx(context.Background(), dirPath)
}

// AuditCtx ctx 版（ADR-314）：GUI 绑定传入 Wails 注入的可取消 ctx。取消后整单作废
// （前端不消费部分结果），完整跑完的报告确定性不受影响（ADR-119）。
func AuditCtx(ctx context.Context, dirPath string) (DirAuditResult, error) { //nolint:gocyclo // 存量复杂度（25>20），发版窗口暂以 nolint 记账，重构另立任务
	if st, err := os.Stat(dirPath); err != nil {
		return DirAuditResult{}, fmt.Errorf("审计目录不可用 %q: %w", dirPath, err)
	} else if !st.IsDir() {
		return DirAuditResult{}, fmt.Errorf("审计目标不是目录: %s", dirPath)
	}

	result := DirAuditResult{
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		Directory:    dirPath,
		Completeness: Completeness{},
		Cache:        CacheStatus{},
		// Resources.ByType 留待下方 walk 结束后由局部 resources map 整体赋值
		// （原此处先 make 一个 map 再被 L246 覆盖，纯属一次无谓分配）。
		Resources: ResourceSummary{},
		Warnings:  make([]string, 0),
	}

	// 1. 资源扫描 + 完整性检查（一次遍历）
	var totalSize int64
	var largestFile string
	var largestSize int64
	// texturePaths 命中率统计的纹理样本（上限 cacheHitSampleLimit，见 measureCacheHitRateCtx）
	var texturePaths []string
	resources := map[string]int{}
	// 注册表加载提升到 walk 外——per-file TypeByLocation 不再
	// 每文件 LoadRegistry（mutex + 解析开销——大仓库线性放大）
	reg := registry.LoadRegistry()

	// ADR-314 取消检查点：ctx.Err() 内部带锁，降频至每 64 项一查（回调内其余工作
	// 均含文件系统调用，检查开销相对可忽略）。
	walked := 0
	err := filepath.WalkDir(dirPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("访问异常: %s (%v)", path, err))
			return nil
		}
		walked++
		if walked%64 == 1 {
			if cerr := ctx.Err(); cerr != nil {
				return cerr
			}
		}
		// 符号链接守卫：拒绝根目录符号链接，跳过子树内符号链接（与 dedup 包对齐）
		if d.Type()&os.ModeSymlink != 0 {
			// filepath.WalkDir 内部对 root 做 Clean，
			// 传入的 dirPath 可能含尾斜杠/.. 而未 clean，导致 path != dirPath 比较失败，
			// 根符号链接被静默跳过。对 dirPath 先 Clean 再比较。
			if path == filepath.Clean(dirPath) {
				return fmt.Errorf("审计根目录是符号链接: %s", dirPath)
			}
			return nil
		}
		if d.IsDir() {
			// 排除回收站目录（code review P2 修复）：与 scanner/dedup/watcher/sync
			// 口径一致——回收站文件不应计入 TotalFiles/Banned/LargestFile/命中率，
			// 否则与 Dedup 维度（skipRecycle=true）报告内自相矛盾
			if d.Name() == ".recycle" {
				return filepath.SkipDir
			}
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		size := info.Size()
		result.Resources.TotalFiles++
		totalSize += size

		// 收集纹理路径供命中率统计（延后到 walk 外并发执行，见 measureCacheHitRateCtx）。
		// 此处只 append 不计算哈希——walk 回调内做 SHA256 会串行拖垮大仓库。
		// 扩展名口径委托 registry.IsTextureExt（单一事实源）。
		if registry.IsTextureExt(ext) && len(texturePaths) < cacheHitSampleLimit {
			texturePaths = append(texturePaths, path)
		}

		// 禁用文件统计：单一口径 registry.IsDisableSuffix（.disabled/.ban，大小写不敏感）
		if registry.IsDisableSuffix(d.Name()) {
			result.Resources.Banned++
		}

		if size > largestSize {
			largestSize = size
			largestFile = path
		}

		// 完整性检查：.json 验证可解析，.ysm 验证非空
		if ext == ".ysm" || ext == ".json" {
			result.Completeness.Checked++
			if isModelFileValid(path, ext) {
				result.Completeness.Valid++
			} else {
				result.Completeness.Invalid++
			}
		}

		// 类型统计（location 路由优先 + 扩展名兜底）：纯 Classify(ext) 对共享扩展名
		// （.zip 被 14 类型声明）last-wins 归最后一个声明者，mmd/PMX 下模型包 zip
		// 会误归 DefaultMorph——目录归属优先（TypeByLocation），容器未命中标
		// "container"（与 gui-flow 统计口径一致，2026-08-23 修复）。
		typeName := registry.TypeByLocation(path, reg)
		if typeName == "" {
			if registry.IsContainerExt(ext) {
				typeName = "container"
			} else {
				// 用 walk 外已 hoist 的 reg（L161）判型——Classify 入口每调一次
				// LoadRegistry，per-file 路径必须走 ClassifyWith 防线性放大
				typeName = ClassifyWith(reg, ext)
			}
		}
		resources[typeName]++
		return nil
	})
	if err != nil {
		return result, fmt.Errorf("扫描目录失败: %w", err)
	}

	result.Resources.TotalSize = totalSize
	result.Resources.ByType = resources
	result.Resources.LargestFile = largestFile
	result.Resources.LargestSize = largestSize

	// 完整性百分比
	if result.Completeness.Checked > 0 {
		result.Completeness.Percentage = float64(result.Completeness.Valid) / float64(result.Completeness.Checked) * 100
	} else {
		result.Completeness.Percentage = 100.0
	}

	// 缓存状态 + 命中率（真命中率见 measureCacheHitRateCtx：逐纹理哈希查缓存）
	stats := texture_cache.GetCacheStats()
	result.Cache.CacheDir = stats.Dir
	result.Cache.CacheFiles = stats.FileCount
	result.Cache.CacheSize = stats.TotalSize
	result.Cache.ShouldWarn = stats.ShouldWarn

	if err := ctx.Err(); err != nil {
		return result, fmt.Errorf("体检已取消: %w", err)
	}
	hits, misses, scanErrs := measureCacheHitRateCtx(ctx, texturePaths)
	if err := ctx.Err(); err != nil {
		return result, fmt.Errorf("体检已取消: %w", err)
	}
	textureTotal := hits + misses
	if textureTotal > 0 {
		result.Cache.Hits = hits
		result.Cache.Misses = misses
		result.Cache.HitRate = float64(hits) / float64(textureTotal) * 100
	}
	result.Cache.CacheScanErrors = scanErrs
	// 采样标记：walk 收集到上限即代表仓库纹理数超限（采样值，非全量）
	result.Cache.CacheSampled = len(texturePaths) >= cacheHitSampleLimit

	// 健康分数 + 警告
	result.Score = calculateAuditScore(result)
	generateAuditWarnings(&result)

	return result, nil
}

// measureCacheHitRateCtx 统计给定纹理列表的缓存命中数/未命中数/探测失败数（ctx 版，ADR-314）。
//
// 口径（与 `cache-verify` 命令一致，勿退回旧的错误算法）：
//   - 命中 = 纹理**内容哈希**（TextureHash）对应的 KTX2 缓存文件存在；
//   - 分子分母同源：都是入参纹理本身，故命中率天然 ∈ [0,100]，无需截断。
//
// 旧实现的错误在于用「全局缓存目录文件数」当分子——那是跨仓库共享的内容哈希池，
// 与本仓库纹理无因果关系，比例必然失真（见 CacheStatus 注释）。
//
// 性能设计：
//   - 缓存集一次建好（ListCacheFiles）后只读查询，替代逐纹理 os.Stat（HasCached）——
//     纹理数 N 时省 N 次 syscall；
//   - 哈希计算（读全文件 + SHA256，IO/CPU 混合）并发执行，worker 数由
//     cacheHitWorkers 控制（包级 var 供测试注入）；
//   - 入参已由调用方按 cacheHitSampleLimit 截断，本函数不重复限流。
//
// 失败语义：哈希失败/缓存探测失败 **不计入** 分子也不计入分母（计入失败数）——
// 「探测故障」≠「未缓存」，否则磁盘/权限故障会被误读成「该纹理没缓存」。
//
// ctx 版：worker 每纹理一查（单纹理 SHA256 开销远大于检查），取消即提前收工——
// 结果作废，调用方据 ctx.Err() 判定。
func measureCacheHitRateCtx(ctx context.Context, texturePaths []string) (hits, misses, scanErrs int) {
	if len(texturePaths) == 0 {
		return 0, 0, 0
	}

	// 缓存哈希集：一次扫描替代逐次 Stat（HasCached 内部即 os.Stat(CachePath)）
	// CacheDir()=="" 是「配置根不可用」的合法空值形态——ListCacheFiles 在此情形下
	// 返回 (nil, nil) 而非错误，若不前置判断，全部纹理会被误计为 miss（0% 命中假象），
	// 违背「故障 ≠ 未缓存」的失败语义。须先显式探测再走「全失败」路径。
	if texture_cache.CacheDir() == "" {
		return 0, 0, len(texturePaths)
	}
	cachedHashes := make(map[string]struct{})
	if entries, err := texture_cache.ListCacheFiles(); err == nil {
		for _, e := range entries {
			if e.Hash != "" {
				cachedHashes[e.Hash] = struct{}{}
			}
		}
	} else {
		// 缓存目录不可列：无法判定命中，全部计入失败（不静默当成 0% 命中）
		return 0, 0, len(texturePaths)
	}

	type tally struct{ hit, miss, bad int }

	// 已收敛到 conc.ParallelN（worker 数外部可控），替代此前的手写分块池。
	// 为何不用 conc.ParallelCtx：其内部固定 worker=max(NumCPU,2)、不可外部传，
	// 无法落实本包 cacheHitWorkers 的限流意图（体检是 GUI 交互路径，
	// 不能与用户的前台操作争抢全部 CPU）——ParallelN 让调用方显式传并发度。
	// ADR 脉络保留：ADR-119 确定性契约保证 tally 按输入序归约，结果与并行度无关。
	// 取消语义：ctx 取消即停止派发，未处理纹理不入计数（与旧实现 break 行为一致）。
	tallies := conc.ParallelN(ctx, cacheHitWorkers, texturePaths, func(ctx context.Context, _ int, path string) (tally, bool) {
		if ctx.Err() != nil {
			return tally{}, false
		}
		var t tally
		hash, err := texture_cache.TextureHash(path)
		if err != nil {
			t.bad++
			return t, true
		}
		if _, ok := cachedHashes[hash]; ok {
			t.hit++
		} else {
			t.miss++
		}
		return t, true
	})

	for _, t := range tallies {
		hits += t.hit
		misses += t.miss
		scanErrs += t.bad
	}
	return hits, misses, scanErrs
}

// HealthReportFor 完整体检（审计 + 去重），GUI 绑定与 CLI health-report 同一载荷
