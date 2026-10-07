// Package geometry 的 maid/l0 清单解析：从 archive.go 拆出（2026-09-06 锐评收口）。
// 职责：maiden 命名空间探测（detectMaidNs / collectMaidManifest / selectBestMaidCandidate）
// 与 l0 manifest 条目解析（l0ResolveModel / l0ResolveTexture / resolveL0 等）。
// archive.go 保留提取/分类/合并排序；本文件只负责 maid 清单语义。
// 2026-10 二次拆分：manifest 收集移入 maid_l0_manifest.go，l0 条目解析移入 maid_l0_resolve.go。
package geometry

import (
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
