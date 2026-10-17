package app

// 设置导出/导入回归（ADR-344-d1）。
//
// 立因：`b1116645c` 只写了「备份迁移双轨叙事」文档、代码从未实现导出/导入（git log -S
// exportSettings 为空）——用户按备份迁移文档复制 ysm_config.json 就静默丢掉几十项浏览器偏好。
// 本文件锁导出格式门控、往返一致性与导入前备份三条不变量。

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// exportTestApp 构造可安全调用写入口的 App（install 非空 + 配置目录隔离到临时目录）。
func exportTestApp(t *testing.T, cfg types.AppConfig) *App {
	t.Helper()
	setConfigDirForTest(t, t.TempDir())
	a := newLinkModeApp()
	// 基线落盘（建立磁盘 + configCache 双源）
	testutil.NoError(t, a.saveConfig(cfg), "saveConfig 基线")
	a.configMu.Lock()
	a.configCache = cfg
	a.configLoaded = true
	a.configMu.Unlock()
	return a
}

// assertExportPathInConfigDir 断言导出路径落在应用数据目录且文件名带时间戳前缀。
// 不能精确等于 settingsExportPath()（锐评 P2③：文件名带时间戳，两次调用毫秒可能不同）。
func assertExportPathInConfigDir(t *testing.T, path string) {
	t.Helper()
	if filepath.Dir(path) != configDir() {
		t.Errorf("导出目录=%q want=%q", filepath.Dir(path), configDir())
	}
	base := filepath.Base(path)
	if !strings.HasPrefix(base, "ysm-settings-export-") || !strings.HasSuffix(base, ".json") {
		t.Errorf("导出文件名应带时间戳前缀: got=%q", base)
	}
}

func TestExportSettingsJSON_WritesExportFileAtAppDataDir(t *testing.T) {
	a := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo", Theme: "dark"})

	path, err := a.ExportSettingsJSON(map[string]string{
		"ui-font-size":    "14",
		"ui-card-density": "compact",
	})
	testutil.NoError(t, err, "ExportSettingsJSON")
	assertExportPathInConfigDir(t, path)
	data, err := os.ReadFile(path)
	testutil.NoError(t, err, "ReadFile 导出文件")
	var exp types.SettingsExport
	testutil.NoError(t, json.Unmarshal(data, &exp), "unmarshal 导出文件")
	if exp.Format != settingsExportFormat {
		t.Errorf("导出 format=%q", exp.Format)
	}
	if exp.ExportVersion != settingsExportVersion {
		t.Errorf("导出 ExportVersion=%d", exp.ExportVersion)
	}
	if exp.AppConfig.Theme != "dark" || exp.AppConfig.FilesRoot != "C:/repo" {
		t.Errorf("导出 appConfig 未携带磁盘轨配置: %+v", exp.AppConfig)
	}
	if exp.LocalStorage["ui-font-size"] != "14" || exp.LocalStorage["ui-card-density"] != "compact" {
		t.Errorf("导出 localStorage 未携带浏览器偏好: %#v", exp.LocalStorage)
	}
}

// 导出侧尺寸闸（锐评 2026-10-16；2026-10-17 补 P2① 前置粗估）：与 ReadSettingsExport 的导入闸对称。
// 无门槛时前端被塞进畸形的 localStorage 会写出一个导入侧必然拒收的大文件，用户白拷一份失败备份。
// 2026-10-17 起闸门**前置为 marshal 前的粗估早退**（estimateLocalStorageSize + settingsExportReserveBytes 余量）：
// 原闸在 json.MarshalIndent 之后才判超限，畸形输入已整份 marshal 完、内存与 CPU 白付（「防资源浪费」语义被架空一半）。
// 粗估早退先拒明显超限，marshal 后的精查保留作最终裁决；两条路径都不许落盘导出文件。
func TestExportSettingsJSON_RejectsOversizedLocalStorage(t *testing.T) {
	a := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo"})
	big := strings.Repeat("x", settingsExportMaxBytes+1)
	if _, err := a.ExportSettingsJSON(map[string]string{"k": big}); err == nil {
		t.Fatal("超过上限的 localStorage 不得导出（导入侧必然拒收，白拷失败备份）")
	}

	matches, err := filepath.Glob(filepath.Join(configDir(), "ysm-settings-export-*.json"))
	testutil.NoError(t, err, "glob 导出文件")
	if len(matches) != 0 {
		t.Errorf("超限导出不得落盘任何文件: got %d", len(matches))
	}
}

