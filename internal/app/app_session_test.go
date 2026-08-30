// ===== SetSessionFilesRoot / ServiceShutdown recover 补测 =====
// R18 审核修复链变更行覆盖：c3b011d8（CLI 会话覆写不写穿）+ 5c1cd58a
// （ServiceShutdown println→log.Printf 接入环形日志，recover 路径此前零覆盖）。
package app

import (
	"testing"

	"ysm-model-manager/go/types"
)

// TestSetSessionFilesRoot CLI 会话级覆写（c3b011d8）：仅覆写内存 configCache，
// LoadAppConfig 本命令内可见覆写后的 FilesRoot；磁盘零副作用。
func TestSetSessionFilesRoot(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{FilesRoot: "orig-root"})
	dir := t.TempDir()
	a.SetSessionFilesRoot(dir)
	if got := a.LoadAppConfig().FilesRoot; got != dir {
		t.Fatalf("会话覆写后 FilesRoot 应为 %q, got %q", dir, got)
	}
}

// TestServiceShutdown_PanicRecoverLogs 覆盖 ServiceShutdown 的 recover+log 路径
// （5c1cd58a 变更行）：代理会话 transport=nil 触发 CloseIdleConnections panic →
// 顶层 defer recover 吞掉并留日志（环形日志面板可见）→ 函数正常返回 nil，
// 退出流程不被崩溃中断——正是该 recover 块存在的意义。
func TestServiceShutdown_PanicRecoverLogs(t *testing.T) {
	a := &App{}
	a.proxyMu.Lock()
	a.proxySessions = map[proxyServerKey]*proxySession{
		{host: "panic.example"}: &proxySession{}, // transport nil → CloseIdleConnections panic
	}
	a.proxyMu.Unlock()
	a.currentPlazaTarget = "http://panic.example/"

	if err := a.ServiceShutdown(); err != nil {
		t.Fatalf("ServiceShutdown 应经 recover 正常返回 nil, got %v", err)
	}
}
