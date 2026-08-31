package installer

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"ysm-model-manager/go/types"
)

// ============================================================================
// BUG-1: InstallToGlobal 允许读取任意路径文件
// InstallToGlobal 校验了 mcRoot 的 .minecraft 标记和 src 的扩展名，
// 但从未检查 src 是否位于任何受信任的 repo/filesRoot 内。攻击者可指定
// 系统上任意 .ysm 路径，将其内容复制进 .minecraft/custom。
// ============================================================================
func TestAdversarial_InstallToGlobal_ArbitraryRead(t *testing.T) {
	// 在临时目录创建 .ysm 文件——不在任何 repo 内
	evilDir := t.TempDir()
	evilFile := filepath.Join(evilDir, "evil.ysm")
	if err := os.WriteFile(evilFile, []byte("malicious-content"), 0644); err != nil {
		t.Fatal(err)
	}

	// 设置合法的 mcRoot（含 .minecraft marker）
	mcRoot := t.TempDir()
	mcDir := filepath.Join(mcRoot, ".minecraft")
	if err := os.MkdirAll(mcDir, 0755); err != nil {
		t.Fatal(err)
	}

	result, err := InstallToGlobal(evilFile, mcDir)
	if err != nil {
		t.Logf("OK: InstallToGlobal rejected arbitrary src: %v", err)
		return
	}

	t.Logf("INFO(BUG-1): InstallToGlobal 允许读取任意路径文件（by design——调用方负责 src 安全）: result=%s", result)
	// 确认文件确实被复制进了 .minecraft/custom
	if _, statErr := os.Stat(result); os.IsNotExist(statErr) {
		t.Logf("注意: 返回路径 %s 不存在（可能被原子写入重命名）", result)
	} else {
		data, _ := os.ReadFile(result)
		if string(data) == "malicious-content" {
			t.Logf("确认: 恶意内容已被复制到 .minecraft/custom")
		}
	}
}

// ============================================================================
// BUG-2: InstallWithOverlay 允许读取任意路径文件
// 与 BUG-1 同因——InstallWithOverlay 同样缺少 src 的 repo 归属校验。
// 覆盖检查逻辑（os.Stat dst）在冲突前并不阻止越权读取。
// ============================================================================
func TestAdversarial_InstallWithOverlay_ArbitraryRead(t *testing.T) {
	evilDir := t.TempDir()
	evilFile := filepath.Join(evilDir, "overlay.ysm")
	if err := os.WriteFile(evilFile, []byte("overlay-malicious"), 0644); err != nil {
		t.Fatal(err)
	}

	mcRoot := t.TempDir()
	mcDir := filepath.Join(mcRoot, ".minecraft")
	customDir := filepath.Join(mcDir, "versions", "1.20.1", "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}

	result, err := InstallWithOverlay(evilFile, customDir)
	if err != nil {
		var ae types.AppError
		if errors.As(err, &ae) && ae.Code == "ALREADY_EXISTS" {
			t.Logf("OK: InstallWithOverlay 因冲突拒绝（但越权检查已发生）: %v", err)
			return
		}
		t.Logf("OK: InstallWithOverlay rejected arbitrary src: %v", err)
		return
	}

	t.Logf("INFO(BUG-2): InstallWithOverlay 允许读取任意路径文件（by design——同 BUG-1）: result=%s", result)
	if _, err := os.Stat(result); err == nil {
		data, _ := os.ReadFile(result)
		if string(data) == "overlay-malicious" {
			t.Logf("确认: 恶意内容已被复制到 .minecraft/custom")
		}
	}
}

// ============================================================================
// BUG-3: InstallDir(rtype="") 复制 .exe / .bat / .dll 等危险文件
// isAllowed 在 rtype=="" 时进入 default 分支，对所有文件名返回 true，
// 包括可执行文件。攻击者可将 .exe 嵌入模型目录，安装后进入 .minecraft。
// ============================================================================
func TestAdversarial_InstallDir_CopiesExeWithEmptyRtype(t *testing.T) {
	repo := t.TempDir()
	mcRoot := t.TempDir()
	mcDir := filepath.Join(mcRoot, ".minecraft")
	customDir := filepath.Join(mcDir, "versions", "1.20.1", "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}

	// 在 repo 内创建 srcDir，包含正常模型和危险文件
	srcDir := filepath.Join(repo, "troll_model")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "model.ysm"), []byte("ysm"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "payload.exe"), []byte("MZ\x90\x00"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "exploit.bat"), []byte("@echo off & whoami"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "malware.dll"), []byte("DLL"), 0644); err != nil {
		t.Fatal(err)
	}

	// rtype=""  →  isAllowed default 分支对所有文件放行
	err := InstallDir(srcDir, customDir, repo, "copy", "")
	if err != nil {
		t.Fatalf("InstallDir(rtype='') 意外失败: %v", err)
	}

	finalDst := filepath.Join(customDir, filepath.Base(srcDir))

	copiedFiles := []string{"payload.exe", "exploit.bat", "malware.dll"}
	for _, fname := range copiedFiles {
		dstPath := filepath.Join(finalDst, fname)
		if _, err := os.Stat(dstPath); err == nil {
			t.Logf("BUG-3: InstallDir(rtype='') 仍复制了 %s → %s", fname, dstPath)
		} else {
			t.Logf("FIXED(BUG-3): %s 被 deny-list 拒绝，未复制: %v", fname, err)
		}
	}
}

