// maid_l0_resolve.go：l0 manifest 条目解析（原 maid_l0.go 拆分，2026-10 文件行数治理）。
// l0Resolved / l0BuildPathIndex / l0ExtractName / l0StripNsPrefix / l0TryCandidates /
// l0ResolveModel / l0ResolveTexture / applyL0ManifestItem / resolveL0——
// basename 模糊匹配 + 命名空间前缀剥离 + 模型/纹理路径解析。
package geometry

import (
	"log"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
)

type l0Resolved struct {
	geoFiles           []geoEntry
	pngs               [][]byte
	pngNames           []string
	modelOrder         []string
	texOrder           []string
	texCategories      []string
	resolvedPathByItem map[int]string
	texNameByItem      map[int]string
	hit                bool
}

// ----- resolveL0 子函数（升格自原闭包 2026-08-25）-----

// l0ModelCandidates / l0TextureCandidates：model_id 推断时的候选路径模板，
// 按"真实包常见度"排序，找到第一个存在的 zip entry 即停。升格为包级 var
// 仅因 resolveL0Model/resolveL0Texture 两 resolver 对称共享，不改变语义。
var l0ModelCandidates = []string{
	"models/entity/<N>.json",
	"models/main/<N>.json",
	"models/<N>.json",
	"models/entity/<N>.geo.json",
	"geckolib/models/entity/<N>.json",
	"models/block/<N>.json",
	"<N>.json",
}
var l0TextureCandidates = []string{
	"textures/entity/<N>.png",
	"textures/main/<N>.png",
	"textures/<N>.png",
	"geckolib/textures/entity/<N>.png",
	"textures/entity/<N>.jpg",
}

// l0BuildPathIndex 把 entries 按「小写 zip 绝对路径」建 O(1) 索引。
// 纯搬移原 resolveL0 头部的 entryByPath 构建循环。
func l0BuildPathIndex(entries []container.Entry) map[string]container.Entry {
	m := make(map[string]container.Entry, len(entries))
	for _, e := range entries {
		m[strings.ToLower(e.Name())] = e
	}
	return m
}

// l0ExtractName 从 model_id "ns:name" 取 name 部分；空则返回 fallback。
// 纯函数（原闭包 extractName 升格）。
func l0ExtractName(modelID, fallback string) string {
	if modelID == "" {
		return fallback
	}
	if idx := strings.Index(modelID, ":"); idx >= 0 {
		return modelID[idx+1:]
	}
	return modelID
}

// l0StripNsPrefix 若 value 形如 "nsBase:path" 且 path 非绝对路径，
// 去掉 nsBase: 前缀后返回 path；否则原样透传。对应 droneeee 一类的混合写法：
// "model": "droneeee:models/entity/x.json"。纯函数（原闭包 stripNsPrefix 升格）。
func l0StripNsPrefix(value, nsBase string) string {
	if nsBase == "" || value == "" {
		return value
	}
	if idx := strings.Index(value, ":"); idx >= 0 {
		if value[:idx] == nsBase && !filepath.IsAbs(value[idx+1:]) {
			return value[idx+1:]
		}
	}
	return value
}

// l0TryCandidates 从候选模板（含 <N> 占位）里找第一个存在的 zip entry。
// 返回 (entry, 小写 absPath, 是否命中)。原闭包 tryCandidates 升格。
func l0TryCandidates(baseName string, templates []string, maidNs string,
	entryByPath map[string]container.Entry) (container.Entry, string, bool) {
	for _, t := range templates {
		rel := strings.ReplaceAll(t, "<N>", baseName)
		abs := strings.ToLower(maidNs + strings.TrimPrefix(rel, "/"))
		if e, ok := entryByPath[abs]; ok {
			return e, abs, true
		}
	}
	return nil, "", false
}

