package fsutil

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// TestReadFileLimited_Normal 正常整读：内容完整返回，无错误。
func TestReadFileLimited_Normal(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "f.bin")
	if err := os.WriteFile(p, []byte("hello world"), 0o644); err != nil {
		t.Fatal(err)
	}
	data, err := ReadFileLimited(p, 100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(data) != "hello world" {
		t.Fatalf("data mismatch: got %q", data)
	}
}

// TestReadFileLimited_TooLarge 超限：返回 ErrFileTooLarge（不静默截断）。
func TestReadFileLimited_TooLarge(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "big.bin")
	// 写 11 字节，上限 10
	if err := os.WriteFile(p, []byte("0123456789a"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := ReadFileLimited(p, 10)
	if !errors.Is(err, ErrFileTooLarge) {
		t.Fatalf("expected ErrFileTooLarge, got %v", err)
	}
}

// TestReadFileLimited_AtLimit 恰好等于上限：放行（len == limit 不算超限）。
func TestReadFileLimited_AtLimit(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "exact.bin")
	if err := os.WriteFile(p, []byte("0123456789a"), 0o644); err != nil {
		t.Fatal(err)
	}
	data, err := ReadFileLimited(p, 11)
	if err != nil {
		t.Fatalf("at-limit should pass, got %v", err)
	}
	if len(data) != 11 {
		t.Fatalf("len mismatch: %d", len(data))
	}
}

// TestReadFileLimited_Missing 文件不存在：原样返回底层 IO 错误（非 ErrFileTooLarge）。
func TestReadFileLimited_Missing(t *testing.T) {
	_, err := ReadFileLimited(filepath.Join(t.TempDir(), "nope"), 10)
	if errors.Is(err, ErrFileTooLarge) {
		t.Fatal("missing file should not be ErrFileTooLarge")
	}
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

// TestReadFileLimited_NonPositiveLimit 非正上限：直接拒绝（防御性边界）。
func TestReadFileLimited_NonPositiveLimit(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "f.bin")
	_ = os.WriteFile(p, []byte("x"), 0o644)
	for _, lim := range []int64{0, -1} {
		if _, err := ReadFileLimited(p, lim); !errors.Is(err, ErrFileTooLarge) {
			t.Fatalf("limit=%d should be ErrFileTooLarge, got %v", lim, err)
		}
	}
}