func TestReadSettingsExport_RejectsForeignJSON(t *testing.T) {
	a := &App{}
	foreign := filepath.Join(t.TempDir(), "random.json")
	testutil.NoError(t, os.WriteFile(foreign, []byte(`{"foo":1}`), 0o644), "写无关 JSON")

	if _, err := a.ReadSettingsExport(foreign); err == nil {
		t.Fatal("无关 JSON 不得被当作设置导出文件解析")
	}

	higher := filepath.Join(t.TempDir(), "future.json")
	testutil.NoError(t, os.WriteFile(higher, []byte(`{"format":"ysm-settings-export","exportVersion":99}`), 0o644), "写未来版本导出")
	if _, err := a.ReadSettingsExport(higher); err == nil {
		t.Fatal("高于当前版本的导出应被拒绝（提示升级程序）")
	}
}

// 跨版本配置 schema 门控（锐评 2026-10-16）：ExportVersion 门控的是**文件格式**，
// 不门控裹在里面的 AppConfig.SchemaVersion。**高 schema** 的配置（新版程序 bump
// schema 并改结构后导出、用户在旧版导入）会被 applyConfigMigrations 按 `>= 当前版本`
// 跳过迁移，旧程序按旧结构读新数据静默错读，再落盘把高版本章焊死——与导出文件
// 版本门控对称的最后一道闸。
func TestReadSettingsExport_RejectsHigherSchemaVersion(t *testing.T) {
	dir := t.TempDir()
	higher := filepath.Join(dir, "future-schema.json")
	testutil.NoError(t, os.WriteFile(higher, []byte(
		`{"format":"ysm-settings-export","exportVersion":1,"appConfig":{"schemaVersion":99999}}`,
	), 0o644), "写高 schema 导出")
	if _, err := (&App{}).ReadSettingsExport(higher); err == nil {
		t.Fatal("高于当前程序 schema 的配置不得导入（旧程序按旧结构读新数据 = 静默错读）")
	}

	// 等值 / 遗留 0 都必须放行（放行面回归：遗留文件由 applyConfigMigrations 正常迁移）
	for i, body := range []string{
		`{"format":"ysm-settings-export","exportVersion":1,"appConfig":{}}`,
		`{"format":"ysm-settings-export","exportVersion":1,"appConfig":{"schemaVersion":1}}`,
	} {
		f := filepath.Join(dir, "ok.json")
		testutil.NoError(t, os.WriteFile(f, []byte(body), 0o644), "写放行样本")
		if _, err := (&App{}).ReadSettingsExport(f); err != nil {
			t.Errorf("样本 %d 应放行: %v", i, err)
		}
	}

	// 双门控共用 SETTINGS_TOO_NEW 专用 Code（对抗审计 2026-10-16 P1）：friendlyError
	// 命中 Code 映射即丢弃 Reason/Suggestion，「升级后重试」指引必须由 Code 的 i18n
	// 分类文案承载——复用泛化 Code（UNSUPPORTED_FORMAT）会把它吞成「不支持的格式」。
	// 断言两道闸（ExportVersion / SchemaVersion）都挂对 Code。
	for _, body := range []string{
		`{"format":"ysm-settings-export","exportVersion":99}`,
		`{"format":"ysm-settings-export","exportVersion":1,"appConfig":{"schemaVersion":99999}}`,
	} {
		f := filepath.Join(dir, "gate-code.json")
		testutil.NoError(t, os.WriteFile(f, []byte(body), 0o644), "写门控样本")
		_, err := (&App{}).ReadSettingsExport(f)
		var ae types.AppError
		if !errors.As(err, &ae) || ae.Code != types.ErrSettingsTooNew {
			t.Errorf("门控样本应返回 AppError{Code:SETTINGS_TOO_NEW}，got %v", err)
		}
	}
}

