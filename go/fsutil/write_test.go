// ===== fsutil.WriteFileAtomic 直测（ADR-044 策略 A 收敛后补测：
// 原子写为数据安全不变量，失败分支清理必须可检测，防残留回归）=====
package fsutil

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWriteFileAtomic_Success(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "data.json")
	if err := WriteFileAtomic(dst, []byte(`{"ok":true}`)); err != nil {
		t.Fatalf("WriteFileAtomic 失败: %v", err)
	}
	data, err := os.ReadFile(dst)
	if err != nil || string(data) != `{"ok":true}` {
		t.Fatalf("内容不符: %q %v", string(data), err)
	}
	fi, err := os.Stat(dst)
	if err != nil {
		t.Fatal(err)
	}
	// 平台感知：Windows 的 os.Chmod(0644) 只映射只读位、实际权限为 0666——
	// 断言「非只读」（拥有者/组/其他均可写）而非精确 0644，跨平台稳定
	want := os.FileMode(0644)
	if runtime.GOOS == "windows" {
		want = 0666
	}
	if fi.Mode().Perm() != want {
		t.Errorf("落地文件权限应为 %o，实际 %o", want, fi.Mode().Perm())
	}
	// 成功路径不得残留 .atomic-*.tmp
	matches, _ := filepath.Glob(filepath.Join(dir, ".atomic-*.tmp"))
	if len(matches) != 0 {
		t.Fatalf("成功路径不应残留临时文件: %v", matches)
	}
}

func TestWriteFileAtomic_TempCreateFailureCleansUp(t *testing.T) {
	// destDir 是普通文件 → CreateTemp 失败 → 不应残留任何 .atomic-*.tmp
	base := t.TempDir()
	blocker := filepath.Join(base, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	err := WriteFileAtomic(filepath.Join(blocker, "out.json"), []byte("x"))
	if err == nil {
		t.Fatal("destDir 为文件时应失败")
	}
	if !errors.Is(err, ErrTempCreateFailed) {
		t.Errorf("CreateTemp 阶段失败应携带 ErrTempCreateFailed，实际 %v", err)
	}
	matches, _ := filepath.Glob(filepath.Join(base, ".atomic-*.tmp"))
	if len(matches) != 0 {
		t.Fatalf("失败后不应残留临时文件: %v", matches)
	}
}
