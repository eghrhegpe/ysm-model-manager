// ===== go/geometry ParseBedrockGeometry 基准 =====
// 核心解析主路径（扫描/预览每次命中都走），补基准护栏防解析回归。
// 与 scanner_benchmark_test.go 同模板：b.TempDir 无 IO 依赖（纯内存解析），
// b.ReportAllocs 观测分配回归；bench 内不做断言（基准只测速，正确性归单测）。
package geometry

import (
	"testing"
)

// BenchmarkParseBedrockGeometry 测量标准 geometry JSON 解析吞吐。
// 输入复用 parse_test.go 的 validGeom（含多 bone / 双形态 UV / rotation 全要素）。
func BenchmarkParseBedrockGeometry(b *testing.B) {
	data := []byte(validGeom)
	b.ReportAllocs()
	b.SetBytes(int64(len(data)))
	for i := 0; i < b.N; i++ {
		m := ParseBedrockGeometry(data)
		if m == nil {
			b.Fatal("基准输入应解析成功")
		}
	}
}

// BenchmarkParseBedrockGeometry_Invalid 测量畸形输入路径（防炸弹分支）不 panic 的代价。
// 非法 JSON 走零值降级路径，是扫描畸形文件时的高频分支。
func BenchmarkParseBedrockGeometry_Invalid(b *testing.B) {
	data := []byte(`{"format_version":"1.16.0","minecraft:geometry":[{"bones":[{"name":"x","cubes":[{`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if m := ParseBedrockGeometry(data); m != nil {
			b.Fatal("畸形输入应返回 nil")
		}
	}
}
