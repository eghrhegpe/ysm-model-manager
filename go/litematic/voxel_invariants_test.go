// ===== voxel.go 体素构建器：数据不变量特征测试 =====
//
// 拆解 gocyclo 存量债时补的护栏。体素构建器「拆错不崩、只静默产出错误体素」——
// 渲染错方块、坐标错位、palette 索引串位、区域边界算错都不报错，故此处钉的是
// **数据**（坐标 / 尺寸 / 颜色→位置映射 / 包围盒），不是「没报错」：
//
//   - buildBedrockVoxelData / BuildSchematicVoxelDataFromRoot 原为 0 处直调，
//     经 BuildNbtVoxelData(path) / BuildSchematicVoxelData(path) 间接覆盖
//     （实测 85.9% / 96.9%），但既有断言从未校验过 schematic 的**坐标**（只数方块个数），
//     基岩分支也只覆盖了 local_bounds.min 全 0、palette 各 sub 同构的样本。
//     本文件补齐：索引→坐标换算、每个 sub_level 各自的 palette、聚合 min 平移归零、
//     尺寸 +1 边界、多字节 varint、直接调用 FromRoot/私有入口。
//   - buildRegionInfo 补 int16 上下界的**接受**侧（原测试只覆盖拒绝侧）。
package litematic

import (
	"testing"

	"ysm-model-manager/go/types/registry"
)

// voxelByColor 汇总体素结果为 颜色 → 位置集合（集合判据，与遍历顺序无关）。
func voxelByColor(vd *registry.LitematicVoxelData) map[string]map[[3]int16]bool {
	out := make(map[string]map[[3]int16]bool, len(vd.Groups))
	for _, g := range vd.Groups {
		if out[g.Color] == nil {
			out[g.Color] = make(map[[3]int16]bool, len(g.Positions))
		}
		for _, p := range g.Positions {
			out[g.Color][p] = true
		}
	}
	return out
}

// assertVoxelPositions 断言 颜色 → 位置集合 与期望**完全一致**：
// 少一个方块、多一个方块、颜色串位（palette 索引错位）三条静默失败路径都在此暴露。
func assertVoxelPositions(t *testing.T, vd *registry.LitematicVoxelData, want map[string][][3]int16) {
	t.Helper()
	got := voxelByColor(vd)
	if len(got) != len(want) {
		t.Errorf("颜色组数 = %d, want %d（实得 %v）", len(got), len(want), got)
	}
	for color, positions := range want {
		gotSet, ok := got[color]
		if !ok {
			t.Errorf("缺少颜色组 %s（期望 %d 个方块）", color, len(positions))
			continue
		}
		if len(gotSet) != len(positions) {
			t.Errorf("颜色 %s 方块数 = %d, want %d（实得 %v）", color, len(gotSet), len(positions), gotSet)
		}
		for _, p := range positions {
			if !gotSet[p] {
				t.Errorf("颜色 %s 缺少坐标 %v（实得 %v）", color, p, gotSet)
			}
		}
	}
	for color, gotSet := range got {
		if _, expected := want[color]; !expected {
			t.Errorf("多余颜色组 %s: %v", color, gotSet)
		}
	}
}

// ===== BuildSchematicVoxelDataFromRoot：索引 → 坐标换算（原测试只数方块个数）=====

func TestBuildSchematicVoxelDataFromRoot_V1CoordinateMapping(t *testing.T) {
	// w=2,h=2,l=2（total=8）；Blocks 非零位为 k=1,4,7。
	// Minecraft 存储顺序 X→Z→Y：idx = x + z*w + y*w*l →
	//   k=1 → (1,0,0)；k=4 → (0,1,0)；k=7 → (1,1,1)
	// 该断言同时钉住 x 用 %w、z 用 (idx/w)%l、y 用 idx/(w*l)——三者任一写反都产出错坐标。
	root := map[string]any{
		"Width":  int32(2),
		"Height": int32(2),
		"Length": int32(2),
		"Blocks": []byte{0, 1, 0, 0, 1, 0, 0, 1},
		"Data":   make([]byte, 8),
		"Palette": map[string]any{
			"minecraft:stone": int32(1),
		},
	}
	vd, err := BuildSchematicVoxelDataFromRoot(root, 100)
	if err != nil {
		t.Fatalf("BuildSchematicVoxelDataFromRoot 失败: %v", err)
	}
	if vd.Size != [3]int{2, 2, 2} {
		t.Errorf("Size = %v, want [2 2 2]", vd.Size)
	}
	if vd.MaxBlocks != 100 || vd.Truncated {
		t.Errorf("MaxBlocks/Truncated = %d/%v, want 100/false", vd.MaxBlocks, vd.Truncated)
	}
	assertVoxelPositions(t, vd, map[string][][3]int16{
		"#7F7F7F": {{1, 0, 0}, {0, 1, 0}, {1, 1, 1}},
	})
}

