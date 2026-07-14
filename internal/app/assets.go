package app

import "embed"

// 编译期嵌入的静态资产由根包 main 在 init() 中通过 SetEmbedded 注入。
// 原因：Go 的 //go:embed 禁止用 ".." 上溯目录，而资源 JSON 与 frontend
// 资产位于仓库根，故 embed 必须定义在仓库根的 .go 文件中（无法下沉到
// internal/app）。本包只持有注入后的引用，供 loadBundledData / wasm 胶水使用。
var (
	resourceFS embed.FS
	wasmBinary []byte
	glueCode   string
)

// SetEmbedded 由根包 main 的 init() 注入编译期嵌入的静态资产。
func SetEmbedded(rfs embed.FS, wasm []byte, glue string) {
	resourceFS = rfs
	wasmBinary = wasm
	glueCode = glue
}
