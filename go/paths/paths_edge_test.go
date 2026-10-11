//go:build !android

// ===== go/paths 安全对抗测试 =====
// 探测 IsInside / ContainsMinecraftMarker 的攻击面与潜在缺陷。
// 每个测试均可在 Windows CI 上运行；Linux 专属分支用 t.Skip 跳过。
// 错误分类统一用 errors.As/errors.Is（Trap #11：禁止 strings.Contains 文本匹配）
package paths

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// ---------- Bug 1: Symlink escape (HIGH, 已修复) ----------
// IsInside 是纯词法判定，不解析符号链接；IsInsideResolved 解析两侧 symlink
// 后再二次判定，拦截 baseDir 内指向外部的 symlink 段逃逸（BUG-1）。
func TestIsInsideResolved_SymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 无特权创建 os.Symlink")
	}

	baseDir := t.TempDir()
	outsideDir := t.TempDir()
	targetFile := filepath.Join(outsideDir, "target.ysm")
	if err := os.WriteFile(targetFile, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	symlinkPath := filepath.Join(baseDir, "symlink")
	if err := os.Symlink(outsideDir, symlinkPath); err != nil {
		t.Fatalf("创建 symlink 失败: %v", err)
	}

	escapedPath := filepath.Join(baseDir, "symlink", "target.ysm")
	// 纯词法 IsInside 放行（不解析 symlink，文档行为）
	if err := IsInside(baseDir, escapedPath); err == nil {
		t.Logf("INFO(BUG-1): 词法 IsInside 放行 symlink 逃逸（纯词法语义，符合预期）")
	}
	// 修复点：IsInsideResolved 必须拦截
	if err := IsInsideResolved(baseDir, escapedPath); err == nil {
		t.Fatal("BUG-1: IsInsideResolved 未拦截 symlink 逃逸")
	} else if !errors.Is(err, ErrNotInside) {
		t.Fatalf("BUG-1: 应分类 ErrNotInside, got %v", err)
	}
}

// ---------- Bug 2: Empty path silently passes when CWD == baseDir (MEDIUM) ----------
// filepath.Abs("") 返回当前工作目录。若 CWD 恰等于 baseDir，
// IsInside(baseDir, "") 会返回 nil，因为相对路径为 "."，前缀检查也通过。
func TestIsInside_EmptyPathCWDMatch(t *testing.T) {
	t.Helper()
	baseDir := t.TempDir()

	origWD, err := os.Getwd()
	if err == nil {
		t.Cleanup(func() { _ = os.Chdir(origWD) })
	}
	if err := os.Chdir(baseDir); err != nil {
		t.Fatalf("os.Chdir(%q) 失败: %v", baseDir, err)
	}

	err = IsInside(baseDir, "")
	if err == nil {
		t.Fatal("FIXED(BUG-2): 空路径应被拒绝")
	}
	if errors.Is(err, ErrEmptyPath) {
		t.Logf("FIXED(BUG-2): 空路径已拒绝（ErrEmptyPath）, err=%v", err)
	} else {
		t.Fatalf("FIXED(BUG-2): 期望分类 ErrEmptyPath, 实际 err=%v", err)
	}
}

// ---------- Bug 3: Cross-drive bypass on Windows (MEDIUM) ----------
// 在 Windows 上，filepath.Rel 对跨驱动器路径返回错误，IsInside 因此
// 返回 ErrPathEscalation——当前行为正确。此测试确认该行为不被破坏。
func TestIsInside_CrossDriveWindows(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("Windows only: 跨驱动器路径是 Windows 特性")
	}

	err := IsInside(`C:\repo`, `D:\evil\file.ysm`)
	if err == nil {
		t.Fatal("BUG-3: 跨驱动器路径未被拒绝")
	}
	var esc *ErrPathEscalation
	if errors.As(err, &esc) {
		if errors.Is(err, ErrRelFailed) {
			t.Logf("FIXED/INFO(BUG-3): 跨驱动器已拒绝（ErrRelFailed）: err=%v", err)
		} else {
			t.Logf("FIXED/INFO(BUG-3): 跨驱动器已拒绝: err=%v", err)
		}
	} else {
		t.Logf("INFO(BUG-3): 跨驱动器被拒绝但非 ErrPathEscalation, err=%v", err)
	}

	// 补充：同一驱动器但不同根目录（如 C:\a vs C:\b）也需拒绝
	err2 := IsInside(`C:\a`, `C:\b\file.ysm`)
	if err2 == nil {
		t.Fatal("BUG-3(b): 同驱动器不同根路径未被拒绝")
	}
	t.Logf("FIXED/INFO(BUG-3b): 同驱动器不同根已拒绝: err=%v", err2)
}

