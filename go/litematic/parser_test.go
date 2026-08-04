// ===== go/litematic parser + voxel 单测 =====
package litematic

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"

	"github.com/Tnze/go-mc/nbt"
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
	info := buildRegionInfo(region)
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
	info := buildRegionInfo(region)
	if info != nil {
		t.Errorf("无 palette 应返回 nil, 得到 %+v", info)
	}
}

func TestBuildRegionInfo_NoSize(t *testing.T) {
	region := map[string]any{
		"BlockStatePalette": []any{map[string]any{"Name": "air"}, map[string]any{"Name": "stone"}},
		"BlockStates":       []int64{0},
	}
	info := buildRegionInfo(region)
	if info != nil {
		t.Errorf("无 Size 应返回 nil, 得到 %+v", info)
	}
}

func TestBuildRegionInfo_NoBlockStates(t *testing.T) {
	region := map[string]any{
		"BlockStatePalette": []any{map[string]any{"Name": "air"}, map[string]any{"Name": "stone"}},
		"Size":              map[string]any{"x": int32(1), "y": int32(1), "z": int32(1)},
	}
	info := buildRegionInfo(region)
	if info != nil {
		t.Errorf("无 BlockStates 应返回 nil, 得到 %+v", info)
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
	info := buildRegionInfo(region)
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
	// palette 只有 1 个元素（仅 air）→ 返回 nil
	region := makeMockRegion(t, 1, 1, 1, []string{"air"}, []int64{0})
	info := buildRegionInfo(region)
	if info != nil {
		t.Errorf("单元素 palette 应返回 nil, 得到 %+v", info)
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

// ====== ParseSchematic ======

func TestParseSchematic_Valid(t *testing.T) {
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

	result := ParseSchematic(path)
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

func TestParseSchematic_NonExistent(t *testing.T) {
	result := ParseSchematic("/nonexistent/path.schematic")
	if result != nil {
		t.Errorf("不存在文件应返回 nil, 得到 %v", result)
	}
}

func TestParseSchematic_NotGzip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.schematic")
	if err := os.WriteFile(path, []byte("notgzip"), 0644); err != nil {
		t.Fatal(err)
	}
	result := ParseSchematic(path)
	if result != nil {
		t.Errorf("非 gzip 应返回 nil, 得到 %v", result)
	}
}

func TestParseSchematic_NotNBT(t *testing.T) {
	// gzip 但非 NBT 数据
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write([]byte("not nbt"))
	gz.Close()
	path := filepath.Join(t.TempDir(), "badnbt.schematic")
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	result := ParseSchematic(path)
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