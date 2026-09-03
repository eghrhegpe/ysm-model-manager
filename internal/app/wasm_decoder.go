package app

import (
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"ysm-model-manager/go/avatar"
	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// nodeJSPath 查找 node.js 可执行文件
var nodeJSPath = findNodeJS()

func init() {
	avatar.SetNodeJS(nodeJSPath, getGlueCode, getWasmBinary)
	// 注入 .ysm 解码器（fileops 封面提取等 go/ 层消费端；取代已停发的 YSMParser.exe sidecar）
	ysm.SetDecoder(func(data []byte) []ysm.DecodedFile {
		out := runYSMNodeJSDecode(data)
		if out == nil {
			return nil
		}
		files := make([]ysm.DecodedFile, len(out))
		for i, f := range out {
			files[i] = ysm.DecodedFile{Path: f.Path, Data: f.Data}
		}
		return files
	})
}

func findNodeJS() string {
	// ADR-047 明示：Android 无 Node.js 运行时，nodeJSPath 恒为空 → runYSMNodeJSDecode
	// 返回 nil（.ysm 预览走 WASM 内嵌解码或不可用），不尝试 exec 避免静默失败
	if runtime.GOOS == "android" {
		return ""
	}
	// PATH 查找（跨平台：Linux/macOS 命中 "node"，Windows 命中 "node.exe"）
	if p, err := exec.LookPath("node"); err == nil {
		return p
	}
	if p, err := exec.LookPath("node.exe"); err == nil {
		return p
	}
	return ""
}

// decodeYSMViaNodeJS 用 Node.js + WASM 解码 .ysm 文件
// 嵌入的 JS 胶水代码和 WASM 二进制会写到临时目录执行
type decodedYSMExtra struct {
	Path string
	Data []byte
}

// runYSMNodeJSDecode 用 Node.js + WASM 解码 .ysm，返回解出的全部文件（Path/Data）。
// decodeYSMViaNodeJS（合并单组件）与 decodeYSMComponentsViaNodeJS（多组件）共用此解码。
// ADR-164 收敛：实现下沉 go/avatar.DecodeYSMData（脚本/子进程/护栏全仓唯一副本），
// 本函数仅做类型适配——超时/输入/输出护栏语义由 avatar 统一承接。
func runYSMNodeJSDecode(ysmData []byte) []decodedYSMExtra {
	files := avatar.DecodeYSMData(ysmData)
	if len(files) == 0 {
		return nil
	}
	out := make([]decodedYSMExtra, len(files))
	for i, f := range files {
		out[i] = decodedYSMExtra{Path: f.Path, Data: f.Data}
	}
	return out
}

// decodeYSMViaNodeJS 用 Node.js + WASM 解码 .ysm 并合并为单 BedrockModel（单组件模式）。
func decodeYSMViaNodeJS(ysmData []byte) *types.BedrockModel {
	files := runYSMNodeJSDecode(ysmData)
	if len(files) == 0 {
		return nil
	}

	// 找 geometry JSON 文件（合并全部组件 bones，保持历史单组件行为）
	var merged *types.BedrockModel
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".json") || types.IsYsmEntryJSON(filepath.Base(low)) {
			continue
		}
		data := f.Data
		if g := geometry.ParseBedrockGeometry(data); g != nil {
			for bi := range g.Bones {
				for ci := range g.Bones[bi].Cubes {
					g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
					g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				}
			}
			if merged == nil {
				merged = g
			} else {
				merged.Bones = append(merged.Bones, g.Bones...)
				merged.BoneCount += g.BoneCount
				merged.CubeCount += g.CubeCount
				// 合并 TexWidth/TexHeight 取 max（对齐 CLI exe 路径 app_model.go 口径）
				if g.TexWidth > merged.TexWidth {
					merged.TexWidth = g.TexWidth
				}
				if g.TexHeight > merged.TexHeight {
					merged.TexHeight = g.TexHeight
				}
			}
		}
	}

	if merged == nil {
		return nil
	}

	// 找纹理（收集全部：Textures 数组供多纹理/3D texArr，Texture 取第一张兼容单纹理）
	var texRaws []ysmTexItem
	var ysmJSON []byte
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if types.IsYsmEntryJSON(filepath.Base(low)) {
			ysmJSON = f.Data // 保留 ysm.json 用于纹理声明序对齐
			continue
		}
		if !strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg") {
			continue
		}
		if strings.HasPrefix(low, "avatar") || strings.Contains(low, "/avatar/") {
			continue
		}
		mime := "image/png"
		if strings.HasSuffix(low, ".jpg") {
			mime = "image/jpeg"
		}
		tn := path.Base(f.Path)
		lowTn := strings.ToLower(tn)
		if strings.HasSuffix(lowTn, ".png") {
			tn = strings.TrimSuffix(tn, ".png")
		} else if strings.HasSuffix(lowTn, ".jpg") {
			tn = strings.TrimSuffix(tn, ".jpg")
		}
		texRaws = append(texRaws, ysmTexItem{name: tn, raw: f.Data, mime: mime})
	}
	if len(texRaws) > 0 {
		// 纹理序口径统一（texture_order.go）：有 ysm.json 声明序 → 声明序 + default_texture 置首；
		// 无（加密模型等）→ 纹理尺寸降序。与前端 wasm.ts orderedTexKeys 对称。
		texNames, texData := orderTexItems(texRaws, ysmJSON)
		if len(texData) == 0 {
			return merged
		}
		merged.Textures = texData
		merged.Texture = texData[0]
		merged.TextureNames = texNames
	}

	return merged
}

