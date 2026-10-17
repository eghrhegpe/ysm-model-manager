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
//  2. localStorage 采集口径以设置键台账为单一事实源，前端遍历 `exportableSettingsKeys()`
//     （tier=local-storage && authority=browser-authority，见 settings-keys.ts），
//     本文件不维护第二份键清单（手抄必漂移）。
//  3. 导入走「备份 → 合并 → 落盘 → 侧效」，与 SaveAppConfig / SaveAppConfigPatch 共用
//     `configWriteMu` + `applyPostSaveSideEffects`；路径字段原样导入（换机后旧盘符失效由 UI 提示），
//     不做 `mcRoot` 硬校验拦截——迁移动作不应因旧机路径在现机不存在而失败。

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
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
	// 导入前备份最多保留的份数（LRU 按时间戳字典序，超过即删最旧）。
	// 无上限的后果：反复导入让 .bak-* 无限堆积，用户还可能误把 .bak 当配置拷走。
	settingsBackupKeep = 10
	// 导出文件大小上限。ReadSettingsExport 直接 os.ReadFile 整份入内存，
	// 无门槛会让用户误选或恶意塞入的超大文件把进程内存吃满。
	settingsExportMaxBytes = 8 << 20 // 8 MiB
)

// settingsExportPath 导出文件的固定落点：应用数据目录（与 ysm_config.json 同域）。
// 用户只拷这一个文件即可带走「磁盘 + 浏览器」两轨设置——这是本功能存在的全部意义。
//
// configDir() 为空（平台数据根注入缺失，见 app_config.go:60 的守卫注释）时返回 ""，
// 由调用方拒绝——直接 filepath.Join("", name) 会让导出静默落到 CWD 相对路径，
// UI 显示一条在本机根本不存在的路径，用户拷走后在别的机器导入必然失败。
func settingsExportPath() string {
	dir := configDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, settingsExportFilename)
}

