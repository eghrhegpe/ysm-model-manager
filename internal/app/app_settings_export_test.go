package app

// 设置导出/导入回归（ADR-344-d1）。
//
// 立因：`b1116645c` 只写了「备份迁移双轨叙事」文档、代码从未实现导出/导入（git log -S
// exportSettings 为空）——用户按备份迁移文档复制 ysm_config.json 就静默丢掉几十项浏览器偏好。
// 本文件锁导出格式门控、往返一致性与导入前备份三条不变量。

import (
	"encoding/json"
	"os"
	"path/filepath"
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

	path, err := a.ExportSettingsJSON(`{"ui-font-size":"14","ui-card-density":"compact"}`)
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

func TestImportSettingsFromFile_RoundTripAndBackup(t *testing.T) {
	const root = "C:/repo"
	src := exportTestApp(t, types.AppConfig{FilesRoot: root, Theme: "dark", Mirror: "jsdelivr"})
	srcPath, err := src.ExportSettingsJSON(`{"ui-font-size":"16","td-cam-speed":"2.4"}`)
	testutil.NoError(t, err, "ExportSettingsJSON")

	// 目标机已有其它配置（FilesRoot 相同 → 不触发 watcher 重建，隔离本测试关注面）
	dst := exportTestApp(t, types.AppConfig{FilesRoot: root, Theme: "light", Mirror: "ghproxy"})

	res, err := dst.ImportSettingsFromFile(srcPath)
	testutil.NoError(t, err, "ImportSettingsFromFile")
	if res.AppliedKeyCount != 2 {
		t.Errorf("AppliedKeyCount=%d want 2", res.AppliedKeyCount)
	}
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
	srcPath, err := src.ExportSettingsJSON(`{}`)
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