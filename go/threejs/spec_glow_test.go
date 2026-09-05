package threejs

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

// TestIsGlowBone 验证 ysmGlow 前缀检测（大小写不敏感）。
func TestIsGlowBone(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"ysmGlowFrontHeadlights", true},
		{"ysmGlowRearLight", true},
		{"ysmglowlowercase", true},       // 大小写不敏感
		{"YSMGLOWUPPERCASE", true},       // 大小写不敏感
		{"ysmGlow", true},                // 裸前缀
		{"Head", false},                  // 无前缀
		{"Arm", false},                   // 无前缀
		{"Body", false},                  // 无前缀
		{"glowysm", false},               // 前缀在后
		{"", false},                      // 空名
		{"ysmGlowingButNotPrefix", true}, // startsWith 语义：以 ysmGlow 开头即为发光骨骼
	}
	for _, c := range cases {
		got := isGlowBone(c.name)
		if got != c.want {
			t.Errorf("isGlowBone(%q) = %v, want %v", c.name, got, c.want)
		}
	}
}

// TestBuildGlowBone 验证 Build 输出的 BoneData.Glow 字段正确标记发光骨骼。
func TestBuildGlowBone(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{
			{Name: "Head", Pivot: [3]float64{0, 24, 0}},
			{Name: "ysmGlowFrontHeadlights", Pivot: [3]float64{0, 24, 0}, Parent: "Head"},
			{Name: "ysmGlowRearLight", Pivot: [3]float64{0, 24, 0}, Parent: "Head"},
			{Name: "Arm", Pivot: [3]float64{0, 24, 0}, Parent: "Head"},
		},
	}

	spec, err := Build(model)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	// 解析 spec JSON 验证 Glow 字段
	var parsed struct {
		Models []struct {
			Bones []struct {
				Name string `json:"name"`
				Glow bool   `json:"glow"`
			} `json:"bones"`
		} `json:"models"`
	}
	if err := json.Unmarshal([]byte(spec), &parsed); err != nil {
		t.Fatalf("解析 spec JSON: %v", err)
	}

	if len(parsed.Models) == 0 || len(parsed.Models[0].Bones) != 4 {
		t.Fatalf("期望 4 个骨骼，得到 %+v", parsed)
	}

	glowMap := map[string]bool{}
	for _, b := range parsed.Models[0].Bones {
		glowMap[b.Name] = b.Glow
	}

	if !glowMap["ysmGlowFrontHeadlights"] {
		t.Error("ysmGlowFrontHeadlights 应标记 Glow=true")
	}
	if !glowMap["ysmGlowRearLight"] {
		t.Error("ysmGlowRearLight 应标记 Glow=true")
	}
	if glowMap["Head"] {
		t.Error("Head 不应标记 Glow")
	}
	if glowMap["Arm"] {
		t.Error("Arm 不应标记 Glow")
	}
}

// TestBuildGlowBoneCaseInsensitive 验证大小写不敏感的 ysmGlow 检测。
func TestBuildGlowBoneCaseInsensitive(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{
			{Name: "ysmglowheadlight", Pivot: [3]float64{0, 24, 0}},
		},
	}

	spec, err := Build(model)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	var parsed struct {
		Models []struct {
			Bones []struct {
				Name string `json:"name"`
				Glow bool   `json:"glow"`
			} `json:"bones"`
		} `json:"models"`
	}
	if err := json.Unmarshal([]byte(spec), &parsed); err != nil {
		t.Fatalf("解析 spec JSON: %v", err)
	}

	if len(parsed.Models) == 0 || len(parsed.Models[0].Bones) != 1 {
		t.Fatalf("期望 1 个骨骼，得到 %+v", parsed)
	}
	if !parsed.Models[0].Bones[0].Glow {
		t.Error("ysmglowheadlight (小写) 应标记 Glow=true")
	}
}

// TestGlowMeshUVMatchesGeometry 用 foxcar 真实 fixture 锁定发光部件的 UV 映射
// 不变量：每个发光 mesh 的每个面，UV 四边形的像素尺寸 {du,dv} 应与该面非零
// 几何跨度集合相等（允许轴对调，不允许旋转/换位/拉伸）。容差 0.5px 吸收
// 纹理尺寸取整误差。原为 zz_debug_foxcar_test.go 的人工打印诊断，2026-09-05 扶正。
func TestGlowMeshUVMatchesGeometry(t *testing.T) {
	p := filepath.Join("..", "..", "tests", "fixtures", "ysm", "01_taisho_maid", "models", "foxcar.json")
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	m := geometry.ParseBedrockGeometry(data)
	if m == nil {
		t.Fatal("parse nil")
	}
	mg, err := buildModelGroup(*m, "main", 0)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	tw, th := mg.TextureWidth, mg.TextureHeight

	glowMeshes := 0
	for _, mesh := range mg.MeshGroups {
		if !isGlowBone(mesh.BoneID) {
			continue
		}
		glowMeshes++
		for fi := 0; fi < 6; fi++ {
			// 面几何尺寸：4 顶点 position 的各轴跨度（每面 12 个 position 值）
			base := fi * 12
			mn := [3]float64{1e9, 1e9, 1e9}
			mx := [3]float64{-1e9, -1e9, -1e9}
			for v := 0; v < 4; v++ {
				for a := 0; a < 3; a++ {
					x := mesh.Positions[base+v*3+a]
					if x < mn[a] {
						mn[a] = x
					}
					if x > mx[a] {
						mx[a] = x
					}
				}
			}
			var geom []float64
			for a := 0; a < 3; a++ {
				if s := mx[a] - mn[a]; s > 0.5 {
					geom = append(geom, s)
				}
			}

			// 面内 UV 像素尺寸（每面 8 个 uv 值，quad 为 (u0,v0)(u1,v0)(u0,v1)(u1,v1)）
			uvb := fi * 8
			u := [4]float64{mesh.Uvs[uvb], mesh.Uvs[uvb+2], mesh.Uvs[uvb+4], mesh.Uvs[uvb+6]}
			v := [4]float64{mesh.Uvs[uvb+1], mesh.Uvs[uvb+3], mesh.Uvs[uvb+5], mesh.Uvs[uvb+7]}
			uMin, uMax := u[0], u[0]
			vMin, vMax := v[0], v[0]
			for _, x := range u {
				if x < uMin {
					uMin = x
				}
				if x > uMax {
					uMax = x
				}
			}
			for _, x := range v {
				if x < vMin {
					vMin = x
				}
				if x > vMax {
					vMax = x
				}
			}
			var uv []float64
			if du := (uMax - uMin) * tw; du > 0.5 {
				uv = append(uv, du)
			}
			if dv := (vMax - vMin) * th; dv > 0.5 {
				uv = append(uv, dv)
			}

			sort.Float64s(geom)
			sort.Float64s(uv)
			if len(geom) != len(uv) {
				t.Errorf("mesh %s face%d: 几何非零跨度 %v 与 UV 像素尺寸 %v 数量不符", mesh.BoneID, fi+1, geom, uv)
				continue
			}
			for i := range geom {
				if math.Abs(geom[i]-uv[i]) > 0.5 {
					t.Errorf("mesh %s face%d: UV 像素尺寸 %v 与几何跨度 %v 不一致（疑似 UV 旋转/换位/拉伸）", mesh.BoneID, fi+1, uv, geom)
					break
				}
			}
		}
	}
	if glowMeshes == 0 {
		t.Fatal("fixture 中未找到 ysmGlow 发光 mesh，测试失去锁定意义")
	}
}
