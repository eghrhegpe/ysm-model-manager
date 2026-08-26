package download

// ===== download 抽出子函数直接单测 =====
// 背景：downloadTo 拆成 8 个子函数（96486077），各子函数原只被入口（Download/File）
// 间接覆盖。此处为 prepareAtomicWrite / commitAtomicWrite / verifyDownloadedFile /
// copyResponseBodyWithProgress 补直接单测，兑现「各自升格可单测」的承诺，并补上
// 间接覆盖不到的边界分支（截断超量、校验和不匹配、CreateTemp 失败等）。

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestPrepareAtomicWrite_Success 创建临时文件 + 清理闭包幂等。
func TestPrepareAtomicWrite_Success(t *testing.T) {
	dir := t.TempDir()
	savePath := filepath.Join(dir, "out.bin")
	af, cleanup, err := prepareAtomicWrite(savePath)
	if err != nil {
		t.Fatalf("prepareAtomicWrite: %v", err)
	}
	if af.savePath != savePath {
		t.Fatalf("savePath = %q, want %q", af.savePath, savePath)
	}
	if _, err := os.Stat(af.tmpName); err != nil {
		t.Fatalf("临时文件应存在: %v", err)
	}
	// 未 commit 时 cleanup 应删掉临时文件
	cleanup()
	if _, err := os.Stat(af.tmpName); !os.IsNotExist(err) {
		t.Fatalf("cleanup 后临时文件应已删除, err=%v", err)
	}
	// 幂等：二次 cleanup 不 panic 也不报错（文件已删，Remove 失败仅留痕）
	cleanup()
}

func TestPrepareAtomicWrite_CreateTempFail(t *testing.T) {
	// 不存在的目录 → CreateTemp 必然失败
	_, _, err := prepareAtomicWrite(filepath.Join(t.TempDir(), "no-such-dir", "out.bin"))
	if err == nil {
		t.Fatal("期望 CreateTemp 失败返回 error")
	}
	if !strings.Contains(err.Error(), "创建临时文件失败") {
		t.Fatalf("错误应包装原因, got %v", err)
	}
}

func TestCommitAtomicWrite_SuccessAndProgress(t *testing.T) {
	dir := t.TempDir()
	savePath := filepath.Join(dir, "out.bin")
	af, cleanup, err := prepareAtomicWrite(savePath)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if _, err := af.tmp.WriteString("hello"); err != nil {
		t.Fatal(err)
	}

	var cbDownloaded, cbTotal int64
	err = commitAtomicWrite(af, 5, 5, func(downloaded, total int64) {
		cbDownloaded = downloaded
		cbTotal = total
	})
	if err != nil {
		t.Fatalf("commitAtomicWrite: %v", err)
	}
	if !af.committed {
		t.Fatal("提交后 committed 应为 true")
	}
	data, _ := os.ReadFile(savePath)
	if string(data) != "hello" {
		t.Fatalf("落盘内容 = %q, want %q", string(data), "hello")
	}
	if cbDownloaded != 5 || cbTotal != 5 {
		t.Fatalf("进度回调 = (%d,%d), want (5,5)", cbDownloaded, cbTotal)
	}
	// 提交后临时文件名已重命名消失
	if _, err := os.Stat(af.tmpName); !os.IsNotExist(err) {
		t.Fatalf("提交后临时文件应消失, err=%v", err)
	}
}

func TestVerifyDownloadedFile_Truncation(t *testing.T) {
	f := tempFileWithContent(t, "abc")

	// 实际字节数 < 声明 → 截断
	_, err := verifyDownloadedFile(f, 5, 3, true, nil)
	if !errors.Is(err, ErrTruncated) {
		t.Fatalf("期望 ErrTruncated, got %v", err)
	}
	// 实际字节数 > 声明 → 同样视为异常
	_, err = verifyDownloadedFile(f, 3, 5, true, nil)
	if !errors.Is(err, ErrTruncated) {
		t.Fatalf("期望超量时 ErrTruncated, got %v", err)
	}
}

func TestVerifyDownloadedFile_Checksum(t *testing.T) {
	f := tempFileWithContent(t, "hello")

	sum := sha256Sum(t, "hello")
	// 匹配 → 通过，返回 usedTotal=total
	used, err := verifyDownloadedFile(f, 5, 5, true, sum)
	if err != nil {
		t.Fatalf("校验和匹配不应报错: %v", err)
	}
	if used != 5 {
		t.Fatalf("usedTotal = %d, want 5", used)
	}
	// 不匹配 → ErrChecksumMismatch
	_, err = verifyDownloadedFile(f, 5, 5, true, []byte("wrong"))
	if !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("期望 ErrChecksumMismatch, got %v", err)
	}
}

func TestVerifyDownloadedFile_UnknownTotal(t *testing.T) {
	f := tempFileWithContent(t, "hello")

	// total<=0 时返回 downloaded 而非 total
	used, err := verifyDownloadedFile(f, -1, 5, false, nil)
	if err != nil {
		t.Fatalf("未知 total 不应报错: %v", err)
	}
	if used != 5 {
		t.Fatalf("usedTotal = %d, want 5", used)
	}
}

// tempFileWithContent 创建临时文件并写入内容，测试结束后关闭+删除（Windows 需先关句柄）。
func tempFileWithContent(t *testing.T, s string) *os.File {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "v")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		f.Close()
		os.Remove(f.Name())
	})
	if _, err := f.WriteString(s); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestCopyResponseBodyWithProgress(t *testing.T) {
	var buf bytes.Buffer
	n, err := copyResponseBodyWithProgress(context.Background(), strings.NewReader("hello world"), &buf, 11, nil)
	if err != nil {
		t.Fatalf("copyResponseBodyWithProgress: %v", err)
	}
	if n != 11 {
		t.Fatalf("downloaded = %d, want 11", n)
	}
	if buf.String() != "hello world" {
		t.Fatalf("内容 = %q", buf.String())
	}
}

func TestCopyResponseBodyWithProgress_Cancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 立即取消
	_, err := copyResponseBodyWithProgress(ctx, strings.NewReader("x"), io.Discard, 1, nil)
	if err == nil || !strings.Contains(err.Error(), "取消") {
		t.Fatalf("期望取消错误, got %v", err)
	}
}

// sha256Sum 计算字符串的 SHA256（与 verifyDownloadedFile 同一哈希口径）。
func sha256Sum(t *testing.T, s string) []byte {
	t.Helper()
	h := sha256.New()
	h.Write([]byte(s))
	return h.Sum(nil)
}
