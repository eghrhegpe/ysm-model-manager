package ysmwasi

import (
	"context"
	"os"
	"testing"

	"github.com/tetratelabs/wazero"
)

// benchFixture 读真实 .ysm 样本（YSMWASI_TEST_FIXTURE），未设置则跳过——
// 基准必须喂真实加密容器，合成字节会在 parser abort 上测出无意义的 trap 耗时。
func benchFixture(b *testing.B) []byte {
	b.Helper()
	path := os.Getenv("YSMWASI_TEST_FIXTURE")
	if path == "" {
		b.Skip("未设置 YSMWASI_TEST_FIXTURE，跳过真实样本基准")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		b.Fatalf("读取样本: %v", err)
	}
	return data
}

// BenchmarkDecode_Compiler 生产路径基准（wazero optimizing compiler；
// Windows/macOS/Linux amd64+arm64 桌面端实走此路径）。
// 运行：YSMWASI_TEST_FIXTURE=<.ysm> go test ./go/ysmwasi/ -bench . -benchtime 5x
func BenchmarkDecode_Compiler(b *testing.B) {
	data := benchFixture(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := Decode(data); err != nil {
			b.Fatalf("解码失败: %v", err)
		}
	}
}

// BenchmarkDecode_Interpreter 无 compiler 平台基准（Android 上 wazero 退
// interpreter 的量化依据——上线前在开发机先拿到数量级，on-device 终测另行安排）。
// 同一真实样本、同 decodeWith 路径，仅 runtime 配置不同。
func BenchmarkDecode_Interpreter(b *testing.B) {
	data := benchFixture(b)
	ctx := context.Background()
	rt, cm, err := newRuntime(ctx, wazero.NewRuntimeConfigInterpreter())
	if err != nil {
		b.Fatalf("interpreter runtime 初始化: %v", err)
	}
	defer rt.Close(ctx)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := decodeWith(ctx, rt, cm, data); err != nil {
			b.Fatalf("解码失败: %v", err)
		}
	}
}
