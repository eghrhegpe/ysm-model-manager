// ===== Bedrock Geometry JSON 解析 =====
// 从 app_model.go 拆分：解析标准 minecraft:geometry JSON 格式
// 兼容旧版 geometry.* 格式（format_version ≤ 1.10.0，如车万女仆 mod）
package geometry

import (
	"encoding/json"
	"log"
	"sort"
	"strings"

	"ysm-model-manager/go/types"
)

// maxParseSize ParseBedrockGeometry 接受的最大输入大小
const maxParseSize = 100 << 20 // 100MB

// pivotOf 解引用 cube 的 pivot 指针；JSON 缺席（nil）→ 零值 [0,0,0]
func pivotOf(p *[3]float64) [3]float64 {
	if p == nil {
		return [3]float64{}
	}
	return *p
}

// ===== 共享 JSON 中间类型（新旧格式骨骼/方块结构同构）=====

type cubeJSON struct {
	Origin   [3]float64      `json:"origin"`
	Size     [3]float64      `json:"size"`
	Pivot    *[3]float64     `json:"pivot,omitempty"`
	UV       json.RawMessage `json:"uv,omitempty"`
	Rotation json.RawMessage `json:"rotation,omitempty"`
	Texture  int             `json:"texture"`
	Inflate  float64         `json:"inflate,omitempty"`
	Mirror   bool            `json:"mirror,omitempty"`
}

type boneJSON struct {
	Name     string          `json:"name"`
	Parent   string          `json:"parent,omitempty"`
	Pivot    [3]float64      `json:"pivot"`
	Rotation json.RawMessage `json:"rotation,omitempty"`
	Cubes    []cubeJSON      `json:"cubes"`
}

// clampTexSize 纹理尺寸守卫（防 1e100 溢出为负 → UV 归一化垃圾值）：
// 合法范围 [0, 65536]，<0 或 >65536 归 0 —— 0 是「缺失/无效」哨兵值，
// 与合法 0 不可区分属有意取舍（下游 0 → 走默认纹理尺寸），超界不做真钳制。
func clampTexSize(v float64) int {
	i := int(v)
	if i < 0 || i > 65536 {
		return 0
	}
	return i
}

// isGuiBone 检测骨骼是否为 GUI 装饰骨骼（无几何体 + 名称匹配已知 GUI 模式）。
// wine_fox 等模型包含 GuiRoot/Backgrounds/gui/curtain 等仅用于屏幕空间覆盖的骨骼，
// 在 3D 预览中会显示为浮动几何或干扰元素。匹配策略：名称前缀/精确匹配（不区分大小写）。
func isGuiBone(name string, cubeCount int) bool {
	// 有几何体的骨骼不是 GUI 骨骼
	if cubeCount > 0 {
		return false
	}
	lower := strings.ToLower(name)
	// 精确匹配
	switch lower {
	case "gui", "curtain", "white_curtain", "guiroot", "backgrounds", "background1":
		return true
	}
	// 前缀匹配
	if strings.HasPrefix(lower, "gui") || strings.HasPrefix(lower, "background") {
		return true
	}
	return false
}

// buildModel 从骨骼数组 + 纹理尺寸构建 BedrockModel（新旧格式共享）
func buildModel(formatVersion string, texW, texH int, bones []boneJSON) *types.BedrockModel {
	model := &types.BedrockModel{
		Format:    formatVersion,
		TexWidth:  texW,
		TexHeight: texH,
	}
	var cubeTotal int
	var skippedGUI int
	for _, b := range bones {
		cubes := make([]types.Cube2D, 0, len(b.Cubes))
		for _, c := range b.Cubes {
			var uv [2]float64
			var faceUV string
			var rot [3]float64
			if len(c.UV) > 0 {
				uvStr := string(c.UV)
				if len(uvStr) > 0 && uvStr[0] == '{' {
					faceUV = uvStr
				} else {
					if err := json.Unmarshal(c.UV, &uv); err != nil {
						log.Printf("[geometry] 解析 cube UV 失败: %v", err)
					}
				}
			}
			if len(c.Rotation) > 0 {
				if err := json.Unmarshal(c.Rotation, &rot); err != nil {
					log.Printf("[geometry] 解析 cube rotation 失败: %v", err)
				}
			}
			cubes = append(cubes, types.Cube2D{
				Origin: c.Origin, Size: c.Size,
				Pivot:    pivotOf(c.Pivot),
				PivotSet: c.Pivot != nil,
				UV:       uv, FaceUV: faceUV, Rotation: rot,
				TexSlot: c.Texture,
				Inflate: c.Inflate, Mirror: c.Mirror,
			})
		}
		// 过滤 GUI 装饰骨骼：无几何体 + 名称匹配已知 GUI 模式
		if isGuiBone(b.Name, len(cubes)) {
			skippedGUI++
			continue
		}
		var boneRot [3]float64
		if len(b.Rotation) > 0 {
			if err := json.Unmarshal(b.Rotation, &boneRot); err != nil {
				log.Printf("[geometry] 解析 bone rotation 失败: %v", err)
			}
		}
		model.Bones = append(model.Bones, types.Bone2D{
			Name: b.Name, Parent: b.Parent, Pivot: b.Pivot,
			Rotation: boneRot, Cubes: cubes,
		})
		cubeTotal += len(cubes)
	}
	// GUI 装饰骨骼已被过滤（continue 跳过），BoneCount 必须以过滤后的
	// model.Bones 为准，否则破坏 BoneCount == len(Bones) 不变量
	// （concurrent.go 校验会误报「骨骼数不一致」）。
	model.BoneCount = len(model.Bones)
	model.CubeCount = cubeTotal
	if skippedGUI > 0 {
		log.Printf("[geometry] 过滤 %d 个 GUI 装饰骨骼", skippedGUI)
	}
	return model
}