// 假备份拒止（锐评 2026-10-16 引入，2026-10-17 收窄判据）：配置文件存在却**无法解析** =
// loadAppConfig 在 JSON 损坏时保留零值不重试的形态。此前只 log.Printf，而做备份迁移的
// 用户恰恰不看日志：零值假备份是延迟引爆炸弹——换机那天才发现路径全丢，比不做备份更糟
// （以为有了保险）。从静音升为拒绝导出：备份动作失败必须当场可见，宁可不给保险也不给假保险。
// 判据收窄见下方 AllowsExistingConfigWithoutPaths（路径空 ≠ 损坏，原判据误伤正常用户）。
func TestExportSettingsJSON_RejectsCorruptConfig(t *testing.T) {
	// 配置文件存在但内容损坏（无法解析 → loadAppConfig 走零值缓存）
	setConfigDirForTest(t, t.TempDir())
	testutil.NoError(t, os.WriteFile(configPath(), []byte(`{not valid json[`), 0o644), "写损坏配置")
	a := newLinkModeApp()

	if _, err := a.ExportSettingsJSON(map[string]string{"ui-font-size": "14"}); err == nil {
		t.Fatal("配置文件损坏（无法解析）时不得导出假备份（须当场报错，不能只落日志）")
	}
}

// 放行面回归（锐评 2026-10-17 P1③）：配置文件**存在且 JSON 合法**但无任何路径设置时
// 必须放行——启动链 resolveStartupConfigBootstrap 会在首启动自动探测 Minecraft 目录落盘，
// 装过 Minecraft 但尚未设文件存储根目录的用户配置文件是存在且合法的；原判据（路径空）
// 把它们误判为「损坏形态」拒绝导出，是真实的误伤路径。
func TestExportSettingsJSON_AllowsExistingConfigWithoutPaths(t *testing.T) {
	setConfigDirForTest(t, t.TempDir())
	testutil.NoError(t, os.WriteFile(configPath(), []byte(`{}`), 0o644), "写合法空配置")
	a := newLinkModeApp()

	if _, err := a.ExportSettingsJSON(map[string]string{"ui-font-size": "14"}); err != nil {
		t.Fatalf("配置文件存在但 JSON 合法（路径空）时应放行，got %v", err)
	}
}

func TestExportSettingsJSON_AllowsNewUserWithoutPaths(t *testing.T) {
	// 放行面回归：全新用户（配置文件不存在、尚未设置路径）导出不受限——
	// 拒止只针对「文件存在但零值」的损坏形态，不惩罚正常的首启动用户
	setConfigDirForTest(t, t.TempDir())
	a := newLinkModeApp()
	path, err := a.ExportSettingsJSON(map[string]string{})
	testutil.NoError(t, err, "全新用户导出应放行")
	assertExportPathInConfigDir(t, path)
}

