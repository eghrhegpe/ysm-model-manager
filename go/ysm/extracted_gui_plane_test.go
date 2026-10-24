package ysm

import (
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// setupGuiPlaneDir 构造 wine_fox 17_mini 的病灶复刻：
//   - player.texture 只声明 skin（共享皮肤）
//   - vehicles 段声明 plane 复用 skin（"texture":{"uv":"textures/skin.png"}）
//   - textures/gui/background.png（GUI 背景，非模型纹理）——曾污染全局 texArr
//
// 回归红线：载具共享皮肤 + 无同名纹理时不得错绑到 gui 背景。
func setupGuiPlaneDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	texturesDir := filepath.Join(dir, "textures")
	guiDir := filepath.Join(texturesDir, "gui")
	for _, d := range []string{modelsDir, texturesDir, guiDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			testutil.NoError(t, err)
		}
	}
	ysmJSON := `{
	  "files": {
	    "player": {
	      "model": {"main": "models/main.json", "arm": "models/arm.json"},
	      "texture": ["textures/skin.png"]
	    },
	    "vehicles": [
	      {"match": ["immersive_aircraft:biplane"], "model": "models/plane.json", "texture": {"uv": "textures/skin.png"}}
	    ]
	  }
	}`
	geo := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"x","texture_width":128,"texture_height":128},"bones":[{"name":"R","cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0]}]}]}]}`
	pngBytes := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00}
	write := func(rel string, data []byte) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, rel)), 0o755); err != nil {
			testutil.NoError(t, err)
		}
		if err := os.WriteFile(filepath.Join(dir, rel), data, 0o644); err != nil {
			testutil.NoError(t, err)
		}
	}
	write("ysm.json", []byte(ysmJSON))
	for _, m := range []string{"main.json", "arm.json", "plane.json"} {
		write(filepath.ToSlash("models/"+m), []byte(geo))
	}
	write("textures/skin.png", pngBytes)
	write("textures/gui/background.png", pngBytes)
	return dir
}

// TestFindComponentsInExtractedYSM_PlaneSharedSkinNoGui 回归 wine_fox 17_mini plane→background：
// ① 合并版递归 textures/ 不得收 gui/background.png；
// ② 组件版 plane（vehicles 共享 skin、无同名 plane.png）获 ComponentTextures=skin，不落全局槽错绑。
func TestFindComponentsInExtractedYSM_PlaneSharedSkinNoGui(t *testing.T) {
	dir := setupGuiPlaneDir(t)
	ysmPath := filepath.Join(dir, "ysm.json")

	// ① 合并版：TextureNames 不得含 background
	geo, _ := FindGeometryInExtractedYSM(ysmPath)
	testutil.NotNil(t, geo, "合并版解析失败")
	for _, n := range geo.TextureNames {
		if n == "background" {
			t.Errorf("合并版把 gui/background.png 纳入纹理槽（texArr 污染）")
		}
	}

	// ② 组件版：plane 有股 ComponentTextures（skin），而非依赖全局槽
	comps, _ := FindComponentsInExtractedYSM(ysmPath)
	var plane *struct {
		sourceName string
		compTex    map[string][]string
		texSlot    int
	}
	for i := range comps {
		c := &comps[i]
		if c.SourceName != "plane" {
			continue
		}
		slot := -1
		if len(c.Bones) > 0 && len(c.Bones[0].Cubes) > 0 {
			slot = c.Bones[0].Cubes[0].TexSlot
		}
		plane = &struct {
			sourceName string
			compTex    map[string][]string
			texSlot    int
		}{c.SourceName, c.ComponentTextures, slot}
	}
	testutil.NotNil(t, plane, "plane 组件缺失（vehicles 声明模型应被补扫收集）")
	// 原复合条件拆序贯（守卫下方 tex[0] 索引）
	tex, ok := plane.compTex["plane"]
	testutil.Equal(t, ok, true, "plane 组件应获 ComponentTextures=skin（共享皮肤），实际 %v", plane.compTex)
	testutil.Equal(t, len(tex) != 1 || len(tex[0]) == 0, false, "plane ComponentTextures 应有 1 张非空纹理，实际 %v", tex)
	t.Logf("✓ plane: ComponentTextures[plane] 命中 %d 张，TexSlot=%d", len(tex), plane.texSlot)
}
