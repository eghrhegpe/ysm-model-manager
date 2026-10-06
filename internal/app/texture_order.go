package app

// 纹理序口径（2026-08-10 统一）：有 ysm.json 声明序 → 声明序 + default_texture 置首；
// 无（加密模型等 ysm.json 不可解）→ 按纹理尺寸降序（主纹理通常最大）。
// 三处消费方共用：AnalyzeBedrockModel（Go 原生解析）、decodeYSMViaWASI（wazero 解码）、
// 前端 wasm.ts orderedTexKeys（texture-order.ts，口径对称）。改口径务必同步三处。

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"path/filepath"
	"sort"
	"strings"
)

// ysmTexItem 纹理收集项（name + 原始字节 + mime），供排序与 dataURI 生成
type ysmTexItem struct {
	name string
	raw  []byte
	mime string
}

// orderTexItems 统一纹理序入口：接收收集项与（可能不可解的）ysm.json，
// 返回排序后的 (纹理名列表, dataURI 列表)，两者同序。
// 声明序「能解析出非空列表」才走声明分支（声明序 + default_texture 置首）；
// 其余（无 ysm.json / 不可解析 / 空声明）一律尺寸降序——与前端 buildOrderedTexKeys
// （ysmTexOrder && ysmTexOrder.length 才走声明分支）口径对称。
func orderTexItems(items []ysmTexItem, ysmJSON []byte) ([]string, []string) {
	names := make([]string, len(items))
	datas := make([]string, len(items))
	for i, it := range items {
		names[i] = it.name
		datas[i] = "data:" + it.mime + ";base64," + base64.StdEncoding.EncodeToString(it.raw)
	}
	if order, _ := ysmTextureOrder(ysmJSON); len(order) > 0 {
		on, od := orderTexByYSM(names, datas, ysmJSON)
		// 声明序与实提取纹理名全部不匹配时返回空列表，调用方 datas[0] 会 panic
		if len(on) > 0 {
			return on, od
		}
	}
	return orderTexBySize(names, datas, items)
}

// ysmTextureOrder 解析 ysm.json 的 files.player.texture 声明序与 properties.default_texture。
// 返回 (声明序纹理文件名列表[去扩展名小写], default_texture 文件名[去扩展名小写])。
func ysmTextureOrder(ysmJSON []byte) ([]string, string) {
	if len(ysmJSON) == 0 {
		return nil, ""
	}
	var root struct {
		Files struct {
			Player struct {
				Texture json.RawMessage `json:"texture"`
			} `json:"player"`
		} `json:"files"`
		Properties struct {
			DefaultTexture *string `json:"default_texture"`
		} `json:"properties"`
	}
	if json.Unmarshal(ysmJSON, &root) != nil {
		return nil, ""
	}
	var defName string
	if root.Properties.DefaultTexture != nil {
		defName = strings.ToLower(filepath.Base(*root.Properties.DefaultTexture))
		if i := strings.LastIndexByte(defName, '.'); i >= 0 {
			defName = defName[:i]
		}
	}
	raw := strings.TrimSpace(string(root.Files.Player.Texture))
	if !strings.HasPrefix(raw, "[") {
		// 字符串/对象单形态声明：与前端 wasm.ts 包数组口径一致
		var single string
		if json.Unmarshal(root.Files.Player.Texture, &single) == nil && single != "" {
			return []string{single}, defName
		}
		// 对象单形态（{"uv":..,"path":..}）——原实现只 unmarshal string，
		// 对象形态失败后静默回退尺寸降序，与前端声明序分叉（2026-08-12 口径核对）
		var obj struct {
			Uv   string `json:"uv"`
			Path string `json:"path"`
		}
		if json.Unmarshal(root.Files.Player.Texture, &obj) == nil {
			tn := obj.Uv
			if tn == "" {
				tn = obj.Path
			}
			if tn != "" {
				return []string{tn}, defName
			}
		}
		return nil, defName
	}
	var arr []json.RawMessage
	if json.Unmarshal(root.Files.Player.Texture, &arr) != nil {
		return nil, defName
	}
	order := make([]string, 0, len(arr))
	for _, item := range arr {
		s := strings.TrimSpace(string(item))
		var tn string
		if strings.HasPrefix(s, "{") {
			var obj struct {
				Uv   string `json:"uv"`
				Path string `json:"path"`
			}
			if json.Unmarshal(item, &obj) == nil {
				tn = obj.Uv
				if tn == "" {
					tn = obj.Path
				}
			}
		} else {
			var sval string
			if json.Unmarshal(item, &sval) == nil {
				tn = sval
			}
		}
		if tn == "" {
			continue
		}
		tn = strings.ToLower(filepath.Base(tn))
		if i := strings.LastIndexByte(tn, '.'); i >= 0 {
			tn = tn[:i]
		}
		order = append(order, tn)
	}
	return order, defName
}

