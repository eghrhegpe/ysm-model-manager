// ===== go/avatar 补测（既有测试未覆盖分支）=====
package avatar

import (
	"archive/zip"
	"bytes"
	"testing"
)

func TestReadFileFromZip_NoMatch(t *testing.T) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, _ := w.Create("other.txt")
	_, _ = f.Write([]byte("x"))
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if got := ReadFileFromZip(zr, "target.png"); got != nil {
		t.Fatalf("目标不存在应 nil: %q", got)
	}
	// 反斜杠路径归一化匹配（Windows 风格 zip 条目）
	w2 := zip.NewWriter(&buf)
	buf.Reset()
	f2, _ := w2.Create(`avatars\a.png`)
	_, _ = f2.Write([]byte("PNG"))
	_ = w2.Close()
	zr2, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if got := ReadFileFromZip(zr2, "avatars/a.png"); string(got) != "PNG" {
		t.Fatalf("反斜杠路径应归一化匹配: %q", string(got))
	}
}