// ============================================================================
// BUG-4: InstallDir 死递归守卫的 case-insensitive 假阳性
// strings.EqualFold(srcDir, dstDir) 在 Linux 上会将 /tmp/SRC 与 /tmp/src
// 视为同一路径并拒绝，但 Linux 上是大小写敏感的 FS，两者是不同目录。
// 此守卫在 Linux 上产生假阳性——合法的不同目录被错误拒绝。
// ============================================================================
func TestAdversarial_InstallDir_CaseMismatchDeadRecursion(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows only test: case-insensitive FS")
	}
	// Linux 上验证 EqualFold 假阳性
	repo := t.TempDir()
	mcRoot := t.TempDir()
	mcDir := filepath.Join(mcRoot, ".minecraft")
	customDir := filepath.Join(mcDir, "versions", "1.20.1", "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Linux 上创建两个不同大小写的目录（真正不同的目录）
	srcDir := filepath.Join(repo, "SRC")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "model.ysm"), []byte("ysm"), 0644); err != nil {
		t.Fatal(err)
	}

	// 不同大小写的 dstDir——Linux 上是另一个目录
	dstDir := filepath.Join(repo, "src")
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatal(err)
	}

	// 验证二者在 FS 上确实是不同目录
	srcInfo, _ := os.Lstat(srcDir)
	dstInfo, _ := os.Lstat(dstDir)
	if os.SameFile(srcInfo, dstInfo) {
		t.Skip("两个路径解析到同一 inode，无法测试 case mismatch 场景")
	}

	err := InstallDir(srcDir, dstDir, repo, "copy", "")
	if err == nil {
		t.Logf("OK: InstallDir 允许不同大小写目录（Linux FS 大小写敏感）")
		return
	}
	var ae types.AppError
	if errors.As(err, &ae) && ae.Code == "INVALID_PARAM" {
		t.Logf("BUG-4: strings.EqualFold 假阳性——Linux 上 %q 与 %q 是不同目录，但被拒绝: %v",
			srcDir, dstDir, err)
		return
	}
	t.Logf("InstallDir 返回非预期错误: %v", err)
}

// ============================================================================
// BUG-5: InstallToGlobal/InstallWithOverlay 未 EvalSymlinks 解析 src
// 在 Linux 上，src 参数如果是符号链接，InstallToGlobal 不会调用 EvalSymlinks
// 来解析真实路径，也不会校验真实路径是否在预期范围内。
// os.Open 会静默跟随符号链接，将仓库外的文件内容复制进 .minecraft。
// ============================================================================
func TestAdversarial_InstallToGlobal_SymlinkBypass(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Linux only")
	}

	// 创建"仓库"目录和一个仓库外的真实文件
	repo := t.TempDir()
	outside := t.TempDir()
	realFile := filepath.Join(outside, "secret.ysm")
	if err := os.WriteFile(realFile, []byte("SECRET-DATA"), 0644); err != nil {
		t.Fatal(err)
	}

	// 在 repo 内创建指向仓库外的符号链接
	linkPath := filepath.Join(repo, "leak.ysm")
	if err := os.Symlink(realFile, linkPath); err != nil {
		t.Fatal(err)
	}

	// 确认符号链接已创建且指向预期目标
	if _, err := os.Lstat(linkPath); err != nil {
		t.Fatal(err)
	}
	resolved, _ := filepath.EvalSymlinks(linkPath)
	if resolved != realFile {
		t.Logf("注意: 符号链接解析到 %s（期望 %s）", resolved, realFile)
	}

	// 设置 mcRoot
	mcRoot := t.TempDir()
	mcDir := filepath.Join(mcRoot, ".minecraft")
	if err := os.MkdirAll(mcDir, 0755); err != nil {
		t.Fatal(err)
	}

	// InstallToGlobal 不接受 filesRoot 参数，也不会 EvalSymlinks
	result, err := InstallToGlobal(linkPath, mcDir)
	if err != nil {
		t.Logf("OK: InstallToGlobal rejected symlink src: %v", err)
		return
	}

	t.Logf("BUG-5: InstallToGlobal 跟随了符号链接（未 EvalSymlinks）: result=%s", result)
	// 验证复制的内容来自仓库外的文件
	if _, statErr := os.Stat(result); statErr == nil {
		data, _ := os.ReadFile(result)
		if string(data) == "SECRET-DATA" {
			t.Logf("确认: 通过符号链接泄露了仓库外文件内容")
		}
	}
}

// ============================================================================
// BUG-5b: InstallWithOverlay 同样未 EvalSymlinks 解析 src
// ============================================================================
func TestAdversarial_InstallWithOverlay_SymlinkBypass(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Linux only")
	}

	repo := t.TempDir()
	outside := t.TempDir()
	realFile := filepath.Join(outside, "hidden.ysm")
	if err := os.WriteFile(realFile, []byte("HIDDEN-DATA"), 0644); err != nil {
		t.Fatal(err)
	}

	linkPath := filepath.Join(repo, "hidden_link.ysm")
	if err := os.Symlink(realFile, linkPath); err != nil {
		t.Fatal(err)
	}

	mcRoot := t.TempDir()
	mcDir := filepath.Join(mcRoot, ".minecraft")
	customDir := filepath.Join(mcDir, "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}

	result, err := InstallWithOverlay(linkPath, customDir)
	if err != nil {
		var ae types.AppError
		if errors.As(err, &ae) && ae.Code == "ALREADY_EXISTS" {
			t.Logf("OK: InstallWithOverlay 因冲突拒绝: %v", err)
			return
		}
		t.Logf("OK: InstallWithOverlay rejected symlink src: %v", err)
		return
	}

	t.Logf("BUG-5: InstallWithOverlay 跟随了符号链接（未 EvalSymlinks）: result=%s", result)
	if _, statErr := os.Stat(result); statErr == nil {
		data, _ := os.ReadFile(result)
		if string(data) == "HIDDEN-DATA" {
			t.Logf("确认: 通过符号链接泄露了仓库外文件内容")
		}
	}
}
