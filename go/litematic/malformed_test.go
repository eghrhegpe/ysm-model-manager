// ===== go/litematic 畸形/越界输入测试 =====
// 目标：针对 litematic / structure NBT / schematic 三种二进制格式的解析，
// 构造截断、越界、数据不一致等畸形输入，验证解析器不会 panic 且能优雅降级。
// 每类测试都标注源码根因（文件:行号），若发现静默失败或逻辑问题进报告。
package litematic

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

// =========================================================================
// 一、截断的 litematic 二进制（gzip / NBT 层截断）
// =========================================================================

func TestOpenGzRoot_EmptyFile(t *testing.T) {
	// 空文件 → gzip.NewReader 报错
	path := filepath.Join(t.TempDir(), "empty.litematic")
	_ = os.WriteFile(path, []byte{}, 0644)
	_, err := openGzRoot(path)
	if err == nil {
		t.Fatal("空文件应报错")
	}
	// 验证错误类型：应是 io.EOF 或 gzip 相关错误
	if !errors.Is(err, io.EOF) && err.Error()[:4] != "gzip" {
		t.Logf("错误类型: %v (预期 io.EOF 或 gzip 错误)", err)
	}
}

func TestOpenGzRoot_TruncatedGzip(t *testing.T) {
	// 合法 gzip 中途截断 → gzip 报错
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	root := nbtCompound("", nbtInt("Version", 5))
	_, _ = gz.Write(root)
	_ = gz.Close()
	truncated := buf.Bytes()[:len(buf.Bytes())/2]
	path := filepath.Join(t.TempDir(), "trunc.litematic")
	_ = os.WriteFile(path, truncated, 0644)
	_, err := openGzRoot(path)
	if err == nil {
		t.Fatal("截断 gzip 应报错")
	}
}

func TestOpenGzRoot_OnlyGzipHeader(t *testing.T) {
	// 仅 gzip 魔数两字节
	path := filepath.Join(t.TempDir(), "hdr.litematic")
	_ = os.WriteFile(path, []byte{0x1F, 0x8B}, 0644)
	_, err := openGzRoot(path)
	if err == nil {
		t.Fatal("仅 gzip header 应报错")
	}
}

// =========================================================================
// 二、NBT 结构畸形：非法 tag 类型 / 截断 compound / 数据不足
// =========================================================================

func TestReadRootCompound_UnknownRootTag(t *testing.T) {
	// 根 tag 类型 = 0xFF（未知），probeNbtDepth 的 default 分支返回 false
	data := []byte{0xFF, 0x00, 0x00}
	path := writeGzNbt(t, data)
	_, err := openGzRoot(path)
	if err == nil {
		t.Fatal("未知 root tag 类型应报错")
	}
}

func TestReadRootCompound_RootEndTag(t *testing.T) {
	// 根 tag 类型 = 0x00（end），probeNbtDepth 显式拒绝
	data := []byte{0x00}
	path := writeGzNbt(t, data)
	_, err := openGzRoot(path)
	if err == nil {
		t.Fatal("根 end tag 应报错")
	}
	// 验证错误包含 "nbt" 前缀（来自 openGzRootFromReader 的 wrapping）
	if err.Error()[:3] != "nbt" {
		t.Logf("错误类型: %v (预期 nbt 前缀)", err)
	}
}

func TestReadRootCompound_TruncatedCompound(t *testing.T) {
	// compound 有子 tag 但没有 end(0x00)，probe 读子 payload 后找不到 end → 畸形
	// 根 compound + 空名 + 子 int + 空名 + int 值（缺根 end）
	data := []byte{
		0x0A, 0x00, 0x00, // 根 compound + 空名
		0x03, 0x00, 0x00, // 子 int + 空名
		0x00, 0x00, 0x00, 0x05, // int 值 5
		// 缺根 compound 的 end 0x00
	}
	path := writeGzNbt(t, data)
	_, err := openGzRoot(path)
	if err == nil {
		t.Fatal("截断 compound（缺 end）应报错")
	}
}

