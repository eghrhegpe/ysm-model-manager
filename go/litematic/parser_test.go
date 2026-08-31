// ===== go/litematic parser + voxel 单测 =====
package litematic

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"

	"github.com/Tnze/go-mc/nbt"

	"ysm-model-manager/go/types"
)

// ====== buildRegionInfo ======

func makeMockRegion(t *testing.T, sx, sy, sz int, paletteNames []string, longs []int64) map[string]any {
	t.Helper()
	paletteList := make([]any, len(paletteNames))
	for i, name := range paletteNames {
		paletteList[i] = map[string]any{"Name": name}
	}
	return map[string]any{
		"BlockStatePalette": paletteList,
		"Size":              map[string]any{"x": int32(sx), "y": int32(sy), "z": int32(sz)},
		"Position":          map[string]any{"x": int32(0), "y": int32(0), "z": int32(0)},
		"BlockStates":       longs,
	}
}

func TestBuildRegionInfo_Valid(t *testing.T) {
	region := makeMockRegion(t, 3, 3, 3, []string{"air", "minecraft:stone"}, []int64{0, 0})
	info, err := buildRegionInfo(region)
	if err != nil {
		t.Fatalf("合法 region 不应 error: %v", err)
	}
	if info == nil {
		t.Fatal("期望非 nil")
	}
	if info.sizeX != 3 || info.sizeY != 3 || info.sizeZ != 3 {
		t.Errorf("size = %d,%d,%d, 期望 3,3,3", info.sizeX, info.sizeY, info.sizeZ)
	}
	if len(info.palette) != 2 {
		t.Errorf("palette 长度 = %d, 期望 2", len(info.palette))
	}
	if info.bpe != 2 {
		t.Errorf("bpe = %d, 期望 2 (ceil(log2(2)) = 1, 但最小 2)", info.bpe)
	}
}

func TestBuildRegionInfo_NilPalette(t *testing.T) {
	region := map[string]any{
		"Size":        map[string]any{"x": int32(1), "y": int32(1), "z": int32(1)},
		"BlockStates": []int64{0},
	}
	info, err := buildRegionInfo(region)
	if info != nil {
		t.Errorf("无 palette 应返回 nil, 得到 %+v", info)
	}
	if err != nil {
		t.Errorf("无 palette 应为合法空，不应 error: %v", err)
	}
}

func TestBuildRegionInfo_NoSize(t *testing.T) {
	region := map[string]any{
		"BlockStatePalette": []any{map[string]any{"Name": "air"}, map[string]any{"Name": "stone"}},
		"BlockStates":       []int64{0},
	}
	info, err := buildRegionInfo(region)
	if info != nil {
		t.Errorf("无 Size 应返回 nil, 得到 %+v", info)
	}
	if err == nil {
		t.Errorf("无 Size 应返回 error")
	}
}

func TestBuildRegionInfo_NoBlockStates(t *testing.T) {
	region := map[string]any{
		"BlockStatePalette": []any{map[string]any{"Name": "air"}, map[string]any{"Name": "stone"}},
		"Size":              map[string]any{"x": int32(1), "y": int32(1), "z": int32(1)},
	}
	info, err := buildRegionInfo(region)
	if info != nil {
		t.Errorf("无 BlockStates 应返回 nil, 得到 %+v", info)
	}
	if err == nil {
		t.Errorf("非空尺寸缺 BlockStates 应返回 error")
	}
}

func TestBuildRegionInfo_NegativeSize(t *testing.T) {
	// 负 size 应标准化为正 size 并调整 origin
	region := map[string]any{
		"BlockStatePalette": []any{map[string]any{"Name": "air"}, map[string]any{"Name": "stone"}},
		"Size":              map[string]any{"x": int32(-3), "y": int32(-3), "z": int32(-3)},
		"Position":          map[string]any{"x": int32(5), "y": int32(5), "z": int32(5)},
		"BlockStates":       []int64{0, 0},
	}
	info, err := buildRegionInfo(region)
	if err != nil {
		t.Fatalf("负 size 应标准化成功, 实际 error: %v", err)
	}
	if info == nil {
		t.Fatal("期望非 nil")
	}
	if info.sizeX != 3 || info.sizeY != 3 || info.sizeZ != 3 {
		t.Errorf("size 应标准化为正: %d,%d,%d", info.sizeX, info.sizeY, info.sizeZ)
	}
	// origin 应调整为 5 + (-3) + 1 = 3
	if info.originX != 3 || info.originY != 3 || info.originZ != 3 {
		t.Errorf("origin 应调整: %d,%d,%d", info.originX, info.originY, info.originZ)
	}
}

