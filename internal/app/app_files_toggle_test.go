package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// TestToggleEnable_GuardAndToggle 覆盖 ToggleEnable 的路径守卫（拒绝仓库外路径）+ 根内
// 正常切换 .disabled/.ban 禁启用状态（fail-closed 越权拒绝是真实回归风险）。
func TestToggleEnable_GuardAndToggle(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	a := repoApp(t, types.AppConfig{FilesRoot: base})

	// 根内文件：切换为禁用（生成 .disabled）→ 再切回启用
	inside := filepath.Join(base, "model.ysm")
	err := os.WriteFile(inside, []byte("x"), 0o644)
	testutil.NoError(t, err, "WriteFile")
	enabled, err := a.ToggleEnable(inside)
	testutil.NoError(t, err, "根内切换应成功")
	if enabled {
		t.Errorf("首次切换应变为禁用(enabled=false), got %v", enabled)
	}
	if _, err := os.Stat(inside + ".disabled"); err != nil {
		t.Errorf("禁用后应有 .disabled 文件: %v", err)
	}
	// 切回启用
	enabled, err = a.ToggleEnable(inside + ".disabled")
	testutil.NoError(t, err, "根内切回应成功")
	if !enabled {
		t.Errorf("二次切换应变为启用(enabled=true), got %v", enabled)
	}

	// 根外路径：拒绝
	outside := filepath.Join(t.TempDir(), "evil.ysm")
	err = os.WriteFile(outside, []byte("x"), 0o644)
	testutil.NoError(t, err, "WriteFile")
	if _, err := a.ToggleEnable(outside); err == nil {
		t.Error("仓库外路径应被拒绝(返回 error)")
	}
}

// TestToggleEnable_TagRoundTripPreservesBasePath 锁「启用/禁用不 relocate 标签」这一设计：
// ToggleEnable 只是给同一基准路径加/摘 .disabled 后缀——文件身份（规范路径）没变，
// 标签键停在基准路径上，禁用期间 ListByTag 仍能查到（ListByTag 是 Store 侧查询、不查磁盘），
// re-enable 后原样复原。若按「改键须 relocate」硬接 relocateTags，反而会把标签搬到
// .disabled 上，re-enable 时就变成新的基准路径孤儿（反向病）。锐评 2026-10-11 复盘实证。
// 不加 t.Parallel()：repoApp 走包级全局 configDirOverride（无锁、t.Cleanup 还原），
// 并行会互踩导致 TempDir 清理失败（Windows "directory is not empty"）。
func TestToggleEnable_TagRoundTripPreservesBasePath(t *testing.T) {
	base := t.TempDir()
	a := repoApp(t, types.AppConfig{FilesRoot: base})

	canonical := filepath.Join(base, "model.ysm")
	err := os.WriteFile(canonical, []byte("x"), 0o644)
	testutil.NoError(t, err, "WriteFile")
	err = a.SetModelTags(canonical, []string{"联动"})
	testutil.NoError(t, err, "打标应成功")

	// 禁用：文件变 model.ysm.disabled，标签必须仍在规范路径
	enabled, err := a.ToggleEnable(canonical)
	testutil.NoError(t, err, "禁用应成功")
	if enabled {
		t.Error("首次切换应变为禁用(enabled=false)")
	}
	if got, _ := a.GetModelTags(canonical); len(got) != 1 || got[0] != "联动" {
		t.Errorf("禁用后规范路径标签应保留, got %v", got)
	}
	if paths := listByTagAll(t, a, "联动"); len(paths) != 1 || paths[0] != canonical {
		t.Errorf("禁用期间 ListByTag 应仍命中规范路径, got %v", paths)
	}

	// re-enable：从 .disabled 切回启用，标签原样复原
	enabled, err = a.ToggleEnable(canonical + ".disabled")
	testutil.NoError(t, err, "启回应成功")
	if !enabled {
		t.Error("二次切换应变为启用(enabled=true)")
	}
	if got, _ := a.GetModelTags(canonical); len(got) != 1 || got[0] != "联动" {
		t.Errorf("启回后规范路径标签应原样保留, got %v", got)
	}
}

// listByTagAll 包装 ListByTag，容忍其返回 nil/空切片两种表示。
func listByTagAll(t *testing.T, a *App, tag string) []string {
	t.Helper()
	paths, err := a.ListByTag(tag)
	testutil.NoError(t, err, "ListByTag(%q) 失败", tag)
	if paths == nil {
		return []string{}
	}
	return paths
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
		err := os.MkdirAll(d, 0o755)
		testutil.NoError(t, err, "MkdirAll")
	}
	src := filepath.Join(srcDir, "m.ysm")
	err := os.WriteFile(src, []byte("x"), 0o644)
	testutil.NoError(t, err, "WriteFile")
	a := repoApp(t, types.AppConfig{FilesRoot: base, CustomRoots: map[string]string{"mmd": filepath.Join(base, "mmd")}})

	// 同根：src 与 dst 都在 FilesRoot 内 → 允许（移动成功）
	err = a.MoveModelFile(src, dstDir)
	testutil.NoError(t, err, "同根移动应成功")
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
	// 不加 t.Parallel：本测试断言「二次 scan 命中包级全局 scanCache」这一前置，而并行组里
	// TestMoveModelFile_RootValidation 调 MoveModelFile 会 InvalidateCache 全局缓存、打掉
	// 本测试刚建立的 hit（MoveModelFile 上轮起纳入清缓存后新增的时序耦合）。非并行主序列
	// 先于所有 t.Parallel 测试跑完，串行即隔离。
	base := t.TempDir()
	sub := filepath.Join(base, "dst")
	err := os.MkdirAll(sub, 0o755)
	testutil.NoError(t, err, "MkdirAll")
	src := filepath.Join(base, "m.ysm")
	err = os.WriteFile(src, []byte("x"), 0o644)
	testutil.NoError(t, err, "WriteFile")
	a := repoApp(t, types.AppConfig{FilesRoot: base})

	// 预扫描建立缓存（同 app_scan_test 口径：首 miss、二 hit）
	_, hit := a.scanModelEntriesWithHit(base)
	testutil.Equal(t, hit, false, "首次扫描不应命中缓存")
	_, hit = a.scanModelEntriesWithHit(base)
	testutil.Equal(t, hit, true, "二次扫描应命中缓存（前置条件）")
	err = a.MoveModelFile(src, sub)
	testutil.NoError(t, err, "同根移动应成功")
	if _, hit := a.scanModelEntriesWithHit(base); hit {
		t.Error("MoveModelFile 成功后不应命中旧扫描缓存")
	}

	// 重新建立缓存（移动后首次扫已 miss，第二次应 hit——前置条件）
	_, hit = a.scanModelEntriesWithHit(base)
	testutil.Equal(t, hit, true, "移动后重扫第二次应命中缓存（前置条件）")
	err = a.CopyModelFile(filepath.Join(sub, "m.ysm"), base)
	testutil.NoError(t, err, "同根复制应成功")
	if _, hit := a.scanModelEntriesWithHit(base); hit {
		t.Error("CopyModelFile 成功后不应命中旧扫描缓存")
	}
	if _, hit := a.scanModelEntriesWithHit(base); !hit {
		t.Error("复制后重扫应命中新缓存")
	}
}

// 注：FindPreviewImage / ExtractPreviewTexture 的守卫拒绝已由 app_audit_fix_test.go
// 的 TestFindPreviewImage_Guard 覆盖，此处不再重复。
