package geometry

import (
	"archive/zip"
	"bytes"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// 最小 Bedrock geometry：Root + 1 cube
const miniGeo = `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": {"identifier": "test", "texture_width": 64, "texture_height": 32},
    "bones": [{
      "name": "Root",
      "pivot": [0, 0, 0],
      "cubes": [{"origin": [-1, 0, -1], "size": [2, 2, 2], "uv": [0, 0]}]
    }]
  }]
}`

// TestParseComponentsFromZip 多组件 zip 解析：每个模型文件独立组件（含 arm），
// main 优先排序，TexSlot 全局化。
func TestParseComponentsFromZip(t *testing.T) {
	// 用 slice-of-pairs 代替 map 遍历，确保 zip 条目写入序确定（Go map 迭代序随机）。
	type entry struct{ name, content string }
	entries := []entry{
		{"ysm.json", `{"files":{"player":{"model":{"main":"models/main.json","arm":"models/arm.json"},"texture":["textures/skin.png"]}}}`},
		{"models/main.json", miniGeo},
		{"models/arm.json", miniGeo},
		{"models/arrow.json", miniGeo},
		{"textures/skin.png", "fake-png"},
		{"textures/arrow.png", "fake-png"},
		{"animations/main.animation.json", `{"format_version":"1.8.0","animations":{}}`},
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		w, err := zw.Create(e.name)
		testutil.NoError(t, err)
		if _, err := w.Write([]byte(e.content)); err != nil {
			testutil.NoError(t, err)
		}
	}
	if err := zw.Close(); err != nil {
		testutil.NoError(t, err)
	}
	data := buf.Bytes()

	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	testutil.NoError(t, err)
	// 守卫下方 texNames[i] 循环与 comps[0] 索引
	testutil.Equal(t, len(comps), 3, "组件数 = %d, 期望 3（main/arm/arrow）", len(comps))
	// ADR-114 perComponent：texNames = 组件声明的纹理名（无声明用 basename）
	// main→skin（声明 textures/skin.png）、arm→""（与 main 共用皮肤，texNames 置空）、arrow→arrow
	wantNames := []string{"skin", "", "arrow"}
	for i, want := range wantNames {
		if texNames[i] != want {
			t.Errorf("texNames[%d] = %q, 期望 %q", i, texNames[i], want)
		}
	}
	// main 优先（组件 0）
	testutil.Equal(t, comps[0].BoneCount == 0, false, "组件 0 应为 main（非空）")
	// ADR-114 perComponent：每组件 cube.TexSlot=0（用自己的第 0 张纹理）
	for i, c := range comps {
		slot := c.Bones[0].Cubes[0].TexSlot
		testutil.Equal(t, slot, 0, "组件 %d texSlot = %d, 期望 0（perComponent）", i, slot)
		// 原复合条件拆序贯
		testutil.Equal(t, c.Bones[0].Cubes[0].CubeTexW, 64, "组件 %d CubeTexW 未设置: %d/%d", i, c.Bones[0].Cubes[0].CubeTexW, c.Bones[0].Cubes[0].CubeTexH)
		testutil.Equal(t, c.Bones[0].Cubes[0].CubeTexH, 32, "组件 %d CubeTexH 未设置: %d/%d", i, c.Bones[0].Cubes[0].CubeTexW, c.Bones[0].Cubes[0].CubeTexH)
	}
}

// TestParseComponentsFromZipEmpty 空/损坏 zip 不 panic
func TestParseComponentsFromZipEmpty(t *testing.T) {
	comps, _, err := ParseComponentsFromZip([]byte("not-a-zip"), 9)
	testutil.NotNil(t, err, "损坏 zip 应返回错误")
	testutil.Nil(t, comps, "损坏 zip 组件应为 nil")
}

// TestParseComponentsFrom7zBadData 损坏 7z 返回错误（7z 构造需 sevenzip Writer，仅覆盖错误路径）
func TestParseComponentsFrom7zBadData(t *testing.T) {
	comps, _, err := ParseComponentsFrom7z([]byte("not7z"), 5)
	testutil.NotNil(t, err, "损坏 7z 应返回错误")
	testutil.Nil(t, comps, "损坏 7z 组件应为 nil")
}
