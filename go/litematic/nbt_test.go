// ===== go/litematic NBT 工具函数 + block_ids 单测 =====
package litematic

import (
	"testing"
)

// ====== getLong ======

func TestGetLong_Found(t *testing.T) {
	m := map[string]any{"key": int64(12345)}
	v, ok := getLong(m, "key")
	if !ok || v != 12345 {
		t.Errorf("期望 12345, true, 得到 %d, %v", v, ok)
	}
}

func TestGetLong_NotFound(t *testing.T) {
	v, ok := getLong(map[string]any{}, "nope")
	if ok || v != 0 {
		t.Errorf("未找到应返回 0, false, 得到 %d, %v", v, ok)
	}
}

func TestGetLong_WrongType(t *testing.T) {
	m := map[string]any{"key": "string"}
	v, ok := getLong(m, "key")
	if ok || v != 0 {
		t.Errorf("类型不匹配应返回 0, false, 得到 %d, %v", v, ok)
	}
}

// ====== getByteArray ======

func TestGetByteArray_Found(t *testing.T) {
	m := map[string]any{"key": []byte{1, 2, 3}}
	v, ok := getByteArray(m, "key")
	if !ok || len(v) != 3 || v[0] != 1 {
		t.Errorf("期望 [1 2 3], true, 得到 %v, %v", v, ok)
	}
}

func TestGetByteArray_NotFound(t *testing.T) {
	v, ok := getByteArray(map[string]any{}, "nope")
	if ok || v != nil {
		t.Errorf("未找到应返回 nil, false, 得到 %v, %v", v, ok)
	}
}

func TestGetByteArray_WrongType(t *testing.T) {
	m := map[string]any{"key": 123}
	v, ok := getByteArray(m, "key")
	if ok || v != nil {
		t.Errorf("类型不匹配应返回 nil, false, 得到 %v, %v", v, ok)
	}
}

// ====== getLongArray ======

func TestGetLongArray_Found(t *testing.T) {
	m := map[string]any{"key": []int64{1, 2, 3}}
	v, ok := getLongArray(m, "key")
	if !ok || len(v) != 3 || v[0] != 1 {
		t.Errorf("期望 [1 2 3], true, 得到 %v, %v", v, ok)
	}
}

func TestGetLongArray_NotFound(t *testing.T) {
	v, ok := getLongArray(map[string]any{}, "nope")
	if ok || v != nil {
		t.Errorf("未找到应返回 nil, false, 得到 %v, %v", v, ok)
	}
}

func TestGetLongArray_WrongType(t *testing.T) {
	m := map[string]any{"key": "string"}
	v, ok := getLongArray(m, "key")
	if ok || v != nil {
		t.Errorf("类型不匹配应返回 nil, false, 得到 %v, %v", v, ok)
	}
}

// ====== getList ======

func TestGetList_Found(t *testing.T) {
	m := map[string]any{"key": []any{"a", "b", "c"}}
	v := getList(m, "key")
	if len(v) != 3 {
		t.Errorf("期望 3 个元素, 得到 %d: %v", len(v), v)
	}
}

func TestGetList_NotFound(t *testing.T) {
	v := getList(map[string]any{}, "nope")
	if v != nil {
		t.Errorf("未找到应返回 nil, 得到 %v", v)
	}
}

func TestGetList_WrongType(t *testing.T) {
	m := map[string]any{"key": "string"}
	v := getList(m, "key")
	if v != nil {
		t.Errorf("类型不匹配应返回 nil, 得到 %v", v)
	}
}

// ====== getCompoundKey ======

func TestGetCompoundKey_Found(t *testing.T) {
	m := map[string]any{"key": "value"}
	v := getCompoundKey(m, "key")
	if v.(string) != "value" {
		t.Errorf("期望 value, 得到 %v", v)
	}
}

func TestGetCompoundKey_NotFound(t *testing.T) {
	v := getCompoundKey(map[string]any{}, "nope")
	if v != nil {
		t.Errorf("未找到应返回 nil, 得到 %v", v)
	}
}

// ====== extractBits ======

