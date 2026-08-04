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
