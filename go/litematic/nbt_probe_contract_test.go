// ===== probeNbtDepth 契约补测（拆解前录制：畸形输入一律 ok=false 且深度归 0）=====
// 既有护栏：nbt_test.go 覆盖浅/深/截断 + 四条 charge 预算用例，FuzzProbeNbtDepth
// 保证任意字节不 panic、深度非负。本文件补齐此前无断言的分支：
//   - 各 tag 类型 payload 的深度推进（maxDepth 在 payload 入口记录，非返回值累计）
//   - byteArray/string/intArray/longArray 的长度守卫与乘法溢出守卫
//   - compound 键名计入 512MB 物化预算（P2 修复）
//   - 畸形输入不得返回「部分深度」（哨兵只留给超深合法结构）
package litematic

import "testing"

// TestProbeNbtDepth_AllPayloadTypesDepth 锁定各 payload 类型的深度推进：
// list 元素与 compound 子 payload 均为 depth+1（根 compound 的孙子层 = 2）。
func TestProbeNbtDepth_AllPayloadTypesDepth(t *testing.T) {
	data := nbtCompound("",
		nbtTag(0x01, "b", []byte{1}),
		nbtTag(0x02, "s", []byte{0, 1}),
		nbtTag(0x03, "i", []byte{0, 0, 0, 1}),
		nbtTag(0x04, "l", []byte{0, 0, 0, 0, 0, 0, 0, 1}),
		nbtTag(0x05, "f", []byte{0, 0, 0, 0}),
		nbtTag(0x06, "d", []byte{0, 0, 0, 0, 0, 0, 0, 0}),
		nbtByteArray("ba", []byte{1, 2, 3}),
		nbtString("str", "hi"),
		nbtList("lst", 0x01, []byte{1}, []byte{2}),
		nbtCompound("cmp", nbtInt("x", 1)),
		nbtTag(0x0B, "ia", []byte{0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 2}),
		nbtLongArray("la", []int64{1, 2}),
	)
	d, ok := probeNbtDepth(data)
	if !ok {
		t.Fatal("合法复合 payload 应 ok=true")
	}
	// 根 compound(0) → 子 payload(1) → cmp 的子 / list 的元素(2)
	if d != 2 {
		t.Errorf("depth = %d, 期望 2（compound 孙层 / list 元素层）", d)
	}
}

// TestProbeNbtDepth_MalformedReturnsZeroDepthNotPartial 畸形输入返回 0 深度，
// 而非已扫描到的部分深度——0 是调用方的拒绝信号（readRootCompound 直接拒绝）。
func TestProbeNbtDepth_MalformedReturnsZeroDepthNotPartial(t *testing.T) {
	truncated := buildNestedNBT(2)
	truncated = truncated[:len(truncated)-1] // 去掉最外层 end：中途截断
	d, ok := probeNbtDepth(truncated)
	if ok {
		t.Fatal("截断输入应 ok=false")
	}
	if d != 0 {
		t.Errorf("depth = %d, 期望 0（不得返回部分深度）", d)
	}
}

// TestProbeNbtDepth_LengthGuards 各类长度声明越界/溢出守卫 → ok=false。
func TestProbeNbtDepth_LengthGuards(t *testing.T) {
	cases := []struct {
		name string
		data []byte
	}{
		// TAG_Byte_Array 声明 100 字节，剩余 0
		{"byteArray 超剩余", []byte{0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x64}},
		// TAG_String 声明 16 字节，剩余 0
		{"string 超剩余", []byte{0x08, 0x00, 0x00, 0x00, 0x10}},
		// TAG_Int_Array 声明 2^30 项（4n 溢出为 0 的历史陷阱）
		{"intArray 溢出", []byte{0x0B, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00}},
		// TAG_Long_Array 声明 2^29 项
		{"longArray 溢出", []byte{0x0C, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00}},
		// 根 tag 类型未知（0xFF）
		{"未知根 tag 类型", []byte{0xFF, 0x00, 0x00}},
		// 根 tag 类型 = TAG_End(0)
		{"根 tag 为 end", []byte{0x00}},
		// 根 tag 名字长度声明超剩余
		{"根名字超剩余", []byte{0x0A, 0x00, 0x10}},
		// list 元素类型 = TAG_End(0) → 未知 payload 类型
		{"list 元素类型 0", []byte{0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01}},
	}
	for _, tc := range cases {
		if d, ok := probeNbtDepth(tc.data); ok {
			t.Errorf("%s：应 ok=false, 得到 depth=%d ok=true", tc.name, d)
		}
	}
}

// TestProbeNbtDepth_CompoundKeyNamesCharged 锁定 P2 修复：compound 键名也计入
// 512MB 物化预算（每键 nameLen+16）。charge 在 read(nameLen) 之前触发，
// 故只需 3 字节/条目即可构造超预算输入——此前漏计键名时该输入会被放行。
func TestProbeNbtDepth_CompoundKeyNamesCharged(t *testing.T) {
	buf := []byte{0x0A, 0x00, 0x00} // 根 compound + 空名
	for i := 0; i < 9000; i++ {
		buf = append(buf, 0x01, 0xFF, 0xFF) // TAG_Byte + 声明 65535 字节键名
	}
	if _, ok := probeNbtDepth(buf); ok {
		t.Fatal("海量长键名应被物化预算拒绝")
	}

	// 对照：同结构但键名短小（100 键）→ 合法
	shortKeys := []byte{0x0A, 0x00, 0x00}
	for i := 0; i < 100; i++ {
		shortKeys = append(shortKeys, 0x01, 0x00, 0x01, 0x41, 0x01) // 名 "A"，payload byte
	}
	shortKeys = append(shortKeys, 0x00) // compound end
	d, ok := probeNbtDepth(shortKeys)
	if !ok || d != 1 {
		t.Errorf("短键名 compound 应 ok=true depth=1, 得到 depth=%d ok=%v", d, ok)
	}
}