func TestImportSettingsFromFile_RoundTripAndBackup(t *testing.T) {
	const root = "C:/repo"
	src := exportTestApp(t, types.AppConfig{FilesRoot: root, Theme: "dark", Mirror: "jsdelivr"})
	srcPath, err := src.ExportSettingsJSON(map[string]string{
		"ui-font-size": "16",
		"td-cam-speed": "2.4",
	})
	testutil.NoError(t, err, "ExportSettingsJSON")

	// 目标机已有其它配置（FilesRoot 相同 → 不触发 watcher 重建，隔离本测试关注面）
	dst := exportTestApp(t, types.AppConfig{FilesRoot: root, Theme: "light", Mirror: "ghproxy"})

	res, err := dst.ImportSettingsFromFile(srcPath)
	testutil.NoError(t, err, "ImportSettingsFromFile")
	// 提示条数归属前端：Go 侧无前端台账键集合，LocalStorageKeyCount 已删除
	if res.BackupPath == "" {
		t.Fatal("导入前必须备份当前配置（可回滚）")
	}
	if _, err := os.Stat(res.BackupPath); err != nil {
		t.Fatalf("备份文件应存在: %s (%v)", res.BackupPath, err)
	}

	onDisk := dst.LoadAppConfig()
	if onDisk.Theme != "dark" || onDisk.Mirror != "jsdelivr" {
		t.Errorf("导入后磁盘配置未变为导出源: Theme=%q Mirror=%q", onDisk.Theme, onDisk.Mirror)
	}
	// 备份内容应为导入前的旧配置（light + ghproxy），证明备份不是自拷贝
	bakData, err := os.ReadFile(res.BackupPath)
	testutil.NoError(t, err, "读备份")
	var bak types.AppConfig
	testutil.NoError(t, json.Unmarshal(bakData, &bak), "unmarshal 备份")
	if bak.Theme != "light" || bak.Mirror != "ghproxy" {
		t.Errorf("备份应为导入前的旧配置: Theme=%q Mirror=%q", bak.Theme, bak.Mirror)
	}
}

// ImportSettingsData（锐评 P2②）：前端 ReadSettingsExport 预览后把**同一个** exp 传入落盘，
// 不再对同一文件读两遍（消除计数与实际写入可能不符的 TOCTOU）。测试直接用构造的
// SettingsExport，验证备份 + 配置覆盖。
// pruneOldExportFiles（锐评 P2③）：导出文件名带时间戳后每次导出都是新文件，须 LRU 裁剪
// 到 settingsExportKeep 份，否则导出目录无限堆积。
func TestPruneOldExportFiles_KeepsRecentExports(t *testing.T) {
	a := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo", Theme: "dark"})
	dir := configDir()
	for i := 0; i < settingsExportKeep+5; i++ {
		name := fmt.Sprintf("ysm-settings-export-20260101-0000%02d.000.json", i)
		testutil.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("{}"), 0o644), "写假导出文件")
	}
	a.pruneOldExportFiles()
	matches, err := filepath.Glob(filepath.Join(dir, "ysm-settings-export-*.json"))
	testutil.NoError(t, err, "Glob 导出文件")
	sort.Strings(matches) // 与 prune 内部同序，matches[0] 即最旧一份
	if len(matches) != settingsExportKeep {
		t.Errorf("应裁剪到 %d 份，got %d", settingsExportKeep, len(matches))
	}
	// 最旧的一份（时间戳前缀字典序最小，编号 00..）必须被删
	if !strings.HasSuffix(matches[0], "00005.000.json") {
		t.Errorf("应保留时间戳较新的导出，got oldest=%q", matches[0])
	}
}

func TestImportSettingsData_RoundTripAndBackup(t *testing.T) {
	const root = "C:/repo"
	dst := exportTestApp(t, types.AppConfig{FilesRoot: root, Theme: "light", Mirror: "ghproxy"})
	exp := types.SettingsExport{
		Format:        settingsExportFormat,
		ExportVersion: settingsExportVersion,
		AppConfig:     types.AppConfig{FilesRoot: root, Theme: "dark", Mirror: "jsdelivr"},
		LocalStorage:  map[string]string{"ui-font-size": "16"},
	}

	res, err := dst.ImportSettingsData(exp)
	testutil.NoError(t, err, "ImportSettingsData")
	if res.BackupPath == "" {
		t.Fatal("导入前必须备份当前配置（可回滚）")
	}
	if _, err := os.Stat(res.BackupPath); err != nil {
		t.Fatalf("备份文件应存在: %s (%v)", res.BackupPath, err)
	}
	onDisk := dst.LoadAppConfig()
	if onDisk.Theme != "dark" || onDisk.Mirror != "jsdelivr" {
		t.Errorf("导入后配置未覆盖: theme=%q mirror=%q", onDisk.Theme, onDisk.Mirror)
	}
}