// ExportSettingsJSON 导出全部设置为单个 JSON 文件（ADR-344-d1）。
//
// localStorage：前端按设置键台账采集的偏好类键值（键→值的 map，由 Wails 绑定直接
// 从 JS 对象解组，不再经「JS 先 stringify → Go 再 Unmarshal」的双重编码绕弯）。
// Go 侧不解释具体键语义——键的集合与归属由 `tests/test_settings_key_ledger.ts`
// 对账的台账守护，本函数只做「收拢 + 落盘」。
//
// 返回导出文件完整路径（供 UI 显示与复制）。
func (a *App) ExportSettingsJSON(localStorage map[string]string) (string, error) {
	path := settingsExportPath()
	if path == "" {
		return "", errors.New("应用数据目录不可用，无法导出设置")
	}

	cfg := a.LoadAppConfig()
	// 假备份拒止（锐评 2026-10-16 引入，2026-10-17 收窄判据）：本意是拦「配置文件损坏 →
	// loadAppConfig 保留零值且不重试（见 app_config.go 守卫注释）→ 照常导出全零值假备份」——
	// 零值假备份是延迟引爆炸弹，换机那天才发现路径全丢，比不做备份更糟（用户以为有了保险），
	// 而做备份迁移的人恰恰不看日志。备份动作的失败必须当场可见。
	// 原判据（FilesRoot 空 && CustomRoots 空）**误伤正常用户**：启动链 resolveStartupConfigBootstrap
	// 会在首次启动自动探测 Minecraft 目录落盘（McRoot 非空），装过 Minecraft 但尚未设文件存储
	// 根目录的用户配置文件是**存在且合法**的，却被当成「损坏形态」拒绝导出（锐评 P1③）。
	// 收窄为「配置文件存在但**无法解析**」= 真正的损坏；JSON 合法（哪怕路径为空）即放行，
	// 因为那反映的是用户真实状态，不是损坏。
	// 全新用户（配置文件不存在）不拦：无路径可丢属正常，不惩罚起步期导出。
	if _, err := os.Stat(configPath()); err == nil {
		var diskCfg types.AppConfig
		if err := readJSONFile(configPath(), &diskCfg); err != nil {
			return "", types.AppError{
				Code:       types.ErrInvalidParam,
				Operation:  "导出设置",
				Reason:     "当前配置文件已损坏（无法解析），导出只会得到一份假备份",
				Suggestion: "请先在「设置 → 环境」恢复文件存储路径（重建配置），再导出",
			}
		}
	}

	exp := types.SettingsExport{
		Format:        settingsExportFormat,
		ExportVersion: settingsExportVersion,
		ExportedAt:    time.Now().Format(time.RFC3339),
		AppVersion:    version.Version,
		AppConfig:     cfg,
		LocalStorage:  localStorage,
	}
	data, err := json.MarshalIndent(exp, "", "  ")
	if err != nil {
		return "", err
	}
	// 与 ReadSettingsExport 的导入闸对称（锐评 2026-10-16）：导出侧同样设尺寸上限。
	// 无门槛时前端被塞进畸形的 localStorage（或未来某键值爆炸）会写出一个导入侧
	// 必然拒收的大文件，用户白拷一份注定失败的备份。
	if len(data) > settingsExportMaxBytes {
		return "", fmt.Errorf("设置数据过大(%d 字节，上限 %d MiB)，无法导出", len(data), settingsExportMaxBytes>>20)
	}
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
	// 先看大小再整读：os.ReadFile 会把文件整份压进内存 + 整份 json.Unmarshal，
	// 无门槛时误选或恶意塞入的大文件会让进程内存暴涨（本绑定可被 JS 传任意路径触发）。
	st, err := os.Stat(path)
	if err != nil {
		return exp, err
	}
	if st.Size() > settingsExportMaxBytes {
		return exp, fmt.Errorf("导出文件过大(%d 字节，上限 %d MiB)", st.Size(), settingsExportMaxBytes>>20)
	}
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
	// 双版本门控对称（锐评 2026-10-16 + 对抗审计 P1 修正）：ExportVersion 门控文件格式、
	// SchemaVersion 门控配置 schema——两套独立编号各有一道闸。高 schema/高格式版本来自
	// 更高版本程序，本程序按旧结构直读会静默错读、再落盘把高版本章焊死。
	// 两道闸共用 ErrSettingsTooNew 专用 Code：friendlyError 命中 Code 映射即丢弃
	// Reason/Suggestion（errors.ts `if (key) return t(key)`），「请升级程序后导入」的
	// 指引必须由 i18n 分类文案本身承载——复用 UNSUPPORTED_FORMAT 会把它吞成「不支持的格式」。
	if exp.ExportVersion > settingsExportVersion {
		return exp, types.AppError{
			Code:       types.ErrSettingsTooNew,
			Operation:  "导入设置",
			Reason:     fmt.Sprintf("导出文件版本(%d)高于当前程序支持的版本(%d)", exp.ExportVersion, settingsExportVersion),
			Suggestion: "请升级程序后导入",
		}
	}
	if exp.AppConfig.SchemaVersion > types.SchemaVersion {
		return exp, types.AppError{
			Code:       types.ErrSettingsTooNew,
			Operation:  "导入设置",
			Reason:     fmt.Sprintf("导出文件的配置版本(%d)高于当前程序支持的版本(%d)", exp.AppConfig.SchemaVersion, types.SchemaVersion),
			Suggestion: "请升级程序后导入",
		}
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
	return a.importResolved(exp)
}

// ImportSettingsData 从已解析的导出数据导入设置——前端导入链路的主入口（锐评 P2②）。
// 前端应先 ReadSettingsExport 拿到 exp 做「导入前确认」（预告覆盖范围/应用条数），确认后
// 把**同一个** exp 原样传入：此前前端对同一文件读两遍（ReadSettingsExport 预览 +
// ImportSettingsFromFile 内部再读一遍），两遍之间文件若被替换，确认时的计数与实际写入
// 就不一致（轻微 TOCTOU）。改成一份 exp 贯穿预览与落盘，计数与写入必然一致。
func (a *App) ImportSettingsData(exp types.SettingsExport) (types.ImportSettingsResult, error) {
	return a.importResolved(exp)
}

// importResolved 是导入的落盘主体（锁内重读当前配置 → 备份 → 以导入配置为基 → 版本门控迁移 +
// 洗脏 linkMode + 废弃字段清零 → saveConfig → applyPostSaveSideEffects）。localStorage 由前端写。
func (a *App) importResolved(exp types.SettingsExport) (types.ImportSettingsResult, error) {
	var res types.ImportSettingsResult

	// 数据入口防线（锐评 P2②）：ImportSettingsData 直接收 exp，须自行校验 format——
	// 否则未走 ReadSettingsExport 的伪造/错误数据会以零值 AppConfig 覆盖当前配置
	if exp.Format != settingsExportFormat {
		return res, types.AppError{
			Code:       types.ErrInvalidParam,
			Operation:  "导入设置",
			Reason:     fmt.Sprintf("不是有效的设置导出数据（format=%q）", exp.Format),
			Suggestion: "请通过「设置 → 备份与迁移」选择有效的设置导出文件",
		}
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

	// LocalStorageKeyCount 已删除（锐评 2026-10-16）：它是「导出文件原始条数」未过滤值，
	// 而前端提示用自身台账过滤后的 applied 计数——原始条数只会虚高、语义误导，
	// 且该字段没有任何消费者。条数归属前端（Go 侧没有前端台账的键集合，算不出真值）。
	return res, nil
}

// backupConfigFile 把当前 ysm_config.json 备份为时间戳后缀的 .bak 文件（原子写入）。
// 文件不存在 = 全新用户无配置可备份，返回空串不算错误（同 BackupWorkshopCreators 口径）。
//
// 命名与保留：时间戳精确到毫秒，同秒连点不再互相覆盖；写完后按 settingsBackupKeep 裁剪，
// 只留最近 N 份，避免反复导入让 .bak-* 无限堆积（用户还可能误把 .bak 当配置拷走）。
func (a *App) backupConfigFile() (string, error) {
	src := configPath()
	data, err := os.ReadFile(src)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	bak := src + fmt.Sprintf(settingsBackupSuffixFmt, time.Now().Format("20060102-150405.000"))
	if err := fsutil.WriteFileAtomic(bak, data); err != nil {
		return "", err
	}
	a.pruneOldConfigBackups(src)
	return bak, nil
}

// pruneOldConfigBackups 删除 src 目录下最旧的 .bak 备份，只保留 settingsBackupKeep 份。
// 清理失败仅记日志——备份文件多留一份比删错更安全，裁剪是尽力而为不是必需。
func (a *App) pruneOldConfigBackups(src string) {
	matches, err := filepath.Glob(src + ".bak-*")
	if err != nil || len(matches) <= settingsBackupKeep {
		return
	}
	// 时间戳前缀（YYYYMMDD-HHMMSS.mmm）字典序即时间序
	sort.Strings(matches)
	for _, old := range matches[:len(matches)-settingsBackupKeep] {
		if err := os.Remove(old); err != nil && !os.IsNotExist(err) {
			log.Printf("[settings-import] 清理旧备份失败 %s: %v", old, err)
		}
	}
}
