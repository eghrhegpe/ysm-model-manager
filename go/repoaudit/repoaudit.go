// Package repoaudit 仓库健康审计核心——GUI 绑定层与 CLI 共用（防双轨口径漂移）。
//
// 历史：审计逻辑原在 go/cli（resource.go collectRepoHealth），GUI 侧如果自算一套
// 会形成「前端算一遍、CLI 算一遍」的双轨（roadmap 方向 A 遗留）。本包把审计核心
// 抽成独立层：cli 与 internal/app 绑定都调同一实现，后续审计口径只改这一处。
package repoaudit

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/dedup"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
)

// extToTypeID 预计算的 ext→注册表类型 id 映射，避免 Classify 热路径每文件遍历注册表。
// sync.Once 延迟构建——首次 Classify 调用时初始化。
var (
	extToTypeID   map[string]string
	extToTypeIDMu sync.Once
)

func initExtMap() {
	count := make(map[string]int)
	owner := make(map[string]string)
	reg := types.LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		for _, e := range rt.EffectiveExtensions() {
			low := strings.ToLower(e)
			count[low]++
			owner[low] = rt.ID
		}
	}
	extToTypeID = make(map[string]string)
	for e, n := range count {
		if n == 1 {
			extToTypeID[e] = owner[e]
		}
	}
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

// Result 仓库审计结果（结构对齐原 go/cli repoAuditResult）
type Result struct {
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
type CacheStatus struct {
	CacheDir   string  `json:"cache_dir"`
	CacheFiles int     `json:"cache_files"`
	CacheSize  int64   `json:"cache_size"`
	HitRate    float64 `json:"hit_rate"`
	Hits       int     `json:"hits"`
	Misses     int     `json:"misses"`
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
func Audit(dirPath string) (Result, error) {
	if st, err := os.Stat(dirPath); err != nil {
		return Result{}, fmt.Errorf("审计目录不可用 %q: %w", dirPath, err)
	} else if !st.IsDir() {
		return Result{}, fmt.Errorf("审计目标不是目录: %s", dirPath)
	}

	result := Result{
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		Directory:    dirPath,
		Completeness: Completeness{},
		Cache:        CacheStatus{},
		Resources: ResourceSummary{
			ByType: make(map[string]int),
		},
		Warnings: make([]string, 0),
	}

	// 1. 资源扫描 + 完整性检查（一次遍历）
	var totalSize int64
	var largestFile string
	var largestSize int64
	resources := map[string]int{}
	// code review P3：注册表加载提升到 walk 外——per-file TypeByLocation 不再
	// 每文件 LoadRegistry（mutex + 解析开销——大仓库线性放大）
	reg := types.LoadRegistry()

	err := filepath.WalkDir(dirPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("访问异常: %s (%v)", path, err))
			return nil
		}
		// 符号链接守卫：拒绝根目录符号链接，跳过子树内符号链接（与 dedup 包对齐）
		if d.Type()&os.ModeSymlink != 0 {
			// R34 P2-3：filepath.WalkDir 内部对 root 做 Clean，
			// 传入的 dirPath 可能含尾斜杠/.. 而未 clean，导致 path != dirPath 比较失败，
			// 根符号链接被静默跳过。对 dirPath 先 Clean 再比较。
			if path == filepath.Clean(dirPath) {
				return fmt.Errorf("审计根目录是符号链接: %s", dirPath)
			}
			return nil
		}
		if d.IsDir() {
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

		// 禁用文件统计：单一口径 types.IsDisableSuffix（.disabled/.ban，大小写不敏感）
		if types.IsDisableSuffix(d.Name()) {
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
		typeName := types.TypeByLocation(path, reg)
		if typeName == "" {
			if types.IsContainerExt(ext) {
				typeName = "container"
			} else {
				typeName = Classify(ext)
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

	// 缓存状态 + 命中率估算（以模型文件数为基准）
	stats := texture_cache.GetCacheStats()
	result.Cache.CacheDir = stats.Dir
	result.Cache.CacheFiles = stats.FileCount
	result.Cache.CacheSize = stats.TotalSize

	// 缓存命中率：缓存文件数 / 仓库总文件数（口径稳定，不依赖类型分类）
	totalFiles := result.Resources.TotalFiles
	if totalFiles > 0 {
		hitRate := float64(stats.FileCount) / float64(totalFiles) * 100
		if hitRate > 100 {
			hitRate = 100
		}
		result.Cache.HitRate = hitRate
		result.Cache.Hits = stats.FileCount
		result.Cache.Misses = totalFiles - stats.FileCount
		if result.Cache.Misses < 0 {
			result.Cache.Misses = 0
		}
	}

	// 健康分数 + 警告
	result.Score = calculateAuditScore(result)
	generateAuditWarnings(&result)

	return result, nil
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
func calculateAuditScore(result Result) int {
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
func generateAuditWarnings(result *Result) {
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
			fmt.Sprintf("存在超大文件 (%s)，可能影响加载性能", formatSize(result.Resources.LargestSize)))
	}
	if result.Cache.CacheSize > int64(warnCacheSizeGB)*1024*1024*1024 {
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("缓存大小已达 %s，建议定期清理", formatSize(result.Cache.CacheSize)))
	}
}

// isModelFileValid 验证模型文件完整性
// .json: 必须合法 JSON 且含 format_version 字段（Bedrock 模型/容器清单均带此字段，
//
//	空对象 {} 或任意数组不再放行——防结构损坏文件被标记「有效」造成完整性假绿）
//
// .ysm: 同 .json 规则（ysm 容器为 format_version + minecraft:geometry 结构）
func isModelFileValid(path, ext string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil || st.Size() == 0 {
		return false
	}

	if ext == ".json" || ext == ".ysm" {
		var v map[string]interface{}
		dec := json.NewDecoder(f)
		if err := dec.Decode(&v); err != nil {
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
func Classify(ext string) string {
	extToTypeIDMu.Do(initExtMap)
	id, ok := extToTypeID[strings.ToLower(strings.TrimSpace(ext))]
	if !ok {
		return "other"
	}
	return id
}

// formatSize 人性化字节大小——委托至 fsutil.FormatSize（单一事实来源）。
func formatSize(bytes int64) string { return fsutil.FormatSize(bytes) }