func TestBuildRegionInfo_SinglePalette(t *testing.T) {
	// palette 只有 1 个元素（仅 air）→ 返回 nil, nil（合法空）
	region := makeMockRegion(t, 1, 1, 1, []string{"air"}, []int64{0})
	info, err := buildRegionInfo(region)
	if info != nil {
		t.Errorf("单元素 palette 应返回 nil, 得到 %+v", info)
	}
	if err != nil {
		t.Errorf("单元素 palette 应为合法空，不应返回 error: %v", err)
	}
}

func TestBuildRegionInfo_SizeTooLarge(t *testing.T) {
	// 单轴超过 maxRegionAxis (2^21) → 拒绝（防 int32 尺寸乘积回绕 + DoS 扫描上界）
	region := map[string]any{
		"BlockStatePalette": []any{map[string]any{"Name": "air"}, map[string]any{"Name": "stone"}},
		"Size":              map[string]any{"x": int32(1<<21 + 1), "y": int32(1), "z": int32(1)},
		"Position":          map[string]any{"x": int32(0), "y": int32(0), "z": int32(0)},
		"BlockStates":       []int64{0},
	}
	info, err := buildRegionInfo(region)
	if info != nil {
		t.Errorf("超轴上限应返回 nil, 得到 %+v", info)
	}
	if err == nil {
		t.Errorf("超轴上限应返回 error")
	}
}

func TestBuildRegionInfo_OriginOutOfInt16(t *testing.T) {
	// origin=40000 超出 int16 正上限 32767 → 拒绝（防 int16 坐标静默回绕）
	region := map[string]any{
		"BlockStatePalette": []any{map[string]any{"Name": "air"}, map[string]any{"Name": "stone"}},
		"Size":              map[string]any{"x": int32(1), "y": int32(1), "z": int32(1)},
		"Position":          map[string]any{"x": int32(40000), "y": int32(0), "z": int32(0)},
		"BlockStates":       []int64{0},
	}
	info, err := buildRegionInfo(region)
	if info != nil {
		t.Errorf("origin 超 int16 应返回 nil, 得到 %+v", info)
	}
	if err == nil {
		t.Errorf("origin 超 int16 应返回 error")
	}
}

func TestBuildRegionInfo_NegativeOriginOutOfInt16(t *testing.T) {
	// origin=-40000 低于 int16 负下限 -32768 → 拒绝（负 origin 曾回绕成 25536 产生错误渲染位）
	region := map[string]any{
		"BlockStatePalette": []any{map[string]any{"Name": "air"}, map[string]any{"Name": "stone"}},
		"Size":              map[string]any{"x": int32(1), "y": int32(1), "z": int32(1)},
		"Position":          map[string]any{"x": int32(-40000), "y": int32(0), "z": int32(0)},
		"BlockStates":       []int64{0},
	}
	info, err := buildRegionInfo(region)
	if info != nil {
		t.Errorf("负 origin 超 int16 应返回 nil, 得到 %+v", info)
	}
	if err == nil {
		t.Errorf("负 origin 超 int16 应返回 error")
	}
}

// ====== aggregateBlockStatsFromPalette ======

func TestAggregateBlockStatsFromPalette_Valid(t *testing.T) {
	// 构造一个 3x3x3 region，longs 编码所有方块为 stone (palette index 1)
	// 3*3*3 = 27 块，bpe=2，每块 2 bits，共 54 bits
	// 2-bit 组全部为 01 = 0x5555555555555555
	region := makeMockRegion(t, 3, 3, 3, []string{"air", "minecraft:stone"}, []int64{0x5555555555555555, 0})
	regions := map[string]any{"Region": region}
	stats := aggregateBlockStatsFromPalette(regions)
	if len(stats) == 0 {
		t.Fatal("期望非空统计")
	}
	found := false
	for _, s := range stats {
		if s.Count > 0 {
			found = true
		}
	}
	if !found {
		t.Errorf("应有方块统计, 得到 %v", stats)
	}
}

func TestAggregateBlockStatsFromPalette_Empty(t *testing.T) {
	stats := aggregateBlockStatsFromPalette(map[string]any{})
	if len(stats) != 0 {
		t.Errorf("空输入应返回空, 得到 %d", len(stats))
	}
}

func TestAggregateBlockStatsFromPalette_InvalidRegion(t *testing.T) {
	regions := map[string]any{"Region": "not a map"}
	stats := aggregateBlockStatsFromPalette(regions)
	if len(stats) != 0 {
		t.Errorf("非法 region 应返回空, 得到 %d", len(stats))
	}
}

