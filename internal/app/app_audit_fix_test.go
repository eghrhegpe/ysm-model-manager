// ========== 2026-08-30 审核修复回归测试 ==========
// 覆盖：base64 预大小守卫（binding 层统一 DecodeBase64Limited 口径）、
// ysm-preview TTL 清扫、isPathInRootOrSelf 符号链接二次复核、
// 预览绑定路径守卫对称性（audit 报告 P3/P4 项）。
package app

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// TestExtractYSMHeaderFromBase64_Oversized：超大 base64 输入应被预检拒绝，
// 返回零值 header 而非解码后才发现（内存尖刺回归线）。
func TestExtractYSMHeaderFromBase64_Oversized(t *testing.T) {
	a := &App{}
	big := strings.Repeat("a", types.MaxReadLimit*2) // 解码后 > MaxReadLimit，预检必拒
	if got := a.ExtractYSMHeaderFromBase64(big); got != (ysm.YSMHeader{}) {
		t.Fatal("超大输入应返回零值 header")
	}
}

// TestSavePreviewTempFile_Guards：解码守卫 + MkdirAll 失败可见 + 文件真实落盘。
func TestSavePreviewTempFile_Guards(t *testing.T) {
	a := &App{}
	// 超大输入拒绝
	big := strings.Repeat("a", types.MaxReadLimit*2)
	if _, err := a.SavePreviewTempFile(big); !errors.Is(err, fsutil.ErrB64TooLarge) {
		t.Fatalf("超大输入应返回 ErrB64TooLarge, got %v", err)
	}
	// 非法 base64 报错
	if _, err := a.SavePreviewTempFile("!!!"); err == nil {
		t.Fatal("非法 base64 应报错")
	}
	// 合法输入落盘
	path, err := a.SavePreviewTempFile(base64.StdEncoding.EncodeToString([]byte("hello")))
	if err != nil {
		t.Fatalf("合法输入不应报错: %v", err)
	}
	defer os.RemoveAll(filepath.Dir(path))
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "hello" {
		t.Fatalf("落盘内容不符: %q err=%v", data, err)
	}
}

// TestSweepPreviewTemp_TTL：超过 TTL 的文件被清扫，新文件保留。
func TestSweepPreviewTemp_TTL(t *testing.T) {
	dir := t.TempDir()
	oldFile := filepath.Join(dir, "old.ysm")
	newFile := filepath.Join(dir, "new.ysm")
	for _, p := range []string{oldFile, newFile} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	stale := time.Now().Add(-2 * previewTempTTL)
	if err := os.Chtimes(oldFile, stale, stale); err != nil {
		t.Fatal(err)
	}
	sweepPreviewTemp(dir)
	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Error("超 TTL 文件应被清扫")
	}
	if _, err := os.Stat(newFile); err != nil {
		t.Error("新文件应保留")
	}
}

// TestSaveScreenshotFile_Oversized：截图绑定同样受预大小守卫。
func TestSaveScreenshotFile_Oversized(t *testing.T) {
	a := &App{}
	big := strings.Repeat("a", types.MaxReadLimit*2)
	if err := a.SaveScreenshotFile("shot.png", big); !errors.Is(err, fsutil.ErrB64TooLarge) {
		t.Fatalf("超大输入应返回 ErrB64TooLarge, got %v", err)
	}
}

// TestIsPathInRootOrSelf_SymlinkEscape：根内 symlink 指向外部文件时，
// 纯词法判定会误放行，IsInsideResolved 二次复核应拒绝（audit P3）。
// Windows 无特权环境创建 symlink 会失败，此时跳过（CI/Linux 全量覆盖）。
func TestIsPathInRootOrSelf_SymlinkEscape(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	outside := filepath.Join(base, "outside")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("s"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("创建符号链接失败（Windows 无特权环境）: %v", err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: root})
	if a.isPathInRootOrSelf(filepath.Join(link, "secret.txt")) {
		t.Error("根内 symlink 指向外部时 isPathInRootOrSelf 应拒绝")
	}
	// 正常根内路径不受影响
	inside := filepath.Join(root, "model.ysm")
	if err := os.WriteFile(inside, []byte("m"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !a.isPathInRootOrSelf(inside) {
		t.Error("根内真实文件应放行")
	}
}

// TestResolvedRootCache：缓存命中 + saveConfig 失效（audit P3 性能收敛回归）。
func TestResolvedRootCache(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: root})

	// Windows Temp 目录可能经 8.3 短名/symlink，基准取 ResolveOrKeep 本身
	wantRoot := paths.ResolveOrKeep(root)
	if got := resolvedRoot(root); got != wantRoot {
		t.Fatalf("已解析根应与 ResolveOrKeep 一致, got %q want %q", got, wantRoot)
	}
	if _, ok := resolvedRootCache.Load(root); !ok {
		t.Fatal("resolvedRoot 结果应写入缓存")
	}
	// 直接改缓存值模拟陈旧条目，saveConfig 后应被清空
	resolvedRootCache.Store(root, filepath.Join(base, "stale"))
	if err := a.saveConfig(a.LoadAppConfig()); err != nil {
		t.Fatalf("saveConfig: %v", err)
	}
	if _, ok := resolvedRootCache.Load(root); ok {
		t.Fatal("saveConfig 后 root 解析缓存应已失效")
	}
	// 失效后重新解析，恢复正确值
	if got := resolvedRoot(root); got != wantRoot {
		t.Fatalf("失效后应重新解析, got %q", got)
	}
	// 守卫功能不回归：根外仍拒绝（root 也经同一解析口径，避免 8.3 短名误判）
	if a.isPathInRootOrSelf(filepath.Join(paths.ResolveOrKeep(base), "outside", "m.ysm")) {
		t.Error("根外路径不应通过 isPathInRootOrSelf")
	}
}

// TestFindPreviewImage_Guard：根外路径应拒绝（与 ReadFileBytes 守卫对称）。
func TestFindPreviewImage_Guard(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	outside := filepath.Join(base, "outside")
	for _, d := range []string{root, outside} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	a := scanApp(t, types.AppConfig{FilesRoot: root})
	if got := a.FindPreviewImage(filepath.Join(outside, "model.ysm")); got != "" {
		t.Errorf("根外路径 FindPreviewImage 应返回空, got %q", got)
	}
	if got := a.ExtractPreviewTexture(filepath.Join(outside, "model.ysm")); got != "" {
		t.Errorf("根外路径 ExtractPreviewTexture 应返回空, got %q", got)
	}
}
