// archive_parse.go：Bedrock Geometry 主解析入口（原 archive.go 拆分，2026-10 文件行数治理）。
// parseModelFromEntries / ParseFromZip / ParseFrom7z / ParseFromZipEntry / ParseFrom7zEntry，
// 及 zip/7z 双份路径收敛（openArchiveBytes / parseModelFromArchive / parseFromArchiveEntry）。
package geometry

import (
	"encoding/json"
	"log"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/types"
)

func parseModelFromEntries(entries []container.Entry, logTag string) (*types.BedrockModel, [][]byte, []string, []geoEntry) {
	logPrefix := "[geometry]"
	if logTag != "zip" {
		logPrefix = logPrefix + " " + logTag
	}

	// maidNs / maidManifest：L0 清单收集（命名空间选择 + 清单提取）已收编 collectMaidManifest
	maidNs, maidManifest := collectMaidManifest(entries, logPrefix)
	// manifest 下标 → 实际解析到的 zip 路径 / 纹理名（resolveL0 填充、SubModels 构建消费）；
	// 由 resolveL0 统一返回非 nil map，无需提前 make
	var resolvedPathByItem map[int]string
	var texNameByItem map[int]string
	var geo *types.BedrockModel
	var pngs [][]byte
	var pngNames []string
	var animJSONs []string

	// ysm.json 统一解析（结构解码共享；口径后处理留在本函数）。metadata 段单独容错：
	// 失败仅忽略（保持零值不挂载），核心解析不受影响。
	md := parseYsmArchive(entries, logPrefix)
	// ysmMeta：ysm.json metadata 段（return 前挂到 geo）；段缺失/解析失败走零值
	ysmMeta := parseYsmMetadataSegment(md.Metadata, logPrefix)

	// model/tex 声明序派生（② 阶段）：player 纹理先、投射物后；modelOrder 与 texOrder 同序
	modelOrder, texOrder, texCategories, projModels := deriveModelTexOrder(*md)

	var geoFiles []geoEntry

	// ===== 1.5 L0 清单先行判定（2026-08-26 审查重构）=====
	// 此前顺序是「collectMergedFiles 全量物化 geo+png → resolveL0 判定」，L0 包
	// 白付一次全量 IO+内存后整套丢弃、applyL0ManifestItem 再把清单引用文件重读
	// 一遍。现改为先探清单：hit 只补收动画字符串（轻量，geo/png 不物化），miss
	// 才走全量遍历——geoFiles/pngs/pngNames/modelOrder/texOrder/texCategories
	// 的最终来源与覆盖判定完全不变。
	l0 := resolveL0(entries, maidNs, maidManifest, logPrefix)
	if l0.hit {
		animJSONs = collectAnimEntriesOnly(entries, maidNs)
		geoFiles = l0.geoFiles
		pngs = l0.pngs
		pngNames = l0.pngNames
		modelOrder = l0.modelOrder
		texOrder = l0.texOrder
		texCategories = l0.texCategories
	} else {
		// 遍历收集 geo/动画/纹理（模型版口径；排 arm）已收编 collectMergedFiles
		geoFiles, animJSONs, pngs, pngNames = collectMergedFiles(entries, maidNs)
	}
	resolvedPathByItem = l0.resolvedPathByItem
	texNameByItem = l0.texNameByItem

	// 移除第一人称手臂模型占位：避免 arm.json 占据 texIdx 槽位导致 main 纹理错位
	modelOrder = filterArmModels(modelOrder)

	// geoFiles 声明序排序（已收编 sortByModelOrder）
	sortByModelOrder(geoFiles, modelOrder)

	// 建立模型文件→纹理索引映射并合并骨骼至 bedModel（已收编 mergeGeoFiles）
	geo = mergeGeoFiles(geoFiles, modelOrder, texOrder, projModels)

	// 纹理声明序排序（已收编 sortByTexOrder；orderMap 供 L0 SubModel.TexSlot 按排序后槽位换算）
	orderMap := sortByTexOrder(texOrder, pngs, pngNames)
	// 纹理名与 pngs 同序（同一循环收集 + 同一 orderMap 排序），供前端纹理列表显示
	if geo != nil {
		geo.TextureNames = pngNames

		// texCategories 与 texOrder 同序，需要按 pngNames 排序后的顺序重排
		if len(texCategories) > 0 && len(texOrder) > 0 {
			geo.TextureCategories = applyTexCategoryOrder(pngNames, texOrder, texCategories)
		}

		// SubModels 清单（L0 manifest 优先 → L1 兜底）已收编 buildSubModels
		buildSubModels(geo, subModelCtx{
			maidManifest:       maidManifest,
			resolvedPathByItem: resolvedPathByItem,
			texNameByItem:      texNameByItem,
			orderMap:           orderMap,
			geoFiles:           geoFiles,
			pngs:               pngs,
		})
	}
	// 顺带返回过滤后的 geoFiles（L0/L1 口径、排 arm）：ParseFromZipEntry 复用同一趟解析
	// 的 geoFiles 做 subPath 匹配，避免二次全量遍历
	if geo != nil && (ysmMeta.Name != "" || ysmMeta.Tips != "" || len(ysmMeta.Authors) > 0 || ysmMeta.License != nil || len(ysmMeta.Links) > 0) {
		geo.Metadata = &ysmMeta
	}
	if geo != nil {
		geo.FileInventory = classifyFileInventory(entries)
	}
	// 旧格式兜底：无 ysm.json（或 ysm.json 无 metadata）时从 info.json 补元数据
	// （Modern YSM parseLegacyFormat 同口径；已挂 metadata 不覆盖）
	if geo != nil && geo.Metadata == nil {
		geo.Metadata = parseLegacyMetadata(entries)
	}
	return geo, pngs, animJSONs, geoFiles
}

