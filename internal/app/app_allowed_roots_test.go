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

	a := &App{}
	// 关键：FilesRoot 必须为空才会走到 GetRepoRoot 的平台默认根分支（L167 FilesRoot
	// 分支优先于 L180 默认根分支）——这正是 Android「查看器模式」的初始状态：
	// 用户未配仓库目录，靠 defaultRepoRoot() 的环境变量/固定路径当仓库。
	a.configCache = types.AppConfig{
		McRoot: filepath.Join(base, "mc"),
	}
	a.configLoaded = true

	// 两侧守卫各自实际使用的根清单——必须同源（allScanRoots 是配置层子集，
	// 不再作为读写侧的比较对象；读写侧现走 allAllowedRoots）。
	readRoots := a.allAllowedRoots()
	toggleRoots := a.toggleAllowedRoots()

	// 断言 1：两套根清单须等价（集合差为空）。
	// 比较对象是「守卫实际使用的清单」——GetRepoRoot 返回的是平台默认根的子目录
	// （{默认根}/minecraft-mod/ysm），只比默认根本身会漏掉漂移。
	for _, r := range toggleRoots {
		if !containsPath(readRoots, r) {
			t.Errorf("启禁根清单含读写根清单没有的条目（漂移）:\n"+
				"  仅 toggleAllowedRoots 含: %s\n"+
				"  allAllowedRoots         : %v\n"+
				"  toggleAllowedRoots      : %v\n"+
				"  后果：该根下路径启禁放行而读写拒绝", r, readRoots, toggleRoots)
		}
	}
	for _, r := range readRoots {
		if !containsPath(toggleRoots, r) {
			t.Errorf("读写根清单含启禁根清单没有的条目（漂移）: 仅 allAllowedRoots 含 %s", r)
		}
	}

	// 断言 2：行为面等价——平台默认根下的文件，两守卫须给出相同判定。
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

	a := &App{}
	a.configCache = types.AppConfig{FilesRoot: filepath.Join(base, "files")}
	a.configLoaded = true

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

	a := &App{}
	a.configCache = types.AppConfig{
		FilesRoot:        "/files",
		McRoot:           "/mc",
		ResourcepackRoot: "", // migrateLegacyConfigFields 迁移后恒空
		MmdRoot:          "",
		CustomRoots:      map[string]string{"ysm": "/custom/ysm"},
	}
	a.configLoaded = true

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
