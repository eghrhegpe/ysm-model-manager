// MoveCopyTarget / RenameTarget 同源测试（2026-10-10 接线前置）。
// 立论：接线方用 plan 算「标签键迁移的 from/to」，其正确性唯一判据 = plan 算出的
// to **恰好等于真实搬迁后文件的落点**。所以本文件不用 fixture 字符串对比，而是
// 真实跑 Move/Copy/Rename 再 Lstat(plan.to)——同源即命中，漂移即空。
// 覆盖 Copy/Move 提升判定刻意不对称的场景（根级 ysm.json：Move 不提升走单文件、
// Copy 提升为整夹）——plan 必须忠实复刻各自行为，不是「统一」它。
package fileops

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRenameTarget_MatchesActualDest(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	oldPath := filepath.Join(base, "a.ysm")
	writeFile(t, oldPath)
	got := RenameTarget(oldPath, "b.ysm")
	if err := RenameFile(oldPath, "b.ysm"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(got); err != nil {
		t.Errorf("RenameTarget 算出的落点应存在（同源判据）: %v", err)
	}
	// 退化输入：空串 → 空串（绑定层据此跳过迁移）
	if RenameTarget("", "b.ysm") != "" || RenameTarget(oldPath, "") != "" {
		t.Error("空参 RenameTarget 应返回空串")
	}
	// trim 口径与 opPrologue 一致
	if RenameTarget(filepath.Join(base, "c.ysm"), " d.ysm ") != filepath.Join(base, "d.ysm") {
		t.Error("RenameTarget 应 trim 后拼接")
	}
}

func TestMoveCopyTarget_DirRenameLiftsToFolder(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	// 模型夹：repo/modelA/ysm.json + sub/face.png
	srcJSON := filepath.Join(base, "modelA", "ysm.json")
	writeFile(t, srcJSON)
	writeFile(t, filepath.Join(base, "modelA", "sub", "face.png"))
	dstParent := filepath.Join(base, "nested")

	from, to, ok := MoveCopyTarget(base, srcJSON, dstParent, false)
	if !ok {
		t.Fatal("MoveCopyTarget 应 ok")
	}
	// move：ysm.json 提升为整夹 → from=父夹、to=nested/modelA
	if from != filepath.Join(base, "modelA") || to != filepath.Join(dstParent, "modelA") {
		t.Errorf("提升后 from/to 错: %q → %q", from, to)
	}
	if err := MoveModelFile(base, srcJSON, dstParent); err != nil {
		t.Fatalf("MoveModelFile: %v", err)
	}
	// 同源判据：plan 的 to 恰好是搬迁后 ysm.json 所在目录
	if _, err := os.Lstat(filepath.Join(to, "ysm.json")); err != nil {
		t.Errorf("文件实际落点应在 plan.to 下（漂移即标签迁错键）: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(to, "sub", "face.png")); err != nil {
		t.Errorf("子树应整体在 plan.to 下: %v", err)
	}
}

func TestMoveCopyTarget_RootLevelYsmJsonMoveNoLift(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	srcJSON := filepath.Join(base, "ysm.json") // 根级清单：Move 不提升（防搬整仓）
	writeFile(t, srcJSON)
	dstDir := filepath.Join(base, "sub")

	from, to, ok := MoveCopyTarget(base, srcJSON, dstDir, false)
	if !ok {
		t.Fatal("ok")
	}
	if from != srcJSON || to != filepath.Join(dstDir, "ysm.json") {
		t.Errorf("根级 ysm.json move 应走单文件: %q → %q", from, to)
	}
	if err := MoveModelFile(base, srcJSON, dstDir); err != nil {
		t.Fatalf("MoveModelFile: %v", err)
	}
	if _, err := os.Lstat(to); err != nil {
		t.Errorf("单文件落点应等于 plan.to: %v", err)
	}
}

func TestMoveCopyTarget_RootLevelYsmJsonCopyLiftsFolder(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	srcJSON := filepath.Join(base, "ysm.json") // 根级清单：Copy 刻意提升（不对称既有行为）
	writeFile(t, srcJSON)
	dstDir := filepath.Join(base, "sub")

	from, to, ok := MoveCopyTarget(base, srcJSON, dstDir, true)
	if !ok {
		t.Fatal("ok")
	}
	if from != base || to != filepath.Join(dstDir, filepath.Base(base)) {
		t.Errorf("根级 ysm.json copy 应提升为整夹: %q → %q", from, to)
	}
}

func TestMoveCopyTarget_PlainFile(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	src := filepath.Join(base, "m.pmx")
	writeFile(t, src)
	dstDir := filepath.Join(base, "out")

	from, to, ok := MoveCopyTarget(base, src, dstDir, false)
	if !ok || from != src || to != filepath.Join(dstDir, "m.pmx") {
		t.Fatalf("单文件 plan 错: %q → %q ok=%v", from, to, ok)
	}
	if err := MoveModelFile(base, src, dstDir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(to); err != nil {
		t.Errorf("落点应等于 plan.to: %v", err)
	}
	// 空参 → ok=false
	if _, _, ok := MoveCopyTarget(base, "", dstDir, false); ok {
		t.Error("空 src 应 ok=false")
	}
}
