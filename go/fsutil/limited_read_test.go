package fsutil

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestReadFileLimited_Normal 正常整读：内容完整返回，无错误。
func TestReadFileLimited_Normal(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "f.bin")
	testutil.NoError(t, os.WriteFile(p, []byte("hello world"), 0o644))
	data, err := ReadFileLimited(p, 100)
	testutil.NoError(t, err, "unexpected error")
	testutil.Equal(t, string(data), "hello world", "data mismatch: got %q", data)
}

// TestReadFileLimited_TooLarge 超限：返回 ErrFileTooLarge（不静默截断）。
func TestReadFileLimited_TooLarge(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "big.bin")
	// 写 11 字节，上限 10
	testutil.NoError(t, os.WriteFile(p, []byte("0123456789a"), 0o644))
	_, err := ReadFileLimited(p, 10)
	testutil.ErrorIs(t, err, ErrFileTooLarge, "expected ErrFileTooLarge")
}

// TestReadFileLimited_AtLimit 恰好等于上限：放行（len == limit 不算超限）。
func TestReadFileLimited_AtLimit(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "exact.bin")
	testutil.NoError(t, os.WriteFile(p, []byte("0123456789a"), 0o644))
	data, err := ReadFileLimited(p, 11)
	testutil.NoError(t, err, "at-limit should pass")
	testutil.Equal(t, len(data), 11, "len mismatch: %d", len(data))
}

// TestReadFileLimited_Missing 文件不存在：原样返回底层 IO 错误（非 ErrFileTooLarge）。
func TestReadFileLimited_Missing(t *testing.T) {
	_, err := ReadFileLimited(filepath.Join(t.TempDir(), "nope"), 10)
	testutil.Equal(t, errors.Is(err, ErrFileTooLarge), false, "missing file should not be ErrFileTooLarge")
	testutil.NotNil(t, err, "expected error for missing file")
}

// TestReadFileLimited_NonPositiveLimit 非正上限：直接拒绝（防御性边界）。
func TestReadFileLimited_NonPositiveLimit(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "f.bin")
	_ = os.WriteFile(p, []byte("x"), 0o644)
	for _, lim := range []int64{0, -1} {
		_, err := ReadFileLimited(p, lim)
		testutil.ErrorIs(t, err, ErrFileTooLarge, "limit=%d should be ErrFileTooLarge", lim)
	}
}
