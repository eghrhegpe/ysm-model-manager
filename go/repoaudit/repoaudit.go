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
package repoaudit

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ysm-model-manager/go/dedup"
	"ysm-model-manager/go/fsutil"
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
	Completeness Completeness    `json:"completeness"`
	Cache        CacheStatus     `json:"cache"`
	Resources    ResourceSummary `json:"resources"`
	Dedup        DedupSummary    `json:"dedup"`
	Warnings     []string        `json:"warnings,omitempty"`
}

// Audit 仓库健康审计核心：资源扫描 + 完整性 + 缓存 + 健康分数 + 警告，一次遍历。
// 这是 repo-audit 与 GUI 绑定 RepoHealthAudit 的唯一实现来源。
// 目录不存在/不可用必须先报错——filepath.Walk 对不存在目录只回错误回调却返回 nil，
// 会静默产出「空报告 = 假绿」（与 dedup.ErrSymlinkRoot 同族陷阱）。
func Audit(dirPath string) (DirAuditResult, error) {
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
	// texturePaths 命中率统计的纹理样本（上限 cacheHitSampleLimit，见 measureCacheHitRate）
	var texturePaths []string
	resources := map[string]int{}
	// 注册表加载提升到 walk 外——per-file TypeByLocation 不再
	// 每文件 LoadRegistry（mutex + 解析开销——大仓库线性放大）
	reg := registry.LoadRegistry()

	err := filepath.WalkDir(dirPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("访问异常: %s (%v)", path, err))
			return nil
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

		// 收集纹理路径供命中率统计（延后到 walk 外并发执行，见 measureCacheHitRate）。
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

	// 缓存状态 + 命中率（真命中率见 measureCacheHitRate：逐纹理哈希查缓存）
	stats := texture_cache.GetCacheStats()
	result.Cache.CacheDir = stats.Dir
	result.Cache.CacheFiles = stats.FileCount
	result.Cache.CacheSize = stats.TotalSize
	result.Cache.ShouldWarn = stats.ShouldWarn

	hits, misses, scanErrs := measureCacheHitRate(texturePaths)
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

// measureCacheHitRate 统计给定纹理列表的缓存命中数/未命中数/探测失败数。
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
func measureCacheHitRate(texturePaths []string) (hits, misses, scanErrs int) {
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

	// 分块并发：按 cacheHitWorkers 切块，每块一个 goroutine 串行处理块内纹理。
	// 为何不用 conc.ParallelCtx：其内部固定 worker=NumCPU（不可外部传），
	// 无法落实本包 cacheHitWorkers 的限流意图（体检是 GUI 交互路径，
	// 不能与用户的前台操作争抢全部 CPU）。切块后并发度显式可控。
	workers := cacheHitWorkers
	if workers < 1 {
		workers = 1
	}
	if workers > len(texturePaths) {
		workers = len(texturePaths)
	}
	chunk := (len(texturePaths) + workers - 1) / workers

	tallies := make([]tally, workers)
	var wg sync.WaitGroup
	for w := range workers {
		start := w * chunk
		end := start + chunk
		if start >= len(texturePaths) {
			break
		}
		if end > len(texturePaths) {
			end = len(texturePaths)
		}
		wg.Add(1)
		go func(w, start, end int) {
			defer wg.Done()
			var t tally
			for _, path := range texturePaths[start:end] {
				hash, err := texture_cache.TextureHash(path)
				if err != nil {
					t.bad++
					continue
				}
				if _, ok := cachedHashes[hash]; ok {
					t.hit++
				} else {
					t.miss++
				}
			}
			tallies[w] = t
		}(w, start, end)
	}
	wg.Wait()

	for _, t := range tallies {
		hits += t.hit
		misses += t.miss
		scanErrs += t.bad
	}
	return hits, misses, scanErrs
}

// HealthReportFor 完整体检（审计 + 去重），GUI 绑定与 CLI health-report 同一载荷
func HealthReportFor(dirPath string) (HealthReport, error) {
	audit, err := Audit(dirPath)
	if err != nil {
		return HealthReport{}, err
	}

	report := HealthReport{
		Timestamp:    audit.Timestamp,
		Directory:    audit.Directory,
		Score:        audit.Score,
		Completeness: audit.Completeness,
		Cache:        audit.Cache,
		Resources:    audit.Resources,
		Warnings:     audit.Warnings,
	}

	groups, err := dedup.FindDuplicateFiles(dirPath, true)
	if err != nil {
		return HealthReport{}, fmt.Errorf("去重扫描失败: %w", err)
	}
	for _, g := range groups {
		report.Dedup.Groups++
		report.Dedup.ExtraFiles += len(g.Files) - 1
		report.Dedup.Reclaim += g.Size * int64(len(g.Files)-1)
	}
	return report, nil
}

// calculateAuditScore 计算健康分数
// 扣分有下限（scoreFloor），避免多问题叠加直接归零失去区分度
func calculateAuditScore(result DirAuditResult) int {
	score := 100

	if result.Completeness.Percentage < 100 {
		score -= int((100 - result.Completeness.Percentage) * 0.5)
	}
	if result.Completeness.Invalid > 0 {
		score -= result.Completeness.Invalid * 5
	}

	if result.Resources.TotalFiles > 0 && result.Cache.CacheFiles == 0 {
		score -= 20 // 没有缓存
	}

	if result.Resources.LargestSize > int64(scoreLargeFileMB)*1024*1024 {
		score -= 10
	}

	if score < scoreFloor {
		score = scoreFloor
	}
	return score
}

// generateAuditWarnings 生成审计警告
func generateAuditWarnings(result *DirAuditResult) {
	if result.Completeness.Percentage < warnCompletenessPct {
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("模型完整性 %.1f%% 低于 %.0f%% 阈值", result.Completeness.Percentage, warnCompletenessPct))
	}
	if result.Resources.TotalFiles > 0 && result.Cache.CacheFiles == 0 {
		result.Warnings = append(result.Warnings,
			"无纹理缓存，首次加载性能可能较慢")
	}
	if result.Resources.LargestSize > int64(warnLargeFileMB)*1024*1024 {
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("存在超大文件 (%s)，可能影响加载性能", fsutil.FormatSize(result.Resources.LargestSize)))
	}
	// 容量「接近上限」预告警：ShouldWarn（>0.8 上限）且未达硬阈值时提示，
	// 与下方「已达」警告错峰，避免 0.8GB~1GB 区间双弹。
	if result.Cache.ShouldWarn && result.Cache.CacheSize <= int64(warnCacheSizeGB)*1024*1024*1024 {
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("缓存大小接近上限 (%s)，建议定期清理", fsutil.FormatSize(result.Cache.CacheSize)))
	}
	if result.Cache.CacheSize > int64(warnCacheSizeGB)*1024*1024*1024 {
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("缓存大小已达 %s，建议定期清理", fsutil.FormatSize(result.Cache.CacheSize)))
	}
}

