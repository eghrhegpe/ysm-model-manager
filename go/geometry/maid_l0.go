// Package geometry 的 maid/l0 清单解析：从 archive.go 拆出（2026-09-06 锐评收口）。
// 职责：maiden 命名空间探测（detectMaidNs / collectMaidManifest / selectBestMaidCandidate）
// 与 l0 manifest 条目解析（l0ResolveModel / l0ResolveTexture / resolveL0 等）。
// archive.go 保留提取/分类/合并排序；本文件只负责 maid 清单语义。
package geometry

import (
	"encoding/json"
	"log"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types/registry"
)

// l0NamedEntry 是 resolveL0 的 basename 模糊匹配索引条目。
// 升格自 resolveL0 内匿名 struct，避免闭包外无法声明类型签名。
type l0NamedEntry struct {
	path string
	e    container.Entry
}

// l0BasenameIndex 封装「basename 索引懒构建」：仅当 resolver 走到 basename 回扫
// 分支（候选字典未命中）时才真正扫描命名空间下 entries，保持原 lazyBuildBasenameIdx
// 的懒语义不提前支付 O(N·basename 拆分) 成本。
type l0BasenameIndex struct {
	entries []container.Entry
	maidNs  string
	geo     map[string][]l0NamedEntry
	png     map[string][]l0NamedEntry
	built   bool
}

// build 执行一次真实构建（幂等，built 后直接返回已构建索引）
func (b *l0BasenameIndex) build() (geo, png map[string][]l0NamedEntry) {
	if b.built {
		return b.geo, b.png
	}
	b.geo = map[string][]l0NamedEntry{}
	b.png = map[string][]l0NamedEntry{}
	for _, e := range b.entries {
		low := strings.ToLower(e.Name())
		if !strings.HasPrefix(low, b.maidNs) {
			continue
		}
		rel := low[len(b.maidNs):]
		if strings.HasSuffix(low, ".json") {
			if registry.IsYsmEntryJSON(filepath.Base(rel)) ||
				strings.HasSuffix(rel, "maid_model.json") ||
				strings.HasSuffix(rel, "maid_chair.json") ||
				strings.HasSuffix(rel, "maid_sound.json") ||
				strings.Contains(rel, "animation") ||
				strings.Contains(rel, "controller") {
				continue
			}
			base := filepath.Base(rel)
			base = strings.TrimSuffix(base, ".geo.json")
			base = strings.TrimSuffix(base, ".json")
			b.geo[base] = append(b.geo[base], l0NamedEntry{path: low, e: e})
		} else if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
			base := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(filepath.Base(rel)))
			b.png[base] = append(b.png[base], l0NamedEntry{path: low, e: e})
		}
	}
	b.built = true
	return b.geo, b.png
}

// detectMaidNs 组件版命名空间选择：与合并版 collectMaidManifest 同口径
// （"最长清单即主包"，selectBestMaidCandidate）——多命名空间包组件视图与
// 合并预览选中的 ns 不再分叉（2026-08-26 审查统一；此前取条目序首个，
// zip 内多清单时两条路径口径分叉）。无 maid_model.json 时返回空串。
func detectMaidNs(entries []container.Entry) string {
	ns, _ := collectMaidManifest(entries, "")
	return ns
}

// jsonEntryPass 判断 entry 是否通过 json 收集前置过滤：非目录 .json、非 ysm 入口、
// 通过 maidNs 命名空间过滤（排除 maid_model/chair/sound 配置）。collectGeoAnimEntries
// 与 collectAnimJSONs 共用，避免过滤逻辑重复（ADR-140 L3）。
func jsonEntryPass(e container.Entry, maidNs string) bool {
	low := strings.ToLower(e.Name())
	if !strings.HasSuffix(low, ".json") || e.IsDir() {
		return false
	}
	if registry.IsYsmEntryJSON(filepath.Base(e.Name())) {
		return false
	}
	// maid-model 命名空间过滤：只处理首个 namespace 的 entity JSON
	if maidNs != "" {
		if !strings.HasPrefix(low, maidNs) || strings.HasSuffix(low, "maid_model.json") || strings.HasSuffix(low, "maid_chair.json") || strings.HasSuffix(low, "maid_sound.json") {
			return false
		}
	}
	return true
}

