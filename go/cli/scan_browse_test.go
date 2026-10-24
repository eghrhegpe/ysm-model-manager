// ===== scan models 浏览投影接线（go/cli/scan.go 变更行）覆盖率补测 =====
// runScanModels 的条目获取已从 ScanModelEntries（带 SHA256）换成 ScanModelEntriesForBrowse
// （浏览投影，无 SHA256——本命令只展示 Name/Size，从不消费 Hash，大库冷扫不付哈希税）。
// 本文件锁两层：
// ① 桩注入（同 fakeAppService / benchCountingApp 惯例：嵌入 AppService nil 接口 + 只覆盖
// 被测方法）：--dir 原样透传给浏览投影入口，有条目/空仓库两个输出分支文案；
// ② 真 App 集成：零值 App 根清单为空（allAllowedRoots 依赖 LoadAppConfig），临时目录被根
// 守卫拒绝 → nil 条目，验证 runScanModels → 真 ScanModelEntriesForBrowse 调用链可达。
package cli

import (
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"

	"ysm-model-manager/internal/app"
)

// scanBrowseStubApp 测试桩：未覆盖方法经嵌入的 nil 接口调用会 panic——
// 测试只走被覆盖方法（ScanModelEntriesForBrowse）的路径。
type scanBrowseStubApp struct {
	AppService
	entries []types.ModelEntry
	gotDir  string
}

func (s *scanBrowseStubApp) ScanModelEntriesForBrowse(dir string, _ string, _ string, _ string) []types.ModelEntry {
	s.gotDir = dir
	return s.entries
}

// 有条目：--dir 透传 + 「共扫描到 N 个模型条目」计数与模型名输出。
func TestScanModels_BrowseProjection_Entries(t *testing.T) {
	dir := t.TempDir()
	stub := &scanBrowseStubApp{entries: []types.ModelEntry{
		{Name: "模型A.ysm", Size: 2048},
	}}
	out := captureOutput(t, func() {
		err := runScanModels(&CmdContext{App: stub, FilesRoot: dir, Args: []string{"--dir", dir}})
		testutil.NoError(t, err, "scan models 有条目应成功, got")
	})
	testutil.Equal(t, stub.gotDir, dir, "--dir 应原样传给浏览投影入口")
	testutil.Equal(t, strings.Contains(out, "共扫描到 1 个模型条目"), true, "应输出条目计数, got: "+out)
	testutil.Equal(t, strings.Contains(out, "模型A.ysm"), true, "应输出模型名, got: "+out)
}

// 空仓库（桩返回 nil）：「未扫描到模型条目」文案分支。
func TestScanModels_BrowseProjection_EmptyStub(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		err := runScanModels(&CmdContext{App: &scanBrowseStubApp{}, FilesRoot: dir, Args: []string{"--dir", dir}})
		testutil.NoError(t, err, "scan models 空仓库应成功, got")
	})
	testutil.Equal(t, strings.Contains(out, "未扫描到模型条目"), true, "空仓库应提示未扫描到条目, got: "+out)
}

// 真 App 集成：临时目录在根清单之外（零值 App 的 allAllowedRoots 为空）→
// isPathInRootOrSelf 拒绝 → nil 条目 → 空仓库文案，安静返回。
func TestScanModels_BrowseProjection_RealApp_OutsideRoot(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		err := runScanModels(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--dir", dir}})
		testutil.NoError(t, err, "根外目录应安静返回空, got")
	})
	testutil.Equal(t, strings.Contains(out, "未扫描到模型条目"), true, "根外目录应走空仓库分支, got: "+out)
}
