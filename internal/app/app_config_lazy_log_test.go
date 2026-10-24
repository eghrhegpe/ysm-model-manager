// 惰性读路径的失败日志口径（锐评 2026-10-15 P2）。
//
// 背景：`LoadAppConfig` 在 `readJSONFile` 失败时**静默** return（configLoaded 保持 false、
// 下次重试——这个语义正确，app_config_loaded_test.go 已锁）；但「失败本身零日志」是个
// 诊断盲区：JSON 损坏时用户在环形日志面板看不到任何痕迹，尤其启动路径若也失败，
// 诊断就是彻底盲区（启动路径 loadAppConfig 是打日志的，两边口径不一致）。
//
// 判据：与启动路径同口径——**仅 NotExist 不记**（文件缺失=首次启动，属正常），
// 其它失败（JSON 损坏、IO 错）必须记一条 `[LoadAppConfig]` 日志。
//
// ⚠️ 本用例与 app_config_loaded_test.go 互补：那个锁「configLoaded 不被误置」，
// 这个锁「失败有痕」——两者都锁住了修复方向，缺一都会静默退化。
package app

import (
	"bytes"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/internal/testutil"
)

// captureLog 把 log 输出重定向到 buf，返回恢复函数。
func captureLog(t *testing.T, buf *bytes.Buffer) func() {
	t.Helper()
	prev := log.Writer()
	log.SetOutput(buf)
	log.SetFlags(0)
	return func() { log.SetOutput(prev) }
}

func TestLoadAppConfig_LogsCorruptJSON(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	t.Cleanup(func() { pathMgr = orig })

	// 落一份损坏的 JSON
	testutil.NoError(t, os.MkdirAll(filepath.Dir(configPath()), 0o755), "mkdir")
	testutil.NoError(t, os.WriteFile(configPath(), []byte("{ not valid json"), 0o644), "write corrupt")

	var buf bytes.Buffer
	restore := captureLog(t, &buf)
	defer restore()

	a := &App{} // configLoaded=false，必走惰性读盘路径
	a.LoadAppConfig()

	if !strings.Contains(buf.String(), "[LoadAppConfig]") {
		t.Errorf("JSON 损坏时惰性路径未打日志（诊断盲区）: 日志=%q", buf.String())
	}
}

func TestLoadAppConfig_DoesNotLogMissingFile(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	t.Cleanup(func() { pathMgr = orig })

	var buf bytes.Buffer
	restore := captureLog(t, &buf)
	defer restore()

	a := &App{}
	a.LoadAppConfig()

	if strings.Contains(buf.String(), "[LoadAppConfig]") {
		t.Errorf("文件缺失（首次启动，正常态）不应打日志——会持久缺失时每次调用刷屏: 日志=%q", buf.String())
	}
}
