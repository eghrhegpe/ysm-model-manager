// ===== Bedrock Geometry JSON 解析 =====
// 从 app_model.go 拆分：解析标准 minecraft:geometry JSON 格式
package geometry

import (
	"encoding/json"

	"ysm-model-manager/go/types"
)

// ParseBedrockGeometry 解析标准 Bedrock geometry JSON（minecraft:geometry 格式）
func ParseBedrockGeometry(data []byte) *types.BedrockModel {
	var raw struct {
		FormatVersion string `json:"format_version"`
		Geometry      []struct {
			Description struct {
				Identifier    string  `json:"identifier"`
				TextureWidth  float64 `json:"texture_width"`
				TextureHeight float64 `json:"texture_height"`
			} `json:"description"`
			Bones []struct {
				Name     string          `json:"name"`
				Parent   string          `json:"parent,omitempty"`
				Pivot    [3]float64      `json:"pivot"`
				Rotation json.RawMessage `json:"rotation,omitempty"`
				Cubes    []struct {
					Origin   [3]float64      `json:"origin"`
					Size     [3]float64      `json:"size"`
					Pivot    [3]float64      `json:"pivot,omitempty"`
					UV       json.RawMessage `json:"uv,omitempty"`
					Rotation json.RawMessage `json:"rotation,omitempty"`
				} `json:"cubes"`
			} `json:"bones"`
		} `json:"minecraft:geometry"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}
	if len(raw.Geometry) == 0 {
		return nil
	}
	g := raw.Geometry[0]
	model := &types.BedrockModel{
		Format:    raw.FormatVersion,
		TexWidth:  int(g.Description.TextureWidth),
		TexHeight: int(g.Description.TextureHeight),
	}
	var cubeTotal int
	for _, b := range g.Bones {
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
					json.Unmarshal(c.UV, &uv)
				}
			}
			if len(c.Rotation) > 0 {
				json.Unmarshal(c.Rotation, &rot)
			}
			cubes = append(cubes, types.Cube2D{
				Origin: c.Origin, Size: c.Size, Pivot: c.Pivot,
				UV: uv, FaceUV: faceUV, Rotation: rot,
			})
		}
		var boneRot [3]float64
		if len(b.Rotation) > 0 {
			json.Unmarshal(b.Rotation, &boneRot)
		}
		model.Bones = append(model.Bones, types.Bone2D{
			Name: b.Name, Parent: b.Parent, Pivot: b.Pivot,
			Rotation: boneRot, Cubes: cubes,
		})
		cubeTotal += len(cubes)
	}
	model.BoneCount = len(g.Bones)
	model.CubeCount = cubeTotal
	return model
}
