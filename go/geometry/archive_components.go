// archive_components.go：Bedrock Geometry 多组件解析（原 archive.go 拆分，2026-10 文件行数治理）。
// ParseComponentsFromZip / ParseComponentsFrom7z / parseComponentsFromArchive / buildComponents /
// resolveComponentTexName 等——zip 内每个模型文件独立组件，含 arm/载具，不合并不排除。
package geometry

import (
	"encoding/base64"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/types"
)

func ParseComponentsFromZip(data []byte, size int64) ([]types.BedrockModel, []string, error) {
	return parseComponentsFromArchive(data, size, false)
}

// parseComponentsFromArchive 多组件解析统一实现（zip/7z）：collectArchiveFiles →
// buildComponents → classifyFileInventory。收敛 ParseComponentsFromZip/7z 的分形双份——
// 8-22 FileInventory 下沉后 collect/build/classify 循环在 zip/7z 各写一遍，改一处漏一处
// 即行为分叉（提交 eghrhegpe 0b1ceec0 以来两次同构累积）。
func parseComponentsFromArchive(data []byte, size int64, sevenZip bool) ([]types.BedrockModel, []string, error) {
	r, err := openArchiveBytes(data, size, sevenZip)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = r.Close() }()
	collected := collectArchiveFiles(r.Entries())
	models, texNames := buildComponents(collected.geoFiles, collected.modelOrder, collected.texOrder, collected.pngs, collected.pngNames, collected.modelTexName)
	// 文件归属清单（只识别不解析）：每个组件挂同一容器清单，前端取任一组件即可得
	inv := classifyFileInventory(r.Entries())
	for i := range models {
		models[i].FileInventory = inv // 值类型 range 副本不写回，须按索引
	}
	return models, texNames, nil
}

// buildComponents 组件化收集：每组件独立纹理（ADR-114 perComponent）。
// cube.TexSlot = 0（每组件用自己的第 0 张），不再全局 texOrder 位置分配。
// ComponentTextures[componentName] = [declaredTexBase64]，前端按组件名查纹理。
func buildComponents(geoFiles []geoEntry, modelOrder, texOrder []string, pngs [][]byte, pngNames []string, modelTexName map[string]string) ([]types.BedrockModel, []string) {
	orderMap, pngNameMap := buildOrderAndPngIndex(modelOrder, pngNames)
	sortGeoFilesMainFirst(geoFiles, orderMap, modelOrder)

	var comps []types.BedrockModel
	// texNames = texArr **期望序**（契约校验：前端 texArr 来自元数据，序 = texOrderNames
	// 优先 + 其余按名；texNames[i] = texArr 第 i 个的期望名 = texOrder[i]，越界用 basename）。
	// 注意：texNames 索引是 texArr 连续索引（与组件解析跳过无关——texArr 来自元数据，
	// 不因组件跳过而收缩）；长度 = 成功组件数，契约比对 Math.min 截断，未解析组件槽位不比对。
	texNames := make([]string, 0, len(geoFiles))
	// ADR-114 perComponent：每组件独立纹理，cube.TexSlot=0（用自己的第 0 张）。
	// texOrder 仅用于查"组件声明的纹理名"，不再作为全局槽位索引。
	// compTex 在循环内创建，避免所有组件共享同一个 map 引用（否则每个组件的
	// ComponentTextures 都会包含所有已处理组件的条目）。
	for _, gf := range geoFiles {
		g := ParseBedrockGeometry(gf.data)
		if g == nil || g.BoneCount == 0 {
			continue
		}
		compName := extractCompName(gf.name)
		isArm := IsArmModelName(gf.name)

		// 查组件声明的纹理名：按 basename 直接查 modelTexName 映射，不再依赖 modelOrder 索引。
		// 修复 wine_fox 根因：texOrder 去重后长度 < modelOrder，按索引查表会错位。
		declaredTexName := resolveComponentTexName(compName, gf.name, modelTexName, pngNameMap, isArm)
		texBase64 := encodeTextureBase64(declaredTexName, pngNameMap, pngs)

		// 每组件 cube.TexSlot=0（perComponent，用自己的第 0 张纹理）
		applyPerComponentTexSlot(g)

		// 填 ComponentTextures[compName] = [texBase64]
		// arm 不填（与 main 共用全局 texArr[0] 皮肤，见 isArm 分支注释）
		compTex := make(map[string][]string)
		if texBase64 != "" && !isArm {
			compTex[compName] = []string{texBase64}
		}

		// texNames[i] = 组件声明的纹理名（无声明用 basename）
		// arm 的 texNames 置空（前端 R1 校验跳过空值，arm 走全局 texArr[0]）
		tn := compName
		if declaredTexName != "" {
			tn = declaredTexName
		}
		if isArm {
			tn = ""
		}
		g.SourceName = compName
		g.ComponentTextures = compTex
		texNames = append(texNames, tn)
		comps = append(comps, *g)
	}
	return comps, texNames
}