// collectAnimJSONs 遍历 entries，收集 animation/controller JSON 字符串（geo/png 不物化）。
// 过滤口径（ysm 入口 / maidNs 命名空间 / maid_model·chair·sound 配置）与
// collectGeoAnimEntries 动画分支逐字节一致；ns 过滤置 Open 之前，无 reader 泄漏。
// 供 collectGeoAnimEntries（全量路径）与 collectAnimEntriesOnly（L0 命中路径）共用，
// 避免动画收集逻辑重复（ADR-140 L3）。
func collectAnimJSONs(entries []container.Entry, maidNs string) []string {
	var animJSONs []string
	var totalBytes int64
	for _, e := range entries {
		if !jsonEntryPass(e, maidNs) {
			continue
		}
		low := strings.ToLower(e.Name())
		if !strings.Contains(low, "animation") && !strings.Contains(low, "controller") {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			continue
		}
		// ReadLimitedEntry 内部已 Close；+1 探测，超限返回 nil（ADR-033）
		buf := fsutil.ReadLimitedEntry(rc, maxExtractSize)
		if len(buf) > 2 {
			animJSONs = append(animJSONs, string(buf))
			totalBytes += int64(len(buf))
			// 条目/累计字节双封顶：恶意归档塞 5000 个 ~50MB 动画 JSON → ~250GB 物化到内存，
			// 绕过 512MB 字节封顶——与 collectPngEntries 同构双封顶
			if len(animJSONs) >= maxMaterializeEntries || totalBytes >= maxMaterializeBytes {
				log.Printf("[geometry] collectAnimJSONs 达到物化封顶 (entries=%d bytes=%d), 截断", len(animJSONs), totalBytes)
				break
			}
		}
	}
	return animJSONs
}

// collectGeoAnimEntries 遍历 entries，收集 geometry JSON（geoFiles）和
// animation/controller JSON（animJSONs）。排除 ysm.json 入口、非 maidNs 的文件、
// maid_model/chair/sound 配置 JSON。anim 部分委托 collectAnimJSONs（单一来源），
// 本函数只额外物化 geo（不含 arm 过滤——组件版需要；合并版由调用方 filterArmModels 过滤）。
func collectGeoAnimEntries(entries []container.Entry, maidNs string) ([]geoEntry, []string) {
	animJSONs := collectAnimJSONs(entries, maidNs)
	var geoFiles []geoEntry
	var geoBytes int64
	for _, e := range entries {
		if !jsonEntryPass(e, maidNs) {
			continue
		}
		low := strings.ToLower(e.Name())
		// animation/controller 已由 collectAnimJSONs 收集，这里只物化 geo
		if strings.Contains(low, "animation") || strings.Contains(low, "controller") {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			continue
		}
		buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
		if len(buf) == 0 {
			continue // nil/空 buf 不占物化槽位（F-3 防御）
		}
		geoFiles = append(geoFiles, geoEntry{name: e.Name(), data: buf})
		geoBytes += int64(len(buf))
		// 条目/累计字节双封顶：与 collectPngEntries 同构
		if len(geoFiles) >= maxMaterializeEntries || geoBytes >= maxMaterializeBytes {
			log.Printf("[geometry] collectGeoAnimEntries 达到物化封顶 (entries=%d bytes=%d), 截断", len(geoFiles), geoBytes)
			break
		}
	}
	return geoFiles, animJSONs
}

