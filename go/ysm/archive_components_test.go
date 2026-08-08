package ysm

import (
	"os"
	"path/filepath"
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

// TestFindComponentsInExtractedYSM 解压目录多组件：main+arm 显式 + 补扫 models/ 其余
// （arrow 等 projectiles/vehicles 组件），TexSlot 全局化，arm 不排除。
func TestFindComponentsInExtractedYSM(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	if err := os.MkdirAll(modelsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	ysmJSON := `{"files":{"player":{"model":{"main":"models/main.json","arm":"models/arm.json"},"texture":["textures/skin.png"]}}}`
	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"main.json", "arm.json", "arrow.json", "boat.json"} {
		if err := os.WriteFile(filepath.Join(modelsDir, name), []byte(miniGeo), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	comps := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) != 4 {
		t.Fatalf("组件数 = %d, 期望 4（main/arm/arrow/boat 补扫）", len(comps))
	}
	// main 优先 + TexSlot 全局化 0/1/2/3（无钳制）
	for i, c := range comps {
		slot := c.Bones[0].Cubes[0].TexSlot
		if slot != i {
			t.Fatalf("组件 %d texSlot = %d, 期望 %d", i, slot, i)
		}
	}
}
