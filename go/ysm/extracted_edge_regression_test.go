// 边角回归：texture 声明规范化口径 + pngNameMap 收集范围的黑盒守护。
// 现状两个消费方对 player.texture 的规范化各有一套（extracted.go 重复解析）：
//   - Geometry 版带扩展名（orderMap 键）、Components 版去扩展名（前端 R1 校验）——
//     两者自洽，抽公共函数时不得强改任一。
//
// commit A：抽 parsePlayerModel 后照样各留规范化（反斜杠裸路径守卫在本文件）。
// commit B：pngNameMap 由单层只认 .png 扩为公共递归 collectTextureFiles（含 gui 排除、
// .png/.jpg/.tga），子目录同名纹理 / .tga 同名纹理两红 case 在下方锁定后修复。
package ysm

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// TestFindComponents_BackslashTexDecl 反斜杠裸字符串纹理声明应正确取 basename（切 '\\'）。
// 现状 Components 用 LastIndexAny("/\\")，已正确；本测试锁住，防抽公共函数时误退化为只切 '/'
// （Geometry 裸分支曾有该缺陷）。
func TestFindComponents_BackslashTexDecl(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	texDir := filepath.Join(dir, "textures")
	for _, d := range []string{modelsDir, texDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			testutil.NoError(t, err)
		}
	}
	// 裸字符串 + 反斜杠路径：textures\skin.png
	ysmJSON := `{"files":{"player":{"model":"models/main.json","texture":["textures\\skin.png"]}}}`
	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(geoWithBone("mainBone")), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "textures", "skin.png"), []byte{1, 2, 3}, 0o644); err != nil {
		testutil.NoError(t, err)
	}

	comps, texNames := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) != 1 {
		t.Fatalf("组件数 = %d, 期望 1", len(comps))
	}
	// 反斜杠裸声明 → 声明纹理槽 0 → texNames[0] 应为去扩展名 basename "skin"
	if len(texNames) != 1 || texNames[0] != "skin" {
		t.Fatalf("texNames = %v, 期望 [skin]（反斜杠裸路径应切 basename）", texNames)
	}
}

// TestFindComponents_SubdirSameNameTex 未声明组件与纹理**子目录**同名文件应命中
// perComponent 兜底（pngNameMap 递归化契约）。现状 pngNameMap 只扫 textures/ 一层、
// 只认 .png，子目录里的同名纹理收不到 → ComponentTextures 缺失（红）。
func TestFindComponents_SubdirSameNameTex(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	subTex := filepath.Join(dir, "textures", "variants")
	for _, d := range []string{modelsDir, subTex} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			testutil.NoError(t, err)
		}
	}
	// main 已声明（占 texture 声明 slot 0），arrow 未声明 → 由补扫进入、按名走 pngNameMap
	ysmJSON := `{"files":{"player":{"model":{"main":"models/main.json"},"texture":["textures/skin.png"]}}}`
	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(geoWithBone("mainBone")), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "arrow.json"), []byte(geoWithBone("arrowBone")), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	// 同名纹理在 textures/variants/ 子目录（不在 textures/ 根）
	if err := os.WriteFile(filepath.Join(subTex, "arrow.png"), []byte{1, 2, 3}, 0o644); err != nil {
		testutil.NoError(t, err)
	}

	comps, _ := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	// main + arrow（补扫）
	if len(comps) != 2 {
		t.Fatalf("组件数 = %d, 期望 2", len(comps))
	}
	var arrow *types.BedrockModel
	for i := range comps {
		if comps[i].SourceName == "arrow" {
			arrow = &comps[i]
			break
		}
	}
	if arrow == nil {
		t.Fatal("未找到补扫组件 arrow")
	}
	if len(arrow.ComponentTextures) == 0 {
		t.Fatal("未声明组件应命中子目录同名纹理兜底（ComponentTextures 非空）")
	}
}

// TestFindComponents_TgaSameNameTex 未声明组件与 .tga 同名纹理**不**走 perComponent
// data-URI 分支：.tga 非 Web 图像格式，硬编码成 data:image/png;base64,<TGA 字节> 浏览器
// 无法解码 → textureDataURI 返回空串，落回全局 texArr 路径（ComponentTextures 为空）。
func TestFindComponents_TgaSameNameTex(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	texDir := filepath.Join(dir, "textures")
	for _, d := range []string{modelsDir, texDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			testutil.NoError(t, err)
		}
	}
	ysmJSON := `{"files":{"player":{"model":{"main":"models/main.json"},"texture":["textures/skin.png"]}}}`
	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(geoWithBone("mainBone")), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "boat.json"), []byte(geoWithBone("boatBone")), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	// 同名纹理为 .tga（非 Web 格式）
	if err := os.WriteFile(filepath.Join(texDir, "boat.tga"), []byte{1, 2, 3}, 0o644); err != nil {
		testutil.NoError(t, err)
	}

	comps, _ := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) != 2 {
		t.Fatalf("组件数 = %d, 期望 2（main + boat 补扫）", len(comps))
	}
	var boat *types.BedrockModel
	for i := range comps {
		if comps[i].SourceName == "boat" {
			boat = &comps[i]
			break
		}
	}
	if boat == nil {
		t.Fatal("未找到补扫组件 boat")
	}
	if len(boat.ComponentTextures) != 0 {
		t.Fatalf(".tga 同名纹理不得产出 data URI（浏览器不可解码），实际 ComponentTextures = %v", boat.ComponentTextures)
	}
}

