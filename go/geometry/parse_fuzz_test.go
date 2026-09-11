// ===== go/geometry ParseBedrockGeometry 模糊测试 =====
// 契约：任意畸形字节流不得 panic、不得挂起——超限输入由实现内部 maxParseSize
// 防炸弹上限拦截，畸形 JSON 走零值降级路径。正确性归单测
// TestParseBedrockGeometry_*，本文件只做「不崩」护栏（与 parse_benchmark_test.go
// 同属主路径护栏，区别在输入来自随机变异而非固定样本）。
//
// 运行：go test ./go/geometry -fuzz=FuzzParseBedrockGeometry -fuzztime=30s
package geometry

import "testing"

func FuzzParseBedrockGeometry(f *testing.F) {
	// 种子：合法标准 geometry（多 bone / UV 数组与对象双形态 / rotation 全要素，
	// 复用 parse_test.go 的 validGeom）+ 既有畸形/空/截断样本
	f.Add([]byte(validGeom))
	f.Add([]byte(`{"format_version":"1.0","minecraft:geometry":[]}`))
	f.Add([]byte(`{"format_version":"1.16.0","minecraft:geometry":[{"bones":[{"name":"x","cubes":[{`))
	f.Add([]byte("{not json"))
	f.Add([]byte(""))
	f.Add([]byte("{}"))

	f.Fuzz(func(t *testing.T, data []byte) {
		// 唯一契约 = 不 panic 且正常返回；返回 nil 是合法降级，不作断言
		_ = ParseBedrockGeometry(data)
	})
}