func TestReadRootCompound_FloatDataShort(t *testing.T) {
	// 子 float(4 字节) 声明后只有 2 字节数据 → read(4) 越界 → ok=false
	data := []byte{
		0x0A, 0x00, 0x00, // 根 compound + 空名
		0x05, 0x00, 0x00, // 子 float + 空名
		0x00, 0x00, // 仅 2 字节（需 4）
		0x00, // 根 end
	}
	path := writeGzNbt(t, data)
	_, err := openGzRoot(path)
	if err == nil {
		t.Fatal("float 数据不足应报错")
	}
}

func TestReadRootCompound_ByteArrayNegativeLength(t *testing.T) {
	// byteArray 长度声明为 -1 → n < 0 守卫拒绝
	data := []byte{
		0x0A, 0x00, 0x00, // 根 compound
		0x07, 0x00, 0x00, // 子 byteArray
		0xFF, 0xFF, 0xFF, 0xFF, // 长度 -1
		0x00, // 根 end
	}
	path := writeGzNbt(t, data)
	_, err := openGzRoot(path)
	if err == nil {
		t.Fatal("byteArray 负长度应报错")
	}
}

func TestReadRootCompound_LongArrayNegativeLength(t *testing.T) {
	// longArray 长度声明为 -1 → n < 0 守卫拒绝
	data := []byte{
		0x0A, 0x00, 0x00,
		0x0C, 0x00, 0x00,
		0xFF, 0xFF, 0xFF, 0xFF,
		0x00,
	}
	path := writeGzNbt(t, data)
	_, err := openGzRoot(path)
	if err == nil {
		t.Fatal("longArray 负长度应报错")
	}
}

// =========================================================================
// 三、Litematic Region：BlockStates 数据量与 Size 不一致
// =========================================================================

func TestBuildVoxelData_BlockStatesShort(t *testing.T) {
	// size 4x4x4 = 64 blocks, bpe=2, 需要 128 bits = 2 longs
	// 只给 1 long（64 bits）→ total(64) > capacity(32) → buildRegionInfo 返回 error
	palette := nbtList("BlockStatePalette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	region := nbtCompound("r0",
		palette,
		nbtCompound("Size", nbtInt("x", 4), nbtInt("y", 4), nbtInt("z", 4)),
		nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
		nbtLongArray("BlockStates", []int64{0x5555555555555555}),
	)
	root := nbtCompound("", nbtInt("Version", 5),
		nbtCompound("Metadata",
			nbtCompound("EnclosingSize", nbtInt("x", 4), nbtInt("y", 4), nbtInt("z", 4))),
		nbtCompound("Regions", region),
	)
	path := writeGzNbt(t, root)
	result, err := BuildVoxelData(path, 1000)
	if err == nil {
		t.Fatalf("BlockStates 截断应返回错误，实际 nil（返回 %d 组）", len(result.Groups))
	}
	t.Logf("BlockStates 截断错误: %v", err)
}

func TestBuildVoxelData_BlockStatesEmpty(t *testing.T) {
	// size 1x1x1 = 1 block, 但 BlockStates 长度=0 → buildRegionInfo 返回 error（非空尺寸缺数据）
	palette := nbtList("BlockStatePalette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	region := nbtCompound("r0",
		palette,
		nbtCompound("Size", nbtInt("x", 1), nbtInt("y", 1), nbtInt("z", 1)),
		nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
		nbtLongArray("BlockStates", []int64{}),
	)
	root := nbtCompound("", nbtInt("Version", 5),
		nbtCompound("Metadata",
			nbtCompound("EnclosingSize", nbtInt("x", 1), nbtInt("y", 1), nbtInt("z", 1))),
		nbtCompound("Regions", region),
	)
	path := writeGzNbt(t, root)
	result, err := BuildVoxelData(path, 100)
	if err == nil {
		t.Fatalf("非空尺寸缺 BlockStates 应返回错误，实际 nil（%d 组）", len(result.Groups))
	}
	t.Logf("缺 BlockStates 错误: %v", err)
}

