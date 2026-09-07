// ===== go/geometry 单测（零覆盖包补测）=====
// ParseBedrockGeometry：标准 minecraft:geometry JSON 解析
// （format/description/bones/cubes/UV 数组与对象双形态/rotation/防炸弹上限）
// 断言统一走 testutil（ADR-202 刀5）；「应返回 nil」家族表驱动化收敛。
package geometry

import (
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
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
	testutil.NotNil(t, m, "期望非 nil")
	testutil.Equal(t, m.Format, "1.16.0")
	testutil.Equal(t, m.TexWidth, 64)
	testutil.Equal(t, m.TexHeight, 32)
	testutil.Equal(t, m.BoneCount, 2)
	testutil.Equal(t, m.CubeCount, 2)

	head := m.Bones[0]
	testutil.Equal(t, head.Name, "head")
	testutil.Equal(t, head.Parent, "body")
	testutil.Equal(t, head.Rotation, [3]float64{0, 10, 0})
	// cube UV 数组形态 → UV 解析、FaceUV 空
	testutil.Equal(t, head.Cubes[0].UV, [2]float64{0, 0})
	testutil.Equal(t, head.Cubes[0].FaceUV, "", "cubes[0].FaceUV 应为空（数组形态）")
	// cube UV 对象形态 → FaceUV 保留原文
	testutil.Equal(t, strings.Contains(head.Cubes[1].FaceUV, "north"), true, "cubes[1].FaceUV 应保留对象原文")
	// cube rotation
	testutil.Equal(t, head.Cubes[1].Rotation, [3]float64{0, 0, 90})
	// 空 cubes 的骨（arm）也被登记
	testutil.Equal(t, m.Bones[1].Name, "arm")
	testutil.Equal(t, len(m.Bones[1].Cubes), 0, "arm bone 应无 cube")
}

// TestParseBedrockGeometry_ReturnsNil 表驱动：非法/空/超限/描述符输入 → nil（防炸弹不 panic）。
func TestParseBedrockGeometry_ReturnsNil(t *testing.T) {
	cases := []struct {
		name string
		in   []byte
	}{
		{"空 geometry 数组", []byte(`{"format_version":"1.0","minecraft:geometry":[]}`)},
		{"非法 JSON", []byte("{not json")},
		{"超 100MB 上限", make([]byte, maxParseSize+1)},
		{"描述符文件（无 geometry 键）", []byte(`{"pack_name":"test","author":["a"],"model_list":[{"model_id":"test:foo"}]}`)},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			testutil.Nil(t, ParseBedrockGeometry(c.in), "应返回 nil")
		})
	}
}

// ====== ParseBedrockGeometry 边界 / 畸形输入补测 ======

func TestParseBedrockGeometry_TexSizeClamp(t *testing.T) {
	// texture_width/height 无有限性校验（ADR-011 修复）：溢出/负数/超上限钳到 0，
	// 合法上限 65536 保留（防止 1e100 → int 溢出为负 → UV 归一化除垃圾值）
	cases := []struct {
		name       string
		texW, texH string
		wantW      int
		wantH      int
	}{
		{"巨大数字溢出", "1e100", "64", 0, 64},
		{"负数", "-5", "32", 0, 32},
		{"超上限 1", "65537", "32", 0, 32},
		{"上限边界", "65536", "65536", 65536, 65536},
		{"宽合法高溢出", "64", "1e100", 64, 0},
		{"宽合法高负数", "64", "-3", 64, 0},
		{"宽合法高超上限", "64", "70000", 64, 0},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			desc := `{"identifier":"t","texture_width":` + c.texW + `,"texture_height":` + c.texH + `}`
			geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":` + desc + `,"bones":[]}]}`
			m := ParseBedrockGeometry([]byte(geom))
			testutil.NotNil(t, m, "应解析成功")
			testutil.Equal(t, m.TexWidth, c.wantW, "TexWidth 钳制到 [0,65536]")
			testutil.Equal(t, m.TexHeight, c.wantH, "TexHeight 钳制到 [0,65536]")
		})
	}
	// 缺失（description 无 texture 字段）→ 零值
	t.Run("缺失 texture 字段", func(t *testing.T) {
		m := ParseBedrockGeometry([]byte(`{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"},"bones":[]}]}`))
		testutil.NotNil(t, m, "应解析成功")
		testutil.Equal(t, m.TexWidth, 0)
		testutil.Equal(t, m.TexHeight, 0)
	})
}

