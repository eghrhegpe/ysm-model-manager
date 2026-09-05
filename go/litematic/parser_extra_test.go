// ===== ParseSchematicSummary 多字段提取分支补测（parser.go:173）=====
// 复用包内 NBT 构造辅助（nbtCompound/nbtInt/nbtString/nbtByteArray/nbtList，
// litematic_test.go / voxel_test.go）与 writeGzNbt（malformed_test.go）。
// 覆盖：全字段正常提取、无 Palette 时从 Blocks 统计（含未知 ID 兜底命名 +
// Materials）、Metadata/Blocks/Palette 缺失、TileEntities/Entities 计数、
// result 不足 2 键返回 nil。
package litematic

import (
	"reflect"
	"testing"
)

func TestParseSchematicSummary_FullFields(t *testing.T) {
	// 正常 schematic：version/dataVersion/size/author/name/blockCount/paletteMax/paletteSize
	root := nbtCompound("",
		nbtInt("Version", 2),
		nbtInt("DataVersion", 2566),
		nbtInt("Width", 10),
		nbtInt("Height", 5),
		nbtInt("Length", 8),
		nbtCompound("Metadata",
			nbtString("Author", "作者A"),
			nbtString("Name", "测试建筑"),
		),
		nbtByteArray("Blocks", []byte{1, 2, 3}),
		nbtCompound("Palette",
			nbtInt("minecraft:stone", 1),
			nbtInt("minecraft:air", 0),
		),
		nbtInt("PaletteMax", 2),
		nbtList("TileEntities", 0x0A),
		nbtList("Entities", 0x0A),
	)
	path := writeGzNbt(t, root)
	result := ParseSchematicSummary(path)
	if result == nil {
		t.Fatal("期望非 nil")
	}
	if result["version"] != 2 || result["dataVersion"] != 2566 {
		t.Errorf("version/dataVersion = %v/%v, 期望 2/2566", result["version"], result["dataVersion"])
	}
	if sz, ok := result["size"].([]int); !ok || sz[0] != 10 || sz[1] != 5 || sz[2] != 8 {
		t.Errorf("size = %v, 期望 [10 5 8]", result["size"])
	}
	if result["author"] != "作者A" || result["name"] != "测试建筑" {
		t.Errorf("author/name = %v/%v", result["author"], result["name"])
	}
	if result["blockCount"] != 3 {
		t.Errorf("blockCount = %v, 期望 3", result["blockCount"])
	}
	if result["paletteMax"] != 2 {
		t.Errorf("paletteMax = %v, 期望 2", result["paletteMax"])
	}
	if result["paletteSize"] != 2 {
		t.Errorf("paletteSize = %v, 期望 2", result["paletteSize"])
	}
	if result["tileEntityCount"] != 0 {
		t.Errorf("tileEntityCount = %v, 期望 0", result["tileEntityCount"])
	}
	if result["entityCount"] != 0 {
		t.Errorf("entityCount = %v, 期望 0", result["entityCount"])
	}
	// 有 Palette compound → 不走 Blocks 统计分支
	if _, ok := result["paletteStats"]; ok {
		t.Errorf("有 Palette 时不应生成 paletteStats, 得到 %v", result["paletteStats"])
	}
}

func TestParseSchematicSummary_NoPaletteStatsFromBlocks(t *testing.T) {
	// 无 Palette compound + 有 Blocks → 逐块统计：已知 ID（1→石头、2→草）
	// 走 ResolveBlockName/ResolveBlockZH，未知 ID 兜底 "ID:%d[:%d]"；Materials 一并提取
	root := nbtCompound("",
		nbtInt("Version", 1),
		nbtInt("Width", 3),
		nbtInt("Height", 1),
		nbtInt("Length", 1),
		nbtByteArray("Blocks", []byte{1, 0, 2, 253, 254}),
		nbtByteArray("Data", []byte{0, 0, 0, 3, 0}),
		nbtString("Materials", "Alpha"),
	)
	path := writeGzNbt(t, root)
	result := ParseSchematicSummary(path)
	if result == nil {
		t.Fatal("期望非 nil")
	}
	if result["blockCount"] != 5 {
		t.Errorf("blockCount = %v, 期望 5", result["blockCount"])
	}
	if result["materials"] != "Alpha" {
		t.Errorf("materials = %v, 期望 Alpha", result["materials"])
	}
	// 非零块 4 个（1/2/253/254），id=0 跳过；253/254 不在映射表（表覆盖 0-252 与 255）
	total, names := summarizeStats(t, result["paletteStats"])
	if total != 4 {
		t.Errorf("统计总数 = %d, 期望 4（id=0 跳过）", total)
	}
	if names["石头"] != 1 || names["草"] != 1 {
		t.Errorf("石头/草计数 = %d/%d, 期望各 1", names["石头"], names["草"])
	}
	if names["ID:253:3"] != 1 || names["ID:254"] != 1 {
		t.Errorf("未知 ID 兜底命名计数 = %v, 期望 ID:253:3/ID:254 各 1", names)
	}
}

