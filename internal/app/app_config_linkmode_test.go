// ===== loadAppConfig 链接模式软校验回落（ADR-296 D6）=====
// 手改 config.json 的脏 linkMode：内存快照（SyncLinkMode）与 configCache 双侧洗为
// 默认 ""（copy 语义），磁盘原样保留——loadAppConfig 无写盘职责不在读路径写文件，
// 磁盘修复交下次 SaveAppConfig 的 orDefault 顺带洗（见 wails-bindings 卡）。
// 合法值原样加载并注入快照（安装/同步读点即时生效，不拖到重启）。
package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/app/install"
)

// writeRawConfig 向 fakePathMgr 的配置目录直写含指定 linkMode 的 ysm_config.json。
func writeRawConfig(t *testing.T, linkMode string) {
	t.Helper()
	data, err := json.Marshal(types.AppConfig{LinkMode: linkMode})
	if err != nil {
		t.Fatal(err)
	}
	p := configPath()
	if p == "" {
		t.Fatal("configPath 为空（pathMgr 未注入？）")
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func newLinkModeApp() *App {
	a := &App{}
	a.install = install.NewManager(nil, install.ConfigDeps{
		LoadAppConfig: func() types.AppConfig { return types.AppConfig{} },
		SaveAppConfig: func(types.AppConfig) error { return nil },
	})
	return a
}

func TestLoadAppConfig_DirtyLinkModeWashedInSnapshotAndCache(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	writeRawConfig(t, "mirror") // 契约测试认定的非法值（tests/test_config_defaults.ts）
	a := newLinkModeApp()
	a.loadAppConfig()

	if got := a.GetLinkMode(); got != "" {
		t.Errorf("脏值不得注入内存快照，GetLinkMode=%q want \"\"", got)
	}
	if got := a.LoadAppConfig().LinkMode; got != "" {
		t.Errorf("脏值不得进 configCache（前端 || 兜底只认空串，脏值会让下拉错位），got %q", got)
	}
	// 磁盘原样保留供人工修复
	data, err := os.ReadFile(configPath())
	if err != nil {
		t.Fatal(err)
	}
	var disk types.AppConfig
	if err := json.Unmarshal(data, &disk); err != nil {
		t.Fatal(err)
	}
	if disk.LinkMode != "mirror" {
		t.Errorf("loadAppConfig 不应写盘洗磁盘内容，磁盘 linkMode=%q want mirror", disk.LinkMode)
	}
}

func TestLoadAppConfig_LegalLinkModeLoadsAndSyncs(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	writeRawConfig(t, "hardlink")
	a := newLinkModeApp()
	a.loadAppConfig()

	if got := a.GetLinkMode(); got != "hardlink" {
		t.Errorf("合法值应注入内存快照，GetLinkMode=%q", got)
	}
	if got := a.LoadAppConfig().LinkMode; got != "hardlink" {
		t.Errorf("合法值应进 configCache，got %q", got)
	}
}