func TestParseBedrockGeometry_InvalidCubeUV(t *testing.T) {
	// cube uv 无法解析（非数组形态）→ 记日志、UV 归零，cube 仍保留
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"},"bones":[{"name":"b","cubes":[{"origin":[0,0,0],"size":[1,1,1],"uv":"oops"}]}]}]}`
	m := ParseBedrockGeometry([]byte(geom))
	testutil.NotNil(t, m, "应解析成功（UV 失败不丢弃 cube）")
	testutil.Equal(t, m.CubeCount, 1)
	testutil.Equal(t, len(m.Bones[0].Cubes), 1)
	testutil.Equal(t, m.Bones[0].Cubes[0].UV, [2]float64{}, "UV 应为零值")
}

func TestParseBedrockGeometry_InvalidRotations(t *testing.T) {
	// cube/bone rotation 无法解析 → 记日志、归零，不 panic
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"},"bones":[{"name":"b","rotation":"bad","cubes":[{"origin":[0,0,0],"size":[1,1,1],"rotation":"oops"}]}]}]}`
	m := ParseBedrockGeometry([]byte(geom))
	testutil.NotNil(t, m, "应解析成功（rotation 失败不丢弃）")
	testutil.Equal(t, m.Bones[0].Rotation, [3]float64{}, "bone Rotation 应为零值")
	testutil.Equal(t, m.Bones[0].Cubes[0].Rotation, [3]float64{}, "cube Rotation 应为零值")
}

func TestParseBedrockGeometry_PivotAbsentVsExplicit(t *testing.T) {
	// pivot 缺席（nil）→ PivotSet=false 且 Pivot 零值；显式 [0,0,0] → PivotSet=true
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"},"bones":[{"name":"b","cubes":[{"origin":[0,0,0],"size":[1,1,1],"pivot":[0,0,0]},{"origin":[1,1,1],"size":[1,1,1]}]}]}]}`
	m := ParseBedrockGeometry([]byte(geom))
	testutil.NotNil(t, m, "应解析成功")
	c0, c1 := m.Bones[0].Cubes[0], m.Bones[0].Cubes[1]
	testutil.Equal(t, c0.PivotSet, true, "显式 [0,0,0] pivot 应 PivotSet=true")
	testutil.Equal(t, c0.Pivot, [3]float64{})
	testutil.Equal(t, c1.PivotSet, false, "缺席 pivot 应 PivotSet=false")
	testutil.Equal(t, c1.Pivot, [3]float64{}, "缺席 pivot 应为零值")
}

func TestParseBedrockGeometry_CubeAttrs(t *testing.T) {
	// texture/inflate/mirror 字段透传
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"},"bones":[{"name":"b","cubes":[{"origin":[0,0,0],"size":[1,1,1],"texture":2,"inflate":0.5,"mirror":true}]}]}]}`
	m := ParseBedrockGeometry([]byte(geom))
	testutil.NotNil(t, m, "应解析成功")
	c := m.Bones[0].Cubes[0]
	testutil.Equal(t, c.TexSlot, 2)
	testutil.Equal(t, c.Inflate, 0.5)
	testutil.Equal(t, c.Mirror, true)
}

func TestParseBedrockGeometry_NoBones(t *testing.T) {
	// bones 缺失 → 模型非 nil、BoneCount=0
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"}}]}`
	m := ParseBedrockGeometry([]byte(geom))
	testutil.NotNil(t, m, "无 bones 也应返回非 nil 模型")
	testutil.Equal(t, m.BoneCount, 0)
	testutil.Equal(t, m.CubeCount, 0)
}

func TestParseBedrockGeometry_MultipleGeometryFirstOnly(t *testing.T) {
	// 多个 minecraft:geometry 条目 → 仅首个生效（既有一致口径）
	geom := `{"format_version":"1.16.0","minecraft:geometry":[
		{"description":{"identifier":"first","texture_width":16,"texture_height":16},"bones":[{"name":"a","cubes":[]}]},
		{"description":{"identifier":"second","texture_width":128,"texture_height":128},"bones":[{"name":"b","cubes":[]}]}
	]}`
	m := ParseBedrockGeometry([]byte(geom))
	testutil.NotNil(t, m, "应解析成功")
	testutil.Equal(t, m.BoneCount, 1, "应取首个条目")
	testutil.Equal(t, m.Bones[0].Name, "a")
	testutil.Equal(t, m.TexWidth, 16, "TexWidth 应取首个条目")
}

