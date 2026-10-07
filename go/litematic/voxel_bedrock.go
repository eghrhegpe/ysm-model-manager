// voxel_bedrock.go：Minecraft Bedrock .mcstructure 子区解析（原 voxel.go 拆分，2026-10 文件行数治理）。
// bedrockSubInfo / parseBedrockSubLevel / bedrockBlockAt / buildBedrockVoxelData——
// 跨 sub_level 聚合包围盒 + 块位姿。
package litematic

import (
	"fmt"

	"ysm-model-manager/go/types/registry"
)

type bedrockSubInfo struct {
	originX, originY, originZ int
	minX, minY, minZ          int
	maxX, maxY, maxZ          int
	palette                   []string
	blocks                    []any
}

// bedrockAggBounds 体素侧跨 sub_level 聚合的全局包围盒。
// 与 bedrock.go 的 bedrockBounds 同名不同用：那边服务 ParseBedrockStructure 的
// 「字段缺失即跳过」语义（getInt 带 ok），这边保持体素侧原口径——缺失字段按 0 参与
// 数值比较（`minX, _ := getInt(...)`），故不复用，避免静默改变畸形输入的包围盒。
// hasBounds=false 表示尚无有效包围盒。
type bedrockAggBounds struct {
	minX, minY, minZ, maxX, maxY, maxZ int
	hasBounds                          bool
}

// mergeLocalBounds 并入一个 sub_level 的 local_bounds（首个无条件赋值，其后按 min 取小 / max 取大）。
func (b *bedrockAggBounds) mergeLocalBounds(minX, minY, minZ, maxX, maxY, maxZ int) {
	if !b.hasBounds {
		b.minX, b.minY, b.minZ = minX, minY, minZ
		b.maxX, b.maxY, b.maxZ = maxX, maxY, maxZ
		b.hasBounds = true
		return
	}
	if minX < b.minX {
		b.minX = minX
	}
	if minY < b.minY {
		b.minY = minY
	}
	if minZ < b.minZ {
		b.minZ = minZ
	}
	if maxX > b.maxX {
		b.maxX = maxX
	}
	if maxY > b.maxY {
		b.maxY = maxY
	}
	if maxZ > b.maxZ {
		b.maxZ = maxZ
	}
}

// parseBedrockSubLevel 解析一个 sub_level 的包围盒 / blocks / palette；
// 缺 local_bounds 或 blocks 即无效（对齐 parseBedrockStructure 的字段口径）。
// block_palette：Name → MapColor（缺失 Name / 非 compound 元素兜底灰）。
func parseBedrockSubLevel(sub map[string]any) (bedrockSubInfo, bool) {
	lb := getCompound(sub, "local_bounds")
	blocks := getList(sub, "blocks")
	if lb == nil || blocks == nil {
		return bedrockSubInfo{}, false
	}
	info := bedrockSubInfo{blocks: blocks}
	info.minX, _ = getInt(lb, "min_x")
	info.minY, _ = getInt(lb, "min_y")
	info.minZ, _ = getInt(lb, "min_z")
	info.maxX, _ = getInt(lb, "max_x")
	info.maxY, _ = getInt(lb, "max_y")
	info.maxZ, _ = getInt(lb, "max_z")
	info.originX, info.originY, info.originZ = info.minX, info.minY, info.minZ
	info.palette = paletteColorsFromNames(extractPaletteNames(getList(sub, "block_palette")))
	return info, true
}