// summarizeStats 通过反射读取 []registry.LitematicBlockStat 的名称/计数
func summarizeStats(t *testing.T, v interface{}) (int, map[string]int) {
	t.Helper()
	total := 0
	nameSet := map[string]int{}
	// 反射遍历切片元素的结构体 Name/Count 字段
	elem := reflect.ValueOf(v)
	if elem.Kind() != reflect.Slice {
		t.Fatalf("paletteStats 非切片: %T", v)
	}
	for i := 0; i < elem.Len(); i++ {
		item := elem.Index(i)
		name := item.FieldByName("Name").String()
		count := int(item.FieldByName("Count").Int())
		total += count
		nameSet[name] += count
	}
	return total, nameSet
}

func TestParseSchematicSummary_MissingMetadata(t *testing.T) {
	// Metadata 缺失 → author/name 不写入；version+size 仍在 → 非 nil
	root := nbtCompound("",
		nbtInt("Version", 2),
		nbtInt("Width", 4),
		nbtInt("Height", 4),
		nbtInt("Length", 4),
	)
	path := writeGzNbt(t, root)
	result := ParseSchematicSummary(path)
	if result == nil {
		t.Fatal("缺 Metadata 但仍有 version/size, 期望非 nil")
	}
	if _, ok := result["author"]; ok {
		t.Errorf("缺 Metadata 不应有 author, 得到 %v", result["author"])
	}
	if _, ok := result["name"]; ok {
		t.Errorf("缺 Metadata 不应有 name, 得到 %v", result["name"])
	}
	if sz, ok := result["size"].([]int); !ok || sz[0] != 4 {
		t.Errorf("size = %v, 期望 [4 4 4]", result["size"])
	}
}

func TestParseSchematicSummary_MissingBlocks(t *testing.T) {
	// Blocks 缺失 → blockCount/paletteStats 均不写入
	root := nbtCompound("",
		nbtInt("Version", 2),
		nbtInt("Width", 1),
		nbtInt("Height", 1),
		nbtInt("Length", 1),
		nbtCompound("Metadata", nbtString("Name", "无方块")),
	)
	path := writeGzNbt(t, root)
	result := ParseSchematicSummary(path)
	if result == nil {
		t.Fatal("期望非 nil")
	}
	if _, ok := result["blockCount"]; ok {
		t.Errorf("缺 Blocks 不应有 blockCount, 得到 %v", result["blockCount"])
	}
	if _, ok := result["paletteStats"]; ok {
		t.Errorf("缺 Blocks 不应有 paletteStats, 得到 %v", result["paletteStats"])
	}
}

func TestParseSchematicSummary_MissingPalette(t *testing.T) {
	// PaletteMax 有值但 Palette compound 缺失 → paletteMax 写入、paletteSize 不写入
	root := nbtCompound("",
		nbtInt("Version", 2),
		nbtInt("PaletteMax", 7),
		nbtCompound("Metadata", nbtString("Name", "nopalette")),
	)
	path := writeGzNbt(t, root)
	result := ParseSchematicSummary(path)
	if result == nil {
		t.Fatal("期望非 nil")
	}
	if result["paletteMax"] != 7 {
		t.Errorf("paletteMax = %v, 期望 7", result["paletteMax"])
	}
	if _, ok := result["paletteSize"]; ok {
		t.Errorf("缺 Palette compound 不应有 paletteSize, 得到 %v", result["paletteSize"])
	}
}

func TestParseSchematicSummary_TileEntitiesAndEntities(t *testing.T) {
	// 非空 TileEntities/Entities 列表计数
	root := nbtCompound("",
		nbtInt("Version", 2),
		nbtList("TileEntities", 0x0A,
			nbtCompoundBody(nbtString("id", "chest")),
		),
		nbtList("Entities", 0x0A,
			nbtCompoundBody(nbtString("id", "pig")),
			nbtCompoundBody(nbtString("id", "cow")),
		),
	)
	path := writeGzNbt(t, root)
	result := ParseSchematicSummary(path)
	if result == nil {
		t.Fatal("期望非 nil")
	}
	if result["tileEntityCount"] != 1 {
		t.Errorf("tileEntityCount = %v, 期望 1", result["tileEntityCount"])
	}
	if result["entityCount"] != 2 {
		t.Errorf("entityCount = %v, 期望 2", result["entityCount"])
	}
}

func TestParseSchematicSummary_OnlyVersionReturnsNil(t *testing.T) {
	// 仅 version 一个字段 → len(result) <= 1 → nil
	root := nbtCompound("", nbtInt("Version", 2))
	path := writeGzNbt(t, root)
	if result := ParseSchematicSummary(path); result != nil {
		t.Errorf("仅 version 应返回 nil, 得到 %v", result)
	}
}

func TestParseSchematicSummary_EmptyRootReturnsNil(t *testing.T) {
	// 空根 compound → result 0 键 → nil
	path := writeGzNbt(t, nbtCompound(""))
	if result := ParseSchematicSummary(path); result != nil {
		t.Errorf("空根应返回 nil, 得到 %v", result)
	}
}