func TestBuildSchematicVoxelDataFromRoot_V2MultiByteVarint(t *testing.T) {
	// v2 路径：BlockData varint。blockID=300 编码为两字节 [0xAC,0x02]
	// （300&0x7F=0x2C 带 continuation → 0xAC；300>>7=2）——
	// 单字节 varint 之外的多字节解码此前无断言。
	// w=2,h=2,l=1（total=4）：索引 0 → (0,0,0)，索引 3 → x=1, y=3/2=1, z=0 → (1,1,0)。
	root := map[string]any{
		"Width":     int32(2),
		"Height":    int32(2),
		"Length":    int32(1),
		"BlockData": []byte{0xAC, 0x02, 0x00, 0x00, 0xAC, 0x02},
		"Palette": map[string]any{
			"minecraft:red_concrete": int32(300),
		},
	}
	vd, err := BuildSchematicVoxelDataFromRoot(root, 100)
	if err != nil {
		t.Fatalf("BuildSchematicVoxelDataFromRoot 失败: %v", err)
	}
	if vd.Size != [3]int{2, 2, 1} {
		t.Errorf("Size = %v, want [2 2 1]", vd.Size)
	}
	// palette 键 300 → red_concrete 颜色；varint 解错则颜色兜底 #7F7F7F（组名不符）
	assertVoxelPositions(t, vd, map[string][][3]int16{
		"#932922": {{0, 0, 0}, {1, 1, 0}},
	})
}

// ===== BuildNbtVoxelDataFromRoot：palette 索引 → 颜色 → 坐标 =====

func TestBuildNbtVoxelDataFromRoot_PaletteIndexToPosition(t *testing.T) {
	palette := []any{
		map[string]any{"Name": "minecraft:air"},
		map[string]any{"Name": "minecraft:stone"},
		map[string]any{"Name": "minecraft:red_concrete"},
	}
	blocks := []any{
		map[string]any{"pos": []any{int32(0), int32(0), int32(0)}, "state": int32(1)}, // stone
		map[string]any{"pos": []any{int32(2), int32(1), int32(3)}, "state": int32(2)}, // red_concrete
		map[string]any{"pos": []any{int32(1), int32(0), int32(1)}, "state": int32(0)}, // air → 跳过
		map[string]any{"pos": []any{int32(0), int32(1), int32(0)}, "state": int32(9)}, // 越界 → 跳过
	}
	root := map[string]any{
		"size":    []any{int32(3), int32(2), int32(4)},
		"blocks":  blocks,
		"palette": palette,
	}

	vd, err := BuildNbtVoxelDataFromRoot(root, 100)
	if err != nil {
		t.Fatalf("BuildNbtVoxelDataFromRoot 失败: %v", err)
	}
	// Size 直接取自 NBT size，不参与方块坐标裁剪——钉住「尺寸语义 = 声明值」
	if vd.Size != [3]int{3, 2, 4} {
		t.Errorf("Size = %v, want [3 2 4]", vd.Size)
	}
	if vd.Truncated {
		t.Error("maxBlocks=100 时不应截断")
	}
	// stone=#7F7F7F / red_concrete=#932922：索引 1、2 若串位，颜色组与坐标对不上
	assertVoxelPositions(t, vd, map[string][][3]int16{
		"#7F7F7F": {{0, 0, 0}},
		"#932922": {{2, 1, 3}},
	})

	// maxBlocks 截断经 FromRoot 入口同样生效（容器路径用的就是该入口）
	truncated, err := BuildNbtVoxelDataFromRoot(root, 1)
	if err != nil {
		t.Fatalf("maxBlocks=1 失败: %v", err)
	}
	if !truncated.Truncated {
		t.Error("maxBlocks=1 应 Truncated=true")
	}
	total := 0
	for _, g := range truncated.Groups {
		total += len(g.Positions)
	}
	if total != 1 {
		t.Errorf("maxBlocks=1 应保留 1 个方块, 得到 %d", total)
	}
}

