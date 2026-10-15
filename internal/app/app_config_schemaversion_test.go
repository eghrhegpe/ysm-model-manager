package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// 本组测试锁「配置 schema 版本门控」（结合历史提交的锐评收口）。
//
// 历史多次配置迁移 bug 同根——无版本启发式迁移，判据全是「字段是否为空/是否被拷贝」：
//   - 2936d7da6 白名单漏字段：go/types 新增字段未跟进即被零值覆盖
//   - 8c858c54a 启动路径漏跑 migrateLegacyConfigFields
//   - 3b87efdca theme 缺省口径、c3b011d83 --files-root 写穿、ba71cd3b9 校验假成功
//
// 版本门控把「迁移是否要跑」从「字段是否为空」换成「文件 schemaVersion < 当前版本」，
// 使结构性迁移只发生一次、可被未来版本精确追溯，不再靠字段存在性猜。
//
// ⚠️ 不 t.Parallel()：setConfigDirForTest 走包级全局 configDirOverride（无锁），
// 并行会互踩（同 app_files_toggle_test.go / app_prune_disabled_test.go）。
func TestConfigSchemaVersion(t *testing.T) {
	setConfigDirForTest(t, t.TempDir())

	t.Run("遗留文件无版本号 → 迁移旧字段并盖当前版本章", func(t *testing.T) {
		writeRawConfigJSON(t, map[string]any{"YsmRoot": `D:\ysm`})
		a := &App{}
		cfg := a.LoadAppConfig()
		if cfg.CustomRoots == nil || cfg.CustomRoots["ysm"] != `D:\ysm` {
			t.Errorf("遗留 YsmRoot 未迁入 CustomRoots[ysm]: %#v", cfg.CustomRoots)
		}
		if cfg.YsmRoot != "" {
			t.Errorf("迁移后废弃字段 YsmRoot 应为空，实为 %q", cfg.YsmRoot)
		}
		if cfg.SchemaVersion != types.SchemaVersion {
			t.Errorf("迁移后应盖版本章 %d，实为 %d", types.SchemaVersion, cfg.SchemaVersion)
		}
	})

	t.Run("v1 文件 → 不再重跑启发式迁移（幂等）", func(t *testing.T) {
		// CustomRoots 缺席 + YsmRoot 有值：若仍跑 migrateLegacyConfigFields 会填出
		// CustomRoots[ysm]；版本门控应跳过它（文件已声明迁移完成）。
		writeRawConfigJSON(t, map[string]any{"YsmRoot": `D:\ysm`, "schemaVersion": types.SchemaVersion})
		a := &App{}
		cfg := a.LoadAppConfig()
		if len(cfg.CustomRoots) != 0 {
			t.Errorf("v1 文件不应重跑迁移，CustomRoots 应为空，实为 %#v", cfg.CustomRoots)
		}
	})

	t.Run("启动路径 loadAppConfig 与惰性路径同门控", func(t *testing.T) {
		// 8c858c54a 的病灶：两条读路径迁移逻辑曾不对称。两路都必须经 applyConfigMigrations。
		writeRawConfigJSON(t, map[string]any{"YsmRoot": `D:\ysm`})
		a := &App{}
		a.loadAppConfig()
		a.configMu.RLock()
		cfg := a.configCache
		a.configMu.RUnlock()
		if cfg.CustomRoots == nil || cfg.CustomRoots["ysm"] != `D:\ysm` {
			t.Errorf("启动路径未迁移 YsmRoot: %#v", cfg.CustomRoots)
		}
		if cfg.SchemaVersion != types.SchemaVersion {
			t.Errorf("启动路径未盖版本章: %d", cfg.SchemaVersion)
		}
	})

	t.Run("写盘不越权盖章：未迁移配置落盘无版本号，下次读仍会迁移", func(t *testing.T) {
		// saveConfig 若无脑盖版本章，会把「未迁移」的配置标成「已迁移」，
		// 下次读取跳过迁移 → 复现 8c858c54a 的静默数据丢失。本用例锁死：
		// 版本章只能由 applyConfigMigrations 在迁移完成后盖。
		a := &App{}
		if err := a.saveConfig(types.AppConfig{YsmRoot: `D:\ysm`, FilesRoot: t.TempDir()}); err != nil {
			t.Fatalf("saveConfig: %v", err)
		}
		if got := onDiskField(t, "schemaVersion"); got != nil {
			t.Errorf("未迁移的配置落盘不应带版本章，实为 %v", got)
		}
		// 这份无版本文件下次读取仍会触发迁移
		b := &App{}
		if cfg := b.LoadAppConfig(); cfg.CustomRoots["ysm"] != `D:\ysm` {
			t.Errorf("无版本文件下次读取未迁移: %#v", cfg.CustomRoots)
		}
	})

	t.Run("完整流转：遗留文件→迁移盖章→保存写出带版本章", func(t *testing.T) {
		writeRawConfigJSON(t, map[string]any{"YsmRoot": `D:\ysm`})
		a := &App{}
		_ = a.LoadAppConfig() // 迁移 + 盖内存版本章
		cfg := a.LoadAppConfig()
		cfg.FilesRoot = t.TempDir()
		if err := a.saveConfig(cfg); err != nil {
			t.Fatalf("saveConfig: %v", err)
		}
		if got := onDiskField(t, "schemaVersion"); got != float64(types.SchemaVersion) {
			t.Errorf("迁移后保存的磁盘文件应带 schemaVersion=%d，实为 %v", types.SchemaVersion, got)
		}
	})
}

// onDiskField 读取 configPath() 磁盘 JSON 中的指定字段（nil = 键不存在）。
func onDiskField(t *testing.T, key string) any {
	t.Helper()
	data, err := os.ReadFile(configPath())
	if err != nil {
		t.Fatal(err)
	}
	var onDisk map[string]any
	if err := json.Unmarshal(data, &onDisk); err != nil {
		t.Fatal(err)
	}
	return onDisk[key]
}

// writeRawConfigJSON 向 configPath() 直写任意原始 JSON，模拟任意版本的磁盘遗留文件。
// （区别于 app_config_linkmode_test.go 的 writeRawConfig：它只写 LinkMode，无法表达版本号。）
func writeRawConfigJSON(t *testing.T, obj map[string]any) {
	t.Helper()
	data, err := json.Marshal(obj)
	if err != nil {
		t.Fatal(err)
	}
	dest := configPath()
	if dest == "" {
		t.Fatal("configPath 不应为空（configDirOverride 已生效）")
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		t.Fatal(err)
	}
}
