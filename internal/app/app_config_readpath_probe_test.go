// 双读路径对称性 + legacy 自定义根保全（锐评 2026-10-15 P2）。
//
// 病根：`loadAppConfig`（启动期，app.go|ServiceStartup 唯一配置填充者）与
// `LoadAppConfig`（惰性绑定）对同一份磁盘配置做了**不同**的后处理——
// ADR-296 D6 审查② 当时只把 `washLinkMode` 对称化，`migrateLegacyConfigFields`
// 被漏掉。于是：
//
//	启动路径：configCache = { YsmRoot: "D:/ysm", CustomRoots: nil }   ← 未迁移
//	惰性路径：configCache = { CustomRoots: {ysm: "D:/ysm"}, YsmRoot: "" } ← 已迁移
//
// 而任何一次写盘都走「以旧为基 + clearDeprecatedFields」（save 前者清零 7 个旧字段、
// 不碰 CustomRoots）。两者叠加出一个**静默数据丢失**窗口：
//
//	存量升级用户的配置（ysmRoot=D:/ysm，无 customRoots）
//	  → 启动（A 路径，configLoaded=true，惰性路径被 double-check 短路，永不迁移）
//	  → 用户在设置页保存任意一项（哪怕只换主题）
//	  → clearDeprecatedFields 把 ysmRoot 清零，而它从未被搬进 CustomRoots
//	  → specificRoot("ysm") 返回 "" → GetRepoRoot 回退 FilesRoot/{group}/{subDir}
//	  → 用户设的独立路径彻底消失，全程零报错零提示
//
// 触发条件窄（存量升级用户 + 首启后第一次保存），但后果是不可逆的用户数据丢失——
// 且 `TestSaveAppConfig_ClearsDeprecatedFields` 恰好把「清零」锁成了期望行为。
//
// 本文件锁修复后的三条不变量：
//  1. 启动路径同样跑 migrateLegacyConfigFields（旧字段搬进 CustomRoots 后清零）
//  2. 首次写盘（含「只改主题」这种与路径无关的保存）不丢 legacy 自定义根
//  3. 双读路径对同一份磁盘配置产出**相同**的 configCache（对称性的可执行定义）
package app

