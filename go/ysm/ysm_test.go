// ===== go/ysm 单测（覆盖率 13.1% → 提升）=====
package ysm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

const ysmModToml = `modLoader="javafml"
[[mods]]
modId="yes_steve_model"
displayName="Yes Steve Model"
version="1.0"
`

func TestIsYSMJar(t *testing.T) {
	// 含 mods.toml 且 modId=yes_steve_model → true
	jar := testutil.WriteZipFile(t, "mod.jar", map[string]string{"META-INF/mods.toml": ysmModToml})
	if !IsYSMJar(jar) {
		t.Fatal("含 yes_steve_model 的 jar 应识别为 YSM")
	}
	// neoforge.mods.toml 同样支持
	jarNeo := testutil.WriteZipFile(t, "mod.jar", map[string]string{"META-INF/neoforge.mods.toml": ysmModToml})
	if !IsYSMJar(jarNeo) {
		t.Fatal("neoforge.mods.toml 应识别")
	}
	// 非 YSM mod
	jar2 := testutil.WriteZipFile(t, "mod.jar", map[string]string{"META-INF/mods.toml": `[[mods]]
modId="other_mod"
`})
	if IsYSMJar(jar2) {
		t.Fatal("非 YSM jar 不应识别")
	}
	// 非 zip 文件 → false
	bad := filepath.Join(t.TempDir(), "bad.jar")
	if err := os.WriteFile(bad, []byte("notzip"), 0644); err != nil {
		t.Fatal(err)
	}
	if IsYSMJar(bad) {
		t.Fatal("非 zip 不应识别")
	}
}

// ADR-033 截断探测边界回归——mods.toml 超过 1MB 应跳过（IsYSMJar false）
func TestIsYSMJar_ModsTomlOverLimit(t *testing.T) {
	// 1MB+1 触发 ysm.go 的 limit+1 探测
	huge := strings.Repeat("x", (1<<20)+1)
	jar := testutil.WriteZipFile(t, "mod.jar", map[string]string{"META-INF/mods.toml": huge})
	if IsYSMJar(jar) {
		t.Fatal("mods.toml 超过 1MB 应跳过（截断检测），实际误判为 YSM")
	}
}

// 覆盖 ysm.go:60-66 的空格分隔变体 `key = "value"`（默认测试只覆盖 `key="value"`）
func TestIsYSMJar_SpaceVariants(t *testing.T) {
	jar := testutil.WriteZipFile(t, "mod.jar", map[string]string{"META-INF/mods.toml": `modLoader="javafml"
[[mods]]
modId = "yes_steve_model"
displayName = "Yes Steve Model"
`})
	if !IsYSMJar(jar) {
		t.Fatal("空格分隔 key/value 的 mods.toml 也应识别为 YSM")
	}
	// 仅 modId 匹配、displayName 缺失 → 不应识别（两字段都需命中）
	jar2 := testutil.WriteZipFile(t, "mod.jar", map[string]string{"META-INF/mods.toml": `[[mods]]
modId="yes_steve_model"
displayName="Other Name"
`})
	if IsYSMJar(jar2) {
		t.Fatal("displayName 不匹配不应识别")
	}
	// 多 [[mods]] 块：第二块才命中 → 应识别
	jar3 := testutil.WriteZipFile(t, "mod.jar", map[string]string{"META-INF/mods.toml": `[[mods]]
modId="other_mod"
displayName="Other"
[[mods]]
modId="yes_steve_model"
displayName="Yes Steve Model"
`})
	if !IsYSMJar(jar3) {
		t.Fatal("第二 [[mods]] 块命中应识别")
	}
}