// parseNewFormat 解析新版 minecraft:geometry 数组格式（format_version ≥ 1.12.0）
func parseNewFormat(data []byte) *types.BedrockModel {
	var raw struct {
		FormatVersion string `json:"format_version"`
		Geometry      []struct {
			Description struct {
				Identifier    string  `json:"identifier"`
				TextureWidth  float64 `json:"texture_width"`
				TextureHeight float64 `json:"texture_height"`
			} `json:"description"`
			Bones []boneJSON `json:"bones"`
		} `json:"minecraft:geometry"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}
	if len(raw.Geometry) == 0 {
		return nil
	}
	g := raw.Geometry[0]
	return buildModel(raw.FormatVersion,
		clampTexSize(g.Description.TextureWidth),
		clampTexSize(g.Description.TextureHeight),
		g.Bones)
}

// parseOldFormat 解析旧版 geometry.* 格式（format_version ≤ 1.10.0）
// 顶层键形如 "geometry.model"、"geometry.hakurei_reimu" 等，值为单对象。
// 纹理尺寸字段为 texturewidth/textureheight（无下划线，直接在对象顶层）。
func parseOldFormat(data []byte) *types.BedrockModel {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(data, &top); err != nil {
		return nil
	}
	formatVersion, _ := unquoteString(top["format_version"])

	// 确定性选取 geometry.* 条目：Go map 迭代序随机，直接 for-range 首个命中会让
	// 同一文件（多 geometry.* 键）在不同运行/进程选到不同模型（审核 P3）
	var keys []string
	for key := range top {
		if strings.HasPrefix(key, "geometry.") {
			keys = append(keys, key)
		}
	}
	if len(keys) == 0 {
		return nil
	}
	sort.Strings(keys)
	// 规范键 geometry.model（Blockbench 导出默认）优先，否则按字典序取最小
	for i, k := range keys {
		if k == "geometry.model" && i > 0 {
			keys[0], keys[i] = keys[i], keys[0]
			break
		}
	}
	for _, key := range keys {
		var oldGeom struct {
			TextureWidth  float64    `json:"texturewidth"`
			TextureHeight float64    `json:"textureheight"`
			Bones         []boneJSON `json:"bones"`
		}
		if err := json.Unmarshal(top[key], &oldGeom); err != nil {
			log.Printf("[geometry] 旧版格式 %s 解析失败: %v", key, err)
			continue
		}
		if len(oldGeom.Bones) == 0 {
			continue
		}
		return buildModel(formatVersion,
			clampTexSize(oldGeom.TextureWidth),
			clampTexSize(oldGeom.TextureHeight),
			oldGeom.Bones)
	}
	return nil
}

// unquoteString 从 json.RawMessage 提取字符串值（去引号）
func unquoteString(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}

// ParseBedrockGeometry 解析 Bedrock geometry JSON。
// 支持两种格式：
//   - 新版：minecraft:geometry 数组（format_version ≥ 1.12.0）
//   - 旧版：geometry.* 单对象（format_version ≤ 1.10.0，如车万女仆 mod）
//
// 注意：data 大小不应超过 maxParseSize（100MB），调用方应自行限制
func ParseBedrockGeometry(data []byte) *types.BedrockModel {
	if len(data) > maxParseSize {
		log.Printf("[geometry] ParseBedrockGeometry 输入过大: %d bytes", len(data))
		return nil
	}
	// 优先尝试新版格式（多数模型使用）
	if m := parseNewFormat(data); m != nil {
		return m
	}
	// 回退旧版格式
	return parseOldFormat(data)
}
