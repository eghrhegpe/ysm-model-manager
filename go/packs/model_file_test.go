// ===== IsTypeModelFile 行为护栏 =====
// 归属（ADR-144）：原 go/types/types_extra_test.go，随 IsTypeModelFile 下沉到 go/packs。
package packs_test

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/packs"
)

// TestIsTypeModelFile_EmptyExts 空扩展集类型应返回 false（与旧 isModelFile
// 严格语义一致；extMatch 的空集放行分支在 BuildSyncItems 不会触发——未知
// 类型早被 SubDirMap 空拦截）。
func TestIsTypeModelFile_EmptyExts(t *testing.T) {
	if packs.IsTypeModelFile("x.xyz", "no-such-type") {
		t.Error("空扩展集类型不应放行任何文件")
	}
	if !packs.IsTypeModelFile("m.ysm", "ysm") {
		t.Error("ysm 类型应放行 .ysm")
	}
}

// TestIsTypeModelFile_YsmJsonScopedByType ysm.json 仅对扩展集含 .json 的类型
// （ysm）放行；resourcepack/shaderpack 扩展集只有 .zip，整合包目录散落的
// ysm.json 不得作为其独立同步条目（P3 修复：整合包推送/拉取列表被 ysm.json 刷屏）。
func TestIsTypeModelFile_YsmJsonScopedByType(t *testing.T) {
	if !packs.IsTypeModelFile("ysm.json", "ysm") {
		t.Error("ysm 类型（扩展集含 .json）应放行 ysm.json")
	}
	if !packs.IsTypeModelFile("YSM.JSON", "ysm") {
		t.Error("ysm 类型对大小写变体 ysm.json 应放行")
	}
	if packs.IsTypeModelFile("ysm.json", "resourcepack") {
		t.Error("resourcepack（扩展集仅 .zip）不应放行 ysm.json")
	}
	if packs.IsTypeModelFile("ysm.json", "shaderpack") {
		t.Error("shaderpack（扩展集仅 .zip）不应放行 ysm.json")
	}
	if packs.IsTypeModelFile("ysm.json", "EntityPlayer") {
		t.Error("EntityPlayer（扩展集无 .json）不应放行 ysm.json")
	}
	// 非 ysm.json 的其余 .json 仍一律不放行（ADR-038 D2 不变）
	if packs.IsTypeModelFile("geometry.json", "ysm") {
		t.Error("geometry.json 不应作为 ysm 模型文件")
	}
}

// ===== IsTypeModelFile 对 zipentry 类型 .zip 内含校验（ADR 收敛：同步链路
// 不得把纯打包物/坏包当模型搬运）=====

// writeZip 造一个含指定条目的 zip 文件，返回路径。
func writeZip(t *testing.T, entries map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "model.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
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
	return p
}

// TestIsTypeModelFile_ZipEntry_VmdInsideIsModel 内含 .vmd 的 zip 应识别为
// DefaultAnim 模型（保住合法用例：内装 vmd 动画的压缩包）。
func TestIsTypeModelFile_ZipEntry_VmdInsideIsModel(t *testing.T) {
	zipPath := writeZip(t, map[string]string{"motion.vmd": "vmd", "readme.txt": "x"})
	if !packs.IsTypeModelFile(zipPath, "DefaultAnim") {
		t.Fatalf("内含 .vmd 的 zip 应识别为 DefaultAnim 模型: %s", zipPath)
	}
}

// TestIsTypeModelFile_ZipEntry_NoMatchNotModel 内不含 .vmd 的 zip（纯打包物）
// 不得识别为 DefaultAnim 模型——否则同步推送/拉取会把它当顶层模型搬运。
func TestIsTypeModelFile_ZipEntry_NoMatchNotModel(t *testing.T) {
	zipPath := writeZip(t, map[string]string{"data.bin": "x", "readme.txt": "y"})
	if packs.IsTypeModelFile(zipPath, "DefaultAnim") {
		t.Fatalf("内不含 .vmd 的 zip 不得识别为 DefaultAnim 模型: %s", zipPath)
	}
}

// TestIsTypeModelFile_ZipEntry_BadZipNotModel 损坏 zip（非合法 zip 结构）不得
// 识别为模型——坏包在同步列表里亮起推送按钮正是本次故障来源。
func TestIsTypeModelFile_ZipEntry_BadZipNotModel(t *testing.T) {
	bad := filepath.Join(t.TempDir(), "broken.zip")
	if err := os.WriteFile(bad, []byte("this is not a zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	if packs.IsTypeModelFile(bad, "DefaultAnim") {
		t.Fatalf("损坏 zip 不得识别为 DefaultAnim 模型: %s", bad)
	}
}

// TestIsTypeModelFile_ZipEntry_NonZipEntryTypeUnaffected resourcepack（detector
// != zipentry）仍按扩展名直判 .zip 为资源包实体——本改动不影响非 zipentry 类型。
func TestIsTypeModelFile_ZipEntry_NonZipEntryTypeUnaffected(t *testing.T) {
	p := filepath.Join(t.TempDir(), "pack.zip")
	if err := os.WriteFile(p, []byte("zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !packs.IsTypeModelFile(p, "resourcepack") {
		t.Fatalf("resourcepack 的 .zip 仍应直判为资源包（detector != zipentry 不受影响）")
	}
}

// TestIsTypeModelFile_ZipEntry_BareNameFails code review P1（conf 0.85→确认）：
// 生产调用方曾传裸文件名（instance/sync_dirlevel/sync_relink）——zip 分支
// zip.OpenReader(裸名) 相对 CWD 失败 → 返回 false——锁契约：zipentry 类型必须
// 传完整路径才能开 zip 内含校验（调用方已全部改传完整路径）。
func TestIsTypeModelFile_ZipEntry_BareNameFails(t *testing.T) {
	if packs.IsTypeModelFile("motion.zip", "DefaultAnim") {
		t.Fatalf("裸文件名不应被识别为模型（zip 分支需完整路径开文件）: motion.zip")
	}
}