// parseYsmMetadataSegment 解析 ysm.json 的 metadata 段（原文由 parseYsmArchive 取出）。
// 单独容错：段缺失或解析失败仅忽略（保持零值不挂载），核心解析不受影响。
// 失败即清零点值回传——Go json 部分填充会残留非 nil 指针（如 License），防误挂载。
func parseYsmMetadataSegment(raw json.RawMessage, logPrefix string) types.YsmMetadata {
	var meta types.YsmMetadata
	if len(raw) == 0 {
		return meta
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		log.Printf("%s metadata 段解析失败（忽略）: %v", logPrefix, err)
		return types.YsmMetadata{}
	}
	return meta
}

// applyTexCategoryOrder 把 texCategories（与 texOrder 同序）重排成与 pngNames 同序：
// 逐个 pngName 在 texOrder 中找对应位置，取同位置的 texCategories；找不到则留空串、
// 下标越界（texOrder 比 texCategories 长）同样留空串。
//
// texOrder 已小写（原内联位置 475/495 行，2026-10 拆解后行号漂移），pngNames 保留 zip
// 原始大小写——比较须大小写不敏感（原注释所指 958/966 行排序比较器均已 ToLower，此处
// 保持口径一致；口径锚点＝sortByTexOrder 与 matchGeoEntryBySubPath 的 ToLower 归一化）。
func applyTexCategoryOrder(pngNames, texOrder, texCategories []string) []string {
	ordered := make([]string, len(pngNames))
	for i, pn := range pngNames {
		lowPn := strings.ToLower(pn)
		for j, tn := range texOrder {
			bn := trimTexExt(tn)
			if bn == lowPn || strings.ToLower(tn) == lowPn {
				if j < len(texCategories) {
					ordered[i] = texCategories[j]
				}
				break
			}
		}
	}
	return ordered
}

// ParseFromZip 从 ZIP 字节中解析 Bedrock Geometry 并提取纹理和动画。
func ParseFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string) {
	geo, pngs, anims, _ := parseModelFromArchive(data, size, false)
	return geo, pngs, anims
}

// ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理。
func ParseFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	geo, pngs, _, _ := parseModelFromArchive(data, size, true)
	return geo, pngs
}

// ParseFromZipEntry 按 subPath（zip 内路径，L0 SubModel.SourcePath 口径）解析单个 geometry 文件。
// 不合并多角色 bones，直接返回单角色 BedrockModel；纹理 pngs 仍全量返回（切换角色只是换骨骼，不换纹理集合）。
// 命中失败 → geo=nil。调用方需自行兜底（如回到全量合并解析）。
//
// subPath 匹配策略（与 L0 SubModel.SourcePath 生成口径一致，三层降级命中）：
//  1. 精确（lower + ToSlash）zip entry 路径命中
//  2. 对 subPath 去掉 "assets/<ns>/" 前缀后，再精确/相对命名空间前缀命中
//  3. basename 模糊（去 .json/.geo.json，或只截取 lastSegment 去后缀，按 geoFiles basename 字典取首条）
func ParseFromZipEntry(data []byte, size int64, subPath string) (*types.BedrockModel, [][]byte) {
	return parseFromArchiveEntry(data, size, subPath, false)
}

// ParseFrom7zEntry 对应 ParseFromZipEntry 的 7z 版本；subPath 匹配策略完全一致。
func ParseFrom7zEntry(data []byte, size int64, subPath string) (*types.BedrockModel, [][]byte) {
	return parseFromArchiveEntry(data, size, subPath, true)
}

