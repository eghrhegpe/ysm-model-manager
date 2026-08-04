// ===== go/ysm 单测（覆盖率 13.1% → 提升）=====
package ysm

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

// makeJar 构造最小 jar（zip）文件
func makeJar(t *testing.T, files map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mod.jar")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, content := range files {
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
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

const ysmModToml = `modLoader="javafml"
[[mods]]
modId="yes_steve_model"
displayName="Yes Steve Model"
version="1.0"
`

func TestIsYSMJar(t *testing.T) {
	// 含 mods.toml 且 modId=yes_steve_model → true
	jar := makeJar(t, map[string]string{"META-INF/mods.toml": ysmModToml})
	if !IsYSMJar(jar) {
		t.Fatal("含 yes_steve_model 的 jar 应识别为 YSM")
	}
	// neoforge.mods.toml 同样支持
	jarNeo := makeJar(t, map[string]string{"META-INF/neoforge.mods.toml": ysmModToml})
	if !IsYSMJar(jarNeo) {
		t.Fatal("neoforge.mods.toml 应识别")
	}
	// 非 YSM mod
	jar2 := makeJar(t, map[string]string{"META-INF/mods.toml": `[[mods]]
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

func TestHasYSMMod(t *testing.T) {
	modsDir := t.TempDir()
	jar := makeJar(t, map[string]string{"META-INF/mods.toml": ysmModToml})
	if err := os.Rename(jar, filepath.Join(modsDir, "ysm-1.0.jar")); err != nil {
		t.Fatal(err)
	}
	if !HasYSMMod(modsDir) {
		t.Fatal("含 ysm jar 的目录应识别")
	}
	// 目录不存在 → false
	if HasYSMMod(filepath.Join(t.TempDir(), "nope")) {
		t.Fatal("目录不存在应 false")
	}
	// 无 ysm jar → false
	if HasYSMMod(t.TempDir()) {
		t.Fatal("空目录应 false")
	}
	// 文件名不含关键词的 jar 不打开（快速过滤）
	other := t.TempDir()
	_ = makeJar(t, map[string]string{"META-INF/mods.toml": ysmModToml})
	_ = os.WriteFile(filepath.Join(other, "random.jar"), []byte("x"), 0644)
	if HasYSMMod(other) {
		t.Fatal("文件名不匹配不应打开检查")
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
	// mmd-skin：文件名匹配即可
	modsDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(modsDir, "mmdskin-2.0.jar"), []byte("x"), 0644)
	if !HasModInDir(modsDir, "mmd-skin") {
		t.Fatal("mmd-skin 文件名匹配应 true")
	}
	// ysm：需打开 ZIP 确认
	jar := makeJar(t, map[string]string{"META-INF/mods.toml": ysmModToml})
	if err := os.Rename(jar, filepath.Join(modsDir, "ysm-1.0.jar")); err != nil {
		t.Fatal(err)
	}
	if !HasModInDir(modsDir, "ysm") {
		t.Fatal("ysm jar 应 true")
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
	path := makeJar(t, map[string]string{"model.json": validModelJSON})
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
	path := makeJar(t, map[string]string{"model.json": validModelJSON})
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
	path := makeJar(t, map[string]string{"model.json": validModelJSON})
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
	path := makeJar(t, map[string]string{"model.json": validModelJSON})
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
	path := makeJar(t, map[string]string{"model.json": validModelJSON})
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
	path := makeJar(t, map[string]string{"other.txt": "data"})
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
	path := makeJar(t, map[string]string{"model.json": "{not valid json}"})
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
	path := makeJar(t, map[string]string{"model.json": modelJSON})
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
	path := makeJar(t, map[string]string{"model.json": modelJSON})
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
