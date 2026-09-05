package main

import (
	"embed"
	"log"

	"ysm-model-manager/go/types/registry"
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
// resource_types.json 经 registry.SetBundledRegistryJSON 注入 go/types/registry，使扫描/安装/导入/
// 同步（LoadRegistry）与前端加载（LoadResourceTypes）共用同一份 root embed——
// 单源、build 即同步，彻底取代旧的手工副本 resource_types_embed.go（曾因不同步导致分类被回退弹平）。
func init() {
	app.SetEmbedded(bundledResourceFS, ysmWasmBinary, ysmGlueCode)
	if data, err := bundledResourceFS.ReadFile("resource_types.json"); err == nil {
		registry.SetBundledRegistryJSON(data)
	} else {
		log.Printf("[embed] resource_types.json 读取失败: %v", err)
	}
}