func TestHasModInDir(t *testing.T) {
	// 未知 rtype → 默认 true（非模型类）
	if !HasModInDir(t.TempDir(), "resourcepack") {
		t.Fatal("未知类型应默认 true")
	}
	// 已知 rtype 但目录不存在 → false
	if HasModInDir(filepath.Join(t.TempDir(), "nope"), "ysm") {
		t.Fatal("目录不存在应 false")
	}
	// EntityPlayer：文件名匹配即可
	modsDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(modsDir, "mmdskin-2.0.jar"), []byte("x"), 0644)
	if !HasModInDir(modsDir, "EntityPlayer") {
		t.Fatal("EntityPlayer 文件名匹配应 true")
	}
	// ysm：需打开 ZIP 确认
	jar := testutil.WriteZipFile(t, "mod.jar", map[string]string{"META-INF/mods.toml": ysmModToml})
	if err := os.Rename(jar, filepath.Join(modsDir, "ysm-1.0.jar")); err != nil {
		t.Fatal(err)
	}
	if !HasModInDir(modsDir, "ysm") {
		t.Fatal("ysm jar 应 true")
	}
}

// MMD 组所有子类型（场景模型/动画/表情/舞台/着色器）与 PMX 模型共用 MMD Skin
// 模组（mmdskin/mmd-skin），缺失时应同样判定"无模组"——此前只有 EntityPlayer 有
// ModKeywords 关键词，其余子类型落入默认 true（侧栏徽章误显示 "0" 而非 "无MMD"）。
func TestHasModInDir_MMDSubtypes(t *testing.T) {
	mmdSubtypes := []string{
		"SceneModel", "CustomAnim", "CustomMorph", "StageAnim",
		"DefaultAnim", "DefaultMorph", "mmd-shader",
	}

	modsDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(modsDir, "MMDSkin-1.0.jar"), []byte("x"), 0644)
	for _, rt := range mmdSubtypes {
		if !HasModInDir(modsDir, rt) {
			t.Errorf("含 mmdskin jar 时 MMD 子类型 %q 应识别为 true", rt)
		}
	}

	// 无 mod 的目录 → 所有 MMD 子类型都应 false（回归：此前 SceneModel 等误返回 true）
	empty := t.TempDir()
	for _, rt := range mmdSubtypes {
		if HasModInDir(empty, rt) {
			t.Errorf("无 mod 时 MMD 子类型 %q 应返回 false（此前误判为已装模组）", rt)
		}
	}

	// vrm 在 ModKeywords 中有独立 "mmdskin" 关键词，含 mmdskin jar 应识别为 true
	vrcDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(vrcDir, "mmdskin-1.0.jar"), []byte("x"), 0644)
	if !HasModInDir(vrcDir, "vrm") {
		t.Fatal("vrm 含 mmdskin 关键词应识别为 true")
	}
}

// ====== AnalyzeYSMModel ======

const validModelJSON = `{
	"name": "TestModel",
	"author": "TestAuthor",
	"version": "1.0.0",
	"bones": [{"name":"head"},{"name":"body"}],
	"textures": ["tex1.png","tex2.png","tex3.png"],
	"animations": [{"name":"idle"},{"name":"walk"}],
	"model": {
		"vertices": [1,2,3,4],
		"faces": [{"a":1},{"b":2}]
	}
}`

func TestAnalyzeYSMModel_Valid(t *testing.T) {
	// .ysm 扩展名
	path := testutil.WriteZipFile(t, "mod.jar", map[string]string{"model.json": validModelJSON})
	ysmPath := filepath.Join(t.TempDir(), "test.ysm")
	if err := os.Rename(path, ysmPath); err != nil {
		t.Fatal(err)
	}
	meta := AnalyzeYSMModel(ysmPath)
	if meta.Name != "TestModel" {
		t.Errorf("Name = %q, 期望 TestModel", meta.Name)
	}
	if meta.Author != "TestAuthor" {
		t.Errorf("Author = %q, 期望 TestAuthor", meta.Author)
	}
	if meta.Version != "1.0.0" {
		t.Errorf("Version = %q, 期望 1.0.0", meta.Version)
	}
	if meta.Bones != 2 {
		t.Errorf("Bones = %d, 期望 2", meta.Bones)
	}
	if meta.Textures != 3 {
		t.Errorf("Textures = %d, 期望 3", meta.Textures)
	}
	if meta.Animations != 2 {
		t.Errorf("Animations = %d, 期望 2", meta.Animations)
	}
	if meta.Vertices != 4 {
		t.Errorf("Vertices = %d, 期望 4", meta.Vertices)
	}
	if meta.Faces != 2 {
		t.Errorf("Faces = %d, 期望 2", meta.Faces)
	}
	if meta.HasError {
		t.Errorf("HasError 应为 false, 得到 %s", meta.ErrorMsg)
	}
}

