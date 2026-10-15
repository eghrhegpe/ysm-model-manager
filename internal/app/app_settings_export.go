package app

// 设置导出 / 导入（ADR-344-d1）——把「Go 磁盘轨 + 前端 localStorage 轨」收拢成单个 JSON，
// 让换机从「复制 ysm_config.json + 手重设几十项偏好」变为「导出一次 + 导入一次 + 改路径」。
//
// 病根（为何此前没有它）：`b1116645c` 只写了「备份迁移双轨叙事」文档，
// `git log -i -S exportSettings` 为空——代码从未实现导出/导入。用户按
// `docs/guide/backup-migration.md` 复制 `ysm_config.json`，字号/键位/3D 偏好/收藏创作者
// 几十项留在旧机浏览器本地存储，全程零报错零提示（台账 `frontend/src/settings-keys.ts`
// 的 `nonMigratingSettingsKeys` 即这份清单）。
//
// 设计三原则（见 ADR）：
//  1. 导出目标固定为应用数据目录，不新增保存对话框绑定——与 `ExportWorkshopCreatorsJSONFile`
//     同模式（UI 显示路径 + 复制按钮）。
//  2. localStorage 采集口径以设置键台账为单一事实源，前端遍历 `nonMigratingSettingsKeys()`
//     按 tier/authority 过滤，本文件不维护第二份键清单（手抄必漂移）。
//  3. 导入走「备份 → 合并 → 落盘 → 侧效」，与 SaveAppConfig / SaveAppConfigPatch 共用
//     `configWriteMu` + `applyPostSaveSideEffects`；路径字段原样导入（换机后旧盘符失效由 UI 提示），
//     不做 `mcRoot` 硬校验拦截——迁移动作不应因旧机路径在现机不存在而失败。

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/version"
)

// 导出文件标识与版本（写入文件头，导入时校验，防把无关 JSON 当设置备份解析）。
const (
	settingsExportFormat    = "ysm-settings-export"
	settingsExportVersion   = 1
	settingsExportFilename  = "ysm-settings-export.json"
	settingsBackupSuffixFmt = ".bak-%s"
)

// settingsExportPath 导出文件的固定落点：应用数据目录（与 ysm_config.json 同域）。
// 用户只拷这一个文件即可带走「磁盘 + 浏览器」两轨设置——这是本功能存在的全部意义。
func settingsExportPath() string {
	return filepath.Join(configDir(), settingsExportFilename)
}

// ExportSettingsJSON 导出全部设置为单个 JSON 文件（ADR-344-d1）。
//
// localStorageJSON：前端按设置键台账采集的偏好类键值（JSON object 序列化串）。
// Go 侧不解释具体键语义——键的集合与归属由 `tests/test_settings_key_ledger.ts`
// 对账的台账守护，本函数只做「收拢 + 落盘」。
//
// 返回导出文件完整路径（供 UI 显示与复制）。
func (a *App) ExportSettingsJSON(localStorageJSON string) (string, error) {
	var ls map[string]string
	if localStorageJSON != "" {
		if err := json.Unmarshal([]byte(localStorageJSON), &ls); err != nil {
			return "", fmt.Errorf("浏览器偏好数据格式错误: %w", err)
		}
	}

	exp := types.SettingsExport{
		Format:        settingsExportFormat,
		ExportVersion: settingsExportVersion,
		ExportedAt:    time.Now().Format(time.RFC3339),
		AppVersion:    version.Version,
		AppConfig:     a.LoadAppConfig(),
		LocalStorage:  ls,
	}
	data, err := json.MarshalIndent(exp, "", "  ")
	if err != nil {
		return "", err
	}
	path := settingsExportPath()
	// 原子写入（与 saveConfig / BackupWorkshopCreators 对齐）：直接 os.WriteFile 在磁盘满/中断时
	// 留半截导出文件，用户拷走后导入必然失败
	if err := fsutil.WriteFileAtomic(path, data); err != nil {
		return "", err
	}
	return path, nil
}

// ReadSettingsExport 只读解析 + 校验设置导出文件（无任何副作用）。
// 前端先调本绑定拿到内容做导入前确认（含「导入后将应用 N 项浏览器偏好」计数）。
func (a *App) ReadSettingsExport(path string) (types.SettingsExport, error) {
	var exp types.SettingsExport
	data, err := os.ReadFile(path)
	if err != nil {
		return exp, err
	}
	if err := json.Unmarshal(data, &exp); err != nil {
		return exp, fmt.Errorf("设置导出文件格式错误: %w", err)
	}
	if exp.Format != settingsExportFormat {
		return exp, fmt.Errorf("不是有效的设置导出文件（format=%q）", exp.Format)
	}
	if exp.ExportVersion > settingsExportVersion {
		return exp, fmt.Errorf("导出文件版本(%d)高于当前程序支持的版本(%d)，请升级程序后导入", exp.ExportVersion, settingsExportVersion)
	}
	return exp, nil
}

// ImportSettingsFromFile 导入设置导出文件（ADR-344-d1）。
//
// 流程：锁内重读当前配置 → 备份当前 ysm_config.json → 以导入配置为基 → 版本门控迁移 +
// 洗脏 linkMode + 废弃字段清零 → saveConfig → 复用 applyPostSaveSideEffects（SyncLinkMode +
// 根路径变更时重启 watcher）。localStorage 的写入由前端完成（浏览器侧键值，Go 无能力写）。
//
// 返回结果含备份文件路径（导入失败/后悔可回滚）与将应用的浏览器偏好条数。
func (a *App) ImportSettingsFromFile(path string) (types.ImportSettingsResult, error) {
	var res types.ImportSettingsResult
	exp, err := a.ReadSettingsExport(path)
	if err != nil {
		return res, err
	}

	a.configWriteMu.Lock()
	defer a.configWriteMu.Unlock()

	oldCfg := a.LoadAppConfig()

	// 导入前备份当前配置——导入是「整份覆盖」，一旦旧盘符路径写回后无法自动撤销
	backupPath, err := a.backupConfigFile()
	if err != nil {
		return res, fmt.Errorf("导入前备份当前配置失败: %w", err)
	}
	res.BackupPath = backupPath

	cfg := exp.AppConfig
	// 导入配置视同一次「读盘」：走同一套版本门控 + 值软校验（与 loadAppConfig 同口径），
	// 否则旧版本导出的配置会把遗留独立路径字段带回来、非法 linkMode 直接进内存快照
	applyConfigMigrations(&cfg)
	washLinkMode(&cfg)
	clearDeprecatedFields(&cfg)

	if err := a.saveConfig(cfg); err != nil {
		return res, err
	}
	if err := a.applyPostSaveSideEffects(oldCfg, &cfg); err != nil {
		return res, err
	}

	res.AppliedKeyCount = len(exp.LocalStorage)
	return res, nil
}

// backupConfigFile 把当前 ysm_config.json 备份为时间戳后缀的 .bak 文件（原子写入）。
// 文件不存在 = 全新用户无配置可备份，返回空串不算错误（同 BackupWorkshopCreators 口径）。
func (a *App) backupConfigFile() (string, error) {
	src := configPath()
	data, err := os.ReadFile(src)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	bak := src + fmt.Sprintf(settingsBackupSuffixFmt, time.Now().Format("20060102-150405"))
	if err := fsutil.WriteFileAtomic(bak, data); err != nil {
		return "", err
	}
	return bak, nil
}