// ===== buildBedrockVoxelData：per-sub palette + 聚合 min 平移 + 尺寸 +1 =====

func makeTestSubLevel(t *testing.T, minX int32, paletteNames []string, pid int32) map[string]any {
	t.Helper()
	palette := make([]any, len(paletteNames))
	for i, name := range paletteNames {
		palette[i] = map[string]any{"Name": name}
	}
	return map[string]any{
		"local_bounds": map[string]any{
			"min_x": minX, "min_y": int32(0), "min_z": int32(0),
			"max_x": minX, "max_y": int32(0), "max_z": int32(0),
		},
		"block_palette": palette,
		"blocks": []any{
			map[string]any{
				"local_pos":  map[string]any{"x": int32(0), "y": int32(0), "z": int32(0)},
				"palette_id": pid,
			},
		},
	}
}

func TestBuildBedrockVoxelData_PerSubPaletteAndAggMinTranslation(t *testing.T) {
	// sub0: local_bounds.min_x=5，palette [air, stone]，pid=1 → 全局 x = 5 + 0 - 5 = 0
	// sub1: local_bounds.min_x=8，palette [red_concrete, air]，pid=0 → 全局 x = 8 + 0 - 5 = 3
	// 聚合包围盒 x ∈ [5,8] → Size [4,1,1]（max-min+1，+1 即 off-by-one 哨兵）。
	//
	// 两条静默失败路径在此暴露：
	//   ① palette 若被当成全局共用/或 pid==0 即判空气 → sub1 的 red_concrete 丢失；
	//   ② 若忘记减聚合 min → 坐标变成 (5,0,0)/(8,0,0) 而 Size 仍为 4 → 方块落在盒外。
	sub0 := makeTestSubLevel(t, 5, []string{"minecraft:air", "minecraft:stone"}, 1)
	sub1 := makeTestSubLevel(t, 8, []string{"minecraft:red_concrete", "minecraft:air"}, 0)

	vd, err := buildBedrockVoxelData([]any{sub0, sub1}, 100)
	if err != nil {
		t.Fatalf("buildBedrockVoxelData 失败: %v", err)
	}
	if vd.Size != [3]int{4, 1, 1} {
		t.Errorf("Size = %v, want [4 1 1]（聚合包围盒 max-min+1）", vd.Size)
	}
	assertVoxelPositions(t, vd, map[string][][3]int16{
		"#7F7F7F": {{0, 0, 0}},
		"#932922": {{3, 0, 0}},
	})
}

func TestBuildNbtVoxelDataFromRoot_BedrockDispatch(t *testing.T) {
	// sub_levels 分派分支经 FromRoot 入口（容器路径 internal/app 用的入口）——
	// 既有基岩用例只走 BuildNbtVoxelData(path)。单个 sub 且 min=2：
	// 平移后唯一方块落在 (0,0,0)，Size 必须是 [1,1,1] 而非 [3,1,1]（否则渲染位置整体偏移）。
	sub := makeTestSubLevel(t, 2, []string{"minecraft:air", "minecraft:stone"}, 1)
	root := map[string]any{"sub_levels": []any{sub}}

	vd, err := BuildNbtVoxelDataFromRoot(root, 100)
	if err != nil {
		t.Fatalf("BuildNbtVoxelDataFromRoot(sub_levels) 失败: %v", err)
	}
	if vd.Size != [3]int{1, 1, 1} {
		t.Errorf("Size = %v, want [1 1 1]（min 平移后单格）", vd.Size)
	}
	assertVoxelPositions(t, vd, map[string][][3]int16{
		"#7F7F7F": {{0, 0, 0}},
	})
}

// ===== 拆解时被移动的守卫：反 panic（ADR-039 P3）+ 逐轴包围盒聚合 =====

func TestBuildNbtVoxelDataFromRoot_MalformedSizeTypes(t *testing.T) {
	// size 元素非 int32：必须返回 error，而非裸类型断言 panic
	// （守卫随拆解迁入 parseNbtSize，三条类型分支各覆盖一次）。
	for i, size := range [][]any{
		{"1", int32(1), int32(1)}, // size[0] 类型畸形
		{int32(1), "1", int32(1)}, // size[1] 类型畸形
		{int32(1), int32(1), "1"}, // size[2] 类型畸形
	} {
		root := map[string]any{"size": size, "blocks": []any{}, "palette": []any{}}
		if _, err := BuildNbtVoxelDataFromRoot(root, 100); err == nil {
			t.Errorf("case %d: size=%v 含非 int32 元素应返回 error", i, size)
		}
	}
}

