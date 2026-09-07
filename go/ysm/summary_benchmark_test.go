// ===== go/ysm ExtractYsmSummary 基准 =====
// 扫描/导入主路径（每命中一个模型文件都要提取摘要），补基准护栏防 IO/ZIP
// 解压回归。与 scanner_benchmark_test.go 同模板：b.TempDir 构造夹具，
// b.SetBytes 观测吞吐；bench 内仅做「非 nil 错误」断言（正确性归单测）。
package ysm

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// writeYsmZipFixture 手写 ZIP 夹具（testutil.WriteZipFile 仅收 *testing.T，
// benchmark 的 *testing.B 无法直接传，本地构造等价物）。
func writeYsmZipFixture(b *testing.B, entries map[string]string) string {
	b.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			b.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			b.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		b.Fatal(err)
	}
	path := filepath.Join(b.TempDir(), "model.ysm")
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		b.Fatal(err)
	}
	return path
}

// BenchmarkExtractYsmSummary_Zip 测量 ZIP 含 ysm.json 的摘要提取主路径。
// 夹具构造移出计时区间（b.ResetTimer 前），只测提取本身。
func BenchmarkExtractYsmSummary_Zip(b *testing.B) {
	path := writeYsmZipFixture(b, map[string]string{
		"ysm.json":        minimalYsmJSON(),
		"geo/main.json":   `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"texture_width":64,"texture_height":64},"bones":[]}]}`,
		"tex/default.png": "fake-png-bytes",
	})

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := ExtractYsmSummary(path); err != nil {
			b.Fatalf("基准输入应提取成功: %v", err)
		}
	}
}

// BenchmarkExtractYsmSummary_PlainJSON 测量裸 ysm.json 提取路径（解压后模型常见形态）。
func BenchmarkExtractYsmSummary_PlainJSON(b *testing.B) {
	path := filepath.Join(b.TempDir(), "model.json")
	if err := os.WriteFile(path, []byte(minimalYsmJSON()), 0o644); err != nil {
		b.Fatal(err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := ExtractYsmSummary(path); err != nil {
			b.Fatalf("基准输入应提取成功: %v", err)
		}
	}
}
