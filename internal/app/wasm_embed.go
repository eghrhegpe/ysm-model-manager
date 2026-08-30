package app

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
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
