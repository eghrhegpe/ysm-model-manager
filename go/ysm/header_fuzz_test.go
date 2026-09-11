// ===== go/ysm AnalyzeYSMHeaderFromBytes 模糊测试 =====
// 契约：任意畸形字节流不得 panic、不得挂起——实现内部对输入截断至前 4096 字节，
// 畸形标记走零值/部分填充降级（parseInt 另有溢出守卫钳到 0）。正确性归单测
// TestAnalyzeYSMHeaderFromBytes_*（Full/Truncated/Empty）与 adversarial_test.go，
// 本文件只做「不崩」护栏。
//
// 目标选择理由：AnalyzeYSMHeaderFromBytes 是 go/ysm 下唯一「纯字节进、结构出」
// 且无外部依赖（不读盘、不依赖注入解码器）的解析入口；同包的
// FindComponentsInExtractedYSM / AnalyzeYSMModel 等均以路径为入参、需真实
// fixture 落盘，字节 fuzz 不适用。DecodeYSM 为注入转发层（默认 nil 直返），
// 无解析逻辑，fuzz 价值低。
//
// 运行：go test ./go/ysm -fuzz=FuzzAnalyzeYSMHeaderFromBytes -fuzztime=30s
package ysm

import "testing"

func FuzzAnalyzeYSMHeaderFromBytes(f *testing.F) {
	// 种子：合法完整头部（复用 header_test.go 的 Full 样本）+
	// 截断 / 空 / 二进制 / 畸形标记 / 超长数值
	f.Add([]byte("YSGP\n--- [Metadata]\n<name>ByteTest</name>\n<license>MIT</license>\n--- [Authors]\n<name>AuthorName</name>\n==="))
	f.Add([]byte("YSGP\n--- [Metadata]\n<name>Truncated</name>\n==="))
	f.Add([]byte{})
	f.Add([]byte{0x00, 0xff, 0x1b, 0x7f})
	f.Add([]byte("<name>"))
	f.Add([]byte("<format>99999999999999999999"))
	f.Add([]byte("--- [Authors]\n<name>a</name>"))
	f.Add([]byte("\xef\xbb\xbfYSGP"))

	f.Fuzz(func(t *testing.T, data []byte) {
		// 唯一契约 = 不 panic 且正常返回；零值 Header 是合法降级，不作断言
		_ = AnalyzeYSMHeaderFromBytes(data)
	})
}
