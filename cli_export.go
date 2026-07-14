//go:build cli

package main

import "ysm-model-manager/internal/app"

// 薄入口：实际 CLI 实现位于 internal/app（原 cli_export.go 的 func main 体
// 已抽为 app.CLIMain）。资源/ wasm 嵌入由 embed.go 的 init() 注入，此处无需处理。
func main() {
	app.CLIMain()
}
