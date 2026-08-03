package recycle

import (
	"os"
	"path/filepath"
	"testing"
)

func createTestFile(t *testing.T, dir, name, content string) string {
t.Helper()
p := filepath.Join(dir, name)
if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
t.Fatal(err)
}
if err := os.WriteFile(p, []byte(content), 0644); err != nil {
t.Fatal(err)
}
return p
}

func TestNew(t *testing.T) {
tm := New("/tmp/testroot")
if tm.RecycleDir() != filepath.Join("/tmp/testroot", ".recycle") {
t.Errorf("unexpected recycle dir: %s", tm.RecycleDir())
}
}

func TestMoveAndRestore(t *testing.T) {
dir := t.TempDir()
tm := New(dir)

src := createTestFile(t, dir, "test.ysm", "test content")
// 移到回收站
if err := tm.Move(src); err != nil {
t.Fatal(err)
}
if _, err := os.Stat(src); !os.IsNotExist(err) {
t.Error("源文件应该已被删除")
}

// 列出回收站
entries := tm.List()
if len(entries) != 1 {
t.Fatalf("回收站应有 1 个文件，得到 %d", len(entries))
}

// 恢复
if err := tm.Restore(entries[0].Path); err != nil {
t.Fatal(err)
}
if _, err := os.Stat(src); os.IsNotExist(err) {
t.Error("恢复后源文件应存在")
}
}

func TestDelete(t *testing.T) {
dir := t.TempDir()
tm := New(dir)

src := createTestFile(t, dir, "test.ysm", "delete me")
if err := tm.Move(src); err != nil {
t.Fatal(err)
}
entries := tm.List()
if len(entries) != 1 {
t.Fatalf("回收站应有 1 个文件")
}
if err := tm.Delete(entries[0].Path); err != nil {
t.Fatal(err)
}
if len(tm.List()) != 0 {
t.Error("删除后回收站应为空")
}
}

func TestEmpty(t *testing.T) {
dir := t.TempDir()
tm := New(dir)

createTestFile(t, dir, "a.ysm", "a")
createTestFile(t, dir, "b.ysm", "b")
tm.Move(filepath.Join(dir, "a.ysm"))
tm.Move(filepath.Join(dir, "b.ysm"))

count, err := tm.Empty()
if err != nil {
t.Fatal(err)
}
if count != 2 {
t.Errorf("应清空 2 个文件，得到 %d", count)
}
if len(tm.List()) != 0 {
t.Error("清空后回收站应为空")
}
}

func TestEmptyWithSubdir(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	// 创建含子目录的文件结构：子目录/subfile.ysm
	subDir := filepath.Join(dir, "subfolder")
	createTestFile(t, subDir, "nested.ysm", "nested content")
	tm.Move(filepath.Join(dir, "subfolder", "nested.ysm"))
	// 回收站中应有子目录结构
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("回收站应有 1 个文件，得到 %d", len(entries))
	}

	count, err := tm.Empty()
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("应清空 1 个文件，得到 %d", count)
	}
	if len(tm.List()) != 0 {
		t.Error("清空后回收站应为空（含子目录场景）")
	}
}

// 陷阱 #8：硬链接（nlink>1）→ 直接删除，不进回收站
func TestMoveHardLink(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	src := createTestFile(t, dir, "link.ysm", "hardlink content")
	link2 := filepath.Join(dir, "link2.ysm")
	if err := os.Link(src, link2); err != nil {
		t.Skipf("os.Link 不可用: %v", err)
	}
	res := tm.MoveEx(src)
	if res.Action != "deleted_link" {
		t.Fatalf("硬链接应直接删除，got %s (%s)", res.Action, res.Reason)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("硬链接源应已删除")
	}
	// 另一个链接的数据必须还在（直接删除只断一个链接）
	if _, err := os.Stat(link2); err != nil {
		t.Error("硬链接另一份应保留")
	}
	if len(tm.List()) != 0 {
		t.Error("硬链接不应进回收站")
	}
}

// 陷阱 #8：符号链接 → 直接删除，目标文件不受影响
func TestMoveSymlink(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	target := createTestFile(t, dir, "target.ysm", "target content")
	src := filepath.Join(dir, "sym.ysm")
	if err := os.Symlink(target, src); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	res := tm.MoveEx(src)
	if res.Action != "deleted_link" {
		t.Fatalf("符号链接应直接删除，got %s", res.Action)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("符号链接应已删除")
	}
	if _, err := os.Stat(target); err != nil {
		t.Error("符号链接目标不应受影响")
	}
}

// 同名文件再次回收 → (1) 后缀
func TestMoveDuplicateName(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	src := createTestFile(t, dir, "dup.ysm", "first")
	if err := tm.Move(src); err != nil {
		t.Fatal(err)
	}
	src2 := createTestFile(t, dir, "dup.ysm", "second")
	if err := tm.Move(src2); err != nil {
		t.Fatal(err)
	}
	entries := tm.List()
	if len(entries) != 2 {
		t.Fatalf("回收站应有 2 个文件，得到 %d", len(entries))
	}
	found := false
	for _, e := range entries {
		if e.Name == "dup(1).ysm" {
			found = true
		}
	}
	if !found {
		t.Error("重名文件应带 (1) 后缀")
	}
}

// 恢复时目标已存在 → 生成 keep(1).ysm
func TestRestoreConflict(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)

	src := createTestFile(t, dir, "keep.ysm", "orig")
	if err := tm.Move(src); err != nil {
		t.Fatal(err)
	}
	createTestFile(t, dir, "keep.ysm", "new") // 恢复前在源位置重建
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("回收站应有 1 个文件")
	}
	if err := tm.Restore(entries[0].Path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "keep(1).ysm")); err != nil {
		t.Error("冲突恢复应生成 keep(1).ysm")
	}
}
