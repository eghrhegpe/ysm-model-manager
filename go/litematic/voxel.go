// voxel.go：三格式（litematic / structure NBT / schematic）公共体素管线 + litematic 格式解析。
// 2026-10 拆分：原 862 行按格式分为 voxel.go（本文件：公共管线 + litematic）/
// voxel_nbt.go（structure NBT）/ voxel_bedrock.go（Bedrock .mcstructure 子区）/ voxel_schematic.go（schematic）。
package litematic

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"os"

	"ysm-model-manager/go/types/registry"
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

// withinInt16 判断坐标三元组是否落在体素输出坐标 [3]int16 的可表示范围内。
// 三格式（litematic region / structure NBT / schematic）共用口径：越界坐标直接
// 转换会静默回绕（±32768 外坐标 3D 渲染位置错乱），一律丢弃该方块。
func withinInt16(x, y, z int) bool {
	return x >= -32768 && x <= 32767 && y >= -32768 && y <= 32767 && z >= -32768 && z <= 32767
}

// openGzRoot 打开 gzip NBT 文件并解码 root compound（路径入口）。
func openGzRoot(path string) (map[string]any, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	defer func() { _ = f.Close() }()
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
	defer func() { _ = gz.Close() }()
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
func finalizeVoxelData(size [3]int, colorGroups map[string][][3]int16, truncated bool, maxBlocks int) *registry.LitematicVoxelData {
	colorGroups = filterSurfaceOnly(colorGroups)
	groups := make([]registry.VoxelGroup, 0, len(colorGroups))
	for color, positions := range colorGroups {
		groups = append(groups, registry.VoxelGroup{
			Color:     color,
			Positions: positions,
		})
	}
	return &registry.LitematicVoxelData{
		Size:      size,
		Groups:    groups,
		Truncated: truncated,
		MaxBlocks: maxBlocks,
	}
}

// BuildVoxelData 构建体素渲染数据（按颜色分组）——裸文件路径入口（零回归）。
func BuildVoxelData(path string, maxBlocks int) (*registry.LitematicVoxelData, error) {
	root, err := openGzRoot(path)
	if err != nil {
		return nil, err
	}
	return BuildVoxelDataFromRoot(root, maxBlocks)
}

// BuildVoxelDataFromRoot 从已解码 root compound 构建 litematic 体素（ADR-132 遗留 1：
// 容器内条目读取复用——root 由 OpenGzRootFromBytes 产出，跳过路径层）。
func BuildVoxelDataFromRoot(root map[string]any, maxBlocks int) (*registry.LitematicVoxelData, error) {
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
		return &registry.LitematicVoxelData{Size: encSize}, nil
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

// parseRegionGeometry 解析并标准化一个 region 的 origin / size。
// 负 size 标准化：Minecraft 允许负 size 表示反向延伸，origin 需相应平移 (size+1)。
func parseRegionGeometry(region map[string]any) (ox, oy, oz, sx, sy, sz int, err error) {
	sizeCompound := getCompound(region, "Size")
	if sizeCompound == nil {
		return 0, 0, 0, 0, 0, 0, fmt.Errorf("region 缺少 Size compound")
	}
	sx, _ = getInt(sizeCompound, "x")
	sy, _ = getInt(sizeCompound, "y")
	sz, _ = getInt(sizeCompound, "z")

	posCompound := getCompound(region, "Position")
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
	return ox, oy, oz, sx, sy, sz, nil
}

// regionBlockStates 取 region 的 BlockStates LongArray；非空尺寸缺数据即视为损坏。
func regionBlockStates(region map[string]any, sx, sy, sz int) ([]int64, error) {
	longs, ok := getLongArray(region, "BlockStates")
	if !ok || len(longs) == 0 {
		return nil, fmt.Errorf("region 缺少 BlockStates（尺寸 %d×%d×%d 非空）", sx, sy, sz)
	}
	return longs, nil
}

// checkRegionAxisLimits 按维度上限拒绝离谱声明的 region——
// sx/sy/sz 来自 NBT int32（可达 2^31-1），三者乘积可到 ~1e28 远超 int64 max，
// 直接 `int64(sx)*int64(sy)*int64(sz)` 会回绕（负值使 total > capacity 恒假，守卫失效）。
// 真实 litematic region 每轴远小于 2^21，超限直接丢弃该 region（同时收紧 DoS 扫描上界）。
func checkRegionAxisLimits(sx, sy, sz int) error {
	const maxRegionAxis = 1 << 21
	if sx > maxRegionAxis || sy > maxRegionAxis || sz > maxRegionAxis {
		log.Printf("[litematic] region Size 超出合理范围，跳过: %d×%d×%d", sx, sy, sz)
		return fmt.Errorf("region Size 超出合理范围: %d×%d×%d", sx, sy, sz)
	}
	return nil
}

// checkRegionCoordRange origin+size 超出 int16 表示范围的 region 丢弃——坐标源是 int32
// （origin/px/py/pz），体素输出 `[3]int16`（voxelBlock / registry.VoxelGroup.Positions）
// 会静默回绕（±32768 外坐标 3D 渲染位置错乱）。与 maxRegionAxis 口径一致：合理 litematic
// 坐标远在 int16 内，超限属损坏/畸形文件，丢弃并记录。
// 双侧校验 + 上界 off-by-one——原仅查正上界 `ox > maxCoord`，
// 负 origin（如 -40000）会回绕成 25536 产生错误渲染位；且 `ox+sx > maxCoord` 会拒绝
// `ox+sx-1 == 32767` 的可表示坐标（origin 0 + size 32768 含 x=32767 合法）。
// int16 范围是 [-32768, 32767]，故拒绝 `origin < -32768` 或 `origin+size-1 > 32767`。
func checkRegionCoordRange(ox, oy, oz, sx, sy, sz int) error {
	const maxCoord = 32767  // int16 表示上限（体素输出坐标 [3]int16 的容纳范围）
	const minCoord = -32768 // int16 表示下限
	if ox < minCoord || ox+sx-1 > maxCoord ||
		oy < minCoord || oy+sy-1 > maxCoord ||
		oz < minCoord || oz+sz-1 > maxCoord {
		// P3-3：移除 log.Printf，错误信息已通过 fmt.Errorf 返回给调用方。
		// 高频畸形文件会刷日志，降级为纯 error 返回。
		return fmt.Errorf("region 坐标超出 int16 表示范围: origin=(%d,%d,%d) size=%d×%d×%d", ox, oy, oz, sx, sy, sz)
	}
	return nil
}

// checkRegionCapacity BlockStates 可用位数须容纳 size 声明的方块总数。
func checkRegionCapacity(longs []int64, bpe, sx, sy, sz int) error {
	total := int64(sx) * int64(sy) * int64(sz)
	capacity := int64(len(longs)) * 64 / int64(bpe)
	if total > capacity {
		return fmt.Errorf("region BlockStates 容量不足: size=%d 需 %d 位，实际 %d 位", total, total, capacity)
	}
	return nil
}

// buildRegionInfo 标准化一个 region 的遍历信息。
// 返回 (*regionInfo, error)：
//
//	(nil, nil)    — 合法空 region（无 palette、零尺寸、单一空气 palette），跳过即可
//	(nil, err)    — 数据损坏（缺少必填字段、BlockStates 长度不匹配声明尺寸等）
//	(info, nil)   — 有效 region
//
// 校验顺序即错误优先级：几何解析 → 零尺寸短路 → BlockStates 存在性 → bpe 短路
// → 轴上限 → int16 坐标范围 → 容量交叉校验。
func buildRegionInfo(region map[string]any) (*regionInfo, error) {
	paletteList := getList(region, "BlockStatePalette")
	if len(paletteList) <= 1 {
		return nil, nil
	}

	palette := paletteColorsFromNames(extractPaletteNames(paletteList))

	ox, oy, oz, sx, sy, sz, err := parseRegionGeometry(region)
	if err != nil {
		return nil, err
	}

	// 零尺寸 = 合法空 region（无内容需渲染），静默跳过
	if sx == 0 || sy == 0 || sz == 0 {
		return nil, nil
	}

	longs, err := regionBlockStates(region, sx, sy, sz)
	if err != nil {
		return nil, err
	}

	bpe := bitsPerEntry(len(palette))
	if bpe == 0 {
		// 单条目 palette（仅空气），无需读取 BlockStates
		return nil, nil
	}

	if err := checkRegionAxisLimits(sx, sy, sz); err != nil {
		return nil, err
	}
	if err := checkRegionCoordRange(ox, oy, oz, sx, sy, sz); err != nil {
		return nil, err
	}
	if err := checkRegionCapacity(longs, bpe, sx, sy, sz); err != nil {
		return nil, err
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