func TestBuildNbtVoxelDataFromRoot_MalformedBlockEntries(t *testing.T) {
	// 畸形 blocks 条目（pos 元素类型错 / state 类型错 / pos 长度非 3 / pos 缺失 / 元素非 compound）
	// 一律跳过——既不得 panic，也不得降级成坐标错乱的假方块（守卫随拆解迁入 nbtBlockPos16）。
	palette := []any{
		map[string]any{"Name": "minecraft:air"},
		map[string]any{"Name": "minecraft:stone"},
	}
	blocks := []any{
		map[string]any{"pos": []any{"0", int32(0), int32(0)}, "state": int32(1)},      // pos[0] 类型畸形
		map[string]any{"pos": []any{int32(0), int32(0), int32(0)}, "state": "1"},      // state 类型畸形
		map[string]any{"pos": []any{int32(0), int32(0)}, "state": int32(1)},           // pos 长度非 3
		map[string]any{"state": int32(1)},                                             // pos 缺失
		"not-a-compound",                                                              // 元素非 compound
		map[string]any{"pos": []any{int32(2), int32(0), int32(0)}, "state": int32(1)}, // 唯一合法方块
	}
	root := map[string]any{
		"size":    []any{int32(3), int32(1), int32(1)},
		"blocks":  blocks,
		"palette": palette,
	}
	vd, err := BuildNbtVoxelDataFromRoot(root, 100)
	if err != nil {
		t.Fatalf("畸形条目应被跳过而非报错: %v", err)
	}
	assertVoxelPositions(t, vd, map[string][][3]int16{
		"#7F7F7F": {{2, 0, 0}},
	})
}

func TestBuildBedrockVoxelData_AggBoundsAllAxes(t *testing.T) {
	// 两个 sub_level 在三个轴上各自更小/更大 → 聚合包围盒逐轴取 min/max：
	//   sub0 bounds (1,2,3)-(4,5,6)，sub1 bounds (-1,0,7)-(2,8,9)
	//   → gMin(-1,0,3)、gMax(4,8,9) → Size [6,9,7]
	// blocks 置空（空文件仍贡献包围盒）：只观察包围盒本身。
	// 逐轴比对能抓住把 maxZ 写成 maxY 一类的串轴笔误（尺寸立刻对不上）。
	sub := func(minX, minY, minZ, maxX, maxY, maxZ int32) map[string]any {
		return map[string]any{
			"local_bounds": map[string]any{
				"min_x": minX, "min_y": minY, "min_z": minZ,
				"max_x": maxX, "max_y": maxY, "max_z": maxZ,
			},
			"block_palette": []any{map[string]any{"Name": "minecraft:stone"}},
			"blocks":        []any{},
		}
	}
	vd, err := buildBedrockVoxelData([]any{sub(1, 2, 3, 4, 5, 6), sub(-1, 0, 7, 2, 8, 9)}, 100)
	if err != nil {
		t.Fatalf("buildBedrockVoxelData 失败: %v", err)
	}
	if vd.Size != [3]int{6, 9, 7} {
		t.Errorf("Size = %v, want [6 9 7]（逐轴 gMax-gMin+1）", vd.Size)
	}
	if len(vd.Groups) != 0 {
		t.Errorf("blocks 为空应无方块组, 得到 %d", len(vd.Groups))
	}
}

// ===== buildRegionInfo：int16 边界的接受侧（原测试只覆盖拒绝侧）=====

