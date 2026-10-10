// 下载落盘的缓存失效与进度回调守卫（2026-10-10 锐评）。
// 立因：社区下载队列（app_install 域 queue → downloadFileWithQueue）把文件直写
// 仓库目录（前端 download-queue.ts 注入 saveDir=GetRepoRoot），但 App 侧成功路径
// 不失效扫描缓存——对比同族的导入（importModelFileWithOptions:147 ClearScanCache）、
// 文件夹导入（importModelFolderAs:203 InvalidateCache），下载是唯一漏清的落盘入口。
// 症状：下载完成 → 前端立即 tree:reload → scanModelEntries 命中 ≤TTL 旧缓存 →
// 新模型不出现，须 watcher 兜底（无整合包时短路不清）或等 TTL，树"下载了却看不见"。
package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestDownloadFileWithQueue_InvalidatesScanCache(t *testing.T) {
	body := []byte("fake-ysm-bytes-for-download-test")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(body)
	}))
	t.Cleanup(ts.Close)

	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 预扫描建立缓存（首次 miss、二次 hit——与 app_scan_test 同口径）
	if _, hit := a.scanModelEntriesWithHit(base); hit {
		t.Error("首次扫描不应命中缓存")
		return
	}
	if _, hit := a.scanModelEntriesWithHit(base); !hit {
		t.Error("二次扫描应命中缓存（前置条件）")
		return
	}

	// 下载落盘到同一仓库目录（模拟队列 saveDir=GetRepoRoot 注入）；
	// URL 带 .ysm 文件名——ResolveSavePath 从 URL 尾段取名，裸 ts.URL 会把 savePath
	// 解析成目录本身、rename 撞目录报 Access is denied。
	savePath, err := a.downloadFileWithQueue(context.Background(), ts.URL+"/model.ysm", base)
	if err != nil {
		t.Errorf("downloadFileWithQueue: %v", err)
		return
	}
	if fi, serr := os.Stat(savePath); serr != nil || fi.Size() != int64(len(body)) {
		t.Errorf("下载产物不完整: %v", serr)
		return
	}

	// 核心断言：下载成功后扫描缓存必须失效，tree:reload 立即可见新文件
	if _, hit := a.scanModelEntriesWithHit(base); hit {
		t.Error("下载落盘后不应命中旧扫描缓存（新模型须在 tree:reload 立即可见）")
	}
	entries := a.ScanModelEntries(base)
	var found bool
	for _, e := range entries {
		if filepath.Base(e.Path) == filepath.Base(savePath) {
			found = true
		}
	}
	if !found {
		t.Errorf("重扫应包含新下载文件 %s", savePath)
	}
}

// TestEmitDownloadProgress_NilAppGuard：零值 App（CLI/测试直下，a.app 未注入）
// 进度回调不得 panic——与 DownloadFromGitHub 的 appCtx nil 兜底对称。
func TestEmitDownloadProgress_NilAppGuard(t *testing.T) {
	a := &App{}
	a.emitDownloadProgress(1024, 2048) // 非 final
	a.emitDownloadProgress(2048, 2048) // final：commitAtomicWrite 必发，无守卫即 nil deref
}
