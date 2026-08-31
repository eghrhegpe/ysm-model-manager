package litematic

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
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

// openGzRoot 打开 gzip NBT 文件并解码 root compound（路径入口）。
func openGzRoot(path string) (map[string]any, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	defer f.Close()
	return openGzRootFromReader(f)
}

// openGzRootFromReader 从任意 reader 解码 gzip NBT root compound（容器内条目字节复用，
// ADR-132 遗留 1：蓝图/litematic zip 容器内多 nbt 预览切换的 root 输入源）。
// 字节流先整体读入内存再经 gzip 解压——与 openGzRoot 一致（readRootCompound 自带
// maxDecodedBytes 100MB 上限与深度预检，zip-bomb 防线不因容器条目而削弱）。
func openGzRootFromReader(r io.Reader) (map[string]any, error) {
	gz, err := gzip.NewReader(r)
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

// OpenGzRootFromBytes 从 gzip NBT 字节流解码 root compound（容器条目读取的导出入口，
// internal/app 经 container.Entry.Open + LimitReader 取得字节后喂入）。
func OpenGzRootFromBytes(data []byte) (map[string]any, error) {
	return openGzRootFromReader(bytes.NewReader(data))
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

// BuildVoxelData 构建体素渲染数据（按颜色分组）——裸文件路径入口（零回归）。
func BuildVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error) {
	root, err := openGzRoot(path)
	if err != nil {
		return nil, err
	}
	return BuildVoxelDataFromRoot(root, maxBlocks)
}

// BuildVoxelDataFromRoot 从已解码 root compound 构建 litematic 体素（ADR-132 遗留 1：
// 容器内条目读取复用——root 由 OpenGzRootFromBytes 产出，跳过路径层）。
func BuildVoxelDataFromRoot(root map[string]any, maxBlocks int) (*types.LitematicVoxelData, error) {
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

	var firstErr error
	var regionInfos []regionInfo
	for _, regionTag := range regions {
		region, ok := regionTag.(map[string]any)
		if !ok {
			continue
		}
		info, err := buildRegionInfo(region)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if info == nil {
			continue
		}
		regionInfos = append(regionInfos, *info)
	}

	// 所有 region 均损坏 → 显式报错，不再静默返回空数据
	if len(regionInfos) == 0 && len(regions) > 0 && firstErr != nil {
		return nil, fmt.Errorf("所有 region 数据损坏: %w", firstErr)
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

// buildRegionInfo 标准化一个 region 的遍历信息。
// 返回 (*regionInfo, error)：
//
//	(nil, nil)    — 合法空 region（无 palette、零尺寸、单一空气 palette），跳过即可
//	(nil, err)    — 数据损坏（缺少必填字段、BlockStates 长度不匹配声明尺寸等）
//	(info, nil)   — 有效 region
func buildRegionInfo(region map[string]any) (*regionInfo, error) {
	paletteList := getList(region, "BlockStatePalette")
	if len(paletteList) <= 1 {
		return nil, nil
	}

	palette := paletteColorsFromNames(extractPaletteNames(paletteList))

	sizeCompound := getCompound(region, "Size")
	if sizeCompound == nil {
		return nil, fmt.Errorf("region 缺少 Size compound")
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

	// 零尺寸 = 合法空 region（无内容需渲染），静默跳过
	if sx == 0 || sy == 0 || sz == 0 {
		return nil, nil
	}

	longs, ok := getLongArray(region, "BlockStates")
	if !ok || len(longs) == 0 {
		return nil, fmt.Errorf("region 缺少 BlockStates（尺寸 %d×%d×%d 非空）", sx, sy, sz)
	}

	bpe := bitsPerEntry(len(palette))
	if bpe == 0 {
		// 单条目 palette（仅空气），无需读取 BlockStates
		return nil, nil
	}

	// 先按维度上限拒绝离谱声明，再做容量交叉校验——
	// sx/sy/sz 来自 NBT int32（可达 2^31-1），三者乘积可到 ~1e28 远超 int64 max，
	// 直接 `int64(sx)*int64(sy)*int64(sz)` 会回绕（负值使 total > capacity 恒假，守卫失效）。
	// 真实 litematic region 每轴远小于 2^21，超限直接丢弃该 region（同时收紧 DoS 扫描上界）。
	const maxRegionAxis = 1 << 21
	const maxCoord = 32767 // int16 表示上限（体素输出坐标 [3]int16 的容纳范围）
	if sx > maxRegionAxis || sy > maxRegionAxis || sz > maxRegionAxis {
		log.Printf("[litematic] region Size 超出合理范围，跳过: %d×%d×%d", sx, sy, sz)
		return nil, fmt.Errorf("region Size 超出合理范围: %d×%d×%d", sx, sy, sz)
	}
	// origin+size 超出 int16 表示范围的 region 丢弃——坐标源是 int32（origin/px/py/pz），
	// 体素输出 `[3]int16`（voxel.go:30 / types.VoxelGroup.Positions）会静默回绕
	// （±32768 外坐标 3D 渲染位置错乱）。与 maxRegionAxis 口径一致：合理 litematic
	// 坐标远在 int16 内，超限属损坏/畸形文件，丢弃并记录。
	// 双侧校验 + 上界 off-by-one——原仅查正上界 `ox > maxCoord`，
	// 负 origin（如 -40000）会回绕成 25536 产生错误渲染位；且 `ox+sx > maxCoord` 会拒绝
	// `ox+sx-1 == 32767` 的可表示坐标（origin 0 + size 32768 含 x=32767 合法）。
	// int16 范围是 [-32768, 32767]，故拒绝 `origin < -32768` 或 `origin+size-1 > 32767`。
	const minCoord = -32768 // int16 表示下限
	if ox < minCoord || ox+sx-1 > maxCoord ||
		oy < minCoord || oy+sy-1 > maxCoord ||
		oz < minCoord || oz+sz-1 > maxCoord {
		// P3-3：移除 log.Printf，错误信息已通过 fmt.Errorf 返回给调用方。
		// 高频畸形文件会刷日志，降级为纯 error 返回。
		return nil, fmt.Errorf("region 坐标超出 int16 表示范围: origin=(%d,%d,%d) size=%d×%d×%d", ox, oy, oz, sx, sy, sz)
	}
	total := int64(sx) * int64(sy) * int64(sz)
	capacity := int64(len(longs)) * 64 / int64(bpe)
	if total > capacity {
		return nil, fmt.Errorf("region BlockStates 容量不足: size=%d 需 %d 位，实际 %d 位", total, total, capacity)
	}

	return &regionInfo{
		originX: ox, originY: oy, originZ: oz,
		sizeX: sx, sizeY: sy, sizeZ: sz,
		palette: palette,
		longs:   longs,
		bpe:     bpe,
	}, nil
}

// BuildNbtVoxelData 读取 .nbt structure 文件体素数据（裸文件路径入口）。
func BuildNbtVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error) {
	root, err := openGzRoot(path)
	if err != nil {
		return nil, err
	}
	return BuildNbtVoxelDataFromRoot(root, maxBlocks)
}

// BuildNbtVoxelDataFromRoot 从已解码 root compound 构建 structure NBT 体素（容器内条目复用）。
func BuildNbtVoxelDataFromRoot(root map[string]any, maxBlocks int) (*types.LitematicVoxelData, error) {
	// 基岩版 1.21+ structure 新格式：根含 sub_levels 时走聚合分支
	// （对齐 ParseNbtStructure:274 的判定；Java 版 structure 无此字段，直接走下方原逻辑）
	if subLevels := getList(root, "sub_levels"); subLevels != nil {
		return buildBedrockVoxelData(subLevels, maxBlocks)
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

	paletteColors := paletteColorsFromNames(extractPaletteNames(paletteList))

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
			// 空气判定按 palette 条目实际颜色（MapColor 对 air/cave_air/void_air 返回 ""），
			// 而非 `state == 0`——structure NBT 的 palette 索引 0 不保证是 air
			// （structure_block 保存时常不含 air 条目，palette[0] 即首个非空气方块，
			// 原实现会把 state=0 的真实方块整批丢弃；反过来 air 位于非 0 索引时
			// 原实现会保留一个空颜色 group）
			if !ok || int(state) < 0 || int(state) >= len(paletteColors) || paletteColors[state] == "" {
				continue // air（空颜色）或 invalid
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
			if px < -32768 || px > 32767 || py < -32768 || py > 32767 || pz < -32768 || pz > 32767 {
				continue // 与 buildRegionInfo 的 int16 口径一致，越界丢弃
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
func buildBedrockVoxelData(subLevels []any, maxBlocks int) (*types.LitematicVoxelData, error) {
	// 第一遍：聚合全局包围盒 + 各 sub_level 遍历信息（origin=local_bounds.min）
	var gMinX, gMinY, gMinZ, gMaxX, gMaxY, gMaxZ int
	hasBounds := false
	type subInfo struct {
		originX, originY, originZ int
		palette                   []string
		blocks                    []any
	}
	infos := make([]subInfo, 0, len(subLevels))
	for _, sl := range subLevels {
		sub, ok := sl.(map[string]any)
		if !ok {
			continue
		}
		lb := getCompound(sub, "local_bounds")
		blocks := getList(sub, "blocks")
		if lb == nil || blocks == nil {
			continue
		}
		minX, _ := getInt(lb, "min_x")
		minY, _ := getInt(lb, "min_y")
		minZ, _ := getInt(lb, "min_z")
		maxX, _ := getInt(lb, "max_x")
		maxY, _ := getInt(lb, "max_y")
		maxZ, _ := getInt(lb, "max_z")
		if !hasBounds {
			gMinX, gMinY, gMinZ = minX, minY, minZ
			gMaxX, gMaxY, gMaxZ = maxX, maxY, maxZ
			hasBounds = true
		} else {
			if minX < gMinX {
				gMinX = minX
			}
			if minY < gMinY {
				gMinY = minY
			}
			if minZ < gMinZ {
				gMinZ = minZ
			}
			if maxX > gMaxX {
				gMaxX = maxX
			}
			if maxY > gMaxY {
				gMaxY = maxY
			}
			if maxZ > gMaxZ {
				gMaxZ = maxZ
			}
		}
		// block_palette：Name → MapColor（缺失 Name / 非 compound 元素兜底灰）
		palette := paletteColorsFromNames(extractPaletteNames(getList(sub, "block_palette")))
		infos = append(infos, subInfo{originX: minX, originY: minY, originZ: minZ, palette: palette, blocks: blocks})
	}
	if !hasBounds {
		return nil, fmt.Errorf("not a structure NBT file（sub_levels 无有效包围盒）")
	}
	size := [3]int{gMaxX - gMinX + 1, gMaxY - gMinY + 1, gMaxZ - gMinZ + 1}

	// 方块生成器：跨 sub_level 顺序推进，跳过 air/invalid（状态由闭包捕获）
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
				pid, ok := getInt(bm, "palette_id")
				// 空气判定按 palette 条目实际颜色（MapColor 对 air 系返回 ""），
				// 而非 `pid == 0`——基岩版 block_palette 索引 0 不保证是 air
				if !ok || pid < 0 || pid >= len(info.palette) || info.palette[pid] == "" {
					continue // air or invalid
				}
				lp := getCompound(bm, "local_pos")
				if lp == nil {
					continue
				}
				lx, okx := getInt(lp, "x")
				ly, oky := getInt(lp, "y")
				lz, okz := getInt(lp, "z")
				if !okx || !oky || !okz {
					continue
				}
				// 全局坐标 = local_bounds.min + local_pos - 聚合 min（平移归零）；
				// int16 守卫与 Java 分支口径一致（越界丢弃）
				gx := info.originX + lx - gMinX
				gy := info.originY + ly - gMinY
				gz := info.originZ + lz - gMinZ
				if gx < -32768 || gx > 32767 || gy < -32768 || gy > 32767 || gz < -32768 || gz > 32767 {
					continue
				}
				return voxelBlock{
					Color: info.palette[pid],
					X:     int16(gx),
					Y:     int16(gy),
					Z:     int16(gz),
				}, true
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
func BuildSchematicVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error) {
	root, err := openGzRoot(path)
	if err != nil {
		return nil, err
	}
	return BuildSchematicVoxelDataFromRoot(root, maxBlocks)
}

// BuildSchematicVoxelDataFromRoot 从已解码 root compound 构建 schematic 体素（容器内条目复用）。
func BuildSchematicVoxelDataFromRoot(root map[string]any, maxBlocks int) (*types.LitematicVoxelData, error) {
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

	// ⚠️ w/h/l 来自 NBT int32（可达 2^31-1），三者乘积可溢出 int。
	// 溢出后 total 变为负数（循环不执行→静默返回空数据）或小正数（循环次数错误→
	// 坐标计算 w*l 也溢出→y/z 坐标错乱→渲染错位方块）。
	// 用 int64 计算并钳到合理上限（512M 方块 ≈ 800³，远超任何合理投影）。
	total64 := int64(w) * int64(h) * int64(l)
	const maxSchematicBlocks = 512_000_000
	if total64 < 0 || total64 > maxSchematicBlocks {
		return nil, fmt.Errorf("schematic 尺寸 %d×%d×%d 超出合理范围（溢出或过大）", w, h, l)
	}
	total := int(total64)
	// w*l 用于坐标反推 y := (i-1)/(w*l)，同样可能溢出 int（w=1e6, l=1e6→1e12）。
	// 预计算为 int64，坐标除法用 int64 算术（下方闭包内引用 wl64）。
	wl64 := int64(w) * int64(l)

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
				// int16 坐标守卫：Width/Height/Length 来自 NBT int32（可达 2^31-1），
				// 坐标由索引反推（范围 [0, size-1]），超出 int16 表示范围直接转换会
				// 静默回绕——与 buildRegionInfo 的 int16 口径一致，越界跳过该方块
				x := (i - 1) % w
				y := int(int64(i-1) / wl64)
				z := ((i - 1) / w) % l
				if x < -32768 || x > 32767 || y < -32768 || y > 32767 || z < -32768 || z > 32767 {
					continue
				}
				return voxelBlock{
					Color: color,
					X:     int16(x),
					Y:     int16(y),
					Z:     int16(z),
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
			// int16 坐标守卫：与 v2 路径一致（见 v2 注释），越界跳过该方块
			x := (i - 1) % w
			y := int(int64(i-1) / wl64)
			z := ((i - 1) / w) % l
			if x < -32768 || x > 32767 || y < -32768 || y > 32767 || z < -32768 || z > 32767 {
				continue
			}
			return voxelBlock{
				Color: color,
				X:     int16(x),
				Y:     int16(y),
				Z:     int16(z),
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
