// ===== go/importer 容器类型识别模糊测试 =====
// 两条识别链路均消费不可信输入：
//
//   - DetectContainerType：按字节识别 zip/7z 容器（7z 魔数命中即走 sevenzip
//     解析，其余走 zip central directory），契约 = 不 panic、对坏/截断输入
//     返回 "" 降级
//   - DetectContainerTypeFromBase64Tail：从 base64 尾部字符串识别容器，
//     契约 = 不 panic（非法 base64/短串返回 false）
//
// 运行：go test ./go/importer -fuzz=FuzzDetectContainerType -fuzztime=30s
//
//	go test ./go/importer -fuzz=FuzzDetectContainerTypeFromBase64Tail -fuzztime=30s
package importer

import (
	"archive/zip"
	"bytes"
	"testing"
)

// fuzzZipBytes 用给定条目名构造最小内存 zip（内容空，识别只看条目名）。
func fuzzZipBytes(t testing.TB, entries ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, name := range entries {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write(nil); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func FuzzDetectContainerType(f *testing.F) {
	f.Add(fuzzZipBytes(f, "ysm.json", "models/main.json")) // YSM 指纹 zip
	f.Add(fuzzZipBytes(f, "pack.mcmeta", "assets/x.png"))  // 资源包指纹 zip
	f.Add(fuzzZipBytes(f))                                 // 空 zip
	f.Add([]byte{0x37, 0x7A, 0xBC, 0xAF})                  // 7z 签名（截断）
	f.Add([]byte("PK\x03\x04"))                            // zip local header 前缀
	f.Add([]byte{})
	f.Add([]byte("not a container"))

	f.Fuzz(func(t *testing.T, data []byte) {
		// 超大输入直接返回：7z/zip 解析代价随体积上升，护栏无需遍历巨大输入
		// （Go fuzzer 生成的输入远小于此上限，仅在用户显式喂语料时触发）
		if len(data) > 8<<20 {
			return
		}
		// 契约 = 不 panic；识别结果（含 ""）由实现裁决，不作断言
		_ = DetectContainerType(data)
	})
}

func FuzzDetectContainerTypeFromBase64Tail(f *testing.F) {
	f.Add("")
	f.Add("UEsDBBQAAAAI")     // zip 尾部 base64 片段
	f.Add("N3q8rycc")         // 7z 签名 base64 片段
	f.Add("!!!not-base64!!!") // 非法 base64
	f.Add("A")                // 单字符（长度不足）
	f.Add("////")             // 全填充

	f.Fuzz(func(t *testing.T, b64 string) {
		if len(b64) > 1<<20 {
			return
		}
		// 契约 = 不 panic；无法识别返回 false 属预期
		_, _ = DetectContainerTypeFromBase64Tail(b64)
	})
}
