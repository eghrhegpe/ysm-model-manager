package geometry

import (
	"archive/zip"
	"bytes"
	"testing"
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
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	entries := map[string]string{
		"ysm.json":                           `{"files":{"player":{"model":{"main":"models/main.json","arm":"models/arm.json"},"texture":["textures/skin.png"]}}}`,
		"models/main.json":                   miniGeo,
		"models/arm.json":                    miniGeo,
		"models/arrow.json":                  miniGeo,
		"textures/skin.png":                  "fake-png",
		"textures/arrow.png":                 "fake-png",
		"animations/main.animation.json":     `{"format_version":"1.8.0","animations":{}}`,
	}
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	data := buf.Bytes()

	comps, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if len(comps) != 3 {
		t.Fatalf("组件数 = %d, 期望 3（main/arm/arrow）", len(comps))
	}
	// main 优先（组件 0）
	if comps[0].BoneCount == 0 {
		t.Fatal("组件 0 应为 main（非空）")
	}
	// TexSlot 全局化 0/1/2（无钳制：arrow 组件 texSlot=2 而非被钳到 1）
	for i, c := range comps {
		slot := c.Bones[0].Cubes[0].TexSlot
		if slot != i {
			t.Fatalf("组件 %d texSlot = %d, 期望 %d", i, slot, i)
		}
		if c.Bones[0].Cubes[0].CubeTexW != 64 || c.Bones[0].Cubes[0].CubeTexH != 32 {
			t.Fatalf("组件 %d CubeTexW/H 未设置: %d/%d", i, c.Bones[0].Cubes[0].CubeTexW, c.Bones[0].Cubes[0].CubeTexH)
		}
	}
}

// TestParseComponentsFromZipEmpty 空/损坏 zip 不 panic
func TestParseComponentsFromZipEmpty(t *testing.T) {
	comps, err := ParseComponentsFromZip([]byte("not-a-zip"), 9)
	if err == nil {
		t.Fatal("损坏 zip 应返回错误")
	}
	if comps != nil {
		t.Fatal("损坏 zip 组件应为 nil")
	}
}

// TestParseComponentsFrom7zBadData 损坏 7z 返回错误（7z 构造需 sevenzip Writer，仅覆盖错误路径）
func TestParseComponentsFrom7zBadData(t *testing.T) {
	comps, err := ParseComponentsFrom7z([]byte("not7z"), 5)
	if err == nil {
		t.Fatal("损坏 7z 应返回错误")
	}
	if comps != nil {
		t.Fatal("损坏 7z 组件应为 nil")
	}
}