// buildOrderAndPngIndex 构建 modelOrder 排序索引和 pngNames 名称索引。
// orderMap：model 的 slash 路径 → 在 modelOrder 中的序号（用于稳定排序）；
// 键统一小写（对齐合并版 sortByModelOrder 双侧 ToLower 口径）：Windows 工具
// 产出的混合大小写条目名未归一化会让声明序静默失效退化为字典序（2026-08-26 审查修复）。
// pngNameMap：纹理名（小写 basename 去扩展名）→ pngs 数组索引
func buildOrderAndPngIndex(modelOrder, pngNames []string) (map[string]int, map[string]int) {
	orderMap := make(map[string]int, len(modelOrder))
	for i, p := range modelOrder {
		orderMap[strings.ToLower(filepath.ToSlash(p))] = i
	}
	pngNameMap := make(map[string]int, len(pngNames))
	for i, n := range pngNames {
		pngNameMap[strings.ToLower(n)] = i
	}
	return orderMap, pngNameMap
}

// sortGeoFilesMainFirst 对 geoFiles 做稳定排序：main 优先 + modelOrder 相对序；
// modelOrder 为空（ysm.json 无 player.model 声明或解析失败）时回退
// IsMainModelName 优先 + 路径字典序——与 WASM 路径同口径（P2）。
func sortGeoFilesMainFirst(geoFiles []geoEntry, orderMap map[string]int, modelOrder []string) {
	sort.SliceStable(geoFiles, func(i, j int) bool {
		mi := IsMainModelName(geoFiles[i].name)
		mj := IsMainModelName(geoFiles[j].name)
		if mi != mj {
			return mi
		}
		if len(modelOrder) > 0 {
			ai, oki := orderMap[strings.ToLower(filepath.ToSlash(geoFiles[i].name))]
			aj, okj := orderMap[strings.ToLower(filepath.ToSlash(geoFiles[j].name))]
			if oki && okj {
				return ai < aj
			}
			if oki != okj {
				return oki
			}
		}
		return geoFiles[i].name < geoFiles[j].name
	})
}

// trimTexExt 去纹理扩展名（.png/.jpg，区分大小写后缀原样剥离）。
// 全文多处「basename 化 + 去扩展」链的公共尾原子；是否 ToLower/basename 由调用点自定。
func trimTexExt(s string) string {
	return strings.TrimSuffix(strings.TrimSuffix(s, ".png"), ".jpg")
}

// compBaseName 组件基名：去路径分隔符（/ 与 \ 兼容）+ 去 .geo.json/.json 后缀，保留大小写。
// 与 modelBaseName 差异：后者小写化且只去 .json（保留 .geo 供 IsArmModelName/IsMainModelName
// 判定），勿合并——extractCompName 与 mergeGeoFiles 的 modelTexName 构建共用（2026-09 锐评收口）。
// 注意：TrimSuffix 顺序必须 .geo.json 先、.json 后（"x.geo.json"→"x"）；mergeGeoFiles 的
// modelOrder 分支（.json 先、.geo.json 后）与此不同，勿顺手复用。
func compBaseName(path string) string {
	name := baseName(path)
	return strings.TrimSuffix(strings.TrimSuffix(name, ".geo.json"), ".json")
}

// extractCompName 从 geoEntry 路径提取组件名（去目录、去 .geo.json/.json 扩展名）。
// 例：models/entity/foxcar.geo.json → foxcar；arm.json → arm
func extractCompName(entryName string) string {
	return compBaseName(filepath.ToSlash(entryName))
}

