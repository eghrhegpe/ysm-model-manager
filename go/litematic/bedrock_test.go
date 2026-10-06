// ===== parseBedrockStructure 特征测试（先测后改：拆解前录制既有行为）=====
// 该函数此前只经 ParseNbtStructure 间接覆盖（parser_test.go 三个用例，语句覆盖 83.3%），
// 以下分支在拆解前无任何断言：DataVersion 提取、非 compound 的子结构/方块元素跳过、
// entities / block_entities 计数、以及「无尺寸且内容不足 → nil」的有效判定。
// 直调（绕过 gzip/NBT 解码）以便逐条钉死分支语义；值类型对齐 go-mc 解码产物（int32）。
package litematic

import (
	"os"
	"path/filepath"
	"testing"
)

// bedrockBoundsMap 构造 local_bounds compound（字段名同基岩版，值类型 int32）。
func bedrockBoundsMap(minX, minY, minZ, maxX, maxY, maxZ int32) map[string]any {
	return map[string]any{
		"min_x": minX, "min_y": minY, "min_z": minZ,
		"max_x": maxX, "max_y": maxY, "max_z": maxZ,
	}
}

// bedrockPaletteEntry 构造 block_palette 条目（Name 引用）。
func bedrockPaletteEntry(name string) map[string]any {
	return map[string]any{"Name": name}
}

// bedrockBlock 构造 blocks 条目（palette_id 引用）。
func bedrockBlock(pid int32) map[string]any {
	return map[string]any{"palette_id": pid}
}

func TestParseBedrockStructure_DataVersionAndJunkSubLevel(t *testing.T) {
	// 非 compound 子结构元素（字符串 / nil）跳过，不影响其余子结构聚合
	root := map[string]any{"DataVersion": int32(2566)}
	subLevels := []any{
		"junk element",
		nil,
		map[string]any{"local_bounds": bedrockBoundsMap(0, 0, 0, 0, 0, 0)},
	}
	result := parseBedrockStructure(root, subLevels)
	if result == nil {
		t.Fatal("含 local_bounds 应非 nil")
	}
	if result["dataVersion"] != 2566 {
		t.Errorf("dataVersion = %v, 期望 2566", result["dataVersion"])
	}
	sz, ok := result["size"].([]int)
	if !ok || sz[0] != 1 || sz[1] != 1 || sz[2] != 1 {
		t.Errorf("size = %v, 期望 [1 1 1]", result["size"])
	}
}

func TestParseBedrockStructure_EntityCountsAndJunkBlockElement(t *testing.T) {
	// 非 compound 方块元素跳过统计但仍计入 blockCount（len(blocks) 口径）
	sub := map[string]any{
		"local_bounds": bedrockBoundsMap(0, 0, 0, 1, 1, 1),
		"blocks": []any{
			"junk block",
			bedrockBlock(0),
		},
		"block_palette":  []any{bedrockPaletteEntry("minecraft:stone")},
		"entities":       []any{map[string]any{"id": "pig"}, map[string]any{"id": "cow"}},
		"block_entities": []any{map[string]any{"id": "chest"}},
	}
	result := parseBedrockStructure(map[string]any{}, []any{sub})
	if result == nil {
		t.Fatal("期望非 nil")
	}
	if result["blockCount"] != 2 {
		t.Errorf("blockCount = %v, 期望 2（含非 compound 元素）", result["blockCount"])
	}
	if result["entityCount"] != 2 {
		t.Errorf("entityCount = %v, 期望 2", result["entityCount"])
	}
	if result["tileEntityCount"] != 1 {
		t.Errorf("tileEntityCount = %v, 期望 1", result["tileEntityCount"])
	}
	total, names := summarizeStats(t, result["paletteStats"])
	if total != 1 || names["石头"] != 1 {
		t.Errorf("paletteStats = %v, 期望仅石头 ×1", names)
	}
}