// collectAnimEntriesOnly 仅收集动画/控制器 JSON 字符串（geo/png 不物化）。
// L0 命中路径专用：清单生效时 geoFiles/pngs 全部由清单派生，全量物化纯属
// 浪费——故本函数只委托 collectAnimJSONs，绝不触碰 geo 物化（无 I/O 回归，
// 与 collectGeoAnimEntries 动画分支逐字节一致）。
func collectAnimEntriesOnly(entries []container.Entry, maidNs string) []string {
	return collectAnimJSONs(entries, maidNs)
}

// collectPngEntries 遍历 entries，收集非 avatar/ 非 gui/ 的 png/jpg 纹理。
// 输出按 pngs[idx] ↔ pngNames[idx] 对齐；文件名已 basename 化并去扩展名。
func collectPngEntries(entries []container.Entry, maidNs string) ([][]byte, []string) {
	var pngs [][]byte
	var pngNames []string
	var totalBytes int64
	for _, e := range entries {
		low := strings.ToLower(e.Name())
		// QF1001 德摩根：!(A && !B && !C && !D) → !A || B || C || D（语义等价，短路更早）
		if (!strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg")) || e.IsDir() || strings.Contains(low, "avatar/") || strings.Contains(low, "gui/") {
			continue
		}
		// maid-model 命名空间过滤：只收集首个 namespace 的纹理
		if maidNs != "" && !strings.HasPrefix(low, maidNs) {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			continue
		}
		pngData := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
		// 与 .ysm 解压路径口径对齐：不按尺寸过滤小纹理（64×64 合法贴图可 <4KB），
		// 头像/预览图仅由 avatar/ 路径与基名前缀排除
		if len(pngData) == 0 {
			continue
		}
		name := baseName(e.Name())
		name = trimTexExt(name)
		pngNames = append(pngNames, name)
		pngs = append(pngs, pngData)
		totalBytes += int64(len(pngData))
		// 条目/累计字节双封顶：恶意归档塞数十万条微小 PNG 可绕过 classifyFileInventory 的条目防线占数 GB 内存——超限截断 + 日志
		if len(pngs) >= maxMaterializeEntries || totalBytes >= maxMaterializeBytes {
			log.Printf("[geometry] collectPngEntries 达到物化封顶 (entries=%d bytes=%d), 截断", len(pngs), totalBytes)
			break
		}
	}
	return pngs, pngNames
}

// maidManifestItem 对应 L0 maid_model.json model[] / model_list[] 的单条
// 支持两种描述形式，两个字段组合使用：
//   - 形式 A（完整路径，老/自定义包）：Model + Texture 直接给出相对路径
//   - 形式 B（model_id，TLM 原生）：ModelID = "namespace:name" → 通过路径字典推断
type maidManifestItem struct {
	Name    string `json:"name"`
	Model   string `json:"model"`    // 相对命名空间根的路径（形式 A）
	Texture string `json:"texture"`  // 相对路径（形式 A）
	ModelID string `json:"model_id"` // TLM 标准："namespace:name"（形式 B）
}

// maidNsCandidate 是单个 maid_model.json 解析后的候选结果
type maidNsCandidate struct {
	ns       string
	manifest []maidManifestItem
	count    int
}

// maidGroupWrapper 对应 maid_model.json 中 pack/chair/decor 分组的两种清单格式
type maidGroupWrapper struct {
	Model     []maidManifestItem `json:"model"`
	ModelList []maidManifestItem `json:"model_list"`
}

// maidManifestRaw 是 maid_model.json 的完整解析结构
// TLM 真实格式：{pack_name, pack:{model_list:[...]}, chair:{model_list:[...]}}
// 自定义简化格式：{model:[...]} 或 {model_list:[...]}
type maidManifestRaw struct {
	Model     []maidManifestItem `json:"model"`
	ModelList []maidManifestItem `json:"model_list"`
	Pack      maidGroupWrapper   `json:"pack"`
	Chair     maidGroupWrapper   `json:"chair"`
	Decor     maidGroupWrapper   `json:"decor"`
}

