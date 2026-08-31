package litematic

// ParseNbtStructure 解析 Java 版 structure NBT（.nbt 结构方块保存）摘要。
// 基岩版 1.21+ 多子结构格式（sub_levels）分流到 bedrock.go 的 parseBedrockStructure；
// 体素渲染侧对应 BuildNbtVoxelData / buildBedrockVoxelData（voxel.go）。
func ParseNbtStructure(path string) map[string]interface{} {
	root, err := openGzRoot(path)
	if err != nil {
		return nil
	}

	// 基岩版 1.21+ structure 新格式（origin/sub_levels 多子结构）：根含 sub_levels 时走聚合分支
	if subLevels := getList(root, "sub_levels"); subLevels != nil {
		return parseBedrockStructure(root, subLevels)
	}

	sizeList := getList(root, "size")
	blocksList := getList(root, "blocks")
	paletteList := getList(root, "palette")
	entitiesList := getList(root, "entities")
	if sizeList == nil && blocksList == nil && paletteList == nil {
		return nil
	}

	result := map[string]interface{}{}
	if v, ok := getInt(root, "DataVersion"); ok {
		result["dataVersion"] = v
	}
	if len(sizeList) == 3 {
		sx, sxOk := sizeList[0].(int32)
		sy, syOk := sizeList[1].(int32)
		sz, szOk := sizeList[2].(int32)
		// P3-2：三元素任一类型断言失败或零尺寸则不设 size，
		// 避免前端拿到全零 size 渲染异常、下游 voxel 除零。
		if sxOk && syOk && szOk && sx > 0 && sy > 0 && sz > 0 {
			result["size"] = []int{int(sx), int(sy), int(sz)}
		}
	}
	if blocksList != nil {
		result["blockCount"] = len(blocksList)
	}
	if entitiesList != nil {
		result["entityCount"] = len(entitiesList)
	}
	if paletteList != nil {
		counts := map[string]int{}
		for _, name := range extractPaletteNames(paletteList) {
			if name != "" {
				counts[ResolveBlockZH(name)]++
			}
		}
		if stats := sortedStats(counts); len(stats) > 0 {
			result["paletteStats"] = stats
		}
	}
	return result
}
