// ===== go/container 容器层模糊测试 =====
// 容器层是"条目名 + 条目内容"的统一入口（ADR-068），直接消费用户磁盘上的
// 不可信 zip 字节与条目名（含 GBK/Shift-JIS/Big5 非 UTF-8 名）。三个护栏目标：
//
//   - OpenZipBytes：内存 zip 解析 + 条目枚举，契约 = 不 panic、坏/截断输入返回 err
//   - normalizeEntryName：非 UTF-8 条目名救援归一化，契约 = 不 panic（已在
//     TestNormalizeEntryName_InvalidBytesNoPanic 静态覆盖，此处随机化推广）
//   - bestDecode：多编码试解兜底，契约 = 不 panic（畸形字节序列不得崩）
//
// 运行：go test ./go/container -fuzz=FuzzOpenZipBytes -fuzztime=30s
//
//	go test ./go/container -fuzz=FuzzNormalizeEntryName -fuzztime=30s
//	go test ./go/container -fuzz=FuzzBestDecode -fuzztime=30s
package container

import (
	"archive/zip"
	"bytes"
	"testing"
)

// fuzzMakeZip 构造内存 zip；非 UTF-8 名（GBK 中文/Shift-JIS）以原始字节写入，
// 用于覆盖 normalizeEntryName 的救援路径。
func fuzzMakeZip(t testing.TB, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range entries {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func FuzzOpenZipBytes(f *testing.F) {
	f.Add(fuzzMakeZip(f, map[string]string{"a.txt": "hello", "dir/b.bin": "\x00\x01"}))
	// GBK「中文」原始字节——合法 UTF-8 名（如 "中文.png"）会被 zip.Writer 设 UTF-8 标志、
	// 走 cleanControlChars 正常路径，命中不了 NonUTF8 救援路径，故种子须用原始字节
	f.Add(fuzzMakeZip(f, map[string]string{"\xd6\xd0\xce\xc4.png": "x"}))
	f.Add(fuzzMakeZip(f, nil))            // 空 zip
	f.Add([]byte("PK\x03\x04"))           // local header 前缀（截断）
	f.Add([]byte{0x37, 0x7A, 0xBC, 0xAF}) // 7z 签名（非 zip）
	f.Add([]byte{})

	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 4<<20 {
			return // 超大输入跳过：护栏无需遍历巨量字节
		}
		r, err := OpenZipBytes(data, int64(len(data)))
		if err != nil {
			return // 坏/截断 zip → err 属预期降级
		}
		defer r.Close()
		// 枚举契约：条目元数据访问不得 panic
		_ = r.Incomplete()
		for _, e := range r.Entries() {
			_ = e.Name()
			_ = e.IsDir()
			size := e.UncompressedSize64()
			// 仅解压小条目做真实读取（防空条目声明的超大尺寸触发内存膨胀）
			if size > 64<<10 {
				continue
			}
			rc, err := e.Open()
			if err != nil {
				continue
			}
			buf := make([]byte, 0, 1024)
			tmp := make([]byte, 512)
			for {
				n, err := rc.Read(tmp)
				buf = append(buf, tmp[:n]...)
				if err != nil || len(buf) > 1<<20 {
					break
				}
			}
			_ = rc.Close()
		}
	})
}

func FuzzNormalizeEntryName(f *testing.F) {
	f.Add("a.txt", false)
	f.Add("中文.png", true)
	f.Add("\x80\x81\x82", true)  // 非法 UTF-8 字节
	f.Add("\x1b[31m\x07", false) // 控制字符
	f.Add("", false)
	f.Add("/abs/../traversal/\\x", true)

	f.Fuzz(func(t *testing.T, name string, nonUTF8 bool) {
		if len(name) > 1<<16 {
			return
		}
		// 契约 = 不 panic；归一化结果由实现裁决，不作断言
		_ = normalizeEntryName(name, nonUTF8)
	})
}

func FuzzBestDecode(f *testing.F) {
	f.Add("plain-ascii")
	f.Add("中文")
	f.Add("\x80\x81\x82\x83") // GBK 片段
	f.Add("\xff\xfe\xfd")
	f.Add("")

	f.Fuzz(func(t *testing.T, raw string) {
		if len(raw) > 1<<16 {
			return
		}
		// 契约 = 不 panic（多编码试解路径不得因畸形字节序列崩溃）
		_ = bestDecode(raw)
	})
}