func TestParseBedrockStructure_EmptyEntityListsOmitKeys(t *testing.T) {
	// 空（非 nil）列表计数为 0 → 对应键不写入
	sub := map[string]any{
		"local_bounds":   bedrockBoundsMap(0, 0, 0, 0, 0, 0),
		"blocks":         []any{},
		"entities":       []any{},
		"block_entities": []any{},
	}
	result := parseBedrockStructure(map[string]any{}, []any{sub})
	if result == nil {
		t.Fatal("有 local_bounds 即应非 nil")
	}
	for _, key := range []string{"blockCount", "entityCount", "tileEntityCount"} {
		if _, ok := result[key]; ok {
			t.Errorf("计数为 0 不应写入 %s: %v", key, result[key])
		}
	}
}

func TestParseBedrockStructure_NoBoundsReturnsNil(t *testing.T) {
	// 无 local_bounds → 无 size；result 键数 ≤1 → 判无效返回 nil
	cases := []struct {
		name      string
		root      map[string]any
		subLevels []any
	}{
		{"空 root + 空 sub_levels", map[string]any{}, nil},
		{"仅 DataVersion", map[string]any{"DataVersion": int32(1)}, nil},
		{"仅 entities", map[string]any{}, []any{map[string]any{"entities": []any{"e"}}}},
		{"非 compound 子结构元素", map[string]any{}, []any{"junk", nil}},
	}
	for _, tc := range cases {
		if r := parseBedrockStructure(tc.root, tc.subLevels); r != nil {
			t.Errorf("%s：无尺寸应返回 nil, 得到 %v", tc.name, r)
		}
	}
}

func TestParseBedrockStructure_BlockCountAloneKeepsResult(t *testing.T) {
	// 反向对照：无 local_bounds（无 size）但方块统计 + blockCount 使 result 键数 > 1
	// → 不判无效，原样返回（码点：`!hasSize && len(result) <= 1`）
	sub := map[string]any{
		"blocks":        []any{bedrockBlock(0)},
		"block_palette": []any{bedrockPaletteEntry("minecraft:stone")},
	}
	result := parseBedrockStructure(map[string]any{}, []any{sub})
	if result == nil {
		t.Fatal("有 blockCount + paletteStats 时不应返回 nil")
	}
	if _, ok := result["size"]; ok {
		t.Errorf("无 local_bounds 不应有 size: %v", result["size"])
	}
	if result["blockCount"] != 1 {
		t.Errorf("blockCount = %v, 期望 1", result["blockCount"])
	}
}

func TestParseBedrockStructure_EmptyLocalBoundsStillCountsAsBounds(t *testing.T) {
	// hasBounds 只看 local_bounds compound 是否存在（不看字段是否可解析）：
	// 空 compound → 全零包围盒 → size = [1 1 1]
	sub := map[string]any{"local_bounds": map[string]any{}}
	result := parseBedrockStructure(map[string]any{}, []any{sub})
	if result == nil {
		t.Fatal("local_bounds 存在即视为有包围盒，应非 nil")
	}
	sz, ok := result["size"].([]int)
	if !ok || sz[0] != 1 || sz[1] != 1 || sz[2] != 1 {
		t.Errorf("size = %v, 期望 [1 1 1]", result["size"])
	}
}

func TestParseBedrockStructure_BoundsAggregationSemantics(t *testing.T) {
	// 首个 local_bounds 无条件赋值（hasBounds=false 时不做 min/max 比较），
	// 后续子结构按 min 取小 / max 取大，缺字段不动既有值
	subNoBounds := map[string]any{"blocks": []any{}}
	subFirst := map[string]any{"local_bounds": bedrockBoundsMap(5, 5, 5, 100, 100, 100)}
	subPartial := map[string]any{"local_bounds": map[string]any{"min_x": int32(9), "max_x": int32(200)}}
	result := parseBedrockStructure(map[string]any{}, []any{subNoBounds, subFirst, subPartial})
	if result == nil {
		t.Fatal("期望非 nil")
	}
	sz, ok := result["size"].([]int)
	if !ok {
		t.Fatalf("size 缺失或类型错误: %v", result["size"])
	}
	// min_x: 9 不覆盖 5；max_x: 200 覆盖 100；y/z 保持 5..100
	want := []int{200 - 5 + 1, 100 - 5 + 1, 100 - 5 + 1}
	for i := range want {
		if sz[i] != want[i] {
			t.Errorf("size[%d] = %d, 期望 %d（size=%v）", i, sz[i], want[i], sz)
		}
	}
}