// resolveComponentTexName 解析组件声明的纹理名，返回可直接查 pngNameMap 的 key。
// 四级 fallback（按优先级）：
//  1. modelTexName[完整 slash 路径] — ysm.json 精确声明
//  2. modelTexName[compName] — 路径前缀被 strip 时按 basename 兜底
//  3. pngNameMap[compName] — 未声明时同名纹理兜底（对齐 YSMViewer 每组件独立纹理）
//  4. pngNameMap 前缀匹配（_ / - 分隔）— maid_model 多合一包后缀 _1/_2/_3
//
// arm 组件直接返回空串（与 main 共用全局 player.texture，不走 perComponent 纹理）。
// 三叉戟灰根因修复：投射物/子组件未声明纹理时 compTex 曾无条目——本函数第 3 级兜底补上。
func resolveComponentTexName(compName, entryName string, modelTexName map[string]string, pngNameMap map[string]int, isArm bool) string {
	if isArm {
		return ""
	}
	declaredTexName := ""
	if modelTexName != nil {
		declaredTexName = modelTexName[filepath.ToSlash(entryName)]
	}
	// fallback：按 compName 查（path 前缀可能被 strip，如 "models/foxcar.json" → 查不到）
	if declaredTexName == "" && modelTexName != nil {
		declaredTexName = modelTexName[compName]
	}
	if declaredTexName != "" {
		return declaredTexName
	}
	// 未声明纹理的组件：同名 basename 纹理兜底
	if _, ok := pngNameMap[compName]; ok {
		return compName
	}
	// 前缀匹配兜底：maid_model 多合一女仆包纹理名带 _1/_2/_3 后缀
	// （asuma_toki → asuma_toki_1）。候选收集后按字典序取最小——map 迭代序
	// 随机，直接 for-range 首个命中会让同一输入不同运行绑到不同纹理
	// （确定性修复，与 parse.go geometry.* 键选取同口径）
	compLower := strings.ToLower(compName)
	var hits []string
	for pn := range pngNameMap {
		if strings.HasPrefix(pn, compLower+"_") || strings.HasPrefix(pn, compLower+"-") {
			hits = append(hits, pn)
		}
	}
	if len(hits) > 0 {
		sort.Strings(hits)
		return hits[0]
	}
	return ""
}

// sniffTexMime 嗅探纹理字节魔数选 MIME（PNG/JPEG 双后缀支持）。
// collectPngEntries 收集时已去扩展名，pngNameMap 键不含后缀——不能靠名字选 MIME，
// 只能嗅探字节头（浏览器渲染 data URL 同样按字节嗅探，行为一致）。
// 未知魔数回退 image/png：保持旧行为（测试假数据/非标准格式仍走 png 前缀）。
func sniffTexMime(data []byte) string {
	if len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n" {
		return "image/png"
	}
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return "image/jpeg"
	}
	return "image/png"
}

// encodeTextureBase64 按声明的纹理名查 pngNameMap，找到即编码为 data URL。
// MIME 按字节魔数嗅探选型（sniffTexMime）：jpg 纹理不再统一错标 image/png。
// 未命中或 declaredTexName 为空时返回空串。
func encodeTextureBase64(declaredTexName string, pngNameMap map[string]int, pngs [][]byte) string {
	if declaredTexName == "" {
		return ""
	}
	idx, ok := pngNameMap[declaredTexName]
	if !ok || idx >= len(pngs) {
		return ""
	}
	return "data:" + sniffTexMime(pngs[idx]) + ";base64," + base64.StdEncoding.EncodeToString(pngs[idx])
}

// applyPerComponentTexSlot 把模型内所有 cube 的 TexSlot 置 0（ADR-114 perComponent：
// 每组件用自己的第 0 张纹理），同时把 CubeTexW/CubeTexH 对齐模型级尺寸。
func applyPerComponentTexSlot(g *types.BedrockModel) {
	for bi := range g.Bones {
		for ci := range g.Bones[bi].Cubes {
			g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
			g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
			g.Bones[bi].Cubes[ci].TexSlot = 0
		}
	}
}

// ParseComponentsFrom7z 多组件解析（7z 版）：与 ParseComponentsFromZip 同构，
// 复用 parseComponentsFromArchive（含 arm、main 优先、perComponent 独立纹理）。
func ParseComponentsFrom7z(data []byte, size int64) ([]types.BedrockModel, []string, error) {
	return parseComponentsFromArchive(data, size, true)
}