// bedrockBlockAt 解析一个 sub_level 的 block 元素为体素；air / 畸形 / 越界返回 ok=false。
// 空气判定按 palette 条目实际颜色（MapColor 对 air 系返回 ""），而非 `pid == 0`——
// 基岩版 block_palette 索引 0 不保证是 air（palette 随 sub_level 各自携带）。
func bedrockBlockAt(bm map[string]any, info bedrockSubInfo, gMinX, gMinY, gMinZ int) (voxelBlock, bool) {
	pid, ok := getInt(bm, "palette_id")
	if !ok || pid < 0 || pid >= len(info.palette) || info.palette[pid] == "" {
		return voxelBlock{}, false // air or invalid
	}
	lp := getCompound(bm, "local_pos")
	if lp == nil {
		return voxelBlock{}, false
	}
	lx, okx := getInt(lp, "x")
	ly, oky := getInt(lp, "y")
	lz, okz := getInt(lp, "z")
	if !okx || !oky || !okz {
		return voxelBlock{}, false
	}
	// 全局坐标 = local_bounds.min + local_pos - 聚合 min（平移归零）；
	// int16 守卫与 Java 分支口径一致（越界丢弃）
	gx := info.originX + lx - gMinX
	gy := info.originY + ly - gMinY
	gz := info.originZ + lz - gMinZ
	if !withinInt16(gx, gy, gz) {
		return voxelBlock{}, false
	}
	return voxelBlock{
		Color: info.palette[pid],
		X:     int16(gx),
		Y:     int16(gy),
		Z:     int16(gz),
	}, true
}

// buildBedrockVoxelData 基岩版 1.21+ structure 体素聚合。
// 格式（对齐 parseBedrockStructure:329 的字段口径）：
//
//	sub_levels[]: {
//	  local_bounds: {min_x,min_y,min_z,max_x,max_y,max_z},   // 子结构包围盒（相对结构原点）
//	  blocks: [{ local_pos: {x,y,z}, palette_id: int }],     // local_pos 相对 local_bounds.min
//	  block_palette: [{ Name: string, Properties: {...} }],  // palette_id 引用索引
//	  entities / block_entities
//	}
//
// 全局坐标 = local_bounds.min + local_pos，再整体平移使聚合 min 归零
// （与 Java 版 structure 的 size/blocks.pos「相对结构原点」语义一致，
//
//	实测样本 local_bounds.min 恒为 0，公式退化即 local_pos 本身）。
//
// 空气判定按 palette 颜色为空（MapColor 对 air 系返回 ""），与 Java 分支口径一致。
func buildBedrockVoxelData(subLevels []any, maxBlocks int) (*registry.LitematicVoxelData, error) {
	// 第一遍：聚合全局包围盒 + 各 sub_level 遍历信息（origin=local_bounds.min）
	var gb bedrockAggBounds
	infos := make([]bedrockSubInfo, 0, len(subLevels))
	for _, sl := range subLevels {
		sub, ok := sl.(map[string]any)
		if !ok {
			continue
		}
		info, ok := parseBedrockSubLevel(sub)
		if !ok {
			continue
		}
		gb.mergeLocalBounds(info.minX, info.minY, info.minZ, info.maxX, info.maxY, info.maxZ)
		infos = append(infos, info)
	}
	if !gb.hasBounds {
		return nil, fmt.Errorf("not a structure NBT file（sub_levels 无有效包围盒）")
	}
	size := [3]int{gb.maxX - gb.minX + 1, gb.maxY - gb.minY + 1, gb.maxZ - gb.minZ + 1}

	// 方块生成器：跨 sub_level 顺序推进，跳过 air/invalid（游标由闭包捕获）
	si, bi := 0, 0
	next := func() (voxelBlock, bool) {
		for si < len(infos) {
			info := infos[si]
			for bi < len(info.blocks) {
				elem := info.blocks[bi]
				bi++
				bm, ok := elem.(map[string]any)
				if !ok {
					continue
				}
				if b, ok := bedrockBlockAt(bm, info, gb.minX, gb.minY, gb.minZ); ok {
					return b, true
				}
			}
			si++
			bi = 0
		}
		return voxelBlock{}, false
	}
	colorGroups, truncated := groupVoxelStream(next, maxBlocks)
	return finalizeVoxelData(size, colorGroups, truncated, maxBlocks), nil
}

// BuildSchematicVoxelData 读取 .schematic 文件体素数据（裸文件路径入口）。
func BuildSchematicVoxelData(path string, maxBlocks int) (*registry.LitematicVoxelData, error) {
	root, err := openGzRoot(path)
	if err != nil {
		return nil, err
	}
	return BuildSchematicVoxelDataFromRoot(root, maxBlocks)
}

// schematicDims schematic 遍历所需的尺寸信息（total / wl64 预计算为 int64 防溢出）。
