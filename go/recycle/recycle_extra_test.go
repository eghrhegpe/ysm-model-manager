// ===== go/recycle 包级函数单测 =====
package recycle

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// ====== 包级函数 ======

func TestPackageLevelMoveEx(t *testing.T) {
	dir := t.TempDir()
	src := testutil.CreateTestFile(t, dir, "test.ysm", "content")
	// 使用 TrashManager 方法（包级 MoveEx 已删除，R26 P4-1）
	tm := New(dir)
	res := tm.MoveEx(src)
	if res.Action != "recycled" {
		t.Fatalf("MoveEx action = %s, 期望 recycled", res.Action)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("源文件应已被删除")
	}
}

func TestPackageLevelList(t *testing.T) {
	dir := t.TempDir()
	src := testutil.CreateTestFile(t, dir, "test.ysm", "content")
	if err := Move(src, dir); err != nil {
		t.Fatal(err)
	}
	tm := New(dir)
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("期望 1 个条目, 得到 %d", len(entries))
	}
	if entries[0].Name != "test.ysm" {
		t.Errorf("Name = %q, 期望 test.ysm", entries[0].Name)
	}
}

func TestPackageLevelRestore(t *testing.T) {
	dir := t.TempDir()
	src := testutil.CreateTestFile(t, dir, "restore.ysm", "content")
	if err := Move(src, dir); err != nil {
		t.Fatal(err)
	}
	tm := New(dir)
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("回收站应有 1 个文件")
	}
	if err := tm.Restore(entries[0].Path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(src); os.IsNotExist(err) {
		t.Error("恢复后源文件应存在")
	}
}

func TestPackageLevelDelete(t *testing.T) {
	dir := t.TempDir()
	src := testutil.CreateTestFile(t, dir, "delete.ysm", "content")
	if err := Move(src, dir); err != nil {
		t.Fatal(err)
	}
	tm := New(dir)
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

func TestPackageLevelEmpty(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "a.ysm", "a")
	testutil.CreateTestFile(t, dir, "b.ysm", "b")
	Move(filepath.Join(dir, "a.ysm"), dir)
	Move(filepath.Join(dir, "b.ysm"), dir)

	tm := New(dir)
	count, err := tm.Empty()
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("期望清空 2 个文件, 得到 %d", count)
	}
	if len(tm.List()) != 0 {
		t.Error("清空后回收站应为空")
	}
}

// ====== copyFile ======

func TestCopyFile_Success(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.ysm")
	content := []byte("copy test data")
	if err := os.WriteFile(src, content, 0644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "sub", "dst.ysm")
	if err := copyFile(src, dst); err != nil {
		t.Fatalf("copyFile 失败: %v", err)
	}
	readBack, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(readBack) != string(content) {
		t.Errorf("内容不一致: 期望 %q, 得到 %q", string(content), string(readBack))
	}
}

func TestCopyFile_SrcMissing(t *testing.T) {
	err := copyFile("/nonexistent/path.ysm", "/tmp/dst.ysm")
	if err == nil {
		t.Fatal("源文件不存在应报错")
	}
}

func TestCopyFile_DstDirCreate(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.ysm")
	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	// 目标目录不存在，应自动创建
	dst := filepath.Join(dir, "a", "b", "dst.ysm")
	if err := copyFile(src, dst); err != nil {
		t.Fatalf("copyFile 自动创建目录失败: %v", err)
	}
	if _, err := os.Stat(dst); err != nil {
		t.Fatal("目标文件应存在")
	}
}