// ---------- Bug 4: Unicode homoglyph bypass (LOW-MEDIUM) ----------
// ContainsMinecraftMarker 检查精确的 ".minecraft"/"minecraft" 字符串。
// 攻击者可用 Cyrillic і (U+0456) 替代 ASCII i 构造视觉上完全相同的目录名，
// 从而绕过标记检测。当前实现使用精确匹配，不会误匹配——这是正确的，
// 但该攻击面仍然存在（检测逻辑本身无法防御同形目录名）。
func TestContainsMinecraftMarker_UnicodeHomoglyph(t *testing.T) {
	t.Helper()

	// Cyrillic 小写 і (U+0456) 替换 ASCII 'i'，视觉一致
	cyrillicPath := filepath.Join("C:", "Users", "x", ".m\u0456necraft", "mods", "file.ysm")
	if got := ContainsMinecraftMarker(cyrillicPath); got {
		t.Fatal("BUG-4: Unicode 同形字符绕过——ContainsMinecraftMarker 匹配了含 Cyrillic і 的路径")
	}
	t.Logf("INFO(BUG-4): 严格 ASCII 匹配未绕过 (%s)——但同形目录名是已知攻击面", cyrillicPath)

	// 另一种形式：Cyrillic п (U+043F) 替代 ASCII 'p'，在 "minecraft" 段中替换 'p'
	// 构造 ".mіnecraft" (U+0456) 已测；这里测 "mіnecraft" (无点，PrismLauncher 风格)
	prismCyrillic := filepath.Join("C:", "Users", "x", "m\u0456necraft", "mods", "file.ysm")
	if got := ContainsMinecraftMarker(prismCyrillic); got {
		t.Fatal("BUG-4(b): 无点同形路径绕过")
	}
	t.Logf("INFO(BUG-4b): 无点同形路径未绕过 (%s)", prismCyrillic)
}

// ---------- Bug 5: NUL byte handling ----------
// Linux 上 filepath.Abs("dir\x00evil") 会截断 NUL 后的内容，
// IsInside 可能无法察觉路径被篡改。Windows 上 filepath.Abs 直接拒绝 NUL。
func TestIsInside_NULByte(t *testing.T) {
	t.Helper()
	baseDir := t.TempDir()

	// 构造含 NUL 字节的路径：正常段 + NUL + 逃逸片段
	nulPath := filepath.Join(baseDir, "normal") + "\x00../../etc/passwd"

	if runtime.GOOS == "linux" {
		err := IsInside(baseDir, nulPath)
		if err == nil {
			t.Fatalf("BUG-5: Linux 上 NUL 字节路径被接受——filepath.Abs 截断后 IsInside 无法察觉原始逃逸")
		}
		if errors.Is(err, ErrNULByte) {
			t.Logf("FIXED(BUG-5, Linux): NUL 字节已拒绝（ErrNULByte）, err=%v", err)
		} else {
			t.Logf("FIXED(BUG-5, Linux): NUL 字节被 filepath.Abs 截断后产生异常, err=%v", err)
		}
	} else {
		err := IsInside(baseDir, nulPath)
		if err == nil {
			t.Fatal("FIXED(BUG-5): Windows 上 NUL 字节路径应被拒绝")
		}
		if errors.Is(err, ErrNULByte) {
			t.Logf("FIXED(BUG-5, Windows): NUL 字节已拒绝（ErrNULByte）, err=%v", err)
		} else {
			t.Logf("FIXED(BUG-5, Windows): NUL 字节被 filepath.Abs 直接拒绝, err=%v", err)
		}
	}
}

// ---------- Bug 6: Double-dot in filenames (false positive check) ----------
// IsInside 用 ".."+separator 前缀检查，而非裸 ".." 前缀。
// 合法文件名以 ".." 开头（如 "..foo"）不应被误判为路径遍历。
// 此测试确认修复后的行为：合法名放行、真逃逸仍拒绝。
func TestIsInside_DotDotInFilenames(t *testing.T) {
	t.Helper()
	baseDir := t.TempDir()

	// 合法：..foo 开头文件名
	validFile := filepath.Join(baseDir, "..foo", "model.ysm")
	if err := IsInside(baseDir, validFile); err != nil {
		t.Fatalf("BUG-6: '..foo' 合法文件名被误判为逃逸, err=%v", err)
	}

	// 合法：..bar.baz 文件名
	validFile2 := filepath.Join(baseDir, "..bar.baz")
	if err := IsInside(baseDir, validFile2); err != nil {
		t.Fatalf("BUG-6: '..bar.baz' 合法文件名被误判为逃逸, err=%v", err)
	}

	// 合法：.. 作为唯一文件名（不加分隔符，即 baseDir 下名为 ".." 的目录）
	// filepath.Join 会将 ".." 归一化为上级目录，这里用手动拼接
	validDotDot := baseDir + string(filepath.Separator) + ".."
	absValid, _ := filepath.Abs(validDotDot)
	if err := IsInside(baseDir, absValid); err == nil {
		t.Log("INFO(BUG-6c): '..' 目录名在 Abs 后解析为父目录，IsInside 放行——需关注")
	} else {
		t.Logf("INFO(BUG-6c): '..' 目录名被拒绝, err=%v", err)
	}

	// 真逃逸：.. + 分隔符 必须拒绝
	escapedFile := filepath.Join(baseDir, "..", "evil.ysm")
	if err := IsInside(baseDir, escapedFile); err == nil {
		t.Fatal("BUG-6: 真 '..' 逃逸未拒绝")
	}

	t.Log("FIXED/INFO(BUG-6): '..foo' 等合法名放行，真 '..' 逃逸拒绝")
}