// ImportSettingsData 数据入口防线（锐评 P2②）：exp 未走 ReadSettingsExport 校验（format 不符）
// 必须拒止，否则调用方传错/伪造数据会以零值 AppConfig 覆盖当前配置。
func TestImportSettingsData_RejectsBadFormat(t *testing.T) {
	dst := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo", Theme: "dark"})
	_, err := dst.ImportSettingsData(types.SettingsExport{Format: "whatever", AppConfig: types.AppConfig{}})
	if err == nil {
		t.Fatal("format 不符的导出数据应被拒止")
	}
	onDisk := dst.LoadAppConfig()
	if onDisk.Theme != "dark" {
		t.Errorf("拒止后不应改动配置，got theme=%q", onDisk.Theme)
	}
}

// 第二轮锐评 P1⑤（2026-10-18）：双版本闸（ExportVersion/SchemaVersion）此前只挂在
// ReadSettingsExport（预览读出口），P2② 把写盘主入口搬进 ImportSettingsData 后闸没跟着搬——
// 代码里自述的「高版本程序导出、本程序直读会静默错读、落盘把高版本章焊死」危害恰好发生在
// 无闸分支。教训：门控跟着「写路径唯一出口」走，不跟着调用链的便利侧留念。
func TestImportSettingsData_RejectsTooNewVersions(t *testing.T) {
	dst := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo", Theme: "dark"})

	for name, exp := range map[string]types.SettingsExport{
		"高格式版本":    {Format: settingsExportFormat, ExportVersion: settingsExportVersion + 1, AppConfig: types.AppConfig{Theme: "mint"}},
		"高 schema": {Format: settingsExportFormat, ExportVersion: settingsExportVersion, AppConfig: types.AppConfig{SchemaVersion: types.SchemaVersion + 1, Theme: "mint"}},
	} {
		_, err := dst.ImportSettingsData(exp)
		var ae types.AppError
		if !errors.As(err, &ae) || ae.Code != types.ErrSettingsTooNew {
			t.Errorf("%s：应拒为 AppError{Code:SETTINGS_TOO_NEW}，got %v", name, err)
			continue
		}
		if got := dst.LoadAppConfig().Theme; got != "dark" {
			t.Errorf("%s：拒止后不得改动配置，got theme=%q", name, got)
		}
	}

	// 放行面回归：等值版本照常落盘 + 备份（防闸搬过去误杀正常导入；遗留 0 值由
	// applyConfigMigrations 正常迁移，同样必须放行）
	res, err := dst.ImportSettingsData(types.SettingsExport{
		Format:        settingsExportFormat,
		ExportVersion: settingsExportVersion,
		AppConfig:     types.AppConfig{FilesRoot: "C:/repo", Theme: "light"},
	})
	testutil.NoError(t, err, "等值版本应放行")
	if res.BackupPath == "" || dst.LoadAppConfig().Theme != "light" {
		t.Errorf("闸迁移不得改变正常导入行为: backup=%q theme=%q", res.BackupPath, dst.LoadAppConfig().Theme)
	}
	if _, err := dst.ImportSettingsData(types.SettingsExport{
		Format:    settingsExportFormat,
		AppConfig: types.AppConfig{FilesRoot: "C:/repo", Theme: "dark"},
	}); err != nil {
		t.Errorf("ExportVersion 缺省 0 的遗留文件应放行: %v", err)
	}
}