func TestAnalyzeYSMModel_ZipExt(t *testing.T) {
	// .zip 扩展名也应支持
	path := testutil.WriteZipFile(t, "mod.jar", map[string]string{"model.json": validModelJSON})
	zipPath := filepath.Join(t.TempDir(), "model.zip")
	if err := os.Rename(path, zipPath); err != nil {
		t.Fatal(err)
	}
	meta := AnalyzeYSMModel(zipPath)
	if meta.HasError {
		t.Errorf("zip 扩展名不应报错: %s", meta.ErrorMsg)
	}
	if meta.Name != "TestModel" {
		t.Errorf("Name = %q, 期望 TestModel", meta.Name)
	}
}

func TestAnalyzeYSMModel_BanYsmExt(t *testing.T) {
	// .ban 后缀但内部是 .ysm → 应正常解析
	path := testutil.WriteZipFile(t, "mod.jar", map[string]string{"model.json": validModelJSON})
	banPath := filepath.Join(t.TempDir(), "test.ysm.ban")
	if err := os.Rename(path, banPath); err != nil {
		t.Fatal(err)
	}
	meta := AnalyzeYSMModel(banPath)
	if meta.HasError {
		t.Errorf(".ysm.ban 不应报错: %s", meta.ErrorMsg)
	}
	if meta.Name != "TestModel" {
		t.Errorf("Name = %q, 期望 TestModel", meta.Name)
	}
}

func TestAnalyzeYSMModel_BanOtherExt(t *testing.T) {
	// .ban 后缀但内部不是 .ysm → hasError
	path := testutil.WriteZipFile(t, "mod.jar", map[string]string{"model.json": validModelJSON})
	banPath := filepath.Join(t.TempDir(), "test.txt.ban")
	if err := os.Rename(path, banPath); err != nil {
		t.Fatal(err)
	}
	meta := AnalyzeYSMModel(banPath)
	if !meta.HasError {
		t.Error(".txt.ban 应报错")
	}
}

func TestAnalyzeYSMModel_UnsupportedExt(t *testing.T) {
	path := testutil.WriteZipFile(t, "mod.jar", map[string]string{"model.json": validModelJSON})
	txtPath := filepath.Join(t.TempDir(), "test.txt")
	if err := os.Rename(path, txtPath); err != nil {
		t.Fatal(err)
	}
	meta := AnalyzeYSMModel(txtPath)
	if !meta.HasError {
		t.Error(".txt 应报错")
	}
}

func TestAnalyzeYSMModel_NotZip(t *testing.T) {
	bad := filepath.Join(t.TempDir(), "bad.ysm")
	if err := os.WriteFile(bad, []byte("notzip"), 0644); err != nil {
		t.Fatal(err)
	}
	meta := AnalyzeYSMModel(bad)
	if !meta.HasError {
		t.Error("非 zip 文件应报错")
	}
}

func TestAnalyzeYSMModel_NoModelJSON(t *testing.T) {
	path := testutil.WriteZipFile(t, "mod.jar", map[string]string{"other.txt": "data"})
	ysmPath := filepath.Join(t.TempDir(), "empty.ysm")
	if err := os.Rename(path, ysmPath); err != nil {
		t.Fatal(err)
	}
	meta := AnalyzeYSMModel(ysmPath)
	if !meta.HasError {
		t.Error("无 model.json 应报错")
	}
}

