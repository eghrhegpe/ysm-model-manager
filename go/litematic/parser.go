package litematic

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"sort"

	"ysm-model-manager/go/types"
)

// sortedStats counts → []LitematicBlockStat，按 Count 降序。
// 四格式统计出口的公共收尾（原 litematic/schematic/structure/bedrock 各写一遍）；
// 计数方负责先把名字解析成最终形态（ResolveBlockZH 幂等，可安全重复调用）。
func sortedStats(counts map[string]int) []types.LitematicBlockStat {
	stats := make([]types.LitematicBlockStat, 0, len(counts))
	for name, count := range counts {
		stats = append(stats, types.LitematicBlockStat{Name: name, Count: count})
	}
	sort.Slice(stats, func(i, j int) bool {
		return stats[i].Count > stats[j].Count
	})
	return stats
}

// ParseMeta 解析 litematic 格式（Litematic/Minihud 保存的投影）元数据。
// schematic / structure NBT 的摘要解析见 schematic.go / structure.go。
func ParseMeta(path string) (*types.LitematicMeta, error) {
	root, err := openGzRoot(path)
	if err != nil {
		return nil, err
	}

	meta := &types.LitematicMeta{}

	if v, ok := getInt(root, "Version"); ok {
		meta.Version = v
	}
	if v, ok := getInt(root, "MinecraftDataVersion"); ok {
		meta.MinecraftDataVersion = v
	}

	metadata := getCompound(root, "Metadata")
	if metadata == nil {
		return nil, fmt.Errorf("缺少 Metadata compound")
	}

	meta.Name, _ = getString(metadata, "Name")
	meta.Author, _ = getString(metadata, "Author")
	meta.Description, _ = getString(metadata, "Description")
	meta.TimeCreated, _ = getLong(metadata, "TimeCreated")
	meta.TimeModified, _ = getLong(metadata, "TimeModified")
	if v, ok := getInt(metadata, "TotalBlocks"); ok {
		meta.TotalBlocks = v
	}
	if v, ok := getInt(metadata, "TotalVolume"); ok {
		meta.TotalVolume = v
	}

	if encSize := getCompound(metadata, "EnclosingSize"); encSize != nil {
		var size [3]int
		if v, ok := getInt(encSize, "x"); ok {
			size[0] = v
		}
		if v, ok := getInt(encSize, "y"); ok {
			size[1] = v
		}
		if v, ok := getInt(encSize, "z"); ok {
			size[2] = v
		}
		meta.EnclosingSize = size
	}

	if previewData, ok := getByteArray(metadata, "PreviewImage"); ok && len(previewData) > 0 {
		meta.PreviewImage = convertPreviewImage(previewData)
	}

	regions := getCompound(root, "Regions")
	if regions != nil {
		meta.RegionCount = len(regions)
		meta.BlockStats = aggregateBlockStatsFromPalette(regions)
	}

	return meta, nil
}

// maxStatBlocks 大投影方块统计截断上限：与渲染路径 maxBlocks 截断口径一致，
// 防止超大投影（如 100³=1M+ 方块）逐块提取拖慢元数据解析；上限内抽样统计足够反映方块占比
const maxStatBlocks = 2_000_000

func aggregateBlockStatsFromPalette(regions map[string]any) []types.LitematicBlockStat {
	counts := make(map[string]int)
	scanned := 0

	for _, regionTag := range regions {
		region, ok := regionTag.(map[string]any)
		if !ok {
			continue
		}

		paletteList := getList(region, "BlockStatePalette")
		if len(paletteList) <= 1 {
			continue
		}

		paletteNames := extractPaletteNames(paletteList)

		info, _ := buildRegionInfo(region)
		if info == nil {
			continue
		}

		totalBlocks := info.sizeX * info.sizeY * info.sizeZ
		if remain := maxStatBlocks - scanned; totalBlocks > remain {
			totalBlocks = remain
		}
		// bitOffset 累加代替 i*bpe 乘法；extractBits 内部已带越界守卫
		bitOffset := 0
		for i := 0; i < totalBlocks; i++ {
			paletteIdx := extractBits(info.longs, bitOffset, info.bpe)
			bitOffset += info.bpe
			if paletteIdx < 0 || paletteIdx >= len(paletteNames) || paletteIdx == 0 {
				continue
			}
			if name := paletteNames[paletteIdx]; name != "" {
				counts[ResolveBlockZH(name)]++
			}
		}
		scanned += totalBlocks
		if scanned >= maxStatBlocks {
			break
		}
	}

	return sortedStats(counts)
}

func convertPreviewImage(data []byte) string {
	const size = 140
	expectedLen := size * size * 4
	if len(data) < expectedLen {
		return ""
	}

	rgba := make([]byte, expectedLen)
	for i := 0; i < size*size; i++ {
		a := data[i*4]
		r := data[i*4+1]
		g := data[i*4+2]
		b := data[i*4+3]
		rgba[i*4] = r
		rgba[i*4+1] = g
		rgba[i*4+2] = b
		rgba[i*4+3] = a
	}

	img := &image.RGBA{
		Pix:    rgba,
		Stride: size * 4,
		Rect:   image.Rect(0, 0, size, size),
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}
