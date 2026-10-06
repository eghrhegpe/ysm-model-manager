// ===== 回收站链路「文件系统终态」特征测试 =====
//
// 既有测试多经 List() 的回读条目名间接断言，或只断言「文件存在」；
// 本文件直接盯盘上终态与内容字节：
//   - Move 后源不再存在、且 .recycle 内按 rel 逐层镜像出落点（含冲突后缀命名）；
//   - Move → Restore 往返后目录结构逐层还原、每个文件内容逐字节一致、回收站不留副本；
//   - RemoveRepoDuplicates 的保留/删除判据、「可恢复」落点与幂等性。
package recycle

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// TestMove_PreservesRecycleTreeLayout 钉「移入后」终态：源不再存在，
// 且 .recycle 内按 src 相对资源根的 rel 逐层镜像出落点（同名同层级），
// 内容逐字节一致；同 rel 再次移入时冲突后缀落在同一层目录内。
func TestMove_PreservesRecycleTreeLayout(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	sub := filepath.Join(dir, "sub", "nested")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(sub, "deep.ysm")
	if err := os.WriteFile(src, []byte("deep content"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := tm.Move(src); err != nil {
		t.Fatalf("移入回收站失败: %v", err)
	}
	// 终态 1：源不再存在
	if _, err := os.Lstat(src); !os.IsNotExist(err) {
		t.Fatalf("移入后源应不再存在: %v", err)
	}
	// 终态 2：.recycle/sub/nested/deep.ysm 逐层镜像，内容一致
	landed := filepath.Join(tm.RecycleDir(), "sub", "nested", "deep.ysm")
	got, err := os.ReadFile(landed)
	if err != nil {
		t.Fatalf("回收站内应按 rel 镜像出落点 %s: %v", landed, err)
	}
	if string(got) != "deep content" {
		t.Fatalf("回收站内内容 = %q, 期望 deep content", string(got))
	}

	// 终态 3：同 rel 再次移入 → 冲突后缀落在同层目录内
	if err := os.WriteFile(src, []byte("second"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := tm.Move(src); err != nil {
		t.Fatalf("同名再次移入失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(tm.RecycleDir(), "sub", "nested", "deep(1).ysm")); err != nil {
		t.Fatalf("重名落点应在同层生成 deep(1).ysm: %v", err)
	}
	// 原落点不应被覆盖（数据不得丢）
	if got, err := os.ReadFile(landed); err != nil || string(got) != "deep content" {
		t.Fatalf("原落点不应被覆盖: %q %v", string(got), err)
	}
}

// TestRestore_RoundTrip_ByteIdentical 钉「恢复往返」终态：整棵目录树 Move → Restore 后
// 目录结构逐层还原、每个文件内容逐字节一致，且回收站侧不留副本（往返是搬运而非复制）。
// 此前同型测试（TestList_FolderModelGrouped / TestRestore_CrossDeviceDirFallback）
// 只断言文件「存在」，内容是否被写坏、多字节文件名是否还原无人看。
func TestRestore_RoundTrip_ByteIdentical(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	modelDir := filepath.Join(dir, "模型A")
	files := map[string][]byte{
		"ysm.json":            []byte(`{"spec":1,"name":"往返"}`),
		"model.pmx":           bytes.Repeat([]byte{0x00, 0xFF, 0x7F}, 300), // 含 NUL/高位字节
		"textures/skin.png":   []byte("PNG-bytes-not-really"),
		"textures/deep/a.bin": {0x01, 0x02, 0x03},
		"anim/中文名.animation":  []byte("多字节内容\n第二行\n"),
	}
	for rel, content := range files {
		full := filepath.Join(modelDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, content, 0644); err != nil {
			t.Fatal(err)
		}
	}

	if err := tm.Move(modelDir); err != nil {
		t.Fatalf("整组移入回收站失败: %v", err)
	}
	if _, err := os.Lstat(modelDir); !os.IsNotExist(err) {
		t.Fatalf("移入后源目录应不再存在: %v", err)
	}
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("应有 1 个整组条目, 得到 %d", len(entries))
	}

	if err := tm.Restore(entries[0].Path); err != nil {
		t.Fatalf("整组恢复失败: %v", err)
	}
	// 结构逐层还原 + 内容逐字节一致
	for rel, want := range files {
		full := filepath.Join(modelDir, filepath.FromSlash(rel))
		got, err := os.ReadFile(full)
		if err != nil {
			t.Errorf("%s 未还原: %v", rel, err)
			continue
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s 内容不一致: 得到 %d 字节 %q, 期望 %d 字节 %q",
				rel, len(got), got, len(want), want)
		}
	}
	// 回收站侧不留副本
	if left := tm.List(); len(left) != 0 {
		t.Errorf("恢复后回收站应为空, 得到 %d 条", len(left))
	}
	if _, err := os.Stat(filepath.Join(tm.RecycleDir(), "模型A")); !os.IsNotExist(err) {
		t.Errorf("回收站内不应残留 模型A: %v", err)
	}
}

// TestRemoveRepoDuplicates_Idempotent 钉判据与幂等性：仓库同名同内容 → 清理；
// 同名不同内容（用户自装改版）与仓库没有的文件 → 逐字节保留；
// 同输入再跑一轮 → 0 清理且文件系统不再变化。
func TestRemoveRepoDuplicates_Idempotent(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "inst")
	repoRoot := filepath.Join(base, "repo")
	recycleRoot := filepath.Join(base, "ysm")
	for _, d := range []string{dir, repoRoot, recycleRoot} {
		if err := os.MkdirAll(d, 0755); err != nil {
			t.Fatal(err)
		}
	}
	write := func(root, name, content string) string {
		t.Helper()
		p := filepath.Join(root, name)
		if err := os.WriteFile(p, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	// 应删：同名 + 同内容（仓库自带副本）
	write(repoRoot, "dup.ysm", "same-bytes")
	dup := write(dir, "dup.ysm", "same-bytes")
	// 应留：同名但内容不同（用户自装改版）
	write(repoRoot, "custom.ysm", "repo-version")
	custom := write(dir, "custom.ysm", "user-version")
	// 应留：仓库没有的文件（整合包自带资源）
	only := write(dir, "only-local.ysm", "local")

	snapshot := func() map[string]string {
		out := map[string]string{}
		for _, p := range []string{dup, custom, only} {
			if b, err := os.ReadFile(p); err == nil {
				out[p] = string(b)
			}
		}
		return out
	}

	first := RemoveRepoDuplicates(dir, repoRoot, recycleRoot, nil)
	if first != 1 {
		t.Fatalf("第一轮应清理 1 个（dup.ysm）, 得到 %d", first)
	}
	if _, err := os.Stat(dup); !os.IsNotExist(err) {
		t.Fatalf("dup.ysm 应被清理: %v", err)
	}
	if b, err := os.ReadFile(custom); err != nil || string(b) != "user-version" {
		t.Fatalf("同名不同内容应原样保留: %q %v", string(b), err)
	}
	if b, err := os.ReadFile(only); err != nil || string(b) != "local" {
		t.Fatalf("仓库没有的文件应原样保留: %q %v", string(b), err)
	}

	snap1 := snapshot()
	second := RemoveRepoDuplicates(dir, repoRoot, recycleRoot, nil)
	if second != 0 {
		t.Errorf("第二轮应清理 0 个（幂等）, 得到 %d", second)
	}
	snap2 := snapshot()
	if len(snap1) != len(snap2) {
		t.Fatalf("第二轮后文件集合应不变: %d → %d 个", len(snap1), len(snap2))
	}
	for k, v := range snap1 {
		if snap2[k] != v {
			t.Errorf("第二轮后 %s 内容应不变: %q → %q", k, v, snap2[k])
		}
	}
}

// TestRemoveRepoDuplicates_InRecycleRoot_MovesToTrash 钉「可恢复」终态：
// dir 位于 recycleRoot 解析树内时清理走「移入回收站」而非直接删——
// 文件必须能在 .recycle 内按 rel 镜像找回，内容逐字节一致。
func TestRemoveRepoDuplicates_InRecycleRoot_MovesToTrash(t *testing.T) {
	base := t.TempDir()
	recycleRoot := filepath.Join(base, "ysm")
	dir := filepath.Join(recycleRoot, "inst")
	repoRoot := filepath.Join(base, "repo")
	for _, d := range []string{dir, repoRoot} {
		if err := os.MkdirAll(d, 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("same-bytes"), 0644); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(src, []byte("same-bytes"), 0644); err != nil {
		t.Fatal(err)
	}

	if n := RemoveRepoDuplicates(dir, repoRoot, recycleRoot, nil); n != 1 {
		t.Fatalf("应清理 1 个, 得到 %d", n)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatalf("清理后源应不再存在: %v", err)
	}
	landed := filepath.Join(recycleRoot, ".recycle", "inst", "m.ysm")
	got, err := os.ReadFile(landed)
	if err != nil {
		t.Fatalf("应在回收站按 rel 找回 %s: %v", landed, err)
	}
	if string(got) != "same-bytes" {
		t.Fatalf("回收站内内容 = %q, 期望 same-bytes", string(got))
	}
}

// TestIsDedupableDir_RejectsFilesystemRoots 钉「永不整盘遍历/删除」守卫：
// 空路径 / Unix 根 / Windows 盘符根一律拒绝，普通子目录放行。
// 直接调用 isDedupableDir 而非经 RemoveRepoDuplicates——避免守卫一旦回归，
// 测试自己变成「真的去遍历盘符根」的破坏性用例。
func TestIsDedupableDir_RejectsFilesystemRoots(t *testing.T) {
	sep := string(filepath.Separator)
	rejected := []string{"", sep}
	if vol := filepath.VolumeName(t.TempDir()); vol != "" {
		rejected = append(rejected, vol+sep) // Windows 盘符根（VolumeName 无尾随分隔符）
	}
	for _, dir := range rejected {
		if isDedupableDir(dir) {
			t.Errorf("isDedupableDir(%q) 应为 false（文件系统根/空路径必须拒绝）", dir)
		}
	}
	base := t.TempDir()
	for _, dir := range []string{base, filepath.Join(base, "inst", "sub")} {
		if !isDedupableDir(dir) {
			t.Errorf("isDedupableDir(%q) 应为 true（普通子目录）", dir)
		}
	}
	// 经 RemoveRepoDuplicates 的空 dir 早退：返回 0 且不触碰仓库
	repoRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if n := RemoveRepoDuplicates("", repoRoot, "", nil); n != 0 {
		t.Errorf("空 dir 应返回 0, 得到 %d", n)
	}
}
