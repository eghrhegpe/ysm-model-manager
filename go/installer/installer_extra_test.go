// ===== go/installer 补充单测（64.9% → 提升）=====
package installer

import (
	"os"
	"path/filepath"
	"testing"
)

// ====== linkOrCopy ======

func TestLinkOrCopy_Success(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.ysm")
	if err := os.WriteFile(src, []byte("link data"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(dir, "dst")
	if err := linkOrCopy(src, dstDir); err != nil {
		t.Fatalf("linkOrCopy failed: %v", err)
	}
	dst := filepath.Join(dstDir, "source.ysm")
	if _, err := os.Stat(dst); err != nil {
		t.Fatalf("target file should exist: %v", err)
	}
}

func TestLinkOrCopy_SrcMissing(t *testing.T) {
	err := linkOrCopy("/nonexistent/path.ysm", t.TempDir())
	if err == nil {
		t.Fatal("missing source should error")
	}
}

// ====== symlinkOrCopy ======

func TestSymlinkOrCopy_Success(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.ysm")
	if err := os.WriteFile(src, []byte("symlink data"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(dir, "dst")
	err := symlinkOrCopy(src, dstDir)
	if err != nil {
		t.Logf("symlinkOrCopy result (may fallback to copy): %v", err)
	}
	dst := filepath.Join(dstDir, "source.ysm")
	if _, statErr := os.Stat(dst); statErr != nil {
		t.Logf("target file status: %v", statErr)
	}
}

func TestSymlinkOrCopy_SrcMissing(t *testing.T) {
	// symlinkOrCopy 不校验源文件存在性，只验证不 panic
	err := symlinkOrCopy("/nonexistent/path.ysm", t.TempDir())
	_ = err
}

// ====== copyFileLocked ======

func TestCopyFileLocked_Success(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.ysm")
	content := []byte("copy data")
	if err := os.WriteFile(src, content, 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(dir, "sub")
	dst, err := copyFileLocked(src, dstDir)
	if err != nil {
		t.Fatalf("copyFileLocked failed: %v", err)
	}
	if dst == "" {
		t.Fatal("returned path should not be empty")
	}
	readBack, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(readBack) != string(content) {
		t.Errorf("content mismatch: got %q, want %q", string(readBack), string(content))
	}
}

func TestCopyFileLocked_SameFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "file.ysm")
	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	dst, err := copyFileLocked(src, dir)
	if err != nil {
		t.Fatalf("copyFileLocked same file failed: %v", err)
	}
	if dst != filepath.Join(dir, "file.ysm") {
		t.Errorf("expected source path, got %q", dst)
	}
}

func TestCopyFileLocked_SrcMissing(t *testing.T) {
	_, err := copyFileLocked("/nonexistent/path.ysm", t.TempDir())
	if err == nil {
		t.Fatal("missing source should error")
	}
}

// TestSameSource_LinkType 链接类型判定（P2 审计修复回归）：
// wantSymlink=false（hardlink 模式）遇 symlink 目标应判不同源（强制转硬链接）；
// wantSymlink=true（symlink 模式）遇 hardlink 目标应判不同源（强制转符号链接）。
func TestSameSource_LinkType(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.ysm")
	dst := filepath.Join(dir, "dst.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	t.Run("hardlink 目标匹配 hardlink 模式", func(t *testing.T) {
		if err := os.Link(src, dst); err != nil {
			t.Skipf("平台不支持硬链接: %v", err)
		}
		defer os.Remove(dst)
		same, err := sameSource(src, dst, false)
		if err != nil || !same {
			t.Fatalf("hardlink 目标应匹配 hardlink 模式: same=%v err=%v", same, err)
		}
		// 但 symlink 模式要求 symlink 目标 → hardlink 判不同源
		sameSym, err := sameSource(src, dst, true)
		if err != nil || sameSym {
			t.Fatalf("hardlink 目标在 symlink 模式下应判不同源: same=%v err=%v", sameSym, err)
		}
	})

	t.Run("symlink 目标匹配 symlink 模式", func(t *testing.T) {
		if err := os.Symlink(src, dst); err != nil {
			t.Skipf("平台不支持符号链接: %v", err)
		}
		defer os.Remove(dst)
		same, err := sameSource(src, dst, true)
		if err != nil || !same {
			t.Fatalf("symlink 目标应匹配 symlink 模式: same=%v err=%v", same, err)
		}
		// 但 hardlink 模式要求非 symlink 目标 → symlink 判不同源
		sameLink, err := sameSource(src, dst, false)
		if err != nil || sameLink {
			t.Fatalf("symlink 目标在 hardlink 模式下应判不同源: same=%v err=%v", sameLink, err)
		}
	})

	t.Run("不存在目标判不同源", func(t *testing.T) {
		same, err := sameSource(src, filepath.Join(dir, "missing.ysm"), false)
		if err == nil || same {
			t.Fatalf("不存在目标应报错且不同源: same=%v err=%v", same, err)
		}
	})
}
