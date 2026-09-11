// ===== go/litematic gzip + NBT 解码模糊测试 =====
// litematic / 蓝图 / 结构文件的字节流来自用户磁盘（不可信输入），是 zip-bomb
// 与深层递归攻击的经典面。两个护栏目标：
//
//   - OpenGzRootFromBytes：gzip 解压 + NBT root 解码的容器条目入口，契约 =
//     不 panic、不挂起（内部 maxDecodedBytes 100MB 上限 + 深度预检承担防炸弹）
//   - probeNbtDepth：NBT 深度/物化预算预检器本身，契约 = 对任意字节返回
//     非负深度且不 panic（ok=false 表示畸形，属预期降级）
//
// 运行：go test ./go/litematic -fuzz=FuzzOpenGzRootFromBytes -fuzztime=30s
//
//	go test ./go/litematic -fuzz=FuzzProbeNbtDepth -fuzztime=30s
package litematic

import (
	"bytes"
	"compress/gzip"
	"testing"
)

// fuzzGz 把原始 NBT 字节压成容器条目形态（gzip 压缩），复用同包 nbt* 构造 helper。
func fuzzGz(t testing.TB, root []byte) []byte {
	t.Helper()
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

// fuzzSeedRoot 返回一份最小合法 root compound（Version + Metadata 子树），
// 作为 gzip 与非压缩两条种子路径的共同输入。
func fuzzSeedRoot() []byte {
	return nbtCompound("",
		nbtInt("Version", 1),
		nbtCompound("Metadata",
			nbtString("Name", "seed"),
			nbtInt("TotalBlocks", 1),
		),
	)
}

func FuzzOpenGzRootFromBytes(f *testing.F) {
	root := fuzzSeedRoot()
	f.Add(fuzzGz(f, root))                // 合法 gzip NBT
	f.Add(fuzzGz(f, nbtCompound("")))     // 合法 gzip + 空 root
	f.Add([]byte{})                       // 空输入
	f.Add([]byte{0x1f, 0x8b, 0x08, 0x00}) // gzip 魔数前缀（截断头）
	f.Add(root)                           // 非 gzip（未压缩 NBT）
	f.Add([]byte{0x00, 0x00, 0x00, 0x00}) // 全零（非法 gzip）

	f.Fuzz(func(t *testing.T, data []byte) {
		// 契约 = 不 panic 且返回；解码失败返回 err 属预期降级
		_, _ = OpenGzRootFromBytes(data)
	})
}

func FuzzProbeNbtDepth(f *testing.F) {
	root := fuzzSeedRoot()
	f.Add(root)                           // 合法 NBT
	f.Add([]byte{0x0a, 0x00, 0x00, 0x00}) // 空 root compound（TAG_Compound + 空名 + End）
	f.Add([]byte{0x0a, 0x00, 0x00})       // 截断（缺 End）
	f.Add([]byte{0x0c})                   // TAG_LongArray 无 body
	f.Add([]byte{})                       // 空输入

	f.Fuzz(func(t *testing.T, data []byte) {
		depth, _ := probeNbtDepth(data)
		// 不变式：maxDepth 初值 0 且只递增，必非负（负值即实现缺陷）
		if depth < 0 {
			t.Fatalf("probeNbtDepth 返回负深度: %d", depth)
		}
	})
}