import (
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// startupPathApp 构造「启动期已 loadAppConfig 过」的 App。
// ⚠️ 必须真调 loadAppConfig 而非手注 configCache —— 手注会绕过被测的那段逻辑
// （app_config_preserve_test.go 用手注模拟「启动残留」正是为了隔离别的东西）。
func startupPathApp(t *testing.T, disk types.AppConfig) *App {
	t.Helper()
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	t.Cleanup(func() { pathMgr = orig })

	a := newLinkModeApp()
	testutil.NoError(t, a.saveConfig(disk), "落盘基线（模拟磁盘上已有该配置）")
	// 清标记后走启动路径重填 cache —— 这才是真实启动序列
	a.configMu.Lock()
	a.configLoaded = false
	a.configMu.Unlock()
	a.loadAppConfig()
	return a
}

// TestLoadAppConfig_MigratesLegacyFieldsOnStartupPath 锁不变量 1：
// 启动路径必须与惰性路径一样跑字段迁移。
func TestLoadAppConfig_MigratesLegacyFieldsOnStartupPath(t *testing.T) {
	a := startupPathApp(t, types.AppConfig{
		FilesRoot: "C:/repo",
		YsmRoot:   "C:/legacy/ysm", // ADR-095 前的旧字段
		MmdRoot:   "C:/legacy/mmd",
		LinkMode:  "copy",
	})

	cached := a.LoadAppConfig() // 启动已填好，这里只读内存副本
	if cached.CustomRoots == nil || cached.CustomRoots["ysm"] == "" {
		t.Fatalf("启动路径未迁移 legacy 字段：CustomRoots=%v（期望含 ysm→%q）", cached.CustomRoots, "C:/legacy/ysm")
	}
	// MmdRoot 的迁移目标是多个资源类型 ID（EntityPlayer/SceneModel 等，见 migrateLegacyConfigFields
	// 的 rt.ConfigField 遍历），不是一个「mmd」键——这里只锁「旧字段被清零」这一侧，
	// 具体迁移到哪些键由 registry 决定，不在本用例断言范围。
	// 迁移后旧字段必须清零（防双源写入不变量）
	if cached.YsmRoot != "" || cached.MmdRoot != "" {
		t.Errorf("迁移后旧字段未清零（防双源不变量）: YsmRoot=%q MmdRoot=%q", cached.YsmRoot, cached.MmdRoot)
	}
}

// TestStartupPath_LegacyRootSurvivesFirstWrite 锁不变量 2（本组的核心）：
// 存量升级用户的 legacy 自定义根，经一次「只改主题」的保存后必须还在。
// 这是修复前的真实数据丢失场景。
func TestStartupPath_LegacyRootSurvivesFirstWrite(t *testing.T) {
	a := startupPathApp(t, types.AppConfig{
		FilesRoot: "C:/repo",
		YsmRoot:   "C:/legacy/ysm",
		LinkMode:  "copy",
	})

	// 用户只改主题（与路径完全无关的保存）
	theme := "warm"
	testutil.NoError(t, a.SaveAppConfigPatch(types.AppConfigPatch{Theme: &theme}), "首次写盘（只改主题）")

	after := a.LoadAppConfig()
	if after.CustomRoots == nil || after.CustomRoots["ysm"] == "" {
		t.Fatalf("用户的老 ysmRoot 经一次「只改主题」的保存后丢失：CustomRoots=%v", after.CustomRoots)
	}
	if got := specificRoot(after, "ysm"); got == "" {
		t.Errorf("specificRoot 取不到 legacy 路径（用户独立路径已失效，会静默回退 FilesRoot 派生路径）")
	}
	// 路径确实保住了，且主题改动也生效（两个诉求都要满足——这正是原实现的误判点：
	// 「以旧为基」与「迁移」被当成互斥，实际可以既迁移又清零）
	if after.Theme != "warm" {
		t.Errorf("主题改动未生效: %q want %q", after.Theme, "warm")
	}
}

// TestBothReadPaths_SymmetricOnSameDisk 锁不变量 3：
// 同一份磁盘配置，两条读路径产出的 cache 必须逐字段相同。
// 这是「对称性」的可执行定义——比逐个迁移函数比对更难退化（新增迁移步骤时
// 忘记加到 A 路径，本用例立刻转红）。
func TestBothReadPaths_SymmetricOnSameDisk(t *testing.T) {
	disk := types.AppConfig{
		FilesRoot: "C:/repo",
		YsmRoot:   "C:/legacy/ysm",
		MmdRoot:   "C:/legacy/mmd",
		LinkMode:  "hardlink",
		Theme:     "sakura",
	}

	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	t.Cleanup(func() { pathMgr = orig })

	// 先落一份磁盘基线。两个 App 实例共享同一份磁盘文件（pathMgr 是包级全局），
	// 这是「同一份磁盘配置」的可执行构造——若各起一个 tmpdir，测的就是两份不同配置。
	seed := newLinkModeApp()
	testutil.NoError(t, seed.saveConfig(disk), "落盘基线")

	// 启动路径：走 loadAppConfig（configLoaded=false → 触发真实读盘）
	startupApp := newLinkModeApp()
	startupApp.loadAppConfig()
	startupGot := startupApp.LoadAppConfig() // double-check 命中，只读 cache

	// 惰性路径：fresh App（configLoaded 仍 false），只走 LoadAppConfig
	lazyApp := newLinkModeApp()
	lazyGot := lazyApp.LoadAppConfig()

	if startupGot.CustomRoots == nil {
		t.Fatalf("启动路径 CustomRoots 为 nil，无法比对")
	}
	if len(startupGot.CustomRoots) != len(lazyGot.CustomRoots) {
		t.Fatalf("双路径 CustomRoots 不等：启动=%v 惰性=%v", startupGot.CustomRoots, lazyGot.CustomRoots)
	}
	for k, v := range lazyGot.CustomRoots {
		if startupGot.CustomRoots[k] != v {
			t.Errorf("双路径 CustomRoots[%q] 不等：启动=%q 惰性=%q", k, startupGot.CustomRoots[k], v)
		}
	}
	if startupGot.YsmRoot != lazyGot.YsmRoot || startupGot.LinkMode != lazyGot.LinkMode {
		t.Errorf("双路径旧字段/linkMode 不等：启动 YsmRoot=%q LinkMode=%q；惰性 YsmRoot=%q LinkMode=%q",
			startupGot.YsmRoot, startupGot.LinkMode, lazyGot.YsmRoot, lazyGot.LinkMode)
	}
}
