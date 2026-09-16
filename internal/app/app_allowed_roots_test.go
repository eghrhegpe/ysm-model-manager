package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// TestAllowedRoots_SingleSource 钉住「启禁允许根」与「扫描/读写根」同源。
//
// 背景：原实现两套手工清单互不等价——
//   - allScanRoots（app_scan.go）= FilesRoot + McRoot + 6 个废弃类型专属字段 + CustomRoots
//   - toggleAllowedRoots（app_files.go）= FilesRoot + McRoot + GetRepoRoot("ysm") + CustomRoots
//
// 6 个废弃字段经 migrateLegacyConfigFields 恒空（被 `root == ""` 跳过），故桌面平台两者
// 实际等价；但 **Android 平台** defaultRepoRoot() 非空（/storage/emulated/0/YSM-Model-Manager）
// 且用户未配 FilesRoot 时（查看器模式，正是该平台的设计意图）：
// GetRepoRoot("ysm") 返回该默认根 → toggleAllowedRoots 含它、allScanRoots 不含 →
// **启禁放行而读写拒绝**（目录级不一致：能改文件名却读不了文件）。
//
// 不变量：任一路径在「启禁守卫」放行，必须在「读写/扫描守卫」也放行（反之亦然）。
func TestAllowedRoots_SingleSource(t *testing.T) {
	base := t.TempDir()
	// 模拟 Android 默认根：一个**不在** FilesRoot/McRoot/CustomRoots 内的独立目录
	platformDefault := filepath.Join(base, "android-default", "YSM-Model-Manager")
	if err := os.MkdirAll(platformDefault, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	orig := pathMgr
	defer func() { pathMgr = orig }()
	pathMgr = fakePathMgr{repo: platformDefault}

	// 走 repoApp 注入（内部取 configMu）：直接写 configCache/configLoaded 无锁
	// 注入在本包其他测试与生产读取路径并发时有 -race 风险
	a := repoApp(t, types.AppConfig{
		McRoot: filepath.Join(base, "mc"),
	})

	// 两侧守卫各自实际使用的根清单——现 toggleAllowedRoots 已收敛为 allAllowedRoots
	// 的同源调用（ADR 34a866ed3），「两套清单漂移」结构上不可表达，原集合差断言
	// 已恒真、无保护力，删除；改由下方行为面断言钉住不变量。

	// 行为面等价——平台默认根下的文件，两守卫须给出相同判定。
	// 用 GetRepoRoot 实际返回的根（而非默认根本身）构造路径。
	ysmRoot, _ := a.GetRepoRoot("ysm")
	if ysmRoot == "" {
		t.Fatal("本用例前提：未配 FilesRoot 时应由 defaultRepoRoot 提供 ysm 根")
	}
	insideFile := filepath.Join(ysmRoot, "model.ysm")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(insideFile, []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	readable := a.isPathInRootOrSelf(insideFile)
	toggleable := a.toggleRootFor(insideFile) != ""
	if readable != toggleable {
		t.Errorf("同一路径两守卫判定不一致（行为漂移）:\n"+
			"  isPathInRootOrSelf(读写)=%v\n  toggleRootFor(启禁)  =%v\n  路径=%s",
			readable, toggleable, insideFile)
	}
}

// TestAllowedRoots_RejectOutsideAllRoots 两套守卫都必须拒绝全部根之外的路径。
func TestAllowedRoots_RejectOutsideAllRoots(t *testing.T) {
	base := t.TempDir()
	outside := filepath.Join(base, "outside", "evil.ysm")
	if err := os.MkdirAll(filepath.Dir(outside), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	orig := pathMgr
	defer func() { pathMgr = orig }()
	pathMgr = fakePathMgr{repo: ""}

	a := repoApp(t, types.AppConfig{FilesRoot: filepath.Join(base, "files")})

	if a.isPathInRootOrSelf(outside) {
		t.Error("读写守卫不得放行全部根之外的路径")
	}
	if a.toggleRootFor(outside) != "" {
		t.Error("启禁守卫不得放行全部根之外的路径")
	}
}

// TestToggleAllowedRoots_NoLegacyEmptyFields 废弃字段恒空后不应污染根清单。
func TestToggleAllowedRoots_NoLegacyEmptyFields(t *testing.T) {
	orig := pathMgr
	defer func() { pathMgr = orig }()
	pathMgr = fakePathMgr{repo: ""}

	a := repoApp(t, types.AppConfig{
		FilesRoot:        "/files",
		McRoot:           "/mc",
		ResourcepackRoot: "", // migrateLegacyConfigFields 迁移后恒空
		MmdRoot:          "",
		CustomRoots:      map[string]string{"ysm": "/custom/ysm"},
	})

	for _, r := range a.toggleAllowedRoots() {
		if r == "" {
			t.Error("根清单不得含空串条目（空串会匹配任意路径的 Rel 计算）")
		}
	}
	if !containsPath(a.toggleAllowedRoots(), "/custom/ysm") {
		t.Errorf("CustomRoots 条目应进根清单, got %v", a.toggleAllowedRoots())
	}
}

func containsPath(roots []string, want string) bool {
	for _, r := range roots {
		if filepath.Clean(r) == filepath.Clean(want) {
			return true
		}
	}
	return false
}

// TestAllowedRootsCache_InvalidateOnSessionOverride 钉住失效契约：
// 根清单缓存（app_allowed_roots_cache.go）的不变量是「根清单变化处必须 Clear」。
// SetSessionFilesRoot 是唯一绕过 saveConfig 直改 configCache.FilesRoot 的入口
// （CLI --files-root，仅内存），须与 saveConfig 同失效——否则 session 覆写后
// 热路径守卫持续用旧根清单（防御纵深：现实调用时序先于缓存预热，窗口为零，
// 但契约不能依赖时序）。
func TestAllowedRootsCache_InvalidateOnSessionOverride(t *testing.T) {
	base := t.TempDir()
	oldRoot := filepath.Join(base, "old")
	newRoot := filepath.Join(base, "new")
	for _, d := range []string{oldRoot, newRoot} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}

	orig := pathMgr
	defer func() { pathMgr = orig }()
	pathMgr = fakePathMgr{repo: ""}

	a := repoApp(t, types.AppConfig{FilesRoot: oldRoot})

	// 预热缓存（旧根可读、新根被拒）
	if !a.isPathInRootOrSelf(filepath.Join(oldRoot, "m.ysm")) {
		t.Fatal("前提失败：旧根内路径应放行")
	}
	if a.isPathInRootOrSelf(filepath.Join(newRoot, "m.ysm")) {
		t.Fatal("前提失败：新根路径在覆写前应被拒")
	}

	// session 覆写 → 缓存须失效，新根立即生效
	a.SetSessionFilesRoot(newRoot)
	if !a.isPathInRootOrSelf(filepath.Join(newRoot, "m.ysm")) {
		t.Error("SetSessionFilesRoot 后新根内路径应放行（缓存未失效=stale 旧根清单）")
	}
	if a.isPathInRootOrSelf(filepath.Join(oldRoot, "m.ysm")) {
		t.Error("SetSessionFilesRoot 后旧根内路径应被拒（缓存未失效=stale 旧根清单）")
	}
}
