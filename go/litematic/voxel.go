package litematic

import (
	"compress/gzip"
	"fmt"
	"os"

	"ysm-model-manager/go/types"
)

// regionInfo 标准化后的 region 遍历信息
type regionInfo struct {
	originX, originY, originZ int
	sizeX, sizeY, sizeZ       int
	palette                   []string
	longs                     []int64
	bpe                       int
}

// BuildVoxelData 构建体素渲染数据（按颜色分组）
func BuildVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, fmt.Errorf("gzip: %w", err)
	}
	defer gz.Close()

	root, err := readRootCompound(gz)
	if err != nil {
		return nil, fmt.Errorf("nbt: %w", err)
	}

	encSize := [3]int{}
	if metadata := getCompound(root, "Metadata"); metadata != nil {
		if es := getCompound(metadata, "EnclosingSize"); es != nil {
			if v, ok := getInt(es, "x"); ok {
				encSize[0] = v
			}
			if v, ok := getInt(es, "y"); ok {
				encSize[1] = v
			}
			if v, ok := getInt(es, "z"); ok {
				encSize[2] = v
			}
		}
	}

	regions := getCompound(root, "Regions")
	if regions == nil {
		return &types.LitematicVoxelData{Size: encSize}, nil
	}

	var regionInfos []regionInfo
	for _, regionTag := range regions {
		region, ok := regionTag.(map[string]any)
		if !ok {
			continue
		}
		info := buildRegionInfo(region)
		if info == nil {
			continue
		}
		regionInfos = append(regionInfos, *info)
	}

	colorGroups := make(map[string][][3]int16)
	blockCount := 0
	truncated := false

	for _, info := range regionInfos {
		totalInRegion := info.sizeX * info.sizeY * info.sizeZ
		for i := 0; i < totalInRegion; i++ {
			if blockCount >= maxBlocks {
				truncated = true
				break
			}
			paletteIdx := extractBits(info.longs, i*info.bpe, info.bpe)
			if paletteIdx < 0 || paletteIdx >= len(info.palette) || paletteIdx == 0 {
				continue // air or invalid
			}

			// 计算全局坐标（Minecraft 存储顺序：X→Z→Y，Y 最慢）
			// 公式: i = x + z * sizeX + y * sizeX * sizeZ
			gx := int16(info.originX + (i % info.sizeX))
			gz := int16(info.originZ + ((i / info.sizeX) % info.sizeZ))
			gy := int16(info.originY + (i / (info.sizeX * info.sizeZ)))

			color := info.palette[paletteIdx]
			colorGroups[color] = append(colorGroups[color], [3]int16{gx, gy, gz})
			blockCount++
		}
		if truncated {
			break
		}
	}

	colorGroups = filterSurfaceOnly(colorGroups)

	groups := make([]types.VoxelGroup, 0, len(colorGroups))
	for color, positions := range colorGroups {
		groups = append(groups, types.VoxelGroup{
			Color:     color,
			Positions: positions,
		})
	}

	return &types.LitematicVoxelData{
		Size:      encSize,
		Groups:    groups,
		Truncated: truncated,
		MaxBlocks: maxBlocks,
	}, nil
}