// matchGeoEntryBySubPath 从 geoFiles 中挑一个匹配 subPath 的条目。
// subPath 为空 → 未命中。匹配策略：exact ToSlash lower → 命名空间相对 → basename（去 json/geo.json）
func matchGeoEntryBySubPath(geoFiles []geoEntry, subPath string) (geoEntry, bool) {
	if subPath == "" {
		return geoEntry{}, false
	}
	sp := strings.ToLower(filepath.ToSlash(subPath))
	// 1) exact full path
	for _, gf := range geoFiles {
		if strings.ToLower(filepath.ToSlash(gf.name)) == sp {
			return gf, true
		}
	}
	// 2) 命名空间前缀剥离（subPath 形如 assets/droneeee/models/entity/x.json
	//    而 geoFiles 里的 name 也可能写绝对路径或不含 assets 前缀的相对路径——
	//    先去掉 assets/<ns>/ 段再互相比对）
	trimAssets := func(p string) string {
		p = strings.ToLower(filepath.ToSlash(p))
		if strings.HasPrefix(p, "assets/") {
			// 截到第二个 "/" 之后（assets/<ns>/xxx → xxx）
			if rest := strings.TrimPrefix(p, "assets/"); strings.Contains(rest, "/") {
				return rest[strings.Index(rest, "/")+1:]
			}
		}
		// 去掉任意首段 "xxx/"（命名空间前缀去头）
		if idx := strings.Index(p, "/"); idx >= 0 && idx+1 < len(p) {
			return p[idx+1:]
		}
		return p
	}
	spRel := trimAssets(sp)
	if spRel != sp {
		for _, gf := range geoFiles {
			if trimAssets(gf.name) == spRel {
				return gf, true
			}
		}
	}
	// 3) basename 模糊：去 .json/.geo.json 后 basename 相等
	geoBase := func(p string) string {
		p = strings.ToLower(filepath.ToSlash(p))
		if idx := strings.LastIndex(p, "/"); idx >= 0 {
			p = p[idx+1:]
		}
		p = strings.TrimSuffix(p, ".geo.json")
		p = strings.TrimSuffix(p, ".json")
		return p
	}
	spBase := geoBase(sp)
	if spBase == "" {
		return geoEntry{}, false
	}
	for _, gf := range geoFiles {
		if geoBase(gf.name) == spBase {
			return gf, true
		}
	}
	return geoEntry{}, false
}

// IsMainModelName 判断模型文件是否为主组件（main.json / main.geo.json）。
// 导出供 wasm 多组件路径（decodeYSMComponentsViaNodeJS）与 zip 路径统一 main 判定口径。
func IsMainModelName(name string) bool {
	return modelBaseName(name) == "main" || modelBaseName(name) == "main.geo"
}

// ParseComponentsFromZip 多组件解析（YSMViewer 式）：zip 内每个模型文件独立组件，
// 含 arm/载具等组件（不合并、不排除）；main 优先排序，perComponent 独立纹理。
// 供 threejs.BuildMulti 生成多组件 spec。
// ===== zip/7z 双份路径收敛（8-22 功能冲刺遗留的分形重复）=====
// 六入口原先各写 OpenZipBytes/Open7zBytes，7z 失败日志也双份；FileInventory/SubModels/
// projectiles 每上新功能都要 zip/7z 各改一遍。收敛后单一打开点 + 单一实现，改 bug 只改一处。

// openArchiveBytes 统一 zip/7z 字节打开；7z 失败保留日志（对齐历史 ParseFrom7z/Entry 口径）。
func openArchiveBytes(data []byte, size int64, sevenZip bool) (container.Reader, error) {
	if sevenZip {
		r, err := container.Open7zBytes(data, size)
		if err != nil {
			log.Printf("[geometry] 打开 7z 失败: %v", err)
			return nil, err
		}
		return r, nil
	}
	return container.OpenZipBytes(data, size)
}

// archiveLogTag 供 parseModelFromEntries 的 logTag 参数：zip/7z 版统一口径。
func archiveLogTag(sevenZip bool) string {
	if sevenZip {
		return "7z"
	}
	return "zip"
}

// parseModelFromArchive 单模型合并解析统一实现（zip/7z）：open + parseModelFromEntries。
// 返回 (geo, pngs, animJSONs, 过滤后 geoFiles)；ParseFromZip 消费前三者，
// ParseFromZipEntry 复用第 4 位 geoFiles 做 subPath 匹配——签名各自不变。
func parseModelFromArchive(data []byte, size int64, sevenZip bool) (*types.BedrockModel, [][]byte, []string, []geoEntry) {
	r, err := openArchiveBytes(data, size, sevenZip)
	if err != nil {
		return nil, nil, nil, nil
	}
	defer func() { _ = r.Close() }()
	return parseModelFromEntries(r.Entries(), archiveLogTag(sevenZip))
}

// parseFromArchiveEntry 单角色按 subPath 解析统一实现（zip/7z）：open + parseModelFromEntries
// 一趟拿 pngs + 过滤后 geoFiles（不再二次 collectArchiveFiles），再 matchGeoEntryBySubPath。
func parseFromArchiveEntry(data []byte, size int64, subPath string, sevenZip bool) (*types.BedrockModel, [][]byte) {
	if subPath == "" {
		return nil, nil
	}
	r, err := openArchiveBytes(data, size, sevenZip)
	if err != nil {
		return nil, nil
	}
	defer func() { _ = r.Close() }()
	entries := r.Entries()
	// PNG 全量须与 ParseFromZip 同口径：L0 清单过滤（否则 SubModel.TexSlot = i 会指错纹理数组下标）。
	_, pngs, _, geoFiles := parseModelFromEntries(entries, archiveLogTag(sevenZip))
	if len(geoFiles) == 0 {
		return nil, pngs
	}
	if gf, ok := matchGeoEntryBySubPath(geoFiles, subPath); ok {
		g := ParseBedrockGeometry(gf.data)
		if g != nil {
			return g, pngs
		}
	}
	return nil, pngs
}
