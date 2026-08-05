// ===== go/litematic BuildVoxelData 主函数测试（补 0% 覆盖）=====
// 覆盖：正常解析（region → 颜色分组）、maxBlocks 截断、无 Regions 降级、
// 非法文件报错。NBT fixture 程序化构造，复用 litematic_test.go 的 nbt* helper。
package litematic

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// nbtLong 构造 TAG_Long
func nbtLong(name string, v int64) []byte {
	b := []byte{0x04}
	b = append(b, byte(len(name)>>8), byte(len(name)))
	b = append(b, name...)
	for i := 7; i >= 0; i-- {
		b = append(b, byte(v>>(8*i)))
	}
	return b
}

// nbtLongArray 构造 TAG_Long_Array
func nbtLongArray(name string, vals []int64) []byte {
	b := []byte{0x0C}
	b = append(b, byte(len(name)>>8), byte(len(name)))
	b = append(b, name...)
	b = append(b, byte(len(vals)>>24), byte(len(vals)>>16), byte(len(vals)>>8), byte(len(vals)))
	for _, v := range vals {
		for i := 7; i >= 0; i-- {
			b = append(b, byte(v>>(8*i)))
		}
	}
	return b
}

// nbtList 构造 TAG_List（元素类型 + 元素字节流）
func nbtList(name string, elemType byte, elems ...[]byte) []byte {
	b := []byte{0x09}
	b = append(b, byte(len(name)>>8), byte(len(name)))
	b = append(b, name...)
	b = append(b, elemType)
	b = append(b, byte(len(elems)>>24), byte(len(elems)>>16), byte(len(elems)>>8), byte(len(elems)))
	for _, e := range elems {
		b = append(b, e...)
	}
	return b
}

// nbtCompoundBody 生成 list 内 compound 元素的字节体（无 type/name，children + TAG_End）
func nbtCompoundBody(children ...[]byte) []byte {
	b := []byte{}
	for _, c := range children {
		b = append(b, c...)
	}
	return append(b, 0x00)
}

// nbtIntBody 生成 list 内 int32 元素的字节体（无 type/name，4 字节大端）
func nbtIntBody(v int32) []byte {
	return []byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}
}

// nbtByteArray 构造 TAG_Byte_Array
func nbtByteArray(name string, data []byte) []byte {
	b := []byte{0x07}
	b = append(b, byte(len(name)>>8), byte(len(name)))
	b = append(b, name...)
	b = append(b, byte(len(data)>>24), byte(len(data)>>16), byte(len(data)>>8), byte(len(data)))
	return append(b, data...)
}

