// ===== go/geometry archive 单测（覆盖率 11.4% → 提升）=====
// 注：ParseBedrockGeometry 测试见 parse_test.go（并行补测），本文件覆盖 archive.go。
package geometry

import (
	"archive/zip"
	"bytes"
	"testing"
)

func makeZipBytes(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestExtractFirstPNGFromZip(t *testing.T) {
	// 含 PNG → 提取第一张
	data := makeZipBytes(t, map[string]string{
		"tex/1.png":  "PNGDATA1",
		"readme.txt": "hi",
		"tex/2.png":  "PNGDATA2",
	})
	got := ExtractFirstPNGFromZip(data, int64(len(data)))
	if string(got) != "PNGDATA1" {
		t.Fatalf("应提取第一张 PNG: %q", string(got))
	}
	// 无 PNG → nil
	data2 := makeZipBytes(t, map[string]string{"a.txt": "x"})
	if got := ExtractFirstPNGFromZip(data2, int64(len(data2))); got != nil {
		t.Fatalf("无 png 应 nil: %q", string(got))
	}
	// 坏 zip → nil
	if got := ExtractFirstPNGFromZip([]byte("notzip"), 6); got != nil {
		t.Fatalf("坏 zip 应 nil: %q", string(got))
	}
}

func TestExtractFirstPNGFrom7z_BadData(t *testing.T) {
	// 7z 样本构造需 sevenzip Writer，此处只覆盖错误路径
	if got := ExtractFirstPNGFrom7z([]byte("not7z"), 5); got != nil {
		t.Fatalf("坏 7z 应 nil: %q", string(got))
	}
}

func TestParseFromZip_Errors(t *testing.T) {
	// 坏 zip → 全 nil
	if model, pngs, names := ParseFromZip([]byte("notzip"), 6); model != nil || pngs != nil || names != nil {
		t.Fatalf("坏 zip 应全 nil")
	}
	// 有效 zip 但无 ysm.json → 模型为 nil（无解析失败崩溃）
	empty := makeZipBytes(t, map[string]string{"tex.png": "PNG"})
	model, _, _ := ParseFromZip(empty, int64(len(empty)))
	if model != nil {
		t.Fatalf("无 ysm.json 应无模型")
	}
}