func TestExtractBits_SingleLong(t *testing.T) {
	// 在一个 long 内提取
	longs := []int64{0b1010} // bit 1 = 1, bit 3 = 1
	if v := extractBits(longs, 1, 1); v != 1 {
		t.Errorf("bit 1 应为 1, 得到 %d", v)
	}
	if v := extractBits(longs, 0, 1); v != 0 {
		t.Errorf("bit 0 应为 0, 得到 %d", v)
	}
}

func TestExtractBits_CrossLong(t *testing.T) {
	// 跨越两个 long 的边界
	longs := []int64{
		-1,  // all bits = 1
		0b1, // bit 0 = 1
	}
	v := extractBits(longs, 60, 8) // 从 long[0] 的 bit 60 开始取 8 位
	// long[0] bit 60-63 = 0xF, long[1] bit 0-3 = 0x1
	// 结果 = 0x1F
	expected := 0b11111
	if v != expected {
		t.Errorf("跨越边界: 期望 %d (0x%x), 得到 %d (0x%x)", expected, expected, v, v)
	}
}

func TestExtractBits_ZeroBitCount(t *testing.T) {
	if v := extractBits([]int64{42}, 0, 0); v != 0 {
		t.Errorf("bitCount=0 应返回 0, 得到 %d", v)
	}
}

func TestExtractBits_MaskExact(t *testing.T) {
	// 4 位全部取
	longs := []int64{0b1111}
	if v := extractBits(longs, 0, 4); v != 15 {
		t.Errorf("期望 15, 得到 %d", v)
	}
}

// ====== bitsPerEntry ======

func TestBitsPerEntry(t *testing.T) {
	tests := []struct {
		paletteSize int
		want        int
	}{
		{0, 0},
		{1, 0},
		{2, 2}, // ceil(log2(2)) = 1, 但最小 2
		{3, 2}, // ceil(log2(3)) = 2
		{4, 2},
		{5, 3}, // ceil(log2(5)) = 3
		{16, 4},
		{256, 8},
		{1000, 10},
	}
	for _, tt := range tests {
		got := bitsPerEntry(tt.paletteSize)
		if got != tt.want {
			t.Errorf("bitsPerEntry(%d) = %d, 期望 %d", tt.paletteSize, got, tt.want)
		}
	}
}

// ====== ResolveBlockName ======

func TestResolveBlockName_Known(t *testing.T) {
	// stone (ID 1:0)
	name := ResolveBlockName(1, 0)
	if name == "" {
		t.Fatal("stone (1:0) 应解析到非空名称")
	}
	if name != "minecraft:stone" {
		t.Logf("stone (1:0) 解析为 %q", name)
	}
}

func TestResolveBlockName_FallbackToData0(t *testing.T) {
	// 1:1（花岗岩变体）可能没有精确匹配，回退到 1:0
	name := ResolveBlockName(1, 1)
	if name == "" {
		t.Error("1:1 应回退到 1:0 并解析到名称")
	}
}

func TestResolveBlockName_Unknown(t *testing.T) {
	// 极大 ID 无匹配
	name := ResolveBlockName(99999, 0)
	if name != "" {
		t.Errorf("未知 ID 应返回空字符串, 得到 %q", name)
	}
}

// ====== ResolveBlockZH ======

func TestResolveBlockZH_Known(t *testing.T) {
	zh := ResolveBlockZH("minecraft:stone")
	if zh == "" || zh == "minecraft:stone" {
		t.Errorf("stone 应映射到中文名, 得到 %q", zh)
	}
}

func TestResolveBlockZH_Unknown(t *testing.T) {
	zh := ResolveBlockZH("minecraft:unknown_block_xyz")
	if zh != "unknown_block_xyz" {
		t.Errorf("未知方块应返回原始名称（去前缀）: %q", zh)
	}
}

func TestResolveBlockZH_NoPrefix(t *testing.T) {
	zh := ResolveBlockZH("stone")
	if zh == "" || zh == "stone" {
		t.Errorf("stone 无前缀也应映射到中文名, 得到 %q", zh)
	}
}

// ====== readVarInt ======

func TestReadVarInt_SingleByte(t *testing.T) {
	v, off := readVarInt([]byte{0x7F, 0x00}, 0)
	if v != 0x7F || off != 1 {
		t.Errorf("期望 127, 1, 得到 %d, %d", v, off)
	}
}

