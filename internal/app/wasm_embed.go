package app

// getWasmBinary 包级函数（供 CLI 使用）
func getWasmBinary() []byte {
	return wasmBinary
}

// getGlueCode 返回内嵌的 YSMParser.js 胶水代码（供 CLI Node.js 解码使用）
func getGlueCode() string {
	return glueCode
}
