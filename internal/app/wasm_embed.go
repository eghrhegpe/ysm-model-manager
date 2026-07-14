package app

// GetWasmBinary 返回内嵌的 YSMParser.wasm 字节（供前端 WebView2 使用）。
// wasmBinary 由根包 main 的 init() 经 SetEmbedded 注入。
func (a *App) GetWasmBinary() []byte {
	return wasmBinary
}

// getWasmBinary 包级函数（供 CLI 使用）
func getWasmBinary() []byte {
	return wasmBinary
}

// getGlueCode 返回内嵌的 YSMParser.js 胶水代码（供 CLI Node.js 解码使用）
func getGlueCode() string {
	return glueCode
}