func TestImportSettingsFromFile_MigratesLegacyRootFields(t *testing.T) {
	const root = "C:/repo"
	src := exportTestApp(t, types.AppConfig{FilesRoot: root})
	// 导出的 JSON 手工改成旧字段形态（YsmRoot 存在、schemaVersion 缺失）
	srcPath, err := src.ExportSettingsJSON(map[string]string{})
	testutil.NoError(t, err, "ExportSettingsJSON")
	var exp types.SettingsExport
	data, err := os.ReadFile(srcPath)
	testutil.NoError(t, err, "读导出")
	testutil.NoError(t, json.Unmarshal(data, &exp), "unmarshal")
	exp.AppConfig = types.AppConfig{FilesRoot: root, YsmRoot: "D:/ysm"} // schemaVersion=0 = 遗留文件
	legacy, err := json.Marshal(exp)
	testutil.NoError(t, err, "marshal 遗留导出")
	testutil.NoError(t, os.WriteFile(srcPath, legacy, 0o644), "改写为遗留形态")

	dst := exportTestApp(t, types.AppConfig{FilesRoot: root})
	if _, err := dst.ImportSettingsFromFile(srcPath); err != nil {
		t.Fatalf("ImportSettingsFromFile: %v", err)
	}
	got := dst.LoadAppConfig()
	if got.CustomRoots["ysm"] != "D:/ysm" {
		t.Errorf("遗留 YsmRoot 未迁入 CustomRoots[ysm]: %#v", got.CustomRoots)
	}
	if got.YsmRoot != "" {
		t.Errorf("迁移后废弃字段 YsmRoot 应为空: %q", got.YsmRoot)
	}
	if got.SchemaVersion != types.SchemaVersion {
		t.Errorf("迁移后应盖版本章: %d", got.SchemaVersion)
	}
}

// ListSettingsBackups（锐评 P2④）：列出导入前备份，最新在前；无备份返回空切片（非 nil）。
func TestListSettingsBackups_RoundTrip(t *testing.T) {
	a := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo", Theme: "dark"})

	backups, err := a.ListSettingsBackups()
	testutil.NoError(t, err, "无备份时应返回空列表")
	if len(backups) != 0 {
		t.Fatalf("无备份时 got %d 条，want 0", len(backups))
	}

	for _, stamp := range []string{"20260101-000000.000", "20260102-000000.000"} {
		bak := configPath() + ".bak-" + stamp
		testutil.NoError(t, os.WriteFile(bak, []byte("{}"), 0o644), "写假备份 "+stamp)
	}
	backups, err = a.ListSettingsBackups()
	testutil.NoError(t, err, "ListSettingsBackups")
	if len(backups) != 2 {
		t.Fatalf("got %d 条备份，want 2", len(backups))
	}
	if filepath.Base(backups[0]) != "ysm_config.json.bak-20260102-000000.000" {
		t.Errorf("最新备份应在前，got %q", filepath.Base(backups[0]))
	}
}

// RestoreSettingsBackup（锐评 P2④）：恢复到指定备份的配置，走同一套写入口与侧效。
func TestRestoreSettingsBackup_RestoresToBackupValue(t *testing.T) {
	a := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo", Theme: "dark"})
	bak, err := a.backupConfigFile()
	testutil.NoError(t, err, "backupConfigFile")
	if bak == "" {
		t.Fatal("应有备份路径")
	}
	// 改动配置，再恢复
	if err := a.saveConfig(types.AppConfig{FilesRoot: "C:/repo2", Theme: "light"}); err != nil {
		t.Fatalf("saveConfig: %v", err)
	}
	if a.LoadAppConfig().Theme != "light" {
		t.Fatalf("前置：改后主题应为 light, got %q", a.LoadAppConfig().Theme)
	}
	testutil.NoError(t, a.RestoreSettingsBackup(bak), "RestoreSettingsBackup")
	if got := a.LoadAppConfig().Theme; got != "dark" {
		t.Errorf("恢复后主题应为 dark（备份值），got %q", got)
	}
	if got := a.LoadAppConfig().FilesRoot; got != "C:/repo" {
		t.Errorf("恢复后 FilesRoot 应为 C:/repo（备份值），got %q", got)
	}
	// 备份文件不存在 → 报错
	if err := a.RestoreSettingsBackup(filepath.Join(configDir(), "ysm_config.json.bak-99999999-000000.000")); err == nil {
		t.Error("备份文件不存在应报错")
	}
}