// orderTexByYSM 按 ysm.json 声明序重排纹理（names/data 同步），default_texture 置首；
// 未在声明序中的纹理（头像/预览图等）排除——与前端 buildOrderedTexKeys 声明分支一致
// （只保留显式声明的贴图）。无 ysm.json/声明序时保持原序（由 orderTexItems 先行判定）。
func orderTexByYSM(names, data []string, ysmJSON []byte) ([]string, []string) {
	order, defName := ysmTextureOrder(ysmJSON)
	if len(order) == 0 {
		return names, data
	}
	rank := make(map[string]int, len(order))
	for i, n := range order {
		rank[n] = i
	}
	norm := func(s string) string { return strings.ToLower(strings.TrimSuffix(s, filepath.Ext(s))) }
	seen := make(map[string]bool)
	sorted := make([]string, 0, len(names))
	sortedData := make([]string, 0, len(data))
	for i, n := range names {
		k := norm(n)
		if _, ok := rank[k]; ok && !seen[k] {
			seen[k] = true
			sorted = append(sorted, n)
			sortedData = append(sortedData, data[i])
		}
		// 未声明纹理（头像/预览图等）直接排除，不参与 texArr
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		return rank[norm(sorted[i])] < rank[norm(sorted[j])]
	})
	// default_texture 置首（与前端 wasm.ts defKey 逻辑一致）
	if defName != "" {
		for i, n := range sorted {
			if norm(n) == defName {
				if i > 0 {
					// 先取值再 append：inner append 复用底层数组会覆盖 sortedData[i]，必须先保存
					d := sortedData[i]
					sorted = append([]string{n}, append(sorted[:i], sorted[i+1:]...)...)
					sortedData = append([]string{d}, append(sortedData[:i], sortedData[i+1:]...)...)
				}
				break
			}
		}
	}
	return sorted, sortedData
}

// orderTexBySize 按图片像素面积降序排列纹理（names/datas 同步）。
// 用于「无 ysm.json 声明序」的场景（加密模型等 ysm.json 不可解）：
// 主纹理通常最大（如 512×512 主贴图 vs 64×64 装饰/箭头），保证 main 组件贴主纹理。
func orderTexBySize(names, datas []string, items []ysmTexItem) ([]string, []string) {
	if len(names) <= 1 {
		return names, datas
	}
	idx := make([]int, len(names))
	area := make([]int, len(names))
	for i := range names {
		idx[i] = i
		area[i] = imagePixelArea(items[i].raw)
	}
	// 降序（面积大的在前）；面积相同保持原序（稳定）
	sort.SliceStable(idx, func(a, b int) bool { return area[idx[a]] > area[idx[b]] })
	sortedNames := make([]string, len(names))
	sortedData := make([]string, len(datas))
	for i, j := range idx {
		sortedNames[i] = names[j]
		sortedData[i] = datas[j]
	}
	return sortedNames, sortedData
}

// imagePixelArea 解析 PNG/JPEG 图片像素面积；无法解析返回 0。
// 优先级：先 PNG 后 JPEG（两分支互斥，签名不同），均不匹配即 0。
func imagePixelArea(data []byte) int {
	if n, ok := pngPixelArea(data); ok {
		return n
	}
	if n, ok := jpegPixelArea(data); ok {
		return n
	}
	return 0
}

// pngPixelArea：PNG 签名 0x89 'P' 'N' 'G' + IHDR 块头（宽度/高度为 big-endian）。
// 非 PNG 或头不足 24 字节返回 ok=false（调用方回落 JPEG 分支）。
func pngPixelArea(data []byte) (int, bool) {
	if len(data) >= 24 && data[0] == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G' &&
		string(data[12:16]) == "IHDR" {
		w := binary.BigEndian.Uint32(data[16:20])
		h := binary.BigEndian.Uint32(data[20:24])
		return int(w * h), true
	}
	return 0, false
}

// jpegMarkerHasNoLength 无长度字段的 JPEG 标记：SOI(0xD8)/EOI(0xD9)/RSTn(0xD0-0xD7)。
// 这类标记后无 2 字节段长，扫描时只前进 2 字节。
func jpegMarkerHasNoLength(marker byte) bool {
	return marker == 0xD8 || marker == 0xD9 || (marker >= 0xD0 && marker <= 0xD7)
}

// jpegMarkerIsSOF SOF 帧头（0xC0-0xCF 内有尺寸字段的段），排除同区间无尺寸的
// DHT(0xC4)/JPG(0xC8)/DAC(0xCC)——误判会把段内数据当宽高读出错误面积。
func jpegMarkerIsSOF(marker byte) bool {
	return marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC
}

// jpegPixelArea：扫描标记段找 SOF（0xC0-0xCF，排除无尺寸的 DHT/DAC/RST 等）。
// 未找到 SOF / 数据被截断返回 ok=false。
func jpegPixelArea(data []byte) (int, bool) {
	if len(data) >= 4 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		i := 2
		for i+9 <= len(data) {
			if data[i] != 0xFF {
				i++
				continue
			}
			marker := data[i+1]
			if jpegMarkerHasNoLength(marker) {
				i += 2
				continue
			}
			if i+3 >= len(data) {
				break
			}
			segLen := int(binary.BigEndian.Uint16(data[i+2 : i+4]))
			if jpegMarkerIsSOF(marker) {
				if i+9 <= len(data) {
					h := int(binary.BigEndian.Uint16(data[i+5 : i+7]))
					w := int(binary.BigEndian.Uint16(data[i+7 : i+9]))
					return w * h, true
				}
			}
			i += 2 + segLen
		}
	}
	return 0, false
}