// ====== convertPreviewImage ======

func TestConvertPreviewImage_Valid(t *testing.T) {
	// 140x140 RGBA = 78400 bytes
	data := make([]byte, 140*140*4)
	for i := 0; i < 140*140; i++ {
		data[i*4] = 255   // A
		data[i*4+1] = 128 // R
		data[i*4+2] = 64  // G
		data[i*4+3] = 32  // B
	}
	result := convertPreviewImage(data)
	if result == "" {
		t.Fatal("期望非空 base64 data URI")
	}
	if len(result) < 30 {
		t.Errorf("结果太短: %d", len(result))
	}
	if result[:5] != "data:" {
		t.Errorf("应以 data: 开头, 得到 %q...", result[:10])
	}
}

func TestConvertPreviewImage_TooShort(t *testing.T) {
	result := convertPreviewImage([]byte{1, 2, 3})
	if result != "" {
		t.Errorf("太短数据应返回空字符串, 得到 %q", result)
	}
}

func TestConvertPreviewImage_Empty(t *testing.T) {
	result := convertPreviewImage([]byte{})
	if result != "" {
		t.Errorf("空数据应返回空字符串, 得到 %q", result)
	}
}

// ====== ParseSchematicSummary ======

func TestParseSchematicSummary_Valid(t *testing.T) {
	// 构造一个最小 schematic NBT 文件
	root := nbtCompound("",
		nbtInt("Version", 2),
		nbtInt("DataVersion", 2566),
		nbtInt("Width", 10),
		nbtInt("Height", 5),
		nbtInt("Length", 8),
		nbtCompound("Metadata",
			nbtString("Author", "测试作者"),
			nbtString("Name", "测试建筑"),
		),
		// Palette 和 Blocks 字段
		[]byte{
			0x08, // TAG_String named "Blocks" (实际是 byte array, 但用 string 模拟)
			0x00, 0x06, 'B', 'l', 'o', 'c', 'k', 's',
			0x00, 0x00, 0x00, 0x01, 0x02, // 长度 1, 内容: 0x01, 0x02
		},
	)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(root); err != nil {
		t.Fatal(err)
	}
	gz.Close()

	path := filepath.Join(t.TempDir(), "test.schematic")
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	result := ParseSchematicSummary(path)
	if result == nil {
		t.Fatal("期望非 nil")
	}
	if result["version"] != 2 {
		t.Errorf("version = %v, 期望 2", result["version"])
	}
	if result["dataVersion"] != 2566 {
		t.Errorf("dataVersion = %v, 期望 2566", result["dataVersion"])
	}
}

func TestParseSchematicSummary_NonExistent(t *testing.T) {
	result := ParseSchematicSummary("/nonexistent/path.schematic")
	if result != nil {
		t.Errorf("不存在文件应返回 nil, 得到 %v", result)
	}
}

func TestParseSchematicSummary_NotGzip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.schematic")
	if err := os.WriteFile(path, []byte("notgzip"), 0644); err != nil {
		t.Fatal(err)
	}
	result := ParseSchematicSummary(path)
	if result != nil {
		t.Errorf("非 gzip 应返回 nil, 得到 %v", result)
	}
}

func TestParseSchematicSummary_NotNBT(t *testing.T) {
	// gzip 但非 NBT 数据
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write([]byte("not nbt"))
	gz.Close()
	path := filepath.Join(t.TempDir(), "badnbt.schematic")
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	result := ParseSchematicSummary(path)
	if result != nil {
		t.Errorf("非 NBT 应返回 nil, 得到 %v", result)
	}
}

// ====== ParseNbtStructure ======

