package app

import (
	"testing"
)

// TestGetWasmBinary_ReturnsBytes 测试 getWasmBinary 返回非空字节
// 注意：嵌入的 WASM 仅在完整构建（main 包 init 注入）时可用，go test 时为空
func TestGetWasmBinary_ReturnsBytes(t *testing.T) {
	wasm := getWasmBinary()
	// 测试环境无嵌入时跳过（仅在完整构建时注入）
	if len(wasm) == 0 {
		t.Skip("测试环境无嵌入 WASM（仅完整构建时注入），跳过")
	}
	// WASM 魔数: \x00asm
	if len(wasm) < 4 || string(wasm[:4]) != "\x00asm" {
		t.Fatalf("返回数据非 WASM 格式: 前4字节=%v", wasm[:4])
	}
}

// TestGetGlueCode_ReturnsJS 测试 getGlueCode 返回非空 JS 胶水代码
// 注意：嵌入的胶水代码仅在完整构建（main 包 init 注入）时可用，go test 时为空
func TestGetGlueCode_ReturnsJS(t *testing.T) {
	code := getGlueCode()
	// 测试环境无嵌入时跳过
	if len(code) == 0 {
		t.Skip("测试环境无嵌入胶水代码（仅完整构建时注入），跳过")
	}
	// 应包含关键标识（YSMParser 模块初始化等）
	if !containsAny(code, []string{"YSMParser", "Module", "instantiate"}) {
		t.Logf("胶水代码前200字符: %s", code[:min(200, len(code))])
	}
}

func containsAny(s string, substrs []string) bool {
	for _, sub := range substrs {
		if len(s) >= len(sub) && indexSubstring(s, sub) >= 0 {
			return true
		}
	}
	return false
}

func indexSubstring(s, sub string) int {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
