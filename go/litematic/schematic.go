package litematic

import (
	"fmt"

	"ysm-model-manager/go/types/registry"
)

// ParseSchematicSummary 解析 WorldEdit schematic（.schem）摘要。
// 返回裸 map 是历史契约：前端按 key 消费且字段高度可选，强类型化收益低
// （与 ParseMeta 的 struct 返回不一致是有意的——那边字段全集固定）。
func ParseSchematicSummary(path string) map[string]interface{} {
	root, err := openGzRoot(path)
	if err != nil {
		return nil
	}

	result := map[string]interface{}{}

	if v, ok := getInt(root, "Version"); ok {
		result["version"] = v
	}
	if v, ok := getInt(root, "DataVersion"); ok {
		result["dataVersion"] = v
	}
	if size, ok := schematicSize(root); ok {
		result["size"] = size
	}

	if metaCompound := getCompound(root, "Metadata"); metaCompound != nil {
		addSchematicMetadata(result, metaCompound)
	}

	blocksBA, _ := getByteArray(root, "Blocks")
	if blocksBA != nil {
		result["blockCount"] = len(blocksBA)
	}

	addSchematicPaletteFields(root, result, blocksBA)

	if tileEntities := getList(root, "TileEntities"); tileEntities != nil {
		result["tileEntityCount"] = len(tileEntities)
	}
	if entities := getList(root, "Entities"); entities != nil {
		result["entityCount"] = len(entities)
	}

	if len(result) <= 1 {
		return nil
	}
	return result
}

// schematicSize 提取 Width/Height/Length：三者齐备且均为正才视为有效尺寸
// （缺一或非正即 false，不写入 size）。
func schematicSize(root map[string]any) ([]int, bool) {
	w, wok := getInt(root, "Width")
	h, hok := getInt(root, "Height")
	l, lok := getInt(root, "Length")
	if wok && hok && lok && w > 0 && h > 0 && l > 0 {
		return []int{w, h, l}, true
	}
	return nil, false
}

// addSchematicMetadata 写入 Metadata.Author / Metadata.Name（缺失的键不写）。
func addSchematicMetadata(result map[string]interface{}, metaCompound map[string]any) {
	if author, ok := getString(metaCompound, "Author"); ok {
		result["author"] = author
	}
	if name, ok := getString(metaCompound, "Name"); ok {
		result["name"] = name
	}
}

// addSchematicPaletteFields 写入调色板相关字段：PaletteMax 独立可存在；Palette
// compound 存在则写 paletteSize（新版 v2，方块统计由 Palette 承担）；Palette 缺失
// 而 Blocks 存在时（v1 旧格式）改按 ID 字节流统计，并提取 Materials。
func addSchematicPaletteFields(root map[string]any, result map[string]interface{}, blocksBA []byte) {
	paletteCompound := getCompound(root, "Palette")
	if paletteMax, ok := getInt(root, "PaletteMax"); ok {
		result["paletteMax"] = paletteMax
	}
	if paletteCompound != nil {
		result["paletteSize"] = len(paletteCompound)
		return
	}
	if blocksBA == nil {
		return
	}
	result["paletteStats"] = schematicBlockIDStats(root, blocksBA)
	if m, ok := getString(root, "Materials"); ok {
		result["materials"] = m
	}
}

// schematicBlockIDStats 旧版 schematic（无 Palette）的逐块统计：
// blocksBA[i] 为方块 ID、Data[i]（可缺）为数据值；id=0 是空气跳过；
// ResolveBlockName 未命中时按 `ID:%d[:%d]` 兜底命名，命中则转中文名。
func schematicBlockIDStats(root map[string]any, blocksBA []byte) []registry.LitematicBlockStat {
	dataBA, _ := getByteArray(root, "Data")
	idCounts := map[string]int{}
	for i, id := range blocksBA {
		if id == 0 {
			continue
		}
		var d byte
		if dataBA != nil && i < len(dataBA) {
			d = dataBA[i]
		}
		name := ResolveBlockName(int(id), d)
		if name == "" {
			if d != 0 {
				name = fmt.Sprintf("ID:%d:%d", id, d)
			} else {
				name = fmt.Sprintf("ID:%d", id)
			}
		} else {
			name = ResolveBlockZH(name)
		}
		idCounts[name]++
	}
	return sortedStats(idCounts)
}
