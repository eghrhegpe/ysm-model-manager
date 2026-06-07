package main

import (
	_ "embed"
)

//go:embed frontend/dist/wasm/YSMParser.wasm
var ysmWasmBinary []byte

// GetWasmBinary 返回内嵌的 YSMParser.wasm 字节（供前端 WebView2 使用）
func (a *App) GetWasmBinary() []byte {
	return ysmWasmBinary
}
