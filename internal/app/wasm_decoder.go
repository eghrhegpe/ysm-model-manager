package app

import (
	"log"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/go/ysm"
	"ysm-model-manager/go/ysmwasi"
	"ysm-model-manager/go/ysmwebview"
)

// ysmDecodeTimeout 桥/兜底共用解码超时（对齐 ADR-316 护栏口径）
const ysmDecodeTimeout = 60 * time.Second

// decodeYSMBest 解码后端选择（ADR-317）：桥就绪且输入合规 → WebView 桥
// （Android 快路径，V8 JIT）；未就绪/失败/超限回退 wazero 内存直解
// （桌面主路径 + Android 兜底 + CLI 无前端的天然路径）。
func decodeYSMBest(data []byte) ([]ysm.DecodedFile, error) {
	if ysmDecodeBridge.Ready() && len(data) <= ysmwebview.MaxInput {
		files, err := ysmDecodeBridge.Decode(data, ysmDecodeTimeout)
		if err == nil {
			return files, nil
		}
		log.Printf("[ysm-webview] 桥解码失败，回退 wazero: %v", err)
	}
	return ysmwasi.Decode(data)
}

func init() {
	// 注入 .ysm 解码器（fileops 封面提取等 go/ 层消费端）：ADR-316 wazero 纯 Go
	// 内存直解为基线，ADR-317 后 Android 上优先走 WebView 桥（decodeYSMBest 选择）；
	// 解码失败降级为 nil（与旧口径一致），错误进日志供诊断。
	ysm.SetDecoder(func(data []byte) []ysm.DecodedFile {
		files, err := decodeYSMBest(data)
		if err != nil {
			log.Printf("[ysm-wasi] 解码失败: %v", err)
			return nil
		}
		return files
	})
}

// decodedYSMExtra 解码产出的单个文件（Path 为产物相对路径）
type decodedYSMExtra struct {
	Path string
	Data []byte
}

// runYSMDecode 解码 .ysm（decodeYSMBest 选择桥/wazero），返回解出的全部文件
// （Path/Data）。decodeYSMViaWASI（合并单组件）与 decodeYSMComponentsViaWASI（多组件）共用此解码。
func runYSMDecode(ysmData []byte) []decodedYSMExtra {
	files, err := decodeYSMBest(ysmData)
	if err != nil {
		log.Printf("[ysm-wasi] 解码失败: %v", err)
		return nil
	}
	out := make([]decodedYSMExtra, len(files))
	for i, f := range files {
		out[i] = decodedYSMExtra{Path: f.Path, Data: f.Data}
	}
	return out
}

// decodeYSMViaWASI 解码 .ysm 并合并为单 BedrockModel（单组件模式）。
func decodeYSMViaWASI(ysmData []byte) *types.BedrockModel { //nolint:gocyclo // 存量复杂度（23>20），发版窗口暂以 nolint 记账，重构另立任务
	files := runYSMDecode(ysmData)
	if len(files) == 0 {
		return nil
	}

	// 找 geometry JSON 文件（合并全部组件 bones，保持历史单组件行为）
	var merged *types.BedrockModel
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".json") || registry.IsYsmEntryJSON(filepath.Base(low)) {
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
		if registry.IsYsmEntryJSON(filepath.Base(low)) {
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

// decodeYSMComponentsViaWASI 解码 .ysm 并收集为多组件列表（不合并 bones）。
// 每个组件 = 独立 BedrockModel；TexSlot 按全局文件序分配（main 优先，其余按路径排序），
// 供 threejs.BuildMulti 生成多组件 spec（YSMViewer 式多组件同屏，arm 等保留为独立组件）。
func decodeYSMComponentsViaWASI(ysmData []byte) ([]types.BedrockModel, []string) {
	files := runYSMDecode(ysmData)
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
		if !strings.HasSuffix(low, ".json") || registry.IsYsmEntryJSON(filepath.Base(low)) {
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
	// 对 main.geo.json 不命中，会把 arm 排在 main 前。
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
