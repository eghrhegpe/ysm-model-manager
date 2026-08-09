package threejs

import (
	"encoding/json"
	"testing"

	"ysm-model-manager/go/types"
)

// TestBuildMulti_TwoComponents 验证多组件 spec：models 数组含两个组件，
// 各自独立 bones/meshGroups，textureId 按 texIdxBase 区分。
func TestBuildMulti_TwoComponents(t *testing.T) {
	compA := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Texture:   "data:image/png;base64,x",
		Bones: []types.Bone2D{{
			Name:  "rootA",
			Pivot: [3]float64{0, 0, 0},
			Cubes: []types.Cube2D{{Origin: [3]float64{0, 0, 0}, Size: [3]float64{8, 8, 8}, UV: [2]float64{0, 0}}},
		}},
	}
	compB := types.BedrockModel{
		TexWidth:  32,
		TexHeight: 32,
		Texture:   "data:image/png;base64,y",
		Bones: []types.Bone2D{{
			Name:  "rootB",
			Pivot: [3]float64{0, 0, 0},
			Cubes: []types.Cube2D{{Origin: [3]float64{0, 0, 0}, Size: [3]float64{4, 4, 4}, UV: [2]float64{0, 0}}},
		}},
	}

	out, err := BuildMulti([]types.BedrockModel{compA, compB}, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	var spec Model3DSpec
	if err := json.Unmarshal([]byte(out), &spec); err != nil {
		t.Fatal(err)
	}
	if len(spec.Models) != 2 {
		t.Fatalf("models 数量 = %d, want 2", len(spec.Models))
	}
	if spec.Models[0].ID != "comp_0" || spec.Models[1].ID != "comp_1" {
		t.Errorf("组件 ID 错误: %q %q", spec.Models[0].ID, spec.Models[1].ID)
	}
	if len(spec.Models[0].Bones) != 1 || len(spec.Models[1].Bones) != 1 {
		t.Errorf("组件 bones 数量错误: %d %d", len(spec.Models[0].Bones), len(spec.Models[1].Bones))
	}
	if len(spec.Models[0].MeshGroups) != 1 || len(spec.Models[1].MeshGroups) != 1 {
		t.Errorf("组件 meshGroups 数量错误: %d %d", len(spec.Models[0].MeshGroups), len(spec.Models[1].MeshGroups))
	}
	if spec.Models[0].MeshGroups[0].BoneID != "rootA" || spec.Models[1].MeshGroups[0].BoneID != "rootB" {
		t.Errorf("mesh 归属错误: %q %q", spec.Models[0].MeshGroups[0].BoneID, spec.Models[1].MeshGroups[0].BoneID)
	}
	if spec.Models[0].TextureID == nil || *spec.Models[0].TextureID != "tex_0" {
		t.Errorf("comp_0 textureId = %v, want tex_0", spec.Models[0].TextureID)
	}
	if spec.Models[1].TextureID == nil || *spec.Models[1].TextureID != "tex_1" {
		t.Errorf("comp_1 textureId = %v, want tex_1", spec.Models[1].TextureID)
	}
	// R4 契约：每个 meshGroup 必输出 texIdx（无 omitempty，缺失即契约破坏）
	for mi, m := range spec.Models {
		for _, mg := range m.MeshGroups {
			if mg.TexIdx < 0 {
				t.Errorf("组件 %d mesh %s texIdx 缺失（契约破坏）", mi, mg.BoneID)
			}
		}
	}
}

// TestBuildMulti_Empty 验证空组件列表返回空 spec。
func TestBuildMulti_Empty(t *testing.T) {
	out, err := BuildMulti(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out != "{}" {
		t.Errorf("空输入应返回 {}, got %q", out)
	}
}