func TestParseNbtStructure_Valid(t *testing.T) {
	// 用 nbt.Marshal 正确编码 NBT 数据结构
	root := map[string]any{
		"DataVersion": int32(2566),
		"size":        []int32{3, 4, 5},
		"blocks":      []any{},
		"palette": []any{
			map[string]any{"Name": "minecraft:stone"},
			map[string]any{"Name": "minecraft:dirt"},
		},
	}
	raw, err := nbt.Marshal(root)
	if err != nil {
		t.Fatalf("nbt.Marshal 失败: %v", err)
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(raw); err != nil {
		t.Fatal(err)
	}
	gz.Close()

	path := filepath.Join(t.TempDir(), "test.nbt")
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	result := ParseNbtStructure(path)
	if result == nil {
		t.Fatal("期望非 nil")
	}
	if result["dataVersion"] != 2566 {
		t.Errorf("dataVersion = %v, 期望 2566", result["dataVersion"])
	}
	if result["blockCount"] != 0 {
		t.Errorf("blockCount = %v, 期望 0", result["blockCount"])
	}
}

// TestParseNbtStructure_SizeGuard 覆盖 R28 P3-2 的 size 断言守卫：
// 仅当 3 元素均为 int32 且尺寸全正时才设 size，避免前端拿到全零 size / 下游 voxel 除零。
// 注意：size 必须编码为 NBT List（[]any{int32...}），[]int32 会被编码为 Int_Array 而 getList 取不到。
func TestParseNbtStructure_SizeGuard(t *testing.T) {
	mkSizeNbt := func(size any) string {
		root := map[string]any{
			"DataVersion": int32(2566),
			"size":        size,
			"blocks":      []any{},
			"palette":     []any{map[string]any{"Name": "minecraft:stone"}},
		}
		raw, err := nbt.Marshal(root)
		if err != nil {
			t.Fatalf("nbt.Marshal 失败: %v", err)
		}
		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		if _, err := gz.Write(raw); err != nil {
			t.Fatal(err)
		}
		gz.Close()
		path := filepath.Join(t.TempDir(), "size.nbt")
		if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}
		return path
	}

	t.Run("valid positive", func(t *testing.T) {
		result := ParseNbtStructure(mkSizeNbt([]any{int32(3), int32(4), int32(5)}))
		if result == nil {
			t.Fatal("期望非 nil")
		}
		got, ok := result["size"].([]int)
		if !ok || got[0] != 3 || got[1] != 4 || got[2] != 5 {
			t.Errorf("size = %v, 期望 [3 4 5]", result["size"])
		}
	})
	t.Run("wrong element type", func(t *testing.T) {
		result := ParseNbtStructure(mkSizeNbt([]any{"3", "4", "5"}))
		if result["size"] != nil {
			t.Errorf("类型断言失败不应设 size, 得到 %v", result["size"])
		}
	})
	t.Run("zero size rejected", func(t *testing.T) {
		result := ParseNbtStructure(mkSizeNbt([]any{int32(0), int32(0), int32(0)}))
		if result["size"] != nil {
			t.Errorf("零尺寸不应设 size, 得到 %v", result["size"])
		}
	})
	t.Run("len != 3 ignored", func(t *testing.T) {
		result := ParseNbtStructure(mkSizeNbt([]any{int32(1)}))
		if result["size"] != nil {
			t.Errorf("长度!=3 不应设 size, 得到 %v", result["size"])
		}
	})
}

func TestParseNbtStructure_NonExistent(t *testing.T) {
	result := ParseNbtStructure("/nonexistent/path.nbt")
	if result != nil {
		t.Errorf("不存在文件应返回 nil, 得到 %v", result)
	}
}

func TestParseNbtStructure_NoSizeOrBlocks(t *testing.T) {
	// 缺少 size/blocks/palette → 返回 nil
	root := nbtCompound("", nbtInt("DataVersion", 2566))
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(root); err != nil {
		t.Fatal(err)
	}
	gz.Close()
	path := filepath.Join(t.TempDir(), "empty.nbt")
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	result := ParseNbtStructure(path)
	if result != nil {
		t.Errorf("缺 size/blocks/palette 应返回 nil, 得到 %v", result)
	}
}

// ====== ParseNbtStructure 基岩版 1.21+（sub_levels 多子结构）======

