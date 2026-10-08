// voxel_schematic.go：.schematic 文件体素解析（原 voxel.go 拆分，2026-10 文件行数治理）。
// BuildSchematicVoxelData / BuildSchematicVoxelDataFromRoot / schematicDims /
// nextSchematicV2Block / nextSchematicV1Block / filterSurfaceOnly / readVarInt。
package litematic

import (
	"fmt"

	"ysm-model-manager/go/types/registry"
)

type schematicDims struct {
	w, h, l int
	total   int
	wl64    int64
}

// schematicCursor schematic 方块生成器的跨调用游标：
// i = 已消费的方块顺序索引，offset = BlockData 字节偏移。避免每次从头扫描。
type schematicCursor struct {
	i, offset int
}

// schematicDimsFromRoot 读 schematic 尺寸三元组，缺一即非 schematic 文件。
func schematicDimsFromRoot(root map[string]any) (w, h, l int, err error) {
	w, wok := getInt(root, "Width")
	h, hok := getInt(root, "Height")
	l, lok := getInt(root, "Length")
	if !wok || !hok || !lok {
		return 0, 0, 0, fmt.Errorf("not a schematic file")
	}
	return w, h, l, nil
}

// layoutSchematic 预计算 total / wl64 并做溢出守卫。
// ⚠️ w/h/l 来自 NBT int32（可达 2^31-1），三者乘积可溢出 int。
// 溢出后 total 变为负数（循环不执行→静默返回空数据）或小正数（循环次数错误→
// 坐标计算 w*l 也溢出→y/z 坐标错乱→渲染错位方块）。
// 用 int64 计算并钳到合理上限（512M 方块 ≈ 800³，远超任何合理投影）。
// w*l 用于坐标反推 y := (i-1)/(w*l)，同样可能溢出 int（w=1e6, l=1e6→1e12），
// 故一并预计算为 int64，坐标除法走 int64 算术。
func layoutSchematic(w, h, l int) (schematicDims, error) {
	total64 := int64(w) * int64(h) * int64(l)
	const maxSchematicBlocks = 512_000_000
	if total64 < 0 || total64 > maxSchematicBlocks {
		return schematicDims{}, fmt.Errorf("schematic 尺寸 %d×%d×%d 超出合理范围（溢出或过大）", w, h, l)
	}
	return schematicDims{
		w: w, h: h, l: l,
		total: int(total64),
		wl64:  int64(w) * int64(l),
	}, nil
}

// schematicPaletteMap 取 Palette compound 的 blockID → MapColor 映射（缺 Palette 返回 nil，
// 下游据 nil 走 v1 的 ResolveBlockName 回退路径）。
func schematicPaletteMap(root map[string]any) map[int]string {
	paletteCompound := getCompound(root, "Palette")
	if paletteCompound == nil {
		return nil
	}
	paletteMap := make(map[int]string)
	for name, v := range paletteCompound {
		if id, ok := v.(int32); ok {
			paletteMap[int(id)] = MapColor(name)
		}
	}
	return paletteMap
}

// schematicCoord 由方块顺序索引 i（1 基，已消费数）反推坐标。
// Minecraft 存储顺序 X→Z→Y：i-1 = x + z*w + y*w*l。
// int16 坐标守卫：Width/Height/Length 来自 NBT int32（可达 2^31-1），坐标由索引反推
// （范围 [0, size-1]），超出 int16 表示范围直接转换会静默回绕——与 buildRegionInfo
// 的 int16 口径一致，越界跳过该方块。
func schematicCoord(i int, dims schematicDims) (x, y, z int16, ok bool) {
	idx := i - 1
	px := idx % dims.w
	py := int(int64(idx) / dims.wl64)
	pz := (idx / dims.w) % dims.l
	if !withinInt16(px, py, pz) {
		return 0, 0, 0, false
	}
	return int16(px), int16(py), int16(pz), true
}

