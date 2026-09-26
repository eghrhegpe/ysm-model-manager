package app

import "embed"

// 编译期嵌入的静态资产由根包 main 在 init() 中通过 SetEmbedded 注入。
// 原因：Go 的 //go:embed 禁止用 ".." 上溯目录，而资源 JSON 位于仓库根，
// 故 embed 必须定义在仓库根的 .go 文件中（无法下沉到 internal/app）。
// 本包只持有注入后的引用，供 loadBundledData 使用。
// （wasmBinary/glueCode 已随 ADR-316 Node 桥退役删除，.ysm 解码走 go/ysmwasi 内嵌 wasm。）
var resourceFS embed.FS

// SetEmbedded 由根包 main 的 init() 注入编译期嵌入的静态资产。
func SetEmbedded(rfs embed.FS) {
	resourceFS = rfs
}