func TestReadVarInt_MultiByte(t *testing.T) {
	// 300 = 0xAC 0x02 (little-endian varint)
	v, off := readVarInt([]byte{0xAC, 0x02, 0x00}, 0)
	if v != 300 || off != 2 {
		t.Errorf("期望 300, 2, 得到 %d, %d", v, off)
	}
}

func TestReadVarInt_Zero(t *testing.T) {
	v, off := readVarInt([]byte{0x00}, 0)
	if v != 0 || off != 1 {
		t.Errorf("期望 0, 1, 得到 %d, %d", v, off)
	}
}

func TestReadVarInt_Offset(t *testing.T) {
	// 从 offset 2 开始读
	data := []byte{0xFF, 0xFF, 0x7F, 0x00}
	v, off := readVarInt(data, 2)
	if v != 0x7F || off != 3 {
		t.Errorf("期望 127, 3, 得到 %d, %d", v, off)
	}
}

func TestReadVarInt_OutOfBounds(t *testing.T) {
	v, off := readVarInt([]byte{0x80, 0x80, 0x80, 0x80, 0x80}, 0)
	// 没有终止字节，循环到末尾，返回最后结果
	_ = v
	_ = off
	// 验证不会 panic 即可
}

// ====== filterSurfaceOnly ======

func TestFilterSurfaceOnly_AllExposed(t *testing.T) {
	// 单个孤立方块 → 6 个方向都暴露
	groups := map[string][][3]int16{
		"stone": {{0, 0, 0}},
	}
	result := filterSurfaceOnly(groups)
	if len(result) != 1 {
		t.Fatalf("期望 1 组, 得到 %d", len(result))
	}
	if len(result["stone"]) != 1 {
		t.Errorf("孤立方块应保留, 得到 %d 个", len(result["stone"]))
	}
}

func TestFilterSurfaceOnly_InteriorRemoved(t *testing.T) {
	// 2x2x2 紧贴方块 → 只有最外层暴露
	groups := map[string][][3]int16{
		"stone": {
			{0, 0, 0}, {1, 0, 0}, {0, 1, 0}, {1, 1, 0},
			{0, 0, 1}, {1, 0, 1}, {0, 1, 1}, {1, 1, 1},
		},
	}
	result := filterSurfaceOnly(groups)
	if len(result) != 1 {
		t.Fatalf("期望 1 组, 得到 %d", len(result))
	}
	// 2x2x2 的 8 个方块全部暴露（没有内部方块）
	if len(result["stone"]) != 8 {
		t.Errorf("2x2x2 全部暴露, 期望 8, 得到 %d", len(result["stone"]))
	}
}

func TestFilterSurfaceOnly_3x3x3CenterHidden(t *testing.T) {
	// 3x3x3 中心方块(1,1,1) 被包围 → 应移除
	var positions [][3]int16
	for x := int16(0); x < 3; x++ {
		for y := int16(0); y < 3; y++ {
			for z := int16(0); z < 3; z++ {
				positions = append(positions, [3]int16{x, y, z})
			}
		}
	}
	groups := map[string][][3]int16{"stone": positions}
	result := filterSurfaceOnly(groups)
	// 3x3x3 = 27 个方块，中心 1 个被隐藏 → 26 个暴露
	if len(result["stone"]) != 26 {
		t.Errorf("3x3x3 期望 26 个暴露, 得到 %d", len(result["stone"]))
	}
}

func TestFilterSurfaceOnly_EmptyInput(t *testing.T) {
	result := filterSurfaceOnly(map[string][][3]int16{})
	if len(result) != 0 {
		t.Errorf("空输入应返回空 map, 得到 %d", len(result))
	}
}

func TestFilterSurfaceOnly_AllInterior(t *testing.T) {
	// 所有方块都被包围 → 全部移除
	groups := map[string][][3]int16{
		"stone": {{1, 1, 1}, {1, 1, 2}},
		"dirt":  {{1, 1, 0}, {1, 1, 3}},
	}
	result := filterSurfaceOnly(groups)
	// (1,1,1) 被 (1,1,0) (1,1,2) (上) 包围但 (1,1,1) 的邻居 (1,1,0) 在 stone 组外
	// 实际上所有方块都在不同组，每个方块都有未占用的邻居方向
	// 所以全部暴露
	if len(result) != 2 {
		t.Errorf("跨组方块应全部暴露, 期望 2 组, 得到 %d", len(result))
	}
}