func TestParseBedrockGeometry_NoDescription(t *testing.T) {
	// description 缺失 → TexWidth/Height 零值、骨骼仍解析
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"bones":[{"name":"b","cubes":[{"origin":[0,0,0],"size":[1,1,1]}]}]}]}`
	m := ParseBedrockGeometry([]byte(geom))
	testutil.NotNil(t, m, "无 description 也应解析成功")
	testutil.Equal(t, m.TexWidth, 0)
	testutil.Equal(t, m.TexHeight, 0)
	testutil.Equal(t, m.BoneCount, 1)
}

// ====== 旧版 geometry.* 格式（车万女仆等 mod 使用）======

const oldFormatGeom = `{
  "format_version": "1.10.0",
  "geometry.model": {
    "texturewidth": 128,
    "textureheight": 128,
    "visible_bounds_width": 3,
    "visible_bounds_height": 2,
    "visible_bounds_offset": [0, 0, 0],
    "bones": [
      {
        "name": "head", "parent": "body", "pivot": [0, 18, 0],
        "cubes": [
          {"origin": [-4, 18, -4], "size": [8, 8, 8], "uv": [0, 12]}
        ]
      },
      {
        "name": "hair", "parent": "head", "pivot": [0, 18, 4],
        "rotation": [10, 0, 0],
        "cubes": [
          {"origin": [3, 8, 3], "size": [1, 10, 1], "uv": [32, 56]}
        ]
      }
    ]
  }
}`

func TestParseBedrockGeometry_OldFormat(t *testing.T) {
	m := ParseBedrockGeometry([]byte(oldFormatGeom))
	testutil.NotNil(t, m, "旧版格式应解析成功")
	testutil.Equal(t, m.Format, "1.10.0")
	testutil.Equal(t, m.TexWidth, 128)
	testutil.Equal(t, m.TexHeight, 128)
	testutil.Equal(t, m.BoneCount, 2)
	testutil.Equal(t, m.CubeCount, 2)
	head := m.Bones[0]
	testutil.Equal(t, head.Name, "head")
	testutil.Equal(t, head.Parent, "body")
	testutil.Equal(t, head.Pivot, [3]float64{0, 18, 0})
	hair := m.Bones[1]
	testutil.Equal(t, hair.Name, "hair")
	testutil.Equal(t, hair.Parent, "head")
	testutil.Equal(t, hair.Rotation, [3]float64{10, 0, 0})
}

func TestParseBedrockGeometry_OldFormatNamedKey(t *testing.T) {
	// geometry.<entity_name> 形式（非 geometry.model）
	geom := `{"format_version":"1.10.0","geometry.hakurei_reimu":{"texturewidth":64,"textureheight":64,"bones":[{"name":"body","cubes":[{"origin":[0,0,0],"size":[8,12,4],"uv":[0,0]}]}]}}`
	m := ParseBedrockGeometry([]byte(geom))
	testutil.NotNil(t, m, "旧版命名 geometry 键应解析成功")
	testutil.Equal(t, m.TexWidth, 64)
	testutil.Equal(t, m.TexHeight, 64)
	testutil.Equal(t, m.BoneCount, 1)
	testutil.Equal(t, m.Bones[0].Name, "body")
}

func TestParseBedrockGeometry_OldFormatTexClamp(t *testing.T) {
	// 旧版格式纹理尺寸溢出也应钳制
	geom := `{"format_version":"1.10.0","geometry.model":{"texturewidth":1e100,"textureheight":-5,"bones":[{"name":"b","cubes":[]}]}}`
	m := ParseBedrockGeometry([]byte(geom))
	testutil.NotNil(t, m, "旧版格式溢出应仍解析成功")
	testutil.Equal(t, m.TexWidth, 0, "TexWidth 应钳制")
	testutil.Equal(t, m.TexHeight, 0, "TexHeight 应钳制")
}

func TestParseBedrockGeometry_NewFormatPreferred(t *testing.T) {
	// 同时含 minecraft:geometry 和 geometry.* → 优先新版
	geom := `{
		"format_version": "1.16.0",
		"minecraft:geometry": [{"description":{"texture_width":32,"texture_height":32},"bones":[{"name":"new","cubes":[]}]}],
		"geometry.model": {"texturewidth":128,"textureheight":128,"bones":[{"name":"old","cubes":[]}]}
	}`
	m := ParseBedrockGeometry([]byte(geom))
	testutil.NotNil(t, m, "应解析成功")
	testutil.Equal(t, m.Bones[0].Name, "new", "应优先新版格式")
	testutil.Equal(t, m.TexWidth, 32, "TexWidth 应取新版")
}