// makeBedrockSubLevel 构造基岩版 1.21+ sub_level（TAG_List 内 compound 元素，无 type/name）。
// palette: block_palette 的 Name 列表（与 blocks.palette_id 下标对应）；
// bounds: [minX,minY,minZ,maxX,maxY,maxZ]；blockPIDs: blocks 的 palette_id 序列。
func makeBedrockSubLevel(palette []string, bounds []int32, blockPIDs ...int32) []byte {
	var paletteElems [][]byte
	for _, name := range palette {
		paletteElems = append(paletteElems, nbtCompoundBody(nbtString("Name", name)))
	}
	var blockElems [][]byte
	for _, pid := range blockPIDs {
		blockElems = append(blockElems, nbtCompoundBody(
			nbtCompound("local_pos", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
			nbtInt("palette_id", pid),
		))
	}
	return nbtCompoundBody(
		nbtList("block_palette", 0x0A, paletteElems...),
		nbtList("blocks", 0x0A, blockElems...),
		nbtCompound("local_bounds",
			nbtInt("min_x", bounds[0]), nbtInt("min_y", bounds[1]), nbtInt("min_z", bounds[2]),
			nbtInt("max_x", bounds[3]), nbtInt("max_y", bounds[4]), nbtInt("max_z", bounds[5]),
		),
	)
}

// makeBedrockStructure 构造基岩版 1.21+ structure（根含 version + sub_levels）。
func makeBedrockStructure(t *testing.T, subLevels ...[]byte) string {
	t.Helper()
	root := nbtCompound("",
		nbtInt("version", 2),
		nbtList("sub_levels", 0x0A, subLevels...),
	)
	return writeGzNbt(t, root)
}

func TestParseNbtStructure_BedrockSubLevels(t *testing.T) {
	// 两个 sub_level：尺寸聚合取全局包围盒、方块数跨子结构求和、
	// paletteStats 按 blocks.palette_id 引用 block_palette.Name 统计真实方块数
	sub1 := makeBedrockSubLevel(
		[]string{"minecraft:stone", "minecraft:dirt"},
		[]int32{0, 0, 0, 2, 3, 4},
		0, 0, 1, // stone×2 + dirt×1
	)
	sub2 := makeBedrockSubLevel(
		[]string{"minecraft:dirt", "minecraft:oak_log"},
		[]int32{1, 1, 1, 5, 6, 7},
		1, 0, 1, // oak_log×2 + dirt×1
	)
	path := makeBedrockStructure(t, sub1, sub2)

	result := ParseNbtStructure(path)
	if result == nil {
		t.Fatal("基岩版 sub_levels 结构应解析成功，得到 nil")
	}
	// 全局包围盒：min 取各子结构最小、max 取最大 → size = (max-min+1)
	size, ok := result["size"].([]int)
	if !ok {
		t.Fatalf("size 缺失或类型错误: %v", result["size"])
	}
	wantSize := []int{5 - 0 + 1, 6 - 0 + 1, 7 - 0 + 1} // [6, 7, 8]
	for i := range wantSize {
		if size[i] != wantSize[i] {
			t.Errorf("size[%d] = %d, 期望 %d", i, size[i], wantSize[i])
		}
	}
	if result["blockCount"] != 6 {
		t.Errorf("blockCount = %v, 期望 6", result["blockCount"])
	}
	stats, ok := result["paletteStats"].([]types.LitematicBlockStat)
	if !ok {
		t.Fatalf("paletteStats 缺失或类型错误: %v", result["paletteStats"])
	}
	// 期望按真实方块数降序：dirt×2, oak_log×2, stone×2（Count 相同按名）
	if len(stats) != 3 {
		t.Fatalf("paletteStats 长度 = %d, 期望 3（%v）", len(stats), stats)
	}
	for _, s := range stats {
		if s.Count != 2 {
			t.Errorf("paletteStats 条目 %q Count = %d, 期望 2", s.Name, s.Count)
		}
	}
}

func TestParseNbtStructure_BedrockEmptyBlocks(t *testing.T) {
	// sub_levels 存在但 blocks 为空：size 仍推导，blockCount=0 不写入（前端以 size 判定通过）
	sub := makeBedrockSubLevel(
		[]string{"minecraft:stone"},
		[]int32{0, 0, 0, 3, 3, 3},
	)
	path := makeBedrockStructure(t, sub)

	result := ParseNbtStructure(path)
	if result == nil {
		t.Fatal("含 local_bounds 的 sub_levels 应解析成功，得到 nil")
	}
	if _, ok := result["size"]; !ok {
		t.Errorf("size 缺失（local_bounds 应推导包围盒）: %v", result)
	}
	if _, ok := result["blockCount"]; ok {
		t.Errorf("blocks 为空不应写入 blockCount: %v", result)
	}
}

func TestParseNbtStructure_BedrockPaletteIdOutOfRange(t *testing.T) {
	// palette_id 越界（超出 block_palette 长度）：跳过不计，不 panic
	sub := makeBedrockSubLevel(
		[]string{"minecraft:stone"},
		[]int32{0, 0, 0, 1, 1, 1},
		0, 5, // palette_id=5 越界（palette 仅 1 项）
	)
	path := makeBedrockStructure(t, sub)

	result := ParseNbtStructure(path)
	if result == nil {
		t.Fatal("越界 palette_id 不应使解析失败")
	}
	stats, ok := result["paletteStats"].([]types.LitematicBlockStat)
	if !ok {
		t.Fatalf("paletteStats 缺失: %v", result)
	}
	if len(stats) != 1 || stats[0].Count != 1 {
		t.Errorf("越界 palette_id 应跳过，仅统计合法引用: %v", stats)
	}
	if result["blockCount"] != 2 {
		t.Errorf("blockCount 应含越界条目（blocks 长度 2）: %v", result["blockCount"])
	}
}