// makeSchematicV2Gz 构造 v2 schematic（BlockData varint + Palette）
func makeSchematicV2Gz(t *testing.T, w, h, l int, blockData []byte) []byte {
	t.Helper()
	root := nbtCompound("",
		nbtInt("Version", 2),
		nbtInt("Width", int32(w)),
		nbtInt("Height", int32(h)),
		nbtInt("Length", int32(l)),
		nbtByteArray("BlockData", blockData),
		nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
	)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(root); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// makeSchematicV1Gz 构造 v1 schematic（Blocks byte array + Data）
func makeSchematicV1Gz(t *testing.T, w, h, l int, blocks []byte) []byte {
	t.Helper()
	root := nbtCompound("",
		nbtInt("Version", 1),
		nbtInt("Width", int32(w)),
		nbtInt("Height", int32(h)),
		nbtInt("Length", int32(l)),
		nbtByteArray("Blocks", blocks),
		nbtByteArray("Data", make([]byte, len(blocks))),
		nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
	)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(root); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// makeNbtStructureGz 构造最小 structure NBT（size 1x1x1，palette 2 项，1 个方块）
func makeNbtStructureGz(t *testing.T, state int32) []byte {
	t.Helper()
	palette := nbtList("palette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	size := nbtList("size", 0x03, nbtIntBody(1), nbtIntBody(1), nbtIntBody(1))
	block := nbtList("blocks", 0x0A,
		nbtCompoundBody(
			nbtList("pos", 0x03, nbtIntBody(0), nbtIntBody(0), nbtIntBody(0)),
			nbtInt("state", state),
		),
	)
	root := nbtCompound("", size, palette, block)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(root); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// makeVoxelGz 构造最小 litematic（含 1 个 region：palette 2 项，BlockStates 1 long）
// blockStates 值：低 2 位（bpe=2）为 palette 索引；默认 1 → 取 palette[1]（stone）
func makeVoxelGz(t *testing.T, blockStates int64, maxBlocks int) (*types.LitematicVoxelData, []byte) {
	t.Helper()
	// BlockStatePalette：list of compound（list 内元素无 type/name 前缀）
	palette := nbtList("BlockStatePalette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	region := nbtCompound("0,0",
		palette,
		nbtCompound("Size", nbtInt("x", 1), nbtInt("y", 1), nbtInt("z", 1)),
		nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
		nbtLongArray("BlockStates", []int64{blockStates}),
	)
	regions := nbtCompound("Regions", region)
	metadata := nbtCompound("Metadata",
		nbtCompound("EnclosingSize", nbtInt("x", 1), nbtInt("y", 1), nbtInt("z", 1)),
	)
	root := nbtCompound("", nbtInt("Version", 5), metadata, regions)

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(root); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	_ = maxBlocks
	return nil, buf.Bytes()
}

func writeVoxelGz(t *testing.T, data []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.litematic")
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestBuildVoxelData_Success(t *testing.T) {
	_, data := makeVoxelGz(t, 1, 100)
	path := writeVoxelGz(t, data)
	result, err := BuildVoxelData(path, 100)
	if err != nil {
		t.Fatalf("BuildVoxelData 失败: %v", err)
	}
	if result.Size != [3]int{1, 1, 1} {
		t.Errorf("Size = %v, want [1 1 1]", result.Size)
	}
	// palette[1]=stone → 1 个颜色组，1 个方块
	if len(result.Groups) != 1 {
		t.Fatalf("Groups = %d, want 1（got %+v）", len(result.Groups), result.Groups)
	}
	if len(result.Groups[0].Positions) != 1 {
		t.Errorf("Positions = %d, want 1", len(result.Groups[0].Positions))
	}
	if result.Truncated {
		t.Error("不应截断")
	}
	if result.MaxBlocks != 100 {
		t.Errorf("MaxBlocks = %d, want 100", result.MaxBlocks)
	}
}

func TestBuildVoxelData_PaletteIndex0IsAir(t *testing.T) {
	// BlockStates=0 → palette[0]=air → 跳过，无方块
	_, data := makeVoxelGz(t, 0, 100)
	path := writeVoxelGz(t, data)
	result, err := BuildVoxelData(path, 100)
	if err != nil {
		t.Fatalf("BuildVoxelData 失败: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("air 索引应无方块, Groups = %+v", result.Groups)
	}
}

func TestBuildVoxelData_MaxBlocksTruncate(t *testing.T) {
	// maxBlocks=0 → 第一个方块就截断
	_, data := makeVoxelGz(t, 1, 0)
	path := writeVoxelGz(t, data)
	result, err := BuildVoxelData(path, 0)
	if err != nil {
		t.Fatalf("BuildVoxelData 失败: %v", err)
	}
	if !result.Truncated {
		t.Error("maxBlocks=0 应 Truncated=true")
	}
	if len(result.Groups) != 0 {
		t.Errorf("截断后应无方块, Groups = %+v", result.Groups)
	}
}

func TestBuildVoxelData_NoRegions(t *testing.T) {
	// 无 Regions → 只返回 Size
	metadata := nbtCompound("Metadata",
		nbtCompound("EnclosingSize", nbtInt("x", 2), nbtInt("y", 3), nbtInt("z", 4)),
	)
	root := nbtCompound("", nbtInt("Version", 5), metadata)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(root)
	_ = gz.Close()
	path := writeVoxelGz(t, buf.Bytes())

	result, err := BuildVoxelData(path, 100)
	if err != nil {
		t.Fatalf("BuildVoxelData 失败: %v", err)
	}
	if result.Size != [3]int{2, 3, 4} {
		t.Errorf("Size = %v, want [2 3 4]", result.Size)
	}
	if len(result.Groups) != 0 {
		t.Errorf("无 Regions 应无方块, Groups = %+v", result.Groups)
	}
}

func TestBuildVoxelData_InvalidFile(t *testing.T) {
	// 文件不存在
	if _, err := BuildVoxelData(filepath.Join(t.TempDir(), "nope.litematic"), 100); err == nil {
		t.Fatal("不存在文件应报错")
	}
	// 非 gzip 数据
	bad := filepath.Join(t.TempDir(), "bad.litematic")
	if err := os.WriteFile(bad, []byte("notgzip"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildVoxelData(bad, 100); err == nil {
		t.Fatal("非 gzip 应报错")
	}
}

// ====== BuildNbtVoxelData（structure NBT 格式）=====

func TestBuildNbtVoxelData_Success(t *testing.T) {
	path := writeVoxelGz(t, makeNbtStructureGz(t, 1))
	result, err := BuildNbtVoxelData(path, 100)
	if err != nil {
		t.Fatalf("BuildNbtVoxelData 失败: %v", err)
	}
	if result.Size != [3]int{1, 1, 1} {
		t.Errorf("Size = %v, want [1 1 1]", result.Size)
	}
	// state=1 → palette[1]=stone → 1 个颜色组 1 个方块
	if len(result.Groups) != 1 || len(result.Groups[0].Positions) != 1 {
		t.Errorf("Groups = %+v, want 1 组 1 方块", result.Groups)
	}
	if result.Truncated {
		t.Error("不应截断")
	}
}

func TestBuildNbtVoxelData_State0(t *testing.T) {
	// state=0 → palette[0]=air，应跳过（与 BuildVoxelData/BuildSchematicVoxelData 一致）
	path := writeVoxelGz(t, makeNbtStructureGz(t, 0))
	result, err := BuildNbtVoxelData(path, 100)
	if err != nil {
		t.Fatalf("BuildNbtVoxelData 失败: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("air 应被跳过, Groups = %+v", result.Groups)
	}
}

func TestBuildNbtVoxelData_MaxBlocksTruncate(t *testing.T) {
	path := writeVoxelGz(t, makeNbtStructureGz(t, 1))
	result, err := BuildNbtVoxelData(path, 0)
	if err != nil {
		t.Fatalf("BuildNbtVoxelData 失败: %v", err)
	}
	if !result.Truncated {
		t.Error("maxBlocks=0 应 Truncated=true")
	}
}

func TestBuildNbtVoxelData_NotStructure(t *testing.T) {
	// 缺 size/blocks/palette → 报错
	root := nbtCompound("", nbtInt("Version", 5))
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(root)
	_ = gz.Close()
	path := writeVoxelGz(t, buf.Bytes())
	if _, err := BuildNbtVoxelData(path, 100); err == nil {
		t.Fatal("缺 size/blocks/palette 应报错")
	}
}

func TestBuildNbtVoxelData_InvalidSize(t *testing.T) {
	// size list 长度不为 3 → 报错
	size := nbtList("size", 0x03, nbtIntBody(1), nbtIntBody(2))
	root := nbtCompound("", size)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(root)
	_ = gz.Close()
	path := writeVoxelGz(t, buf.Bytes())
	if _, err := BuildNbtVoxelData(path, 100); err == nil {
		t.Fatal("size 长度不为 3 应报错")
	}
}

// ====== BuildSchematicVoxelData（schematic 格式，v1 Blocks / v2 BlockData 双路径）=====

func TestBuildSchematicVoxelData_V2BlockData(t *testing.T) {
	// v2：BlockData varint [1, 0] + Palette → 1 个 stone 方块
	// size 2x1x1，索引 0 = blockID 1（stone），索引 1 = 0（air）
	path := writeVoxelGz(t, makeSchematicV2Gz(t, 2, 1, 1, []byte{0x01, 0x00}))
	result, err := BuildSchematicVoxelData(path, 100)
	if err != nil {
		t.Fatalf("BuildSchematicVoxelData 失败: %v", err)
	}
	if result.Size != [3]int{2, 1, 1} {
		t.Errorf("Size = %v, want [2 1 1]", result.Size)
	}
	// 1 个 stone 方块（air 跳过）
	if len(result.Groups) != 1 || len(result.Groups[0].Positions) != 1 {
		t.Errorf("Groups = %+v, want 1 组 1 方块", result.Groups)
	}
}

func TestBuildSchematicVoxelData_V1Blocks(t *testing.T) {
	// v1：Blocks byte array [1, 0, 1] + Palette → 2 个 stone 方块
	path := writeVoxelGz(t, makeSchematicV1Gz(t, 3, 1, 1, []byte{0x01, 0x00, 0x01}))
	result, err := BuildSchematicVoxelData(path, 100)
	if err != nil {
		t.Fatalf("BuildSchematicVoxelData 失败: %v", err)
	}
	if len(result.Groups) != 1 || len(result.Groups[0].Positions) != 2 {
		t.Errorf("Groups = %+v, want 1 组 2 方块", result.Groups)
	}
}

func TestBuildSchematicVoxelData_MaxBlocksTruncate(t *testing.T) {
	path := writeVoxelGz(t, makeSchematicV2Gz(t, 2, 1, 1, []byte{0x01, 0x01}))
	result, err := BuildSchematicVoxelData(path, 1)
	if err != nil {
		t.Fatalf("BuildSchematicVoxelData 失败: %v", err)
	}
	if !result.Truncated {
		t.Error("maxBlocks=1 应 Truncated=true")
	}
}

func TestBuildSchematicVoxelData_NotSchematic(t *testing.T) {
	// 缺 Width/Height/Length → 报错
	root := nbtCompound("", nbtInt("Version", 1))
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(root)
	_ = gz.Close()
	path := writeVoxelGz(t, buf.Bytes())
	if _, err := BuildSchematicVoxelData(path, 100); err == nil {
		t.Fatal("缺 Width/Height/Length 应报错")
	}
}

func TestBuildSchematicVoxelData_NoBlocks(t *testing.T) {
	// 有尺寸但无 Blocks/BlockData → 报错
	root := nbtCompound("",
		nbtInt("Width", 1),
		nbtInt("Height", 1),
		nbtInt("Length", 1),
	)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(root)
	_ = gz.Close()
	path := writeVoxelGz(t, buf.Bytes())
	if _, err := BuildSchematicVoxelData(path, 100); err == nil {
		t.Fatal("无 Blocks/BlockData 应报错")
	}
}
