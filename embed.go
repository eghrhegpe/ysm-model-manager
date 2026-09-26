package main

import (
	"embed"
	"log"

	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/app"
)

//go:embed creators.json resource_types.json workshop-github.json workshop_sites.json
var bundledResourceFS embed.FS

// init 将编译期嵌入的静态资产注入 internal/app。
// 该文件无 build tag，故 GUI（!cli）与 CLI（cli）两种构建都会编译并注册，
// 确保 internal/app 在任意入口下都能取到资源 JSON。
// （.ysm 解码不走此链：ADR-316 后由 go/ysmwasi 内嵌 wasm 内存直解，
//
//	旧 YSMParser.js / YSMParser.wasm Node 桥资产注入已退役——前端预览
//	仍用 frontend 侧资产，与本 Go 内嵌无关。）
//
// resource_types.json 经 registry.SetBundledRegistryJSON 注入 go/types/registry，使扫描/安装/导入/
// 同步（LoadRegistry）与前端加载（LoadResourceTypes）共用同一份 root embed——
// 单源、build 即同步，彻底取代旧的手工副本 resource_types_embed.go（曾因不同步导致分类被回退弹平）。
func init() {
	app.SetEmbedded(bundledResourceFS)
	if data, err := bundledResourceFS.ReadFile("resource_types.json"); err == nil {
		registry.SetBundledRegistryJSON(data)
	} else {
		log.Printf("[embed] resource_types.json 读取失败: %v", err)
	}
}
