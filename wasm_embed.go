package main

import (
	_ "embed"
)

//go:embed frontend/dist/wasm/YSMParser.wasm
var ysmWasmBinary []byte

//go:embed frontend/public/wasm/YSMParser.js
var ysmGlueCode string

// GetWasmBinary 返回内嵌的 YSMParser.wasm 字节（供前端 WebView2 使用）
func (a *App) GetWasmBinary() []byte {
	return ysmWasmBinary
}

// getWasmBinary 包级函数（供 CLI 使用）
func getWasmBinary() []byte {
	return ysmWasmBinary
}

// getGlueCode 返回内嵌的 YSMParser.js 胶水代码（供 CLI Node.js 解码使用）
func getGlueCode() string {
	return ysmGlueCode
}