// decodeYSMComponentsViaNodeJS 解码 .ysm 并收集为多组件列表（不合并 bones）。
// 每个组件 = 独立 BedrockModel；TexSlot 按全局文件序分配（main 优先，其余按路径排序），
// 供 threejs.BuildMulti 生成多组件 spec（YSMViewer 式多组件同屏，arm 等保留为独立组件）。
func decodeYSMComponentsViaNodeJS(ysmData []byte) ([]types.BedrockModel, []string) {
	files := runYSMNodeJSDecode(ysmData)
	if len(files) == 0 {
		return nil, nil
	}

	// 收集模型文件（ParseBedrockGeometry 非空的 .json；动画 JSON 解析为 nil 自动过滤）
	type mf struct {
		path string
		data []byte
	}
	var modelFiles []mf
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".json") || types.IsYsmEntryJSON(filepath.Base(low)) {
			continue
		}
		if g := geometry.ParseBedrockGeometry(f.Data); g != nil {
			modelFiles = append(modelFiles, mf{path: f.Path, data: f.Data})
		}
	}
	if len(modelFiles) == 0 {
		return nil, nil
	}
	// main 优先（YSMViewer 式主组件），其余按路径排序（确定性，ADR-039）
	// 注意：用 basename 判定 main（main.json / main.geo.json），与 zip 版
	// geometry.IsMainModelName 同口径——strings.Contains(..., "main.json")
	// 对 main.geo.json 不命中，会把 arm 排在 main 前（code_review P2）。
	sort.SliceStable(modelFiles, func(i, j int) bool {
		mi := geometry.IsMainModelName(modelFiles[i].path)
		mj := geometry.IsMainModelName(modelFiles[j].path)
		if mi != mj {
			return mi
		}
		return modelFiles[i].path < modelFiles[j].path
	})

	comps := make([]types.BedrockModel, 0, len(modelFiles))
	for i, mf := range modelFiles {
		g := geometry.ParseBedrockGeometry(mf.data)
		if g == nil {
			continue
		}
		// SourceName = 组件源模型文件名（去扩展名，如 main/arm/arrow），UI 组件名用
		src := mf.path
		if idx := strings.LastIndexAny(src, "/\\"); idx >= 0 {
			src = src[idx+1:]
		}
		src = strings.TrimSuffix(strings.TrimSuffix(src, ".geo.json"), ".json")
		g.SourceName = src
		// TexSlot = 全局纹理序（组件 i 的纹理起点；与 FindGeometryInExtractedYSM 的
		// 文件序 texSlot 口径一致，前端 texArr 全局数组按序索引）
		for bi := range g.Bones {
			for ci := range g.Bones[bi].Cubes {
				g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
				g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				g.Bones[bi].Cubes[ci].TexSlot = i
			}
		}
		comps = append(comps, *g)
	}
	// R1 契约：WASM 路径无 ysm.json texture 声明（texArr 序由 AnalyzeBedrockModel 决定），
	// 返回 nil texNames——前端跳过契约比对（避免误报）。
	return comps, nil
}

// ysmTextureOrder 解析 ysm.json 的 files.player.texture 声明序与 properties.default_texture。
