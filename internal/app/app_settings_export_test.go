package app

// 设置导出/导入回归（ADR-344-d1）。
//
// 立因：`b1116645c` 只写了「备份迁移双轨叙事」文档、代码从未实现导出/导入（git log -S
// exportSettings 为空）——用户按备份迁移文档复制 ysm_config.json 就静默丢掉几十项浏览器偏好。
// 本文件锁导出格式门控、往返一致性与导入前备份三条不变量。

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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

func TestExportSettingsJSON_WritesExportFileAtAppDataDir(t *testing.T) {
	a := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo", Theme: "dark"})

	path, err := a.ExportSettingsJSON(map[string]string{
		"ui-font-size":    "14",
		"ui-card-density": "compact",
	})
	testutil.NoError(t, err, "ExportSettingsJSON")
	if path != settingsExportPath() {
		t.Errorf("导出路径应固定在应用数据目录: got=%q want=%q", path, settingsExportPath())
	}
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

// 导出侧尺寸闸（锐评 2026-10-16）：与 ReadSettingsExport 的导入闸对称。
// 无门槛时前端被塞进畸形的 localStorage 会写出一个导入侧必然拒收的大文件，用户白拷一份失败备份。
func TestExportSettingsJSON_RejectsOversizedLocalStorage(t *testing.T) {
	a := exportTestApp(t, types.AppConfig{FilesRoot: "C:/repo"})
	big := strings.Repeat("x", settingsExportMaxBytes+1)
	if _, err := a.ExportSettingsJSON(map[string]string{"k": big}); err == nil {
		t.Fatal("超过上限的 localStorage 不得导出（导入侧必然拒收，白拷失败备份）")
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

// 假备份拒止（锐评 2026-10-16）：配置文件存在却无任何路径设置 = loadAppConfig 在
// JSON 损坏时保留零值不重试的形态。此前只 log.Printf，而做备份迁移的用户恰恰不看日志：
// 零值假备份是延迟引爆炸弹——换机那天才发现路径全丢，比不做备份更糟（以为有了保险）。
// 从静音升为拒绝导出：备份动作失败必须当场可见，宁可不给保险也不给假保险。
func TestExportSettingsJSON_RejectsCorruptConfig(t *testing.T) {
	// 配置文件存在但内容损坏（loadAppConfig 解析失败 → 零值缓存）
	setConfigDirForTest(t, t.TempDir())
	testutil.NoError(t, os.WriteFile(configPath(), []byte(`{not valid json[`), 0o644), "写损坏配置")
	a := newLinkModeApp()

	if _, err := a.ExportSettingsJSON(map[string]string{"ui-font-size": "14"}); err == nil {
		t.Fatal("配置文件存在但无任何路径设置时不得导出假备份（须当场报错，不能只落日志）")
	}
}

func TestExportSettingsJSON_AllowsNewUserWithoutPaths(t *testing.T) {
	// 放行面回归：全新用户（配置文件不存在、尚未设置路径）导出不受限——
	// 拒止只针对「文件存在但零值」的损坏形态，不惩罚正常的首启动用户
	setConfigDirForTest(t, t.TempDir())
	a := newLinkModeApp()
	path, err := a.ExportSettingsJSON(map[string]string{})
	testutil.NoError(t, err, "全新用户导出应放行")
	if path != settingsExportPath() {
		t.Errorf("导出路径=%q want=%q", path, settingsExportPath())
	}
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