func TestBuildVoxelData_BlockStatesExtra(t *testing.T) {
	// size 1x1x1, 但给 10 个 longs → total(1) < capacity(320) → 通过，多余数据被忽略
	palette := nbtList("BlockStatePalette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	longs := make([]int64, 10)
	for i := range longs {
		longs[i] = 0x5555555555555555
	}
	region := nbtCompound("r0",
		palette,
		nbtCompound("Size", nbtInt("x", 1), nbtInt("y", 1), nbtInt("z", 1)),
		nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
		nbtLongArray("BlockStates", longs),
	)
	root := nbtCompound("", nbtInt("Version", 5),
		nbtCompound("Metadata",
			nbtCompound("EnclosingSize", nbtInt("x", 1), nbtInt("y", 1), nbtInt("z", 1))),
		nbtCompound("Regions", region),
	)
	path := writeGzNbt(t, root)
	result, err := BuildVoxelData(path, 100)
	if err != nil {
		t.Fatalf("不应 panic: %v", err)
	}
	// 只取第 1 个 block（索引 1 = stone）
	if len(result.Groups) != 1 {
		t.Errorf("应生成 1 组, 得到 %d 组: %+v", len(result.Groups), result.Groups)
	}
	if len(result.Groups[0].Positions) != 1 {
		t.Errorf("应生成 1 个方块, 得到 %d", len(result.Groups[0].Positions))
	}
}

// =========================================================================
// 四、尺寸越界：零尺寸 / 单轴为零
// =========================================================================

func TestBuildVoxelData_ZeroSizeAllAxes(t *testing.T) {
	// size 0x0x0 → total=0, capacity=len(longs)*64/bpe > 0
	// total <= capacity 通过，但 totalInRegion=0 → 循环不执行 → 无方块（静默跳过）
	palette := nbtList("BlockStatePalette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	region := nbtCompound("r0",
		palette,
		nbtCompound("Size", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
		nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
		nbtLongArray("BlockStates", []int64{0x5555555555555555}),
	)
	root := nbtCompound("", nbtInt("Version", 5),
		nbtCompound("Metadata",
			nbtCompound("EnclosingSize", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0))),
		nbtCompound("Regions", region),
	)
	path := writeGzNbt(t, root)
	result, err := BuildVoxelData(path, 100)
	if err != nil {
		t.Fatalf("不应 panic: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("零尺寸 region 应无方块（静默跳过）, 得到 %d 组", len(result.Groups))
	}
	if result.Size != [3]int{0, 0, 0} {
		t.Errorf("EnclosingSize 应为 [0 0 0], 得到 %v", result.Size)
	}
}

func TestBuildVoxelData_ZeroSizeOneAxis(t *testing.T) {
	// size 0x2x2 → total=0, capacity > 0 → 通过但无方块
	palette := nbtList("BlockStatePalette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	region := nbtCompound("r0",
		palette,
		nbtCompound("Size", nbtInt("x", 0), nbtInt("y", 2), nbtInt("z", 2)),
		nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
		nbtLongArray("BlockStates", []int64{0x5555555555555555}),
	)
	root := nbtCompound("", nbtInt("Version", 5),
		nbtCompound("Metadata",
			nbtCompound("EnclosingSize", nbtInt("x", 0), nbtInt("y", 2), nbtInt("z", 2))),
		nbtCompound("Regions", region),
	)
	path := writeGzNbt(t, root)
	result, err := BuildVoxelData(path, 100)
	if err != nil {
		t.Fatalf("不应 panic: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("单轴零尺寸应无方块, 得到 %d 组", len(result.Groups))
	}
}

// =========================================================================
// 五、Palette 索引越界
// =========================================================================

func TestBuildVoxelData_PaletteIndexOutOfBounds(t *testing.T) {
	// palette 2 项 (bpe=2)，BlockStates 低 2 位 = 0b11 = 3 → 越界
	// voxel.go:139 paletteIdx >= len(info.palette) → 跳过
	palette := nbtList("BlockStatePalette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	region := nbtCompound("r0",
		palette,
		nbtCompound("Size", nbtInt("x", 1), nbtInt("y", 1), nbtInt("z", 1)),
		nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
		nbtLongArray("BlockStates", []int64{0b11}),
	)
	root := nbtCompound("", nbtInt("Version", 5),
		nbtCompound("Metadata",
			nbtCompound("EnclosingSize", nbtInt("x", 1), nbtInt("y", 1), nbtInt("z", 1))),
		nbtCompound("Regions", region),
	)
	path := writeGzNbt(t, root)
	result, err := BuildVoxelData(path, 100)
	if err != nil {
		t.Fatalf("越界索引应被跳过而非 panic: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("越界 palette 索引应被跳过, 得到 %d 组", len(result.Groups))
	}
}

func TestBuildVoxelData_PaletteIndexAllOnes(t *testing.T) {
	// palette 2 项 (bpe=2)，long = 0xFFFF...FF → 每个 2-bit 组都是 0b11 = 3（越界）
	// size 2x2x1 = 4 blocks
	palette := nbtList("BlockStatePalette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	region := nbtCompound("r0",
		palette,
		nbtCompound("Size", nbtInt("x", 2), nbtInt("y", 2), nbtInt("z", 1)),
		nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
		nbtLongArray("BlockStates", []int64{-1}),
	)
	root := nbtCompound("", nbtInt("Version", 5),
		nbtCompound("Metadata",
			nbtCompound("EnclosingSize", nbtInt("x", 2), nbtInt("y", 2), nbtInt("z", 1))),
		nbtCompound("Regions", region),
	)
	path := writeGzNbt(t, root)
	result, err := BuildVoxelData(path, 100)
	if err != nil {
		t.Fatalf("不应 panic: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("全越界索引应全部跳过, 得到 %d 组", len(result.Groups))
	}
}

// =========================================================================
// 六、Palette 元素缺少 Name 字段
// =========================================================================

func TestBuildVoxelData_PaletteMissingName(t *testing.T) {
	// palette[0] 无 Name → MapColor("") 返回某色，但索引 0 始终被当作 air 跳过
	// palette[1] 有 Name → stone
	palette := nbtList("BlockStatePalette", 0x0A,
		nbtCompoundBody(), // 空 compound，无 Name
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	region := nbtCompound("r0",
		palette,
		nbtCompound("Size", nbtInt("x", 2), nbtInt("y", 1), nbtInt("z", 1)),
		nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
		nbtLongArray("BlockStates", []int64{0b0100}), // block0=air(0), block1=stone(1)
	)
	root := nbtCompound("", nbtInt("Version", 5),
		nbtCompound("Metadata",
			nbtCompound("EnclosingSize", nbtInt("x", 2), nbtInt("y", 1), nbtInt("z", 1))),
		nbtCompound("Regions", region),
	)
	path := writeGzNbt(t, root)
	result, err := BuildVoxelData(path, 100)
	if err != nil {
		t.Fatalf("不应 panic: %v", err)
	}
	// 索引 0（air）跳过，索引 1（stone）保留 → 1 个方块
	if len(result.Groups) != 1 {
		t.Errorf("应生成 1 组, 得到 %d 组: %+v", len(result.Groups), result.Groups)
	}
}

// =========================================================================
// 七、Schematic v1：负维度 / 零维度 / Blocks 长度不足
// =========================================================================

func TestBuildSchematicVoxelData_NegativeWidth(t *testing.T) {
	// Width=-1, H=1, L=1 → total64=-1 → 溢出/负值守卫拒绝（防坐标计算错误）
	root := nbtCompound("",
		nbtInt("Version", 1),
		nbtInt("Width", int32(-1)),
		nbtInt("Height", 1),
		nbtInt("Length", 1),
		nbtByteArray("Blocks", []byte{0x01, 0x02, 0x03}),
		nbtByteArray("Data", []byte{0x00, 0x00, 0x00}),
	)
	path := writeGzNbt(t, root)
	result, err := BuildSchematicVoxelData(path, 100)
	if err == nil {
		t.Fatalf("负维度应返回错误（溢出守卫）")
	}
	if result != nil {
		t.Errorf("负维度应返回 nil result, 得到 %+v", result)
	}
}

func TestBuildSchematicVoxelData_ZeroHeight(t *testing.T) {
	// Height=0 → total=0 → 循环不执行
	root := nbtCompound("",
		nbtInt("Version", 1),
		nbtInt("Width", 2),
		nbtInt("Height", 0),
		nbtInt("Length", 2),
		nbtByteArray("Blocks", []byte{0x01, 0x01, 0x01, 0x01}),
		nbtByteArray("Data", []byte{0x00, 0x00, 0x00, 0x00}),
	)
	path := writeGzNbt(t, root)
	result, err := BuildSchematicVoxelData(path, 100)
	if err != nil {
		t.Fatalf("零高度应无 panic: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("零高度应无方块, 得到 %d 组", len(result.Groups))
	}
}

func TestBuildSchematicVoxelData_BlocksShorterThanTotal(t *testing.T) {
	// size 4x1x1 = total 4，但 Blocks 只有 2 字节
	// voxel.go:416 for i < total && i < len(blocksBA) → 只读 2 字节（静默截断）
	root := nbtCompound("",
		nbtInt("Version", 1),
		nbtInt("Width", 4),
		nbtInt("Height", 1),
		nbtInt("Length", 1),
		nbtByteArray("Blocks", []byte{0x01, 0x02}),
		nbtByteArray("Data", []byte{0x00, 0x00}),
	)
	path := writeGzNbt(t, root)
	result, err := BuildSchematicVoxelData(path, 100)
	if err != nil {
		t.Fatalf("Blocks 短于 total 应无 panic: %v", err)
	}
	// blockID=1 (stone) 和 blockID=2 (grass) 各 1 个 → 2 组
	// 但声明了 4 个位置，只填了 2 个（静默截断）
	totalBlocks := 0
	for _, g := range result.Groups {
		totalBlocks += len(g.Positions)
	}
	if totalBlocks > 4 {
		t.Errorf("Blocks 不足不应产生多余方块, 得到 %d 个", totalBlocks)
	}
	t.Logf("Blocks 短于 total: 声明 4 实际读取 %d", totalBlocks)
}

func TestBuildSchematicVoxelData_BlocksEmpty(t *testing.T) {
	// size 2x2x2 = 8 blocks，Blocks 为空
	root := nbtCompound("",
		nbtInt("Version", 1),
		nbtInt("Width", 2),
		nbtInt("Height", 2),
		nbtInt("Length", 2),
		nbtByteArray("Blocks", []byte{}),
		nbtByteArray("Data", []byte{}),
	)
	path := writeGzNbt(t, root)
	result, err := BuildSchematicVoxelData(path, 100)
	if err != nil {
		t.Fatalf("空 Blocks 应无 panic: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("空 Blocks 应无方块, 得到 %d 组", len(result.Groups))
	}
}

// =========================================================================
// 八、Schematic v2：截断 varint BlockData
// =========================================================================

func TestBuildSchematicVoxelData_TruncatedVarint(t *testing.T) {
	// size 4x1x1 = 4 blocks，BlockData 只有 1 字节 0x80（无终止位）
	// readVarInt 循环到 EOF 返回 → offset = len(data) → 循环退出（静默截断）
	root := nbtCompound("",
		nbtInt("Version", 2),
		nbtInt("Width", 4),
		nbtInt("Height", 1),
		nbtInt("Length", 1),
		nbtByteArray("BlockData", []byte{0x80}),
		nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
	)
	path := writeGzNbt(t, root)
	result, err := BuildSchematicVoxelData(path, 100)
	if err != nil {
		t.Fatalf("截断 varint 应无 panic: %v", err)
	}
	// 循环退出时只处理了 0-1 个方块（取决于 readVarInt 返回值）
	t.Logf("截断 varint: 生成 %d 组方块", len(result.Groups))
}

func TestBuildSchematicVoxelData_VarintAllOverflow(t *testing.T) {
	// 全 0xFF 字节（每字节都有 continuation bit），10 字节无终止
	// readVarInt 循环到 EOF，shift 累加至 70 → int 溢出但 Go 不 panic（静默 wrap）
	root := nbtCompound("",
		nbtInt("Version", 2),
		nbtInt("Width", 4),
		nbtInt("Height", 1),
		nbtInt("Length", 1),
		nbtByteArray("BlockData", []byte{0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}),
		nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
	)
	path := writeGzNbt(t, root)
	result, err := BuildSchematicVoxelData(path, 100)
	if err != nil {
		t.Fatalf("全溢出 varint 应无 panic: %v", err)
	}
	t.Logf("全 0xFF varint: 生成 %d 组方块", len(result.Groups))
}

// =========================================================================
// 九、Structure NBT：state 越界 / pos 越界 / 类型不匹配
// =========================================================================

func TestBuildNbtVoxelData_StateTooLarge(t *testing.T) {
	// palette 2 项，state=5 → voxel.go:324 int(state) >= len(paletteColors) → 跳过
	palette := nbtList("palette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	size := nbtList("size", 0x03, nbtIntBody(1), nbtIntBody(1), nbtIntBody(1))
	block := nbtList("blocks", 0x0A,
		nbtCompoundBody(
			nbtList("pos", 0x03, nbtIntBody(0), nbtIntBody(0), nbtIntBody(0)),
			nbtInt("state", int32(5)),
		),
	)
	root := nbtCompound("", size, palette, block)
	path := writeGzNbt(t, root)
	result, err := BuildNbtVoxelData(path, 100)
	if err != nil {
		t.Fatalf("越界 state 应被跳过而非 panic: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("state 越界应被跳过, 得到 %d 组", len(result.Groups))
	}
}

func TestBuildNbtVoxelData_StateNegative(t *testing.T) {
	// state=-1 → voxel.go:324 int(state) < 0 → 跳过
	palette := nbtList("palette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	size := nbtList("size", 0x03, nbtIntBody(1), nbtIntBody(1), nbtIntBody(1))
	block := nbtList("blocks", 0x0A,
		nbtCompoundBody(
			nbtList("pos", 0x03, nbtIntBody(0), nbtIntBody(0), nbtIntBody(0)),
			nbtInt("state", int32(-1)),
		),
	)
	root := nbtCompound("", size, palette, block)
	path := writeGzNbt(t, root)
	result, err := BuildNbtVoxelData(path, 100)
	if err != nil {
		t.Fatalf("负 state 应被跳过而非 panic: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("负 state 应被跳过, 得到 %d 组", len(result.Groups))
	}
}

func TestBuildNbtVoxelData_PosOutOfInt16Range(t *testing.T) {
	// pos x=40000 > 32767 → voxel.go:340 越界检查 → 跳过
	palette := nbtList("palette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	size := nbtList("size", 0x03, nbtIntBody(100), nbtIntBody(100), nbtIntBody(100))
	block := nbtList("blocks", 0x0A,
		nbtCompoundBody(
			nbtList("pos", 0x03, nbtIntBody(40000), nbtIntBody(0), nbtIntBody(0)),
			nbtInt("state", int32(1)),
		),
	)
	root := nbtCompound("", size, palette, block)
	path := writeGzNbt(t, root)
	result, err := BuildNbtVoxelData(path, 100)
	if err != nil {
		t.Fatalf("越界 pos 应被跳过而非 panic: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("pos 越界应被跳过, 得到 %d 组", len(result.Groups))
	}
}

func TestBuildNbtVoxelData_PosNegativeOutOfInt16(t *testing.T) {
	// pos x=-40000 < -32768 → 越界 → 跳过
	palette := nbtList("palette", 0x0A,
		nbtCompoundBody(nbtString("Name", "minecraft:air")),
		nbtCompoundBody(nbtString("Name", "minecraft:stone")),
	)
	size := nbtList("size", 0x03, nbtIntBody(100), nbtIntBody(100), nbtIntBody(100))
	block := nbtList("blocks", 0x0A,
		nbtCompoundBody(
			nbtList("pos", 0x03, nbtIntBody(-40000), nbtIntBody(0), nbtIntBody(0)),
			nbtInt("state", int32(1)),
		),
	)
	root := nbtCompound("", size, palette, block)
	path := writeGzNbt(t, root)
	result, err := BuildNbtVoxelData(path, 100)
	if err != nil {
		t.Fatalf("负越界 pos 应被跳过而非 panic: %v", err)
	}
	if len(result.Groups) != 0 {
		t.Errorf("负越界 pos 应被跳过, 得到 %d 组", len(result.Groups))
	}
}

// =========================================================================
// 十、extractBits 边界测试
// =========================================================================

func TestExtractBits_BeyondLongsCapacity(t *testing.T) {
	// longIdx >= len(longs) → nbt.go:301 返回 0
	longs := []int64{^int64(0x5555555555555555), int64(0x5555555555555555)}
	v := extractBits(longs, 200, 4) // longIdx = 3 >= 2
	if v != 0 {
		t.Errorf("越界 bitOffset 应返回 0, 得到 %d", v)
	}
}

func TestExtractBits_AtLongBoundary(t *testing.T) {
	// 正好在两个 long 的边界处取值
	longs := []int64{^int64(0), int64(0x0000000000000001)}
	// bitOffset=63, bitCount=2 → 跨 long 边界
	v := extractBits(longs, 63, 2)
	// long[0] bit63=1, long[1] bit0=1 → 结果 = 0b11 = 3
	if v != 3 {
		t.Errorf("边界取值应 = 3, 得到 %d", v)
	}
}

func TestExtractBits_ExactlyAtEnd(t *testing.T) {
	// 2 longs = 128 bits。long[0] 全部 1，取 bit60-63 = 0xF（单 long 路径，正好贴 64 边界）
	// 这是 extractBits 里 `bitPos+bitCount<=64` 分支的边界条件
	longs := []int64{^int64(0), 0x0}
	v := extractBits(longs, 60, 4)
	if v != 15 {
		t.Errorf("bit60-63 应 = 15, 得到 %d", v)
	}
}

func TestExtractBits_OneLongEmpty(t *testing.T) {
	// longs 只有 1 个，读取 bit 64-67（需要第 2 个 long）
	longs := []int64{^int64(0x5555555555555555)}
	v := extractBits(longs, 60, 8) // 跨 long，但 longs[1] 不存在
	// nbt.go:313 longIdx+1 < len(longs) 为 false → high = 0
	// low = longs[0] >> 60 = 0xAAAAAAAAAAAAAAAA >> 60 = 0xA
	// result = 0xA | (0 << 4) = 0xA = 10
	if v != 10 {
		t.Errorf("单 long 跨边界应 = 10, 得到 %d", v)
	}
}

// =========================================================================
// 十一、ParseMeta / ParseSchematicSummary 的截断文件
// =========================================================================

func TestParseMeta_TruncatedGzip(t *testing.T) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(nbtCompound("", nbtInt("Version", 5)))
	_ = gz.Close()
	truncated := buf.Bytes()[:len(buf.Bytes())/2]
	path := filepath.Join(t.TempDir(), "trunc.litematic")
	_ = os.WriteFile(path, truncated, 0644)
	if _, err := ParseMeta(path); err == nil {
		t.Fatal("截断文件应报错")
	}
}

func TestParseSchematicSummary_TruncatedGzip(t *testing.T) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(nbtCompound("", nbtInt("Version", 2)))
	_ = gz.Close()
	truncated := buf.Bytes()[:len(buf.Bytes())/2]
	path := filepath.Join(t.TempDir(), "trunc.schematic")
	_ = os.WriteFile(path, truncated, 0644)
	result := ParseSchematicSummary(path)
	if result != nil {
		t.Errorf("截断文件应返回 nil, 得到 %+v", result)
	}
}

func TestParseNbtStructure_TruncatedGzip(t *testing.T) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(nbtCompound("", nbtInt("DataVersion", 2566)))
	_ = gz.Close()
	truncated := buf.Bytes()[:len(buf.Bytes())/2]
	path := filepath.Join(t.TempDir(), "trunc.nbt")
	_ = os.WriteFile(path, truncated, 0644)
	result := ParseNbtStructure(path)
	if result != nil {
		t.Errorf("截断文件应返回 nil, 得到 %+v", result)
	}
}

// =========================================================================
// 十二、readVarInt 溢出守卫（voxel.go）
// =========================================================================

func TestReadVarInt_ContinuationOverflow(t *testing.T) {
	// 15 字节全 0xFF（无终止位）：单次调用内 shift 累加 0→63→70，
	// 守卫在 shift>=64 处截断——第 11 字节不再左移（防 int 溢出 wrap 假值），
	// 返回已消费 10 字节；v 为累积值（-1），不 panic
	data := bytes.Repeat([]byte{0xFF}, 15)
	v, off := readVarInt(data, 0)
	if off != 10 {
		t.Errorf("守卫应截断在 10 字节处, 实际 offset = %d", off)
	}
	if v == 0 {
		t.Errorf("截断值不应为 0（应保留已累积位）")
	}
}

// =========================================================================
// 十三、辅助函数
// =========================================================================

// writeGzNbt 将 NBT 字节流 gzip 压缩后写入临时文件
func writeGzNbt(t *testing.T, nbtData []byte) string {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(nbtData)
	_ = gz.Close()
	path := filepath.Join(t.TempDir(), "test.litematic")
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}