func TestParseBedrockStructure_PaletteReferenceGuards(t *testing.T) {
	// palette 空名/非 compound 条目、palette_id 缺失/负数/越界均跳过统计；
	// blockCount 仍按 blocks 元素总数计
	sub := map[string]any{
		"local_bounds": bedrockBoundsMap(0, 0, 0, 0, 0, 0),
		"block_palette": []any{
			bedrockPaletteEntry(""),
			"junk palette entry",
			bedrockPaletteEntry("minecraft:stone"),
		},
		"blocks": []any{
			bedrockBlock(0),                   // 空名 → 跳过
			bedrockBlock(1),                   // 非 compound palette 条目 → 空名 → 跳过
			bedrockBlock(2),                   // minecraft:stone
			map[string]any{},                  // 无 palette_id → 跳过
			bedrockBlock(-1),                  // 负数 → 跳过
			bedrockBlock(3),                   // 越界 → 跳过
			map[string]any{"palette_id": "0"}, // 非整数 → 跳过
		},
	}
	result := parseBedrockStructure(map[string]any{}, []any{sub})
	if result == nil {
		t.Fatal("期望非 nil")
	}
	if result["blockCount"] != 7 {
		t.Errorf("blockCount = %v, 期望 7", result["blockCount"])
	}
	total, names := summarizeStats(t, result["paletteStats"])
	if total != 1 || names["石头"] != 1 {
		t.Errorf("paletteStats = %v, 期望仅石头 ×1", names)
	}
}

// TestParseNbtStructure_BedrockDataVersionEndToEnd 走完整字节链路：
// 根只有 DataVersion（注意 makeBedrockStructure 写的是 version，parseBedrockStructure
// 不读该键）——锁定既有口径，防止拆解时误改键名。
func TestParseNbtStructure_BedrockDataVersionEndToEnd(t *testing.T) {
	sub := makeBedrockSubLevel(
		[]string{"minecraft:stone"},
		[]int32{0, 0, 0, 2, 2, 2},
		0,
	)
	root := nbtCompound("",
		nbtInt("DataVersion", 2566),
		nbtList("sub_levels", 0x0A, sub),
	)
	result := ParseNbtStructure(writeGzNbt(t, root))
	if result == nil {
		t.Fatal("基岩版结构应解析成功，得到 nil")
	}
	if result["dataVersion"] != 2566 {
		t.Errorf("dataVersion = %v, 期望 2566", result["dataVersion"])
	}
	if sz, ok := result["size"].([]int); !ok || sz[0] != 3 || sz[1] != 3 || sz[2] != 3 {
		t.Errorf("size = %v, 期望 [3 3 3]", result["size"])
	}
}

// TestParseNbtStructure_BedrockTruncated 畸形/截断输入：解压/解码失败 → nil（不 panic）。
func TestParseNbtStructure_BedrockTruncated(t *testing.T) {
	root := nbtCompound("",
		nbtInt("DataVersion", 2566),
		nbtList("sub_levels", 0x0A, makeBedrockSubLevel(
			[]string{"minecraft:stone"}, []int32{0, 0, 0, 1, 1, 1}, 0)),
	)
	gz := fuzzGz(t, root)
	path := filepath.Join(t.TempDir(), "trunc_bedrock.nbt")
	if err := os.WriteFile(path, gz[:len(gz)/2], 0644); err != nil {
		t.Fatal(err)
	}
	if result := ParseNbtStructure(path); result != nil {
		t.Errorf("截断的基岩版结构应返回 nil, 得到 %v", result)
	}
}
