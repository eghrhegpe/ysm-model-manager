package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// TestToggleEnable_GuardAndToggle 覆盖 ToggleEnable 的路径守卫（拒绝仓库外路径）+ 根内
// 正常切换 .disabled/.ban 禁启用状态（fail-closed 越权拒绝是真实回归风险）。
func TestToggleEnable_GuardAndToggle(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	a := repoApp(t, types.AppConfig{FilesRoot: base})

	// 根内文件：切换为禁用（生成 .disabled）→ 再切回启用
	inside := filepath.Join(base, "model.ysm")
	if err := os.WriteFile(inside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	enabled, err := a.ToggleEnable(inside)
	if err != nil {
		t.Fatalf("根内切换应成功: %v", err)
	}
	if enabled {
		t.Errorf("首次切换应变为禁用(enabled=false), got %v", enabled)
	}
	if _, err := os.Stat(inside + ".disabled"); err != nil {
		t.Errorf("禁用后应有 .disabled 文件: %v", err)
	}
	// 切回启用
	enabled, err = a.ToggleEnable(inside + ".disabled")
	if err != nil {
		t.Fatalf("根内切回应成功: %v", err)
	}
	if !enabled {
		t.Errorf("二次切换应变为启用(enabled=true), got %v", enabled)
	}

	// 根外路径：拒绝
	outside := filepath.Join(t.TempDir(), "evil.ysm")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ToggleEnable(outside); err == nil {
		t.Error("仓库外路径应被拒绝(返回 error)")
	}
}

// TestIsFileBanned 覆盖 IsFileBanned 对 .disabled / .ban 后缀的统一判定（转发 fileops，
// 但绑定层是前端禁用态来源，守卫语义需锁死）。
func TestIsFileBanned(t *testing.T) {
	t.Parallel()
	a := &App{} // 纯转发，不需配置桩
	cases := []struct {
		name string
		path string
		want bool
	}{
		{"disabled 后缀", "a/model.ysm.disabled", true},
		{"ban 后缀", "a/model.ysm.ban", true},
		{"普通文件", "a/model.ysm", false},
		{"禁用态容器", "a/model.zip.disabled", true},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := a.IsFileBanned(c.path); got != c.want {
				t.Errorf("IsFileBanned(%q) = %v, want %v", c.path, got, c.want)
			}
		})
	}
}

// TestMoveModelFile_RootValidation 覆盖 MoveModelFile 的 findMoveRoot 多根校验：
// 同根（src/dst 都落在配置根内）允许；跨根（不在任何配置根内）fail-closed 拒绝。
// 修复前硬编码 FilesRoot 会导致自定义根（如独立 D:\MMD-Models）下文件无法移动。
func TestMoveModelFile_RootValidation(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	srcDir := filepath.Join(base, "src")
	dstDir := filepath.Join(base, "dst")
	for _, d := range []string{srcDir, dstDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	src := filepath.Join(srcDir, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := repoApp(t, types.AppConfig{FilesRoot: base, CustomRoots: map[string]string{"mmd": filepath.Join(base, "mmd")}})

	// 同根：src 与 dst 都在 FilesRoot 内 → 允许（移动成功）
	if err := a.MoveModelFile(src, dstDir); err != nil {
		t.Fatalf("同根移动应成功: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dstDir, "m.ysm")); err != nil {
		t.Errorf("移动后目标文件应存在: %v", err)
	}

	// 跨根：dst 落在完全不相关的临时目录（不在任何配置根内）→ 拒绝
	rogue := t.TempDir()
	if err := a.MoveModelFile(filepath.Join(dstDir, "m.ysm"), rogue); err == nil {
		t.Error("跨根移动应被拒绝(返回 error)")
	}
}

// TestMoveCopyModelFile_InvalidatesScanCache 锁 app 层 fileops 写家族的一致性：
// RenameDir/RemoveDir/RenameFile 成功路径全部 scanner.InvalidateCache()（防 30s 陈旧
// 缓存"复活"），而 MoveModelFile/CopyModelFile 曾独漏——右键移动/复制后 tree:reload
// 命中旧缓存，旧位置文件仍在列表、新位置文件不出现 ≤TTL；watcher 只在配置了 McRoot
// 且存在整合包时兜底（app.go 启动条件 + syncAll 无实例短路），查看器模式无兜底。
// 锐评 2026-10-10（回收站/删除链路审计）。
func TestMoveCopyModelFile_InvalidatesScanCache(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	sub := filepath.Join(base, "dst")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(base, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := repoApp(t, types.AppConfig{FilesRoot: base})

	// 预扫描建立缓存（同 app_scan_test 口径：首 miss、二 hit）
	if _, hit := a.scanModelEntriesWithHit(base); hit {
		t.Fatal("首次扫描不应命中缓存")
	}
	if _, hit := a.scanModelEntriesWithHit(base); !hit {
		t.Fatal("二次扫描应命中缓存（前置条件）")
	}
	if err := a.MoveModelFile(src, sub); err != nil {
		t.Fatalf("同根移动应成功: %v", err)
	}
	if _, hit := a.scanModelEntriesWithHit(base); hit {
		t.Error("MoveModelFile 成功后不应命中旧扫描缓存")
	}

	// 重新建立缓存（移动后首次扫已 miss，第二次应 hit——前置条件）
	if _, hit := a.scanModelEntriesWithHit(base); !hit {
		t.Fatal("移动后重扫第二次应命中缓存（前置条件）")
	}
	if err := a.CopyModelFile(filepath.Join(sub, "m.ysm"), base); err != nil {
		t.Fatalf("同根复制应成功: %v", err)
	}
	if _, hit := a.scanModelEntriesWithHit(base); hit {
		t.Error("CopyModelFile 成功后不应命中旧扫描缓存")
	}
	if _, hit := a.scanModelEntriesWithHit(base); !hit {
		t.Error("复制后重扫应命中新缓存")
	}
}

// 注：FindPreviewImage / ExtractPreviewTexture 的守卫拒绝已由 app_audit_fix_test.go
// 的 TestFindPreviewImage_Guard 覆盖，此处不再重复。
