// voxel_nbt.go：.nbt structure 文件体素解析（原 voxel.go 拆分，2026-10 文件行数治理）。
// BuildNbtVoxelData / BuildNbtVoxelDataFromRoot / structureSlices / nextNbtBlock——
// Minecraft Java structure NBT 格式。
package litematic

import (
	"fmt"

	"ysm-model-manager/go/types/registry"
)

func BuildNbtVoxelData(path string, maxBlocks int) (*registry.LitematicVoxelData, error) {
	root, err := openGzRoot(path)
	if err != nil {
		return nil, err
	}
	return BuildNbtVoxelDataFromRoot(root, maxBlocks)
}

// structureSlices 取 structure NBT 的三个顶层列表，缺一即非 structure 文件。
func structureSlices(root map[string]any) (sizeList, blocksList, paletteList []any, err error) {
	sizeList = getList(root, "size")
	blocksList = getList(root, "blocks")
	paletteList = getList(root, "palette")
	if sizeList == nil || blocksList == nil || paletteList == nil {
		return nil, nil, nil, fmt.Errorf("not a structure NBT file")
	}
	return sizeList, blocksList, paletteList, nil
}

// parseNbtSize 解析 structure 的 size 三元组。
// ADR-039 P3：comma-ok 防畸形 NBT 裸断言 panic。
func parseNbtSize(sizeList []any) (sx, sy, sz int, err error) {
	if len(sizeList) != 3 {
		return 0, 0, 0, fmt.Errorf("invalid size")
	}
	sxTag, ok := sizeList[0].(int32)
	if !ok {
		return 0, 0, 0, fmt.Errorf("invalid size[0] type")
	}
	syTag, ok := sizeList[1].(int32)
	if !ok {
		return 0, 0, 0, fmt.Errorf("invalid size[1] type")
	}
	szTag, ok := sizeList[2].(int32)
	if !ok {
		return 0, 0, 0, fmt.Errorf("invalid size[2] type")
	}
	return int(sxTag), int(syTag), int(szTag), nil
}

// nbtBlockPos16 解析 blocks 元素的 pos 三元组为 int16 坐标。
// ADR-039 P3：comma-ok 防畸形 NBT 的 pos 元素非 int32 时裸断言 panic（与 sizeList 一致）；
// 越界 int16 丢弃——与 buildRegionInfo 的 int16 口径一致。
func nbtBlockPos16(posList []any) (x, y, z int16, ok bool) {
	px, okx := posList[0].(int32)
	py, oky := posList[1].(int32)
	pz, okz := posList[2].(int32)
	if !okx || !oky || !okz {
		return 0, 0, 0, false
	}
	if !withinInt16(int(px), int(py), int(pz)) {
		return 0, 0, 0, false
	}
	return int16(px), int16(py), int16(pz), true
}

// nextNbtBlock 从 blocksList[start] 起扫描首个可渲染方块，返回方块与下一个扫描位置
// （供 groupVoxelStream 的生成器闭包推进游标）。
//
// 空气判定按 palette 条目实际颜色（MapColor 对 air/cave_air/void_air 返回 ""），
// 而非 `state == 0`——structure NBT 的 palette 索引 0 不保证是 air
// （structure_block 保存时常不含 air 条目，palette[0] 即首个非空气方块，
// 原实现会把 state=0 的真实方块整批丢弃；反过来 air 位于非 0 索引时
// 原实现会保留一个空颜色 group）。
func nextNbtBlock(blocksList []any, start int, paletteColors []string) (voxelBlock, int, bool) {
	for bi := start; bi < len(blocksList); bi++ {
		block, ok := blocksList[bi].(map[string]any)
		if !ok {
			continue
		}
		posList := getList(block, "pos")
		stateTag := block["state"]
		if posList == nil || stateTag == nil || len(posList) != 3 {
			continue
		}
		state, ok := stateTag.(int32)
		if !ok || int(state) < 0 || int(state) >= len(paletteColors) || paletteColors[state] == "" {
			continue // air（空颜色）或 invalid
		}
		x, y, z, ok := nbtBlockPos16(posList)
		if !ok {
			continue
		}
		return voxelBlock{Color: paletteColors[state], X: x, Y: y, Z: z}, bi + 1, true
	}
	return voxelBlock{}, len(blocksList), false
}

// BuildNbtVoxelDataFromRoot 从已解码 root compound 构建 structure NBT 体素（容器内条目复用）。
func BuildNbtVoxelDataFromRoot(root map[string]any, maxBlocks int) (*registry.LitematicVoxelData, error) {
	// 基岩版 1.21+ structure 新格式：根含 sub_levels 时走聚合分支
	// （对齐 ParseNbtStructure:274 的判定；Java 版 structure 无此字段，直接走下方原逻辑）
	if subLevels := getList(root, "sub_levels"); subLevels != nil {
		return buildBedrockVoxelData(subLevels, maxBlocks)
	}

	sizeList, blocksList, paletteList, err := structureSlices(root)
	if err != nil {
		return nil, err
	}
	sx, sy, sz, err := parseNbtSize(sizeList)
	if err != nil {
		return nil, err
	}

	paletteColors := paletteColorsFromNames(extractPaletteNames(paletteList))

	// 方块生成器：顺序推进 blocks 列表，跳过 air/invalid（游标由闭包捕获）
	bi := 0
	next := func() (voxelBlock, bool) {
		b, nextBi, ok := nextNbtBlock(blocksList, bi, paletteColors)
		bi = nextBi
		return b, ok
	}
	colorGroups, truncated := groupVoxelStream(next, maxBlocks)
	return finalizeVoxelData([3]int{sx, sy, sz}, colorGroups, truncated, maxBlocks), nil
}

// bedrockSubInfo 单个 sub_level 的遍历信息：origin = local_bounds.min（全局坐标基准），
// 包围盒供跨 sub_level 聚合出总 size。
