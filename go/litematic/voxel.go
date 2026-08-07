package litematic

import (
	"compress/gzip"
	"fmt"
	"log"
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

// ===== 三格式（litematic / structure NBT / schematic）公共体素管线 =====
// BuildVoxelData / BuildNbtVoxelData / BuildSchematicVoxelData 共享：
//   openGzRoot（打开+gzip+NBT 解码）→ 各格式解析方块 → groupVoxelStream（分组+截断）
//   → finalizeVoxelData（表面过滤+组装返回）。
// 截断 / 分组 / 表面过滤逻辑只在此实现一次，防止三兄弟各自手写导致行为漂移。

// voxelBlock 单个方块的体素信息（各格式统一中间表示）
type voxelBlock struct {
	Color   string
	X, Y, Z int16
}

// openGzRoot 打开 gzip NBT 文件并解码 root compound
func openGzRoot(path string) (map[string]any, error) {
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
	return root, nil
}

// groupVoxelStream 从 next 生成器消费方块流，按颜色分组，超过 maxBlocks 截断
// next 返回 (方块, 是否还有)。返回 colorGroups + truncated。
func groupVoxelStream(next func() (voxelBlock, bool), maxBlocks int) (map[string][][3]int16, bool) {
	colorGroups := make(map[string][][3]int16)
	blockCount := 0
	truncated := false
	for {
		if blockCount >= maxBlocks {
			truncated = true
			break
		}
		block, ok := next()
		if !ok {
			break
		}
		colorGroups[block.Color] = append(colorGroups[block.Color], [3]int16{block.X, block.Y, block.Z})
		blockCount++
	}
	return colorGroups, truncated
}

// finalizeVoxelData 表面过滤 + 组装返回（三兄弟尾部公共段）
func finalizeVoxelData(size [3]int, colorGroups map[string][][3]int16, truncated bool, maxBlocks int) *types.LitematicVoxelData {
	colorGroups = filterSurfaceOnly(colorGroups)
	groups := make([]types.VoxelGroup, 0, len(colorGroups))
	for color, positions := range colorGroups {
		groups = append(groups, types.VoxelGroup{
			Color:     color,
			Positions: positions,
		})
	}
	return &types.LitematicVoxelData{
		Size:      size,
		Groups:    groups,
		Truncated: truncated,
		MaxBlocks: maxBlocks,
	}
}

// BuildVoxelData 构建体素渲染数据（按颜色分组）
func BuildVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error) {
	root, err := openGzRoot(path)
	if err != nil {
		return nil, err
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

	// 方块生成器：跨 region 顺序推进，跳过 air/invalid（状态由闭包捕获）
	ri, i := 0, 0
	next := func() (voxelBlock, bool) {
		for ri < len(regionInfos) {
			info := regionInfos[ri]
			totalInRegion := info.sizeX * info.sizeY * info.sizeZ
			for i < totalInRegion {
				paletteIdx := extractBits(info.longs, i*info.bpe, info.bpe)
				if paletteIdx < 0 || paletteIdx >= len(info.palette) || paletteIdx == 0 {
					i++
					continue // air or invalid
				}
				// 计算全局坐标（Minecraft 存储顺序：X→Z→Y，Y 最慢）
				// 公式: i = x + z * sizeX + y * sizeX * sizeZ
				gx := int16(info.originX + (i % info.sizeX))
				gz := int16(info.originZ + ((i / info.sizeX) % info.sizeZ))
				gy := int16(info.originY + (i / (info.sizeX * info.sizeZ)))
				b := voxelBlock{Color: info.palette[paletteIdx], X: gx, Y: gy, Z: gz}
				i++
				return b, true
			}
			ri++
			i = 0
		}
		return voxelBlock{}, false
	}
	colorGroups, truncated := groupVoxelStream(next, maxBlocks)
	return finalizeVoxelData(encSize, colorGroups, truncated, maxBlocks), nil
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

	// P3 修复（code_review）：先按维度上限拒绝离谱声明，再做容量交叉校验——
	// sx/sy/sz 来自 NBT int32（可达 2^31-1），三者乘积可到 ~1e28 远超 int64 max，
	// 直接 `int64(sx)*int64(sy)*int64(sz)` 会回绕（负值使 total > capacity 恒假，守卫失效）。
	// 真实 litematic region 每轴远小于 2^21，超限直接丢弃该 region（同时收紧 DoS 扫描上界）。
	const maxRegionAxis = 1 << 21
	if sx > maxRegionAxis || sy > maxRegionAxis || sz > maxRegionAxis {
		log.Printf("[litematic] region Size 超出合理范围，跳过: %d×%d×%d", sx, sy, sz)
		return nil
	}
	total := int64(sx) * int64(sy) * int64(sz)
	capacity := int64(len(longs)) * 64 / int64(bpe)
	if total > capacity {
		log.Printf("[litematic] region Size 与 BlockStates 容量不符，跳过: size=%d capacity=%d", total, capacity)
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
	root, err := openGzRoot(path)
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

	// ADR-039 P3：comma-ok 防畸形 NBT 裸断言 panic
	sxTag, ok := sizeList[0].(int32)
	if !ok {
		return nil, fmt.Errorf("invalid size[0] type")
	}
	syTag, ok := sizeList[1].(int32)
	if !ok {
		return nil, fmt.Errorf("invalid size[1] type")
	}
	szTag, ok := sizeList[2].(int32)
	if !ok {
		return nil, fmt.Errorf("invalid size[2] type")
	}
	sx, sy, sz := int(sxTag), int(syTag), int(szTag)

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

	// 方块生成器：顺序推进 blocks 列表，跳过 air/invalid（状态由闭包捕获）
	bi := 0
	next := func() (voxelBlock, bool) {
		for bi < len(blocksList) {
			elem := blocksList[bi]
			bi++
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
			if !ok || int(state) < 0 || int(state) >= len(paletteColors) || state == 0 {
				continue // air or invalid（与 BuildVoxelData/BuildSchematicVoxelData 一致）
			}
			// ADR-039 P3：comma-ok 防畸形 NBT 的 pos 元素非 int32 时裸断言 panic（与 sizeList 一致）
			px, ok := posList[0].(int32)
			if !ok {
				continue
			}
			py, ok := posList[1].(int32)
			if !ok {
				continue
			}
			pz, ok := posList[2].(int32)
			if !ok {
				continue
			}
			return voxelBlock{
				Color: paletteColors[state],
				X:     int16(px),
				Y:     int16(py),
				Z:     int16(pz),
			}, true
		}
		return voxelBlock{}, false
	}
	colorGroups, truncated := groupVoxelStream(next, maxBlocks)
	return finalizeVoxelData([3]int{sx, sy, sz}, colorGroups, truncated, maxBlocks), nil
}

func BuildSchematicVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error) {
	root, err := openGzRoot(path)
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

	total := w * h * l
	if blockDataBA == nil && blocksBA == nil {
		return nil, fmt.Errorf("schematic has no Blocks or BlockData")
	}

	// 方块生成器：v1 raw Blocks / v2 varint BlockData 双路径，跳过 air（blockID 0）
	// i/offset 由闭包捕获，跨调用推进，避免每次从头扫描
	i, offset := 0, 0
	next := func() (voxelBlock, bool) {
		if blockDataBA != nil && paletteMap != nil {
			// v2: varint BlockData
			for i < total && offset < len(blockDataBA) {
				blockID, newOff := readVarInt(blockDataBA, offset)
				offset = newOff
				i++
				if blockID == 0 {
					continue
				}
				color := "#7F7F7F"
				if c, ok := paletteMap[blockID]; ok {
					color = c
				}
				return voxelBlock{
					Color: color,
					X:     int16((i - 1) % w),
					Y:     int16((i - 1) / (w * l)),
					Z:     int16(((i - 1) / w) % l),
				}, true
			}
			return voxelBlock{}, false
		}
		// v1: raw Blocks byte array
		for i < total && i < len(blocksBA) {
			blockID := int(blocksBA[i])
			i++
			if blockID == 0 {
				continue
			}
			color := "#7F7F7F"
			if paletteMap != nil {
				if c, ok := paletteMap[blockID]; ok {
					color = c
				}
			} else {
				var d byte
				if dataBA != nil && i-1 < len(dataBA) {
					d = dataBA[i-1]
				}
				if name := ResolveBlockName(blockID, d); name != "" {
					color = MapColor(name)
				}
			}
			return voxelBlock{
				Color: color,
				X:     int16((i - 1) % w),
				Y:     int16((i - 1) / (w * l)),
				Z:     int16(((i - 1) / w) % l),
			}, true
		}
		return voxelBlock{}, false
	}
	colorGroups, truncated := groupVoxelStream(next, maxBlocks)
	return finalizeVoxelData([3]int{w, h, l}, colorGroups, truncated, maxBlocks), nil
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