// l0ResolveModel 解析 L0 条目的模型路径，返回 zip 内小写绝对路径（空=未命中）。
// 优先级：形式 A 显式路径 → model_id 候选字典 → basename 模糊回扫。
// 原闭包 resolveL0Model 升格：basename 索引由 bIdx.build() 懒构建保留原语义。
func l0ResolveModel(item maidManifestItem, maidNs, nsBase, logPrefix string,
	entryByPath map[string]container.Entry, bIdx *l0BasenameIndex) string {
	modelRel := l0StripNsPrefix(item.Model, nsBase)
	if modelRel != "" {
		modelAbs := strings.ToLower(maidNs + strings.TrimPrefix(filepath.ToSlash(modelRel), "/"))
		if _, ok := entryByPath[modelAbs]; ok {
			log.Printf("%s L0 形式A 模型: %s → %s", logPrefix, item.Model, modelAbs)
			return modelAbs
		}
	}
	mid := item.ModelID
	if mid == "" && strings.Contains(item.Model, ":") && !filepath.IsAbs(item.Model) {
		mid = item.Model
	}
	if mid != "" {
		namePart := l0ExtractName(mid, "")
		if namePart != "" {
			if _, abs, hit := l0TryCandidates(namePart, l0ModelCandidates, maidNs, entryByPath); hit {
				log.Printf("%s L0 形式B 模型(候选): %s → %s", logPrefix, mid, abs)
				return abs
			}
			geoIdx, _ := bIdx.build()
			if match, ok := geoIdx[namePart]; ok && len(match) > 0 {
				log.Printf("%s L0 形式B 模型(basename回扫): %s → %s", logPrefix, mid, match[0].path)
				return match[0].path
			}
			log.Printf("%s L0 模型未命中: %s", logPrefix, mid)
		}
	}
	return ""
}

// l0ResolveTexture 解析 L0 条目的纹理路径，返回 zip 内小写绝对路径（空=未命中）。
// 优先级：形式 A 显式路径 → model_id 候选字典 → basename 模糊回扫。
// 原闭包 resolveL0Texture 升格：与 l0ResolveModel 三段回退链严格对称。
func l0ResolveTexture(item maidManifestItem, maidNs, nsBase, logPrefix string,
	entryByPath map[string]container.Entry, bIdx *l0BasenameIndex) string {
	textureRel := l0StripNsPrefix(item.Texture, nsBase)
	if textureRel != "" {
		texAbs := strings.ToLower(maidNs + strings.TrimPrefix(filepath.ToSlash(textureRel), "/"))
		if _, ok := entryByPath[texAbs]; ok {
			log.Printf("%s L0 形式A 纹理: %s → %s", logPrefix, item.Texture, texAbs)
			return texAbs
		}
	}
	mid := item.ModelID
	if mid != "" {
		namePart := l0ExtractName(mid, "")
		if namePart != "" {
			if _, abs, hit := l0TryCandidates(namePart, l0TextureCandidates, maidNs, entryByPath); hit {
				log.Printf("%s L0 形式B 纹理(候选): %s → %s", logPrefix, mid, abs)
				return abs
			}
			_, pngIdx := bIdx.build()
			if match, ok := pngIdx[namePart]; ok && len(match) > 0 {
				log.Printf("%s L0 形式B 纹理(basename回扫): %s → %s", logPrefix, mid, match[0].path)
				return match[0].path
			}
			log.Printf("%s L0 纹理未命中: %s", logPrefix, mid)
		}
	}
	return ""
}