// collectMaidManifest 遍历所有 maid_model.json，选"清单最长者"为真正的命名空间。
// 从 parseModelFromEntries 的 L0 清单收集子域收编（只搬逻辑、不改行为），
// 返回命名空间前缀（含尾部 /）与清单；无 maid_model.json 时 maidNs 为空、manifest 为 nil。
func collectMaidManifest(entries []container.Entry, logPrefix string) (string, []maidManifestItem) {
	var candidates []maidNsCandidate
	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if strings.HasSuffix(low, "/maid_model.json") {
			if cand, ok := parseMaidModelJSON(e, low); ok {
				candidates = append(candidates, cand)
			}
		}
	}
	var maidNs string
	var maidManifest []maidManifestItem // 非 nil 且 len>0 表示 L0 生效
	if len(candidates) > 0 {
		best := selectBestMaidCandidate(candidates)
		maidNs = best.ns
		maidManifest = best.manifest
		if logPrefix != "" {
			log.Printf("%s maid-model 命名空间: %s（L0 清单 %d 条 / 候选共 %d 个）",
				logPrefix, maidNs, len(maidManifest), len(candidates))
		}
	}
	return maidNs, maidManifest
}

// parseMaidModelJSON 解析单个 maid_model.json 条目为候选。
// low 是已转小写的 e.Name()，用于拆路径取命名空间。
// 解析层级：顶层 / pack / chair / decor 四处都可能含 model/model_list，
// 分别收集，取条目数最大的那个作为此命名空间的清单来源。
func parseMaidModelJSON(e container.Entry, low string) (maidNsCandidate, bool) {
	parts := strings.Split(low, "/")
	if len(parts) < 3 {
		return maidNsCandidate{}, false
	}
	ns := strings.Join(parts[:len(parts)-1], "/") + "/"
	rc, err := e.Open()
	if err != nil {
		return maidNsCandidate{}, false
	}
	buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
	var raw maidManifestRaw
	if json.Unmarshal(buf, &raw) != nil {
		return maidNsCandidate{}, false
	}
	groups := [][]maidManifestItem{
		pickBestMaidGroup(maidGroupWrapper{Model: raw.Model, ModelList: raw.ModelList}),
		pickBestMaidGroup(raw.Pack),
		pickBestMaidGroup(raw.Chair),
		pickBestMaidGroup(raw.Decor),
	}
	bestGroup := groups[0]
	for _, g := range groups[1:] {
		if len(g) > len(bestGroup) {
			bestGroup = g
		}
	}
	return maidNsCandidate{
		ns:       ns,
		manifest: bestGroup,
		count:    len(bestGroup),
	}, true
}

// pickBestMaidGroup 在同一分组的 model[] 与 model_list[] 两种格式中选条目更多者。
// 两字段都空时返回 nil。
func pickBestMaidGroup(g maidGroupWrapper) []maidManifestItem {
	if len(g.Model) >= len(g.ModelList) {
		return g.Model
	}
	return g.ModelList
}

// selectBestMaidCandidate 从候选中选"清单最长者"（启发式：条目数最长 = 主包清单）。
// 候选空时返回零值。
func selectBestMaidCandidate(candidates []maidNsCandidate) maidNsCandidate {
	// 空切片保护，避免 candidates[0] panic
	if len(candidates) == 0 {
		return maidNsCandidate{}
	}
	best := candidates[0]
	for _, c := range candidates[1:] {
		if c.count > best.count {
			best = c
		}
	}
	return best
}

// l0Resolved 是 L0 清单驱动解析的产物。覆盖判定不对称是现状红线：
// geoFiles 等覆盖看 hit（等价旧 len(l0GeoFiles)>0），而 parseModelFromEntries 的
// SubModels 分支只看清单非空——重构时不得"顺手统一"成一致，否则改行为。
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