func TestAnalyzeYSMModel_InvalidJSON(t *testing.T) {
	path := testutil.WriteZipFile(t, "mod.jar", map[string]string{"model.json": "{not valid json}"})
	ysmPath := filepath.Join(t.TempDir(), "badjson.ysm")
	if err := os.Rename(path, ysmPath); err != nil {
		t.Fatal(err)
	}
	meta := AnalyzeYSMModel(ysmPath)
	if !meta.HasError {
		t.Error("非法 JSON 应报错")
	}
}

func TestAnalyzeYSMModel_TexturesAsObject(t *testing.T) {
	modelJSON := `{
		"name": "ObjTex",
		"textures": {"tex1":"tex1.png","tex2":"tex2.png"}
	}`
	path := testutil.WriteZipFile(t, "mod.jar", map[string]string{"model.json": modelJSON})
	ysmPath := filepath.Join(t.TempDir(), "objtex.ysm")
	if err := os.Rename(path, ysmPath); err != nil {
		t.Fatal(err)
	}
	meta := AnalyzeYSMModel(ysmPath)
	if meta.Textures != 2 {
		t.Errorf("Textures = %d, 期望 2（对象中的键数）", meta.Textures)
	}
}

func TestAnalyzeYSMModel_NoModelField(t *testing.T) {
	modelJSON := `{"name":"NoModel","bones":[]}`
	path := testutil.WriteZipFile(t, "mod.jar", map[string]string{"model.json": modelJSON})
	ysmPath := filepath.Join(t.TempDir(), "nomodel.ysm")
	if err := os.Rename(path, ysmPath); err != nil {
		t.Fatal(err)
	}
	meta := AnalyzeYSMModel(ysmPath)
	if meta.HasError {
		t.Errorf("无 model 字段不应报错: %s", meta.ErrorMsg)
	}
	if meta.Vertices != 0 || meta.Faces != 0 {
		t.Errorf("无 model 字段时 Vertices/Faces 应为 0, 得到 %d/%d", meta.Vertices, meta.Faces)
	}
}

// ADR-095：maid-model（车万女仆）mod 内容检测——读 mods.toml 的 modId/displayName，
// 非文件名关键词匹配（ModMeta 驱动）
const tlmModToml = `modLoader="javafml"
[[mods]]
modId="touhou_little_maid"
displayName="Touhou Little Maid"
version="1.0.0"
`

func TestIsModJar_TLM(t *testing.T) {
	jar := testutil.WriteZipFile(t, "mod.jar", map[string]string{"META-INF/mods.toml": tlmModToml})
	if !IsModJar(jar, "touhou_little_maid", "Touhou Little Maid") {
		t.Fatal("含 touhou_little_maid 的 jar 应识别为车万女仆")
	}
	// 非车万女仆 mod → false
	jar2 := testutil.WriteZipFile(t, "mod.jar", map[string]string{"META-INF/mods.toml": ysmModToml})
	if IsModJar(jar2, "touhou_little_maid", "Touhou Little Maid") {
		t.Fatal("非车万女仆 jar 不应识别")
	}
}

func TestHasModInDir_MaidModel(t *testing.T) {
	modsDir := t.TempDir()
	// 文件名不含 touhou 但内容匹配 → 应识别（不靠文件名）
	jar := testutil.WriteZipFile(t, "random-name.jar", map[string]string{"META-INF/mods.toml": tlmModToml})
	_ = os.Rename(jar, filepath.Join(modsDir, "random-name.jar"))
	if !HasModInDir(modsDir, "maid-model") {
		t.Fatal("内容匹配 touhou_little_maid 应识别（不靠文件名）")
	}
	// 清空 mods 目录 → false
	if err := os.RemoveAll(modsDir); err != nil {
		t.Fatal(err)
	}
	empty := t.TempDir()
	if HasModInDir(empty, "maid-model") {
		t.Fatal("无 mod 时 maid-model 应返回 false")
	}
}
