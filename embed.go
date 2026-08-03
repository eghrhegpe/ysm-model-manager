package main

import (
	"embed"

	"ysm-model-manager/internal/app"
)

//go:embed creators.json resource_types.json workshop-github.json workshop_sites.json
var bundledResourceFS embed.FS

//go:embed frontend/dist/wasm/YSMParser.wasm
var ysmWasmBinary []byte

//go:embed frontend/public/wasm/YSMParser.js
var ysmGlueCode string

// init 将编译期嵌入的静态资产注入 internal/app。
// 该文件无 build tag，故 GUI（!cli）与 CLI（cli）两种构建都会编译并注册，
// 确保 internal/app 在任意入口下都能取到资源 JSON 与 wasm 胶水。
func init() {
	app.SetEmbedded(bundledResourceFS, ysmWasmBinary, ysmGlueCode)
}
