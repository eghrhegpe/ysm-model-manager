// ===== ToggleModelEnable 守卫与错误分支补测 =====
// 覆盖：空参数、仓库外路径、根目录名以 .ban 结尾时的整组拒绝、
// 目录级 .ban 下文件自身带 .ban（旧状态残留）的双重还原与目标已存在分支、
// 无 root 时的 ysm.json 目录提升、禁用/启用目标已存在分支。
// rename 系统调用失败分支（目标目录被占用等）在 Windows 上 stdlib 无法稳定
// 构造，记为不可测。
package fileops

import (
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// 空路径应报错
func TestToggleModelEnable_EmptyPath(t *testing.T) {
	if _, err := ToggleModelEnable("", ""); err == nil {
		t.Fatal("空路径应报错")
	}
}

// 仓库外路径应被拒绝（不静默改名）
func TestToggleModelEnable_OutsideRoot(t *testing.T) {
	base := t.TempDir()
	outside := filepath.Join(t.TempDir(), "x.ysm")
	if _, err := ToggleModelEnable(base, outside); err == nil {
		t.Fatal("仓库外路径应被拒绝")
	}
	if _, err := os.Stat(outside + ".ban"); err == nil {
		t.Fatal("仓库外文件不得被改名成 .ban")
	}
}

// 根目录自身名以 .ban 结尾：整组操作应被拒绝（防静默改名仓库根）
func TestToggleModelEnable_BanSuffixedRootRejected(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "mod.ban")
	if err := os.MkdirAll(root, 0755); err != nil {
		testutil.NoError(t, err)
	}
	ysmPath := filepath.Join(root, "ysm.json")
	if err := os.WriteFile(ysmPath, []byte(`{"spec":1}`), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if _, err := ToggleModelEnable(root, ysmPath); err == nil {
		t.Fatal("根目录自身 .ban 结尾时整组操作应被拒绝")
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("根目录不应被改名: %v", err)
	}
}

// 目录级 .ban 下文件自身带 .ban（旧状态残留）：先还原文件再还原父目录
func TestToggleModelEnable_DirBanWithFileBanResidue(t *testing.T) {
	base := t.TempDir()
	bannedDir := filepath.Join(base, "模型A.ban")
	if err := os.MkdirAll(bannedDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	// 目录级 .ban 内残留文件级 .ban（旧状态）
	residue := filepath.Join(bannedDir, "loose.ysm.ban")
	if err := os.WriteFile(residue, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	enabled, err := ToggleModelEnable(base, residue)
	if err != nil || !enabled {
		t.Fatalf("双重还原应 enabled=true: %v", err)
	}
	// 文件还原 + 父目录还原
	if _, err := os.Stat(filepath.Join(base, "模型A", "loose.ysm")); err != nil {
		t.Fatalf("文件应还原为 loose.ysm: %v", err)
	}
	if _, err := os.Stat(bannedDir); !os.IsNotExist(err) {
		t.Fatal("父目录 .ban 应已还原")
	}
}

// 目录级 .ban 下文件自身带 .ban，但还原目标已存在 → 报错
func TestToggleModelEnable_DirBanFileNewExists(t *testing.T) {
	base := t.TempDir()
	bannedDir := filepath.Join(base, "模型A.ban")
	if err := os.MkdirAll(bannedDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	residue := filepath.Join(bannedDir, "loose.ysm.ban")
	if err := os.WriteFile(residue, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 预置还原目标文件 → 应先命中「目标已存在」
	if err := os.WriteFile(filepath.Join(bannedDir, "loose.ysm"), []byte("y"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if _, err := ToggleModelEnable(base, residue); err == nil {
		t.Fatal("文件还原目标已存在应报错")
	}
	// 原残留与目标都应保留
	if _, err := os.Stat(residue); err != nil {
		t.Fatalf("原 .ban 残留应保留: %v", err)
	}
	if _, err := os.Stat(filepath.Join(bannedDir, "loose.ysm")); err != nil {
		t.Fatalf("目标文件应保留: %v", err)
	}
}

// 目录级 .ban 还原时父目录还原目标已存在 → 报错
func TestToggleModelEnable_DirBanDirNewExists(t *testing.T) {
	base := t.TempDir()
	bannedDir := filepath.Join(base, "模型A.ban")
	if err := os.MkdirAll(bannedDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	ysmPath := filepath.Join(bannedDir, "ysm.json")
	if err := os.WriteFile(ysmPath, []byte(`{"spec":1}`), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 预置同名原目录（未带 .ban）→ 父目录还原目标已存在
	if err := os.MkdirAll(filepath.Join(base, "模型A"), 0755); err != nil {
		testutil.NoError(t, err)
	}
	if _, err := ToggleModelEnable(base, ysmPath); err == nil {
		t.Fatal("父目录还原目标已存在应报错")
	}
	if _, err := os.Stat(bannedDir); err != nil {
		t.Fatalf(".ban 目录应保留: %v", err)
	}
}

// 无 root（空字符串）：ysm.json 仍应提升为父目录级 .disabled（整组禁用）
func TestToggleModelEnable_YsmJsonLiftWithoutRoot(t *testing.T) {
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	enabled, err := ToggleModelEnable("", filepath.Join(modelDir, "ysm.json"))
	if err != nil || enabled {
		t.Fatalf("禁用应 enabled=false: %v", err)
	}
	if _, err := os.Stat(modelDir + ".disabled"); err != nil {
		t.Fatalf("无 root 时 ysm.json 也应整组禁用（父目录 .disabled）: %v", err)
	}
}

// 启用时还原目标已存在（.disabled 文件旁已有原文件）→ 报错
func TestToggleModelEnable_EnableTargetExists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(path, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 预置 .disabled 目标文件 → 禁用时应报错（目标已存在）
	if err := os.WriteFile(path+".disabled", []byte("y"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if _, err := ToggleModelEnable(dir, path); err == nil {
		t.Fatal("禁用目标 .disabled 已存在应报错")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("原文件应保留: %v", err)
	}
	// 清理预置的 .disabled 后，改为测试启用侧：先禁用成功，再预置还原目标 → 启用应报错
	if err := os.Remove(path + ".disabled"); err != nil {
		testutil.NoError(t, err)
	}
	if _, err := ToggleModelEnable(dir, path); err != nil {
		t.Fatalf("禁用应成功: %v", err)
	}
	if err := os.WriteFile(path, []byte("z"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if _, err := ToggleModelEnable(dir, path+".disabled"); err == nil {
		t.Fatal("启用目标已存在应报错")
	}
	if _, err := os.Stat(path + ".disabled"); err != nil {
		t.Fatalf(".disabled 文件应保留: %v", err)
	}
}