// TestFindComponents_JpgSameNameTex 未声明组件与 .jpg 同名纹理应命中 perComponent 兜底，
// 且 data URI 的 MIME 按实际扩展名派生为 image/jpeg（而非硬编码 image/png）。
func TestFindComponents_JpgSameNameTex(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	texDir := filepath.Join(dir, "textures")
	for _, d := range []string{modelsDir, texDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			testutil.NoError(t, err)
		}
	}
	ysmJSON := `{"files":{"player":{"model":{"main":"models/main.json"},"texture":["textures/skin.png"]}}}`
	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(geoWithBone("mainBone")), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "boat.json"), []byte(geoWithBone("boatBone")), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	// 同名纹理为 .jpg
	if err := os.WriteFile(filepath.Join(texDir, "boat.jpg"), []byte{1, 2, 3}, 0o644); err != nil {
		testutil.NoError(t, err)
	}

	comps, _ := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) != 2 {
		t.Fatalf("组件数 = %d, 期望 2（main + boat 补扫）", len(comps))
	}
	var boat *types.BedrockModel
	for i := range comps {
		if comps[i].SourceName == "boat" {
			boat = &comps[i]
			break
		}
	}
	if boat == nil {
		t.Fatal("未找到补扫组件 boat")
	}
	ct, ok := boat.ComponentTextures["boat"]
	if !ok || len(ct) != 1 {
		t.Fatalf("未声明组件应命中 .jpg 同名纹理兜底，实际 ComponentTextures = %v", boat.ComponentTextures)
	}
	if !strings.HasPrefix(ct[0], "data:image/jpeg;base64,") {
		t.Errorf(".jpg 同名纹理 data URI 应为 image/jpeg，实际前缀 %.40q", ct[0])
	}
}

// TestFindComponents_DeclaredOutOfRangeSameNameTex 已声明但超范围组件（模型多于纹理声明）
// 不得绑定自己的同名纹理，而应钳到最后一张声明纹理（共享默认皮肤）——02_new_year 回归语义。
// 回归：重构把分支 B 查找键从 texName（钳到最后一张声明纹理名）改成 base（组件 basename），
// 导致超范围声明组件错误绑定自身同名纹理。
func TestFindComponents_DeclaredOutOfRangeSameNameTex(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	texDir := filepath.Join(dir, "textures")
	for _, d := range []string{modelsDir, texDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			testutil.NoError(t, err)
		}
	}
	// model 声明 2 个（main + extra），texture 只声明 1 张（skin）→ extra 已声明但超范围
	ysmJSON := `{"files":{"player":{"model":{"main":"models/main.json","extra":"models/extra.json"},"texture":["textures/skin.png"]}}}`
	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(geoWithBone("mainBone")), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "extra.json"), []byte(geoWithBone("extraBone")), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	// 共享默认皮肤 skin.png + extra 自己的同名纹理 extra.png（字节不同以便区分）
	skinBytes := []byte{1, 2, 3}
	extraBytes := []byte{9, 9, 9}
	if err := os.WriteFile(filepath.Join(texDir, "skin.png"), skinBytes, 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(texDir, "extra.png"), extraBytes, 0o644); err != nil {
		testutil.NoError(t, err)
	}

	comps, _ := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) != 2 {
		t.Fatalf("组件数 = %d, 期望 2（main + extra 声明）", len(comps))
	}
	var extra *types.BedrockModel
	for i := range comps {
		if comps[i].SourceName == "extra" {
			extra = &comps[i]
			break
		}
	}
	if extra == nil {
		t.Fatal("未找到声明组件 extra")
	}
	// extra 已声明但超范围：应钳到最后一张声明纹理 skin（共享默认皮肤），
	// 而非绑定自己的 extra.png 同名纹理
	ct, ok := extra.ComponentTextures["extra"]
	if !ok || len(ct) != 1 {
		t.Fatalf("超范围声明组件应命中共享默认纹理兜底，实际 ComponentTextures = %v", extra.ComponentTextures)
	}
	uri := ct[0]
	if !strings.HasPrefix(uri, "data:image/png;base64,") {
		t.Fatalf("data URI 应为 PNG，实际前缀 %.40q", uri)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(uri, "data:image/png;base64,"))
	testutil.NoError(t, err, "data URI base64 解码失败")
	if string(decoded) != string(skinBytes) {
		t.Errorf("超范围声明组件应绑定共享默认皮肤 skin.png（%v），实际绑定 %v（若为 extra.png 即回归）", skinBytes, decoded)
	}
}
