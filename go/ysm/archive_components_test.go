package ysm

import (
	"os"
	"path/filepath"
	"testing"
)

// 带指定骨骼名的 Bedrock geometry（各组件用不同骨骼名，便于断言排序/归属）
func geoWithBone(boneName string) string {
	return `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": {"identifier": "test", "texture_width": 64, "texture_height": 32},
    "bones": [{
      "name": "` + boneName + `",
      "pivot": [0, 0, 0],
      "cubes": [{"origin": [-1, 0, -1], "size": [2, 2, 2], "uv": [0, 0]}]
    }]
  }]
}`
}

// TestFindComponentsInExtractedYSM 解压目录多组件：main+arm 显式 + 补扫 models/ 其余
// （arrow 等 projectiles/vehicles 组件），arm 不排除。纹理声明仅 skin 一张：
//   - main（声明序 j=0）→ slot 0（skin）
//   - arm（j=1 越界）→ **钳到最后一张声明纹理** slot 0（同 player 实体共享 skin，
//     02_new_year 回归：之前掉入按名段会贴到 arrow.png）
//   - arrow/boat（未声明补扫）→ 按名段 slot 1/2
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
	// 各组件用不同骨骼名：main→mainBone / arm→armBone / arrow→arrowBone / boat→boatBone，
	// 排序回归（如 main 不在首位）会因断言失败而暴露
	for name, bone := range map[string]string{
		"main.json":  "mainBone",
		"arm.json":   "armBone",
		"arrow.json": "arrowBone",
		"boat.json":  "boatBone",
	} {
		if err := os.WriteFile(filepath.Join(modelsDir, name), []byte(geoWithBone(bone)), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	comps, texNames := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) != 4 {
		t.Fatalf("组件数 = %d, 期望 4（main/arm/arrow/boat 补扫）", len(comps))
	}
	// main 优先（map 形声明：main 键排首位）
	if comps[0].Bones[0].Name != "mainBone" {
		t.Fatalf("组件 0 应为 main（实际骨骼 = %q）", comps[0].Bones[0].Name)
	}
	// TexSlot：main/arm 共享 skin（0），arrow/boat 按名段 1/2
	wantSlots := []int{0, 0, 1, 2}
	// arm 与 main 共用同一套 player.texture 皮肤（ModernYSM 权威）：
	// arm 的 texNames 置空、ComponentTextures 为空，前端走全局 texArr[0]。
	wantTexNames := []string{"skin", "", "arrow", "boat"}
	for i, c := range comps {
		slot := c.Bones[0].Cubes[0].TexSlot
		if slot != wantSlots[i] {
			t.Fatalf("组件 %d texSlot = %d, 期望 %d", i, slot, wantSlots[i])
		}
	}
	if len(texNames) != len(wantTexNames) {
		t.Fatalf("texNames = %v (len=%d), 期望 %v", texNames, len(texNames), wantTexNames)
	}
	for i, want := range wantTexNames {
		if texNames[i] != want {
			t.Fatalf("texNames[%d] = %q, 期望 %q", i, texNames[i], want)
		}
	}
}
