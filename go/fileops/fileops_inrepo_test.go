package fileops

// ===== inRepo（2026-10-16 锐评 P6 收口）回归锁 =====
// inRepo 是本次提交把 Move/Copy/Delete 三处手写 `filepath.Rel + ".."` 收敛后的**单点**仓库
// 包含判定。改动最重、风险最高的一处，存量 Move/Copy/Delete 集成测试只兜端到端，不兜
// 本单点的判据边界——本文件直接喂 inRepo / checkMoveWithinRoot / DeleteModelFile，锁住：
//   1. path==root：allowRoot=false 拒、allowRoot=true 放行（子代理锐评「最值得补的」）
//   2. 仓库外路径拒绝且错误消息由调用方注入（保持既有断言原文）
//   3. root=="" 早退（既有契约：root 空跳过守卫，见 fileops_test.go 显式 root=="" 用例）
//   4. 大小写形态不同的仓库内路径：Windows 放行、Linux 拒绝（路径判据的平台语义）
// 判定不触碰磁盘（IsInside/RelInside 纯词法），无需真实文件。

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// inRepoRoot 造一个词法仓库根（不落地），root 与 child 均相对 t.TempDir()。
func inRepoRoot(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	return filepath.Join(dir, "Repo")
}

func TestInRepo_PathEqualsRoot(t *testing.T) {
	root := inRepoRoot(t)
	msg := "源文件必须在仓库内"

	// allowRoot=false：path==root 无意义，必须拒（Move 源=root、Delete 单文件=root）。
	if err := inRepo(root, root, msg, false); err == nil {
		t.Fatalf("allowRoot=false 时应拒绝 path==root, 得到 nil")
	} else if err.Error() != msg+": "+root {
		t.Fatalf("错误文案不符, got=%q want=%q", err.Error(), msg+": "+root)
	}

	// allowRoot=true：path==root 合法（Copy 源/目标=root、Move 目标=root）。
	if err := inRepo(root, root, msg, true); err != nil {
		t.Fatalf("allowRoot=true 时应放行 path==root, 得到 %v", err)
	}
}

func TestInRepo_OutsideRootRejectsWithInjectedMsg(t *testing.T) {
	root := inRepoRoot(t)
	outside := filepath.Join(t.TempDir(), "outside", "x.ysm")
	msg := "拒绝删除仓库外路径"

	// 错误消息由调用方注入，断言原文（fileops_move_safety_test.go 同款）——防收敛后文案漂移。
	err := inRepo(root, outside, msg, false)
	if err == nil {
		t.Fatalf("仓库外路径应被拒绝, 得到 nil")
	}
	if err.Error() != msg+": "+outside {
		t.Fatalf("错误文案不符, got=%q want=%q", err.Error(), msg+": "+outside)
	}
}

// TestInRepo_EmptyRootEarlyReturnPreserved：root=="" 是**调用点**既有契约
// （checkMoveWithinRoot/CopyModelFile/DeleteModelFile 均先 `if root == ""` 早退，
// 不落进 inRepo）——收敛后必须保持，否则 fileops_test.go 显式 root=="" 期望成功的用例会红。
// inRepo 自身不早退（IsInside 对空 root 报 ErrEmptyBase），故此处只验证调用点早退。
func TestInRepo_EmptyRootEarlyReturnPreserved(t *testing.T) {
	root := ""
	if err := checkMoveWithinRoot(root, "a.ysm", "sub"); err != nil {
		t.Fatalf(`root=="" 时 checkMoveWithinRoot 应早退放行, 得到 %v`, err)
	}
}

func TestInRepo_ChildInsideRoot(t *testing.T) {
	root := inRepoRoot(t)
	child := filepath.Join(root, "sub", "a.ysm")

	// allowRoot=false 仅拒绝 root 自身，root 内子路径必须放行。
	if err := inRepo(root, child, "源文件必须在仓库内", false); err != nil {
		t.Fatalf("仓库内子路径应放行, 得到 %v", err)
	}
	if err := inRepo(root, child, "源文件必须在仓库内", true); err != nil {
		t.Fatalf("仓库内子路径应放行(allowRoot=true), 得到 %v", err)
	}
}

func TestInRepo_CaseInsensitiveOnWindows(t *testing.T) {
	// paths.IsInside 在大小写形态不同的仓库内路径上：Windows 大小写不敏感 → 放行；
	// Linux 大小写敏感（../repo/sub 真越权）→ 拒绝。这是原手写 filepath.Rel 在 Windows
	// 上逐字节比大小写会误判越权的收口点（P6 核心收益），按平台语义各自断言。
	root := inRepoRoot(t)
	rootLower := root[:len(root)-len("Repo")] + "repo"
	candidate := filepath.Join(rootLower, "sub", "a.ysm")

	if runtime.GOOS == "windows" {
		if err := inRepo(root, candidate, "源文件必须在仓库内", false); err != nil {
			t.Fatalf("Windows 下大小写形态不同的仓库内路径应放行, 得到 %v", err)
		}
	} else {
		if err := inRepo(root, candidate, "源文件必须在仓库内", false); err == nil {
			t.Fatal("Linux 下大小写形态不同的路径应视为越权拒绝, 得到 nil")
		}
	}
}

func TestDeleteModelFile_EmptyRootEarlyReturnPreserved(t *testing.T) {
	// DeleteModelFile 的 root=="" 早退（fileops_test.go 显式用例锁定）。
	// 非 ysm 分支走 inRepo(root==""...) 也应早退放行。
	dir := t.TempDir()
	file := filepath.Join(dir, "x.ysm")
	if err := os.WriteFile(file, []byte("data"), 0o644); err != nil {
		t.Fatalf("写测试文件失败: %v", err)
	}
	// root=="" 时守卫 `if root != ""` 整体跳过（文件会被正常删除），此处仅验证
	// 收敛到 inRepo 后不因 root 空而报错——若 inRepo 被误改成立即 fail 就暴露。
	if err := DeleteModelFile("", file); err != nil {
		t.Fatalf(`root=="" 时 DeleteModelFile 应早退不报错, 得到 %v`, err)
	}
}