// applyL0ManifestItem 把单条 manifest 的解析结果（modelAbs/texAbs）落实到 res
// 数组：两段 Open→Read→append 对称代码原在主循环内联各写一份，现在合并。
// 行为逐字节保持原循环：Open 失败静默跳、buf 为空跳、ARM 模型被 IsArmModelName
// 排除、纹理 pngNames 取 LastIndex("/") 后缀、texNameByItem 小写——一处不动。
// 例外：Open 失败补日志——manifest 条目存在但读不了属真 I/O 故障，静默吞掉会让损坏包难排障；
// 条目缺席（entryByPath miss）仍静默（清单路径缺失是正常可预期的落空，逐作者 log 会刷屏）。
func applyL0ManifestItem(res *l0Resolved, i int, maidNs, logPrefix string,
	entryByPath map[string]container.Entry, modelAbs, texAbs string) {
	if modelAbs != "" {
		if e, ok := entryByPath[modelAbs]; ok {
			if rc, err := e.Open(); err == nil {
				buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
				if len(buf) > 0 && !IsArmModelName(e.Name()) {
					res.geoFiles = append(res.geoFiles, geoEntry{name: e.Name(), data: buf})
					res.modelOrder = append(res.modelOrder, modelAbs[len(maidNs):])
					res.resolvedPathByItem[i] = modelAbs
				}
			} else {
				log.Printf("%s L0 模型条目 Open 失败 %s: %v", logPrefix, modelAbs, err)
			}
		}
	}
	if texAbs != "" {
		if e, ok := entryByPath[texAbs]; ok {
			if rc, err := e.Open(); err == nil {
				pngData := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
				if len(pngData) > 0 {
					tn := e.Name()
					if idx := strings.LastIndex(tn, "/"); idx >= 0 {
						tn = tn[idx+1:]
					}
					tn = strings.TrimSuffix(tn, filepath.Ext(tn))
					res.pngs = append(res.pngs, pngData)
					res.pngNames = append(res.pngNames, tn)
					res.texOrder = append(res.texOrder, strings.ToLower(filepath.Base(texAbs)))
					res.texNameByItem[i] = strings.ToLower(tn)
				}
			} else {
				log.Printf("%s L0 纹理条目 Open 失败 %s: %v", logPrefix, texAbs, err)
			}
		}
	}
}

// resolveL0 从 L0 清单派生 geoFiles/pngs/modelOrder/texOrder（权威顺序），只收清单引用的条目。
// 从 parseModelFromEntries 的 L0 解析+覆盖子域收编（只搬逻辑、不改行为）；manifest 为空返回零值。
func resolveL0(entries []container.Entry, maidNs string, manifest []maidManifestItem, logPrefix string) l0Resolved {
	if len(manifest) == 0 {
		return l0Resolved{resolvedPathByItem: map[int]string{}, texNameByItem: map[int]string{}}
	}
	// 入口只做四件事：①建路径索引 / ②实例化懒 basename 索引（不立刻扫）
	// ③算 nsBase / ④预分配 + 调子函数。主循环 ~12 行，纯调度。
	entryByPath := l0BuildPathIndex(entries)
	bIdx := &l0BasenameIndex{entries: entries, maidNs: maidNs}

	var nsBase string
	if strings.HasPrefix(maidNs, "assets/") {
		nsBase = strings.TrimPrefix(maidNs, "assets/")
		nsBase = strings.TrimSuffix(nsBase, "/")
	}

	res := l0Resolved{
		geoFiles:           make([]geoEntry, 0, len(manifest)),
		pngs:               make([][]byte, 0, len(manifest)),
		pngNames:           make([]string, 0, len(manifest)),
		modelOrder:         make([]string, 0, len(manifest)),
		texOrder:           make([]string, 0, len(manifest)),
		resolvedPathByItem: make(map[int]string, len(manifest)),
		texNameByItem:      make(map[int]string, len(manifest)),
	}

	for i, item := range manifest {
		modelAbs := l0ResolveModel(item, maidNs, nsBase, logPrefix, entryByPath, bIdx)
		texAbs := l0ResolveTexture(item, maidNs, nsBase, logPrefix, entryByPath, bIdx)
		applyL0ManifestItem(&res, i, maidNs, logPrefix, entryByPath, modelAbs, texAbs)
	}

	// 只有清单至少命中了 1 个模型才用 L0 覆盖（空命中视为清单与 zip 内容脱节，回退 L1）。
	// texCategories 同步重建（统一 "player"）——命中判定 + 分类两条规则保留逐字节原行为。
	if len(res.geoFiles) > 0 {
		res.hit = true
		res.texCategories = make([]string, len(res.texOrder))
		for i := range res.texCategories {
			res.texCategories[i] = "player"
		}
	}
	return res
}
