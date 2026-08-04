// ===== go/geometry 单测（零覆盖包补测）=====
// ParseBedrockGeometry：标准 minecraft:geometry JSON 解析
// （format/description/bones/cubes/UV 数组与对象双形态/rotation/防炸弹上限）
package geometry

import (
	"strings"
	"testing"
)

const validGeom = `{
  "format_version": "1.16.0",
  "minecraft:geometry": [
    {
      "description": { "identifier": "test", "texture_width": 64, "texture_height": 32 },
      "bones": [
        {
          "name": "head", "parent": "body", "pivot": [0, 0, 0], "rotation": [0, 10, 0],
          "cubes": [
            { "origin": [0, 0, 0], "size": [8, 8, 8], "uv": [0, 0], "texture": 0 },
            {
              "origin": [0, 8, 0], "size": [4, 4, 4],
              "uv": {"north": {"uv": [0, 0], "texture_size": [16, 16]}},
              "rotation": [0, 0, 90], "texture": 1
            }
          ]
        },
        { "name": "arm", "cubes": [] }
      ]
    }
  ]
}`

func TestParseBedrockGeometry_Valid(t *testing.T) {
	m := ParseBedrockGeometry([]byte(validGeom))
	if m == nil {
		t.Fatal("期望非 nil")
	}
	if m.Format != "1.16.0" {
		t.Errorf("Format = %q, 期望 1.16.0", m.Format)
	}
	if m.TexWidth != 64 || m.TexHeight != 32 {
		t.Errorf("TexWidth/TexHeight = %d/%d, 期望 64/32", m.TexWidth, m.TexHeight)
	}
	if m.BoneCount != 2 || m.CubeCount != 2 {
		t.Errorf("BoneCount/CubeCount = %d/%d, 期望 2/2", m.BoneCount, m.CubeCount)
	}

	head := m.Bones[0]
	if head.Name != "head" || head.Parent != "body" {
		t.Errorf("head.Name/Parent = %q/%q", head.Name, head.Parent)
	}
	if head.Rotation != [3]float64{0, 10, 0} {
		t.Errorf("head.Rotation = %v", head.Rotation)
	}
	// cube UV 数组形态 → UV 解析、FaceUV 空
	if head.Cubes[0].UV != [2]float64{0, 0} {
		t.Errorf("cubes[0].UV = %v", head.Cubes[0].UV)
	}
	if head.Cubes[0].FaceUV != "" {
		t.Errorf("cubes[0].FaceUV 应为空（数组形态）, got %q", head.Cubes[0].FaceUV)
	}
	// cube UV 对象形态 → FaceUV 保留原文
	if !strings.Contains(head.Cubes[1].FaceUV, "north") {
		t.Errorf("cubes[1].FaceUV 应保留对象原文, got %q", head.Cubes[1].FaceUV)
	}
	// cube rotation
	if head.Cubes[1].Rotation != [3]float64{0, 0, 90} {
		t.Errorf("cubes[1].Rotation = %v", head.Cubes[1].Rotation)
	}
	// 空 cubes 的骨（arm）也被登记
	if m.Bones[1].Name != "arm" || len(m.Bones[1].Cubes) != 0 {
		t.Errorf("arm bone 解析异常: %+v", m.Bones[1])
	}
}

func TestParseBedrockGeometry_EmptyGeometry(t *testing.T) {
	m := ParseBedrockGeometry([]byte(`{"format_version":"1.0","minecraft:geometry":[]}`))
	if m != nil {
		t.Fatalf("空 geometry 应返回 nil, got %+v", m)
	}
}

func TestParseBedrockGeometry_InvalidJSON(t *testing.T) {
	if m := ParseBedrockGeometry([]byte("{not json")); m != nil {
		t.Fatalf("非法 JSON 应返回 nil, got %+v", m)
	}
}

func TestParseBedrockGeometry_TooLarge(t *testing.T) {
	big := make([]byte, maxParseSize+1) // 100MB+1：防炸弹上限
	if m := ParseBedrockGeometry(big); m != nil {
		t.Fatalf("超过 100MB 上限应返回 nil")
	}
}