func TestBuildRegionInfo_Int16BoundaryAccepted(t *testing.T) {
	names := []string{"air", "minecraft:stone"}

	// 上界接受侧：origin 0 + size 32768 → ox+sx-1 == 32767 == int16 上限，必须接受
	// （`ox+sx > maxCoord` 式的写法会误拒这个可表示坐标）。
	// bpe=2 → capacity = 1024*64/2 = 32768 = total，恰好够。
	longs := make([]int64, 1024)
	upper := makeMockRegion(t, 32768, 1, 1, names, longs)
	info, err := buildRegionInfo(upper)
	if err != nil {
		t.Fatalf("origin 0 + size 32768（末位 x=32767）应被接受: %v", err)
	}
	if info == nil {
		t.Fatal("期望非 nil")
	}
	if info.sizeX != 32768 || info.originX != 0 {
		t.Errorf("sizeX/originX = %d/%d, want 32768/0", info.sizeX, info.originX)
	}

	// 下界接受侧：origin -32768 + size 1 → -32768 == int16 下限，必须接受
	lower := makeMockRegion(t, 1, 1, 1, names, []int64{0})
	lower["Position"] = map[string]any{"x": int32(-32768), "y": int32(0), "z": int32(0)}
	info, err = buildRegionInfo(lower)
	if err != nil {
		t.Fatalf("origin -32768（int16 下限）应被接受: %v", err)
	}
	if info == nil || info.originX != -32768 {
		t.Errorf("info = %+v, want originX=-32768", info)
	}

	// 上界拒绝侧（off-by-one 的另一面）：origin 32767 + size 2 → 末位 32768 越界
	over := makeMockRegion(t, 2, 1, 1, names, []int64{0})
	over["Position"] = map[string]any{"x": int32(32767), "y": int32(0), "z": int32(0)}
	if info, err := buildRegionInfo(over); err == nil || info != nil {
		t.Errorf("origin 32767 + size 2（末位 32768）应被拒绝, 得到 info=%+v err=%v", info, err)
	}
}

// ===== int16 坐标守卫的「丢弃」侧：越界方块不得回绕成假坐标 =====

func TestBuildSchematicVoxelDataFromRoot_CoordOverInt16Skipped(t *testing.T) {
	// w=32769 > int16 上限：末位索引 idx=32768 → x=32768 越界。
	// 该方块必须被丢弃，而不是 int16(32768) 回绕成 -32768（渲染位错乱的经典来源）。
	// 同文件内合法位置 (0,0,0) 仍须保留——守卫只能丢越界项，不能整批失败。
	blocks := make([]byte, 32769)
	blocks[0] = 1     // 合法：(0,0,0)
	blocks[32768] = 1 // 越界：x=32768 → 丢弃
	root := map[string]any{
		"Width":  int32(32769),
		"Height": int32(1),
		"Length": int32(1),
		"Blocks": blocks,
		"Data":   make([]byte, 32769),
		"Palette": map[string]any{
			"minecraft:stone": int32(1),
		},
	}
	vd, err := BuildSchematicVoxelDataFromRoot(root, 100)
	if err != nil {
		t.Fatalf("BuildSchematicVoxelDataFromRoot 失败: %v", err)
	}
	// Size 取自声明值（不因丢弃越界方块而缩水）
	if vd.Size != [3]int{32769, 1, 1} {
		t.Errorf("Size = %v, want [32769 1 1]", vd.Size)
	}
	assertVoxelPositions(t, vd, map[string][][3]int16{
		"#7F7F7F": {{0, 0, 0}},
	})
}

func TestBuildBedrockVoxelData_CoordOverInt16Skipped(t *testing.T) {
	// local_pos 使全局坐标跨出 int16 两侧（+40000 / -40000）→ 一律丢弃；
	// 同 sub 内合法方块保留。守卫随拆解迁入 bedrockBlockAt（withinInt16）。
	palette := []any{
		map[string]any{"Name": "minecraft:air"},
		map[string]any{"Name": "minecraft:stone"},
	}
	block := func(x int32) map[string]any {
		return map[string]any{
			"local_pos":  map[string]any{"x": x, "y": int32(0), "z": int32(0)},
			"palette_id": int32(1),
		}
	}
	sub := map[string]any{
		"local_bounds": map[string]any{
			"min_x": int32(0), "min_y": int32(0), "min_z": int32(0),
			"max_x": int32(0), "max_y": int32(0), "max_z": int32(0),
		},
		"block_palette": palette,
		"blocks":        []any{block(40000), block(-40000), block(0)},
	}
	vd, err := buildBedrockVoxelData([]any{sub}, 100)
	if err != nil {
		t.Fatalf("buildBedrockVoxelData 失败: %v", err)
	}
	if vd.Size != [3]int{1, 1, 1} {
		t.Errorf("Size = %v, want [1 1 1]", vd.Size)
	}
	assertVoxelPositions(t, vd, map[string][][3]int16{
		"#7F7F7F": {{0, 0, 0}},
	})
}