// blockAtSchematicCursor 由游标当前位置与颜色构造方块；坐标越界（int16 回绕守卫）返回 ok=false。
// nextSchematicV2Block / nextSchematicV1Block 末尾原本复制同款「取坐标 + 越界跳过 + 构造 voxelBlock」
// 块，jscpd 记为新增重复对；收口到此处消除。
func blockAtSchematicCursor(c *schematicCursor, dims schematicDims, color string) (voxelBlock, bool) {
	x, y, z, ok := schematicCoord(c.i, dims)
	if !ok {
		return voxelBlock{}, false
	}
	return voxelBlock{Color: color, X: x, Y: y, Z: z}, true
}

// nextSchematicV2Block v2 路径：varint BlockData，推进游标扫描首个非空气方块。
// blockID 缺 Palette 条目时兜底灰 #7F7F7F（与 v1 一致）。
func nextSchematicV2Block(c *schematicCursor, blockDataBA []byte, paletteMap map[int]string, dims schematicDims) (voxelBlock, bool) {
	for c.i < dims.total && c.offset < len(blockDataBA) {
		blockID, newOff := readVarInt(blockDataBA, c.offset)
		c.offset = newOff
		c.i++
		if blockID == 0 {
			continue
		}
		color := "#7F7F7F"
		if col, ok := paletteMap[blockID]; ok {
			color = col
		}
		if b, ok := blockAtSchematicCursor(c, dims, color); ok {
			return b, true
		}
	}
	return voxelBlock{}, false
}

// nextSchematicV1Block v1 路径：raw Blocks byte array；有 Data 字节时经
// ResolveBlockName 查 id+data 对应的方块名（无 Palette 的老格式回退）。
func nextSchematicV1Block(c *schematicCursor, blocksBA, dataBA []byte, paletteMap map[int]string, dims schematicDims) (voxelBlock, bool) {
	for c.i < dims.total && c.i < len(blocksBA) {
		blockID := int(blocksBA[c.i])
		c.i++
		if blockID == 0 {
			continue
		}
		color := "#7F7F7F"
		if paletteMap != nil {
			if col, ok := paletteMap[blockID]; ok {
				color = col
			}
		} else {
			var d byte
			if dataBA != nil && c.i-1 < len(dataBA) {
				d = dataBA[c.i-1]
			}
			if name := ResolveBlockName(blockID, d); name != "" {
				color = MapColor(name)
			}
		}
		if b, ok := blockAtSchematicCursor(c, dims, color); ok {
			return b, true
		}
	}
	return voxelBlock{}, false
}

// BuildSchematicVoxelDataFromRoot 从已解码 root compound 构建 schematic 体素（容器内条目复用）。
func BuildSchematicVoxelDataFromRoot(root map[string]any, maxBlocks int) (*registry.LitematicVoxelData, error) {
	w, h, l, err := schematicDimsFromRoot(root)
	if err != nil {
		return nil, err
	}

	dims, err := layoutSchematic(w, h, l)
	if err != nil {
		return nil, err
	}

	blocksBA, _ := getByteArray(root, "Blocks")
	blockDataBA, _ := getByteArray(root, "BlockData")
	dataBA, _ := getByteArray(root, "Data")

	if blockDataBA == nil && blocksBA == nil {
		return nil, fmt.Errorf("schematic has no Blocks or BlockData")
	}

	paletteMap := schematicPaletteMap(root)

	// 方块生成器：v1 raw Blocks / v2 varint BlockData 双路径，跳过 air（blockID 0）
	// 游标由闭包捕获，跨调用推进，避免每次从头扫描
	c := &schematicCursor{}
	next := func() (voxelBlock, bool) {
		if blockDataBA != nil && paletteMap != nil {
			// v2: varint BlockData
			return nextSchematicV2Block(c, blockDataBA, paletteMap, dims)
		}
		// v1: raw Blocks byte array
		return nextSchematicV1Block(c, blocksBA, dataBA, paletteMap, dims)
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
		// 畸形 varint（连续 continuation bit 无终止）会让 shift 无界累加，
		// int 左移溢出静默 wrap 出假值（损坏文件产出假方块）；shift 越过 64 位即截断返回
		if shift >= 64 {
			break
		}
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
