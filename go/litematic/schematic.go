package litematic

import (
	"fmt"
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

	w, wok := getInt(root, "Width")
	h, hok := getInt(root, "Height")
	l, lok := getInt(root, "Length")
	if wok && hok && lok && w > 0 && h > 0 && l > 0 {
		result["size"] = []int{w, h, l}
	}

	metaCompound := getCompound(root, "Metadata")
	if metaCompound != nil {
		if author, ok := getString(metaCompound, "Author"); ok {
			result["author"] = author
		}
		if name, ok := getString(metaCompound, "Name"); ok {
			result["name"] = name
		}
	}

	blocksBA, _ := getByteArray(root, "Blocks")
	if blocksBA != nil {
		result["blockCount"] = len(blocksBA)
	}

	paletteCompound := getCompound(root, "Palette")
	if paletteMax, ok := getInt(root, "PaletteMax"); ok {
		result["paletteMax"] = paletteMax
	}
	if paletteCompound != nil {
		result["paletteSize"] = len(paletteCompound)
	}

	if paletteCompound == nil && blocksBA != nil {
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
		result["paletteStats"] = sortedStats(idCounts)
		if m, ok := getString(root, "Materials"); ok {
			result["materials"] = m
		}
	}

	tileEntities := getList(root, "TileEntities")
	if tileEntities != nil {
		result["tileEntityCount"] = len(tileEntities)
	}
	entities := getList(root, "Entities")
	if entities != nil {
		result["entityCount"] = len(entities)
	}

	if len(result) <= 1 {
		return nil
	}
	return result
}
