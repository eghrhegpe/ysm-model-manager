// ===== DetectZipTypeFromBase64Tail 尾部探针测试（audit #1）=====
package importer

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"testing"
)

// buildZipB64 用 archive/zip 构造内存 zip 并转 base64（标准填充，len%4==0）
func buildZipB64(t *testing.T, entries map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range entries {
		fw, err := w.Create(name)
		if err != nil {
			t.Fatalf("Create %s: %v", name, err)
		}
		if _, err := fw.Write([]byte(content)); err != nil {
			t.Fatalf("Write %s: %v", name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestDetectZipTypeFromBase64Tail(t *testing.T) {
	// 正常 zip：尾部探针与全量 DetectZipType 同答案
	b64 := buildZipB64(t, map[string]string{"ysm.json": "{}", "model/body.ysm": "x"})
	want := ""
	if full := DetectZipType(mustDecode(t, b64)); full != "" {
		want = full
	}
	if id, ok := DetectZipTypeFromBase64Tail(b64); !ok || id != want {
		t.Errorf("尾部探针 = (%q, %v), want (%q, true)", id, ok, want)
	}
	// 与全量路径交叉验证：两者判定一致
	fullID := DetectZipType(mustDecode(t, b64))
	tailID, _ := DetectZipTypeFromBase64Tail(b64)
	if fullID != tailID {
		t.Errorf("全量=%q 尾部=%q 应一致", fullID, tailID)
	}

	// 非 zip 垃圾：ok=false，交全量兜底
	if _, ok := DetectZipTypeFromBase64Tail(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0xAB}, 128))); ok {
		t.Error("非 zip 输入应返回 ok=false")
	}

	// 非法 base64（长度非 4 倍数）：ok=false
	if _, ok := DetectZipTypeFromBase64Tail("abc"); ok {
		t.Error("非法 base64 应返回 ok=false")
	}

	// 多条目 zip（窗口内）条目名完整解析：条目数多但不超 4MB 窗口
	many := map[string]string{"ysm.json": "{}"}
	for i := 0; i < 500; i++ {
		many["textures/tex_"+string(rune('a'+i%26))+string(rune('a'+i/26))+".png"] = "x"
	}
	b64Many := buildZipB64(t, many)
	if id, ok := DetectZipTypeFromBase64Tail(b64Many); !ok || id == "" {
		t.Errorf("多条目 zip 尾部探针应成功, got (%q, %v)", id, ok)
	}
}

func TestDetectZipTypeFromBase64Tail_LargePaddingFile(t *testing.T) {
	// 大体积 zip：前置一个大 stored 条目把文件推到 >50MB（旧探针上限之上），
	// 中央目录仍在末尾窗口内——探测应成功（旧实现整包解码 50MB 上限必返 unknown）
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	fw, err := w.CreateHeader(&zip.FileHeader{Name: "big.bin", Method: zip.Store})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(bytes.Repeat([]byte{0}, 51<<20)); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"ysm.json", "model/body.ysm"} {
		fw2, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		fw2.Write([]byte("{}"))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if buf.Len() < 50<<20 {
		t.Fatalf("构造的 zip 应大于 50MB, got %d", buf.Len())
	}
	b64 := base64.StdEncoding.EncodeToString(buf.Bytes())
	id, ok := DetectZipTypeFromBase64Tail(b64)
	if !ok || id == "" {
		t.Errorf(">50MB zip 尾部探针应成功（旧上限真空）, got (%q, %v)", id, ok)
	}
}

func mustDecode(t *testing.T, b64 string) []byte {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
