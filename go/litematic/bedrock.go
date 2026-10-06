package litematic

// bedrockBounds 跨 sub_level 聚合的全局包围盒。has 的语义是「至少见过一个
// local_bounds compound」——不要求其字段可解析（空 compound 也算有包围盒，
// size 回退为 1×1×1，见 parseBedrockStructure 的有效判定）。
type bedrockBounds struct {
	minX, minY, minZ int
	maxX, maxY, maxZ int
	has              bool
}

// extend 用子结构的 local_bounds 扩展包围盒。首个 local_bounds 无条件赋值——
// 初值 0 不是有效下界，直接比较会得出错的包围盒；其后按 min 取小 / max 取大，
// 缺字段的子结构不影响既有值。
func (b *bedrockBounds) extend(lb map[string]any) {
	first := !b.has
	b.extendMin(lb, first)
	b.extendMax(lb, first)
	b.has = true
}

// extendMin 收敛 min_x/min_y/min_z（first 时无条件覆盖）。
func (b *bedrockBounds) extendMin(lb map[string]any, first bool) {
	if v, ok := getInt(lb, "min_x"); ok && (first || v < b.minX) {
		b.minX = v
	}
	if v, ok := getInt(lb, "min_y"); ok && (first || v < b.minY) {
		b.minY = v
	}
	if v, ok := getInt(lb, "min_z"); ok && (first || v < b.minZ) {
		b.minZ = v
	}
}

// extendMax 收敛 max_x/max_y/max_z（first 时无条件覆盖）。
func (b *bedrockBounds) extendMax(lb map[string]any, first bool) {
	if v, ok := getInt(lb, "max_x"); ok && (first || v > b.maxX) {
		b.maxX = v
	}
	if v, ok := getInt(lb, "max_y"); ok && (first || v > b.maxY) {
		b.maxY = v
	}
	if v, ok := getInt(lb, "max_z"); ok && (first || v > b.maxZ) {
		b.maxZ = v
	}
}

// size 返回包围盒尺寸（含两端点，故 +1）。
func (b bedrockBounds) size() []int {
	return []int{b.maxX - b.minX + 1, b.maxY - b.minY + 1, b.maxZ - b.minZ + 1}
}

// parseBedrockStructure 解析基岩版 1.21+ structure（origin/sub_levels 多子结构）。
// 每个 sub_level 内嵌 blocks（local_pos+palette_id）、block_palette（Name/Properties）、
// local_bounds（min/max x/y/z）、entities、block_entities；跨子结构聚合全局包围盒、
// 方块总数与方块统计（按 blocks.palette_id 引用 block_palette.Name 计数，Count=真实方块数）。
func parseBedrockStructure(root map[string]any, subLevels []any) map[string]interface{} {
	result := map[string]interface{}{}
	if v, ok := getInt(root, "DataVersion"); ok {
		result["dataVersion"] = v
	}

	var bounds bedrockBounds
	blockCount := 0
	entityCount := 0
	tileEntityCount := 0
	counts := map[string]int{}

	for _, sl := range subLevels {
		sub, ok := sl.(map[string]any)
		if !ok {
			continue
		}
		// 子结构包围盒（local_bounds: min_x/min_y/min_z/max_x/max_y/max_z）
		if lb := getCompound(sub, "local_bounds"); lb != nil {
			bounds.extend(lb)
		}
		// blocks + block_palette（palette_id → Name 引用计数）
		blockCount += countSubLevelBlocks(sub, counts)
		entityCount += len(getList(sub, "entities"))
		tileEntityCount += len(getList(sub, "block_entities"))
	}

	if bounds.has {
		result["size"] = bounds.size()
	}
	if blockCount > 0 {
		result["blockCount"] = blockCount
	}
	if entityCount > 0 {
		result["entityCount"] = entityCount
	}
	if tileEntityCount > 0 {
		result["tileEntityCount"] = tileEntityCount
	}
	if stats := sortedStats(counts); len(stats) > 0 {
		result["paletteStats"] = stats
	}

	// 有效判定：size（local_bounds 推导）单独即视为有效（空结构文件也有尺寸）；
	// 否则仅 DataVersion 等元数据且无内容时返回 nil（对齐 Java 版 len(result)<=1 语义）
	if _, hasSize := result["size"]; !hasSize && len(result) <= 1 {
		return nil
	}
	return result
}

// countSubLevelBlocks 统计单个 sub_level 的方块数并累加 palette 引用计数：
// 返回值是 blocks 元素总数（含非 compound 元素——与 len(blocks) 口径一致）；
// counts 只记 palette_id 能解析到非空 Name 的方块（缺失/负数/越界/空名跳过）。
func countSubLevelBlocks(sub map[string]any, counts map[string]int) int {
	blocks := getList(sub, "blocks")
	paletteNames := extractPaletteNames(getList(sub, "block_palette"))
	for _, b := range blocks {
		bm, ok := b.(map[string]any)
		if !ok {
			continue
		}
		if pid, ok := getInt(bm, "palette_id"); ok && pid >= 0 && pid < len(paletteNames) {
			if name := paletteNames[pid]; name != "" {
				counts[ResolveBlockZH(name)]++
			}
		}
	}
	return len(blocks)
}