// buildRegionInfo 标准化一个 region 的遍历信息
func buildRegionInfo(region map[string]any) *regionInfo {
	paletteList := getList(region, "BlockStatePalette")
	if paletteList == nil || len(paletteList) <= 1 {
		return nil
	}

	palette := make([]string, len(paletteList))
	for i, elem := range paletteList {
		if elemMap, ok := elem.(map[string]any); ok {
			nameTag := getCompoundKey(elemMap, "Name")
			if name, ok := nameTag.(string); ok {
				palette[i] = MapColor(name)
			} else {
				palette[i] = "#000000"
			}
		} else {
			palette[i] = "#000000"
		}
	}

	sizeCompound := getCompound(region, "Size")
	if sizeCompound == nil {
		return nil
	}
	sx, _ := getInt(sizeCompound, "x")
	sy, _ := getInt(sizeCompound, "y")
	sz, _ := getInt(sizeCompound, "z")

	posCompound := getCompound(region, "Position")
	ox, oy, oz := 0, 0, 0
	if posCompound != nil {
		ox, _ = getInt(posCompound, "x")
		oy, _ = getInt(posCompound, "y")
		oz, _ = getInt(posCompound, "z")
	}

	// 负 size 标准化
	if sx < 0 {
		ox += sx + 1
		sx = -sx
	}
	if sy < 0 {
		oy += sy + 1
		sy = -sy
	}
	if sz < 0 {
		oz += sz + 1
		sz = -sz
	}

	longs, ok := getLongArray(region, "BlockStates")
	if !ok || len(longs) == 0 {
		return nil
	}

	bpe := bitsPerEntry(len(palette))
	if bpe == 0 {
		return nil
	}

	return &regionInfo{
		originX: ox, originY: oy, originZ: oz,
		sizeX: sx, sizeY: sy, sizeZ: sz,
		palette: palette,
		longs:   longs,
		bpe:     bpe,
	}
}

func BuildNbtVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	defer gz.Close()
	root, err := readRootCompound(gz)
	if err != nil {
		return nil, err
	}

	sizeList := getList(root, "size")
	blocksList := getList(root, "blocks")
	paletteList := getList(root, "palette")
	if sizeList == nil || blocksList == nil || paletteList == nil {
		return nil, fmt.Errorf("not a structure NBT file")
	}
	if len(sizeList) != 3 {
		return nil, fmt.Errorf("invalid size")
	}

	sx := int(sizeList[0].(int32))
	sy := int(sizeList[1].(int32))
	sz := int(sizeList[2].(int32))

	paletteColors := make([]string, len(paletteList))
	for i, elem := range paletteList {
		if elemMap, ok := elem.(map[string]any); ok {
			nameTag := getCompoundKey(elemMap, "Name")
			if name, ok := nameTag.(string); ok {
				paletteColors[i] = MapColor(name)
			} else {
				paletteColors[i] = "#7F7F7F"
			}
		} else {
			paletteColors[i] = "#7F7F7F"
		}
	}

	colorGroups := make(map[string][][3]int16)
	blockCount := 0
	truncated := false
	for _, elem := range blocksList {
		if blockCount >= maxBlocks {
			truncated = true
			break
		}
		block, ok := elem.(map[string]any)
		if !ok {
			continue
		}
		posList := getList(block, "pos")
		stateTag := block["state"]
		if posList == nil || stateTag == nil || len(posList) != 3 {
			continue
		}
		state, ok := stateTag.(int32)
		if !ok || int(state) < 0 || int(state) >= len(paletteColors) {
			continue
		}
		bx := int16(posList[0].(int32))
		by := int16(posList[1].(int32))
		bz := int16(posList[2].(int32))
		color := paletteColors[state]
		colorGroups[color] = append(colorGroups[color], [3]int16{bx, by, bz})
		blockCount++
	}

	colorGroups = filterSurfaceOnly(colorGroups)

	groups := make([]types.VoxelGroup, 0, len(colorGroups))
	for color, positions := range colorGroups {
		groups = append(groups, types.VoxelGroup{Color: color, Positions: positions})
	}
	return &types.LitematicVoxelData{
		Size:      [3]int{sx, sy, sz},
		Groups:    groups,
		Truncated: truncated,
		MaxBlocks: maxBlocks,
	}, nil
}

func BuildSchematicVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	defer gz.Close()

	root, err := readRootCompound(gz)
	if err != nil {
		return nil, err
	}

	w, wok := getInt(root, "Width")
	h, hok := getInt(root, "Height")
	l, lok := getInt(root, "Length")
	if !wok || !hok || !lok {
		return nil, fmt.Errorf("not a schematic file")
	}

	blocksBA, _ := getByteArray(root, "Blocks")
	blockDataBA, _ := getByteArray(root, "BlockData")
	dataBA, _ := getByteArray(root, "Data")

	paletteCompound := getCompound(root, "Palette")
	var paletteMap map[int]string
	if paletteCompound != nil {
		paletteMap = make(map[int]string)
		for name, v := range paletteCompound {
			if id, ok := v.(int32); ok {
				paletteMap[int(id)] = MapColor(name)
			}
		}
	}

	colorGroups := make(map[string][][3]int16)
	blockCount := 0
	truncated := false
	total := w * h * l

	// v1: raw Blocks byte array; v2+: varint BlockData
	if blockDataBA != nil && paletteMap != nil {
		offset := 0
		for i := 0; i < total; i++ {
			if blockCount >= maxBlocks { truncated = true; break }
			if offset >= len(blockDataBA) { break }
			blockID, newOff := readVarInt(blockDataBA, offset)
			offset = newOff
			if blockID == 0 { continue }
			color := "#7F7F7F"
			if c, ok := paletteMap[blockID]; ok { color = c }
			x := int16(i % w)
			z := int16((i / w) % l)
			y := int16(i / (w * l))
			colorGroups[color] = append(colorGroups[color], [3]int16{x, y, z})
			blockCount++
		}
	} else if blocksBA != nil {
		for i := 0; i < total && i < len(blocksBA); i++ {
			if blockCount >= maxBlocks { truncated = true; break }
			blockID := int(blocksBA[i])
			if blockID == 0 { continue }
			color := "#7F7F7F"
			if paletteMap != nil {
				if c, ok := paletteMap[blockID]; ok { color = c }
			} else {
				var d byte
				if dataBA != nil && i < len(dataBA) { d = dataBA[i] }
				if name := ResolveBlockName(blockID, d); name != "" {
					color = MapColor(name)
				}
			}
			x := int16(i % w)
			z := int16((i / w) % l)
			y := int16(i / (w * l))
			colorGroups[color] = append(colorGroups[color], [3]int16{x, y, z})
			blockCount++
		}
	} else {
		return nil, fmt.Errorf("schematic has no Blocks or BlockData")
	}

	colorGroups = filterSurfaceOnly(colorGroups)

	groups := make([]types.VoxelGroup, 0, len(colorGroups))
	for color, positions := range colorGroups {
		groups = append(groups, types.VoxelGroup{Color: color, Positions: positions})
	}
	return &types.LitematicVoxelData{
		Size:      [3]int{w, h, l},
		Groups:    groups,
		Truncated: truncated,
		MaxBlocks: maxBlocks,
	}, nil
}

// neighborOffsets 6 个相邻方向偏移（用于表面检测）
var neighborOffsets = [][3]int16{
	{1, 0, 0}, {-1, 0, 0},
	{0, 1, 0}, {0, -1, 0},
	{0, 0, 1}, {0, 0, -1},
}

// filterSurfaceOnly 剔除被 6 个邻居完全包围的不可见方块。
// 对于实心建筑可减少 80-95% 的渲染实例数。
func filterSurfaceOnly(colorGroups map[string][][3]int16) map[string][][3]int16 {
	occupied := make(map[[3]int16]bool)
	for _, positions := range colorGroups {
		for _, p := range positions {
			occupied[p] = true
		}
	}
	result := make(map[string][][3]int16, len(colorGroups))
	for color, positions := range colorGroups {
		var exposed [][3]int16
		for _, p := range positions {
			surface := false
			for _, off := range neighborOffsets {
				if !occupied[[3]int16{p[0] + off[0], p[1] + off[1], p[2] + off[2]}] {
					surface = true
					break
				}
			}
			if surface {
				exposed = append(exposed, p)
			}
		}
		if len(exposed) > 0 {
			result[color] = exposed
		}
	}
	return result
}

func readVarInt(data []byte, offset int) (int, int) {
	result := 0
	shift := 0
	for offset < len(data) {
		b := int(data[offset])
		offset++
		result |= (b & 0x7F) << shift
		if (b & 0x80) == 0 {
			break
		}
		shift += 7
	}
	return result, offset
}
