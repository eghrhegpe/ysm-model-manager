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
	"strings"
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

// 仓库内 symlink 段指向仓库外时，启禁必须拒绝——守卫是词法版时此处会把**仓库外**
// 的真实文件改名加 .disabled（越权写）。
//
// 病灶（2026-10-15 锐评亲验）：checkToggleWithinRoot 原只用 filepath.Abs + Rel 做
// 词法包含判定，`repo/escape/victim.ysm` 的 rel = `escape\victim.ysm` 合法即放行，
// 而随后 applyDisableToggle 的 os.Rename 经 symlink 落到仓库外。
// 同族链路（toggleRootFor / recycle.prepareMoveSource）早已用解析版判定，本处是最后一处。
//
// 对照断言（防断言空转）：同一输入经**词法** filepath.Rel 判定确实放行——若哪天
// 有人把守卫退回词法版，本用例的对照段与主断言会一起揭示失败面。
// Windows 无特权创建 symlink 时自动跳过（与 go/paths|TestIsInsideResolved_SymlinkEscape 同款）。
func TestToggleModelEnable_SymlinkEscapeRejected(t *testing.T) {
	repo := t.TempDir()
	outsideDir := t.TempDir()
	victim := filepath.Join(outsideDir, "victim.ysm")
	if err := os.WriteFile(victim, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	escape := filepath.Join(repo, "escape")
	if err := os.Symlink(outsideDir, escape); err != nil {
		t.Skipf("os.Symlink 不可用（需权限/开发者模式）: %v", err)
	}

	escapedPath := filepath.Join(escape, "victim.ysm")
	// 对照：词法判定确实放行（记录病灶形态，非断言目标态）
	if rel, relErr := filepath.Rel(repo, escapedPath); relErr == nil {
		if strings.HasPrefix(rel, "..") {
			t.Fatalf("对照失效：词法 rel 不应越界，got %q", rel)
		}
	} else {
		testutil.NoError(t, relErr)
	}

	// 主断言：解析版守卫必须拒绝
	if _, err := ToggleModelEnable(repo, escapedPath); err == nil {
		t.Fatal("仓库内 symlink 指向仓库外时必须拒绝（否则经链接改名仓库外文件）")
	}
	// 终态：仓库外文件分毫未动（无 .disabled 改名痕迹）
	if _, err := os.Stat(victim); err != nil {
		t.Fatalf("仓库外原文件不得被动: %v", err)
	}
	if _, err := os.Stat(victim + ".disabled"); err == nil {
		t.Fatal("仓库外文件不得被改名成 .disabled（越权写）")
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
