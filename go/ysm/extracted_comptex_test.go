// ===== 解压目录路径 perComponent 纹理（ADR-114 补齐）测试 =====
// 根因背景：FindComponentsInExtractedYSM 此前无同名纹理兜底、无 ComponentTextures 填充，
// 未声明组件（arrow 等）在前端 texArr 越界 → 静默兜底贴错图（wine_fox 多组件 UV「炸」根因）。
package ysm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// setupExtractedDir 搭建解压目录：ysm.json 声明 main/arm + 2 张纹理，
// models/ 额外放未声明的 arrow.json，textures/ 放对应 png。
func setupExtractedDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	texturesDir := filepath.Join(dir, "textures")
	if err := os.MkdirAll(modelsDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.MkdirAll(texturesDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	ysmJSON := `{
	  "files": {
	    "player": {
	      "model": {"main": "models/main.json", "arm": "models/arm.json"},
	      "texture": ["textures/skin.png", "textures/skin_white.png"]
	    }
	  }
	}`
	mainJSON := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"main","texture_width":256,"texture_height":256},"bones":[{"name":"head","cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0]}]}]}]}`
	armJSON := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"arm","texture_width":256,"texture_height":256},"bones":[{"name":"LeftArm","cubes":[{"origin":[2,10,2],"size":[4,12,4],"uv":[0,0]}]}]}]}`
	arrowJSON := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"arrow","texture_width":64,"texture_height":64},"bones":[{"name":"arrow","cubes":[{"origin":[0,0,0],"size":[1,16,1],"uv":{"north":{"uv":[0,0],"uv_size":[1,16]}}}]}]}]}`
	pngBytes := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00}
	write := func(rel string, data []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, rel), data, 0644); err != nil {
			testutil.NoError(t, err)
		}
	}
	write("ysm.json", []byte(ysmJSON))
	write(filepath.ToSlash("models/main.json"), []byte(mainJSON))
	write(filepath.ToSlash("models/arm.json"), []byte(armJSON))
	write(filepath.ToSlash("models/arrow.json"), []byte(arrowJSON))
	write(filepath.ToSlash("textures/skin.png"), pngBytes)
	write(filepath.ToSlash("textures/skin_white.png"), pngBytes)
	write(filepath.ToSlash("textures/arrow.png"), pngBytes)
	return dir
}

// TestFindComponentsInExtractedYSM_PerComponentTextures 验证：
// 未声明组件（arrow）命中同名纹理 → ComponentTextures 填充 + texNames 置空（前端跳过 R1 校验）；
// 已声明组件（main/arm）不受影响（保留全局 texArr 多皮肤切换语义）。
func TestFindComponentsInExtractedYSM_PerComponentTextures(t *testing.T) {
	dir := setupExtractedDir(t)

	comps, texNames := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) != 3 {
		t.Fatalf("应解析出 3 个组件（main/arm/arrow），实际 %d", len(comps))
	}

	bySource := map[string]int{}
	for i, c := range comps {
		bySource[c.SourceName] = i
	}
	// 未声明组件 arrow：按名命中 arrow.png → perComponent 纹理
	arrowIdx, ok := bySource["arrow"]
	if !ok {
		t.Fatal("arrow 组件缺失（补扫应收集未声明组件）")
	}
	arrowTex, has := comps[arrowIdx].ComponentTextures["arrow"]
	if !has || len(arrowTex) != 1 {
		t.Fatalf("arrow 应有 perComponent 纹理 [1 张]，实际 %v", comps[arrowIdx].ComponentTextures)
	}
	if !strings.HasPrefix(arrowTex[0], "data:image/png;base64,") {
		t.Errorf("arrow 纹理应为 data URI，实际前缀 %.40q", arrowTex[0])
	}
	// texNames 与 comps 同序：arrow 走 perComponent → 置空（前端跳过 R1 存在性校验）
	if texNames[arrowIdx] != "" {
		t.Errorf("perComponent 组件 texNames 应为空串，实际 %q", texNames[arrowIdx])
	}

	// 已声明组件：ComponentTextures 保持空（继续走全局 texArr[texSlot]，多皮肤切换可用）
	for _, name := range []string{"main", "arm"} {
		idx, ok := bySource[name]
		if !ok {
			t.Fatalf("%s 组件缺失", name)
		}
		if len(comps[idx].ComponentTextures) != 0 {
			t.Errorf("%s 是已声明组件，不应填 ComponentTextures（保留全局纹理切换），实际 %v", name, comps[idx].ComponentTextures)
		}
	}
	// 已声明组件 texNames = 声明纹理名（R1 契约不变）
	if texNames[bySource["main"]] != "skin" {
		t.Errorf("main texNames 应为声明名 skin，实际 %q", texNames[bySource["main"]])
	}
}

// TestFindComponentsInExtractedYSM_PerComponentNoTexture 未声明组件无同名纹理：
// 不填 ComponentTextures、texNames 回落 basename（现状行为不回归）。
func TestFindComponentsInExtractedYSM_PerComponentNoTexture(t *testing.T) {
	dir := setupExtractedDir(t)
	if err := os.Remove(filepath.Join(dir, "textures", "arrow.png")); err != nil {
		testutil.NoError(t, err)
	}

	comps, texNames := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) != 3 {
		t.Fatalf("应解析出 3 个组件，实际 %d", len(comps))
	}
	for i, c := range comps {
		if c.SourceName != "arrow" {
			continue
		}
		if len(c.ComponentTextures) != 0 {
			t.Errorf("无同名纹理时不应填 ComponentTextures，实际 %v", c.ComponentTextures)
		}
		if texNames[i] != "arrow" {
			t.Errorf("无同名纹理时 texNames 应回落 basename arrow，实际 %q", texNames[i])
		}
	}
}