// TestRestoreSettingsBackup_RejectsForeignPaths 二轮锐评 P2⑦：恢复是有副作用的写，
// 入口曾接受任意路径——JS 可传指向任意 JSON 的路径整份覆盖配置（ReadSettingsExport
// 注释自述威胁模型的具象）。判据两条：目录归属 configDir() + 文件名「ysm_config.json.bak-」
// 前缀。断言错误码为 ErrInvalidParam（证明确实被闸拒、而非碰巧 ENOENT）；正例对照
// 防闸过紧杀掉 UI 自己的恢复链路。
func TestRestoreSettingsBackup_RejectsForeignPaths(t *testing.T) {
	dst := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo", Theme: "dark"})
	if _, err := dst.ImportSettingsData(types.SettingsExport{
		Format: settingsExportFormat, ExportVersion: settingsExportVersion,
		AppConfig: types.AppConfig{FilesRoot: "C:/repo", Theme: "light"},
	}); err != nil {
		t.Fatalf("场景构造导入失败: %v", err)
	}
	backups, err := dst.ListSettingsBackups()
	testutil.NoError(t, err, "ListSettingsBackups")
	if len(backups) == 0 {
		t.Fatal("场景构造失败：无备份")
	}
	// 正例：集合内路径恢复放行，且恢复的确实是导入前（dark）那份
	if err := dst.RestoreSettingsBackup(backups[0]); err != nil {
		t.Fatalf("合法备份被拒（闸过紧）: %v", err)
	}
	if got := dst.LoadAppConfig().Theme; got != "dark" {
		t.Errorf("恢复后 theme = %q, want dark", got)
	}

	evilJSON := []byte(`{"theme":"mint","filesRoot":"D:/evil"}`)
	elseDir := t.TempDir()
	foreign := filepath.Join(elseDir, "ysm_config.json.bak-20200101-000000.000")
	if err := os.WriteFile(foreign, evilJSON, 0o644); err != nil {
		t.Fatal(err)
	}
	notBak := filepath.Join(configDir(), "evil.json")
	if err := os.WriteFile(notBak, evilJSON, 0o644); err != nil {
		t.Fatal(err)
	}
	rel := "ysm_config.json.bak-x"
	if err := os.WriteFile(rel, evilJSON, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(rel) })

	for _, bad := range []string{foreign, notBak, rel, elseDir} {
		err := dst.RestoreSettingsBackup(bad)
		if err == nil {
			t.Errorf("集合外路径 %q 被放行", bad)
			continue
		}
		var ae types.AppError
		if !errors.As(err, &ae) || ae.Code != types.ErrInvalidParam || ae.Operation != "恢复备份" {
			t.Errorf("路径 %q 错误 = %+v, want AppError{ErrInvalidParam, 恢复备份}", bad, err)
		}
		if got := dst.LoadAppConfig(); got.Theme != "dark" || got.FilesRoot != "C:/repo" {
			t.Fatalf("被拒路径 %q 竟改动了配置: %+v", bad, got)
		}
	}
}

// TestListSettingsBackups_ResultsInsideConfigDir 二轮锐评 P2⑦（列表侧不变量）：
// 列表返回值是恢复入口的路径唯一来源，每一项必须绝对且归属配置目录。
// 注：configDirOverride 注入空串会落穿回真实平台目录（configDir() 守卫语义），
// 「平台数据根缺失」态在测试里不可达；ListSettingsBackups 的 configPath()=="" 早退
// 分支以代码审读 + settingsExportPath 先例同族担保。
func TestListSettingsBackups_ResultsInsideConfigDir(t *testing.T) {
	dst := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo", Theme: "dark"})
	if _, err := dst.ImportSettingsData(types.SettingsExport{
		Format: settingsExportFormat, ExportVersion: settingsExportVersion,
		AppConfig: types.AppConfig{FilesRoot: "C:/repo", Theme: "light"},
	}); err != nil {
		t.Fatalf("场景构造导入失败: %v", err)
	}
	backups, err := dst.ListSettingsBackups()
	testutil.NoError(t, err, "ListSettingsBackups")
	if len(backups) == 0 {
		t.Fatal("场景构造失败：无备份")
	}
	for _, p := range backups {
		if !filepath.IsAbs(p) || filepath.Dir(p) != configDir() {
			t.Errorf("备份列表混入归属外路径: %q (configDir=%q)", p, configDir())
		}
	}
}
