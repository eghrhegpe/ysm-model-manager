package geometry

import (
	"archive/zip"
	"bytes"
	"testing"
)

// TestExtractFirstPNG_PackPngPreferred 验证封面候选名优先于"第一张 PNG"：
// pack.png 排在最后也能被优先选中（MC 生态封面约定，资源包/女仆包统一受益）。
func TestExtractFirstPNG_PackPngPreferred(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	// 故意把 pack.png 放在最后（assets 纹理在前）
	for _, e := range []struct{ name, content string }{
		{"assets/mod/textures/entity/role.png", "ROLE_PNG"},
		{"assets/mod/textures/maid_icon.png", "ICON_PNG"},
		{"assets/mod/maid_model.json", `{"spec":1}`},
		{"pack.png", "PACK_PNG"},
	} {
		w, err := zw.Create(e.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(e.content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	data := buf.Bytes()

	got := ExtractFirstPNGFromZip(data, int64(len(data)))
	if string(got) != "PACK_PNG" {
		t.Fatalf("应优先选 pack.png, 得到 %q", string(got))
	}
}

// TestExtractFirstPNG_CoverFallback 无 pack.png 时回退 cover.png/preview.png/thumbnail.png
func TestExtractFirstPNG_CoverFallback(t *testing.T) {
	for _, name := range []string{"cover.png", "preview.png", "thumbnail.png"} {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		w, _ := zw.Create("assets/mod/textures/entity/role.png")
		w.Write([]byte("ROLE_PNG"))
		w2, _ := zw.Create(name)
		w2.Write([]byte("COVER_" + name))
		zw.Close()

		got := ExtractFirstPNGFromZip(buf.Bytes(), int64(buf.Len()))
		if string(got) != "COVER_"+name {
			t.Fatalf("%s 应被优先选中, 得到 %q", name, string(got))
		}
	}
}

// TestExtractFirstPNG_NoCoverStillFirst 无任何封面候选时仍回退第一张 PNG（旧行为不变）
func TestExtractFirstPNG_NoCoverStillFirst(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range []struct{ name, content string }{
		{"assets/mod/textures/entity/role.png", "ROLE_PNG"},
		{"assets/mod/textures/maid_icon.png", "ICON_PNG"},
	} {
		w, _ := zw.Create(e.name)
		w.Write([]byte(e.content))
	}
	zw.Close()

	got := ExtractFirstPNGFromZip(buf.Bytes(), int64(buf.Len()))
	if string(got) != "ROLE_PNG" {
		t.Fatalf("无封面候选应取第一张 PNG, 得到 %q", string(got))
	}
}