// modelFileReadLimit 完整性校验单文件读取上限（R34 P3-4 修复）：
// 与 go/ysm readFileLimited、fsutil.ReadLimitedEntry 同族口径——超限文件直接判
// 无效，防数 GB 恶意/损坏 .json/.ysm 全量载入内存（OOM）。包级 var 供测试注入小值。
var modelFileReadLimit int64 = registry.MaxReadLimit

// isModelFileValid 验证模型文件完整性
// .json: 必须合法 JSON 且含 format_version 字段（Bedrock 模型/容器清单均带此字段，
//
//	空对象 {} 或任意数组不再放行——防结构损坏文件被标记「有效」造成完整性假绿）
//
// .ysm: 同 .json 规则（ysm 容器为 format_version + minecraft:geometry 结构）
// 读取经 fsutil.ReadLimitedEntry 限幅（limit+1 探测截断，超限返回 nil → 判无效），
// 数据由本函数关闭。
func isModelFileValid(path, ext string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	// 单点关闭：原实现散落 f.Close() 于各分支，且 json.Unmarshal 失败等早退路径
	// 直接 return 漏关句柄（每次体检按模型数累积泄漏）。defer 统一收口。
	defer func() { _ = f.Close() }()

	st, err := f.Stat()
	if err != nil || st.Size() == 0 {
		return false
	}

	if ext == ".json" || ext == ".ysm" {
		data := fsutil.ReadLimitedEntry(f, modelFileReadLimit)
		if data == nil {
			return false
		}
		var v map[string]interface{}
		if err := json.Unmarshal(data, &v); err != nil {
			return false
		}
		// 最小结构校验：必须含 format_version（或 minecraft:geometry），
		// 拒绝空对象/数组等无意义 JSON
		if _, ok := v["format_version"]; ok {
			return true
		}
		_, hasGeo := v["minecraft:geometry"]
		_, hasBones := v["bones"]
		return hasGeo || hasBones
	}
	return true
}

// Classify 将扩展名映射到注册表资源类型 id（如 "ysm"/"fbx"/"blueprint"）。
// 单一声明者直判——零或多声明者返回 "other"（禁 last-wins，共享扩展名靠
// 扩展名判型本身就是回归根源）。导出供 resource-scan/审计兜底共用。
// 注意：本导出入口每调一次 LoadRegistry（mutex+解析）；per-file 热路径
// （Audit walk / cli resource scan）请用 ClassifyWith 传外层已 hoist 的 reg，
// 避免大仓库线性放大（见 ClassifyWith 注释）。
func Classify(ext string) string {
	return ClassifyWith(registry.LoadRegistry(), ext)
}

// ClassifyWith 使用调用方已 hoist 的注册表实例做扩展名判型（cache hit 时零锁）。
// 背景（code_review 963d4d36 #6/#8/#9）：原实现每次调用都 LoadRegistry 做
// 实例指针比对——mutex+解析在 per-file 路径上线性放大，恰好违反 Audit walk
// 中「注册表加载提升到 walk 外」（本文件 L159-161）的既有收敛。调用方须在
// walk/scan 外 LoadRegistry 一次并传入；缓存仍以实例指针为失效 key，
// SetRegistryPath 重置后新实例自然触发重建。
func ClassifyWith(reg *registry.ResourceTypeRegistry, ext string) string {
	key := strings.ToLower(strings.TrimSpace(ext))
	if raw := extClassifierCache.Load(); raw != nil {
		cl := raw.(*extClassifier)
		if cl.reg == reg {
			if id, ok := cl.extMap[key]; ok {
				return id
			}
			return "other"
		}
	}
	// 缓存未命中或注册表已重置 → 重建（幂等：并发时最后 Store 者胜）
	cl := buildExtClassifierFrom(reg)
	extClassifierCache.Store(cl)
	if id, ok := cl.extMap[key]; ok {
		return id
	}
	return "other"
}
