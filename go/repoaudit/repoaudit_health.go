// repoaudit_health.go：仓库完整体检（原 repoaudit.go 拆分，2026-10 文件行数治理）。
// HealthReportFor / calculateAuditScore / generateAuditWarnings / isModelFileValid / Classify / ClassifyWith——
// 审计 + 去重 + 评分 + 告警，GUI 体检绑定与 CLI health-report 共用。
package repoaudit

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"ysm-model-manager/go/dedup"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types/registry"
)

func HealthReportFor(dirPath string) (HealthReport, error) {
	return HealthReportForCtx(context.Background(), dirPath)
}

// HealthReportForCtx ctx 版（ADR-314）：审计与去重全链贯穿可取消 ctx。
func HealthReportForCtx(ctx context.Context, dirPath string) (HealthReport, error) {
	audit, err := AuditCtx(ctx, dirPath)
	if err != nil {
		return HealthReport{}, err
	}

	report := HealthReport{
		Timestamp:    audit.Timestamp,
		Directory:    audit.Directory,
		Score:        audit.Score,
		Verdict:      ScoreVerdict(audit.Score),
		Completeness: audit.Completeness,
		Cache:        audit.Cache,
		Resources:    audit.Resources,
		Warnings:     audit.Warnings,
	}

	groups, err := dedup.FindDuplicateFilesCtx(ctx, dirPath, true)
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
