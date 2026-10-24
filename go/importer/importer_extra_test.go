// ===== go/importer copyDir 单测 =====
package importer

import (
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// ====== copyDir ======

func TestCopyDir_Basic(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "copied")

	// 创建源目录结构
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("aaa"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	sub := filepath.Join(src, "sub")
	if err := os.MkdirAll(sub, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(sub, "b.txt"), []byte("bbb"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	testutil.NoError(t, copyDir(src, dst), "copyDir 失败")

	// 验证文件已复制
	data, err := os.ReadFile(filepath.Join(dst, "a.txt"))
	testutil.NoError(t, err)
	if string(data) != "aaa" {
		t.Errorf("a.txt = %q, 期望 aaa", string(data))
	}
	data, err = os.ReadFile(filepath.Join(dst, "sub", "b.txt"))
	testutil.NoError(t, err)
	if string(data) != "bbb" {
		t.Errorf("sub/b.txt = %q, 期望 bbb", string(data))
	}
}

func TestCopyDir_OverwriteExisting(t *testing.T) {
	src := t.TempDir()
	dst := t.TempDir()

	if err := os.WriteFile(filepath.Join(src, "new.txt"), []byte("new"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 在 dst 放一个同名文件
	if err := os.WriteFile(filepath.Join(dst, "new.txt"), []byte("old"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	testutil.NoError(t, copyDir(src, dst), "copyDir 覆盖失败")
	data, err := os.ReadFile(filepath.Join(dst, "new.txt"))
	testutil.NoError(t, err)
	if string(data) != "new" {
		t.Errorf("内容应被覆盖: %q, 期望 new", string(data))
	}
}

func TestCopyDir_SrcMissing(t *testing.T) {
	err := copyDir("/nonexistent/path", t.TempDir())
	testutil.NotNil(t, err, "源目录不存在应报错")
}

func TestCopyDir_EmptyDir(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "empty")
	testutil.NoError(t, copyDir(src, dst), "空目录复制失败")
	if _, err := os.Stat(dst); os.IsNotExist(err) {
		t.Error("目标目录应存在")
	}
}
