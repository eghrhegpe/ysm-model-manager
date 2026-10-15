// resource_bindings_delete_test.go：DeleteResourcePack 守卫回归锁（2026-10 锐评复盘三连）。
// 覆盖三个确定性缺陷：① 仓库根解析全空时文件分支 fail-open（ysm.json 入参直达
// fileops.DeleteModelFile 的无守卫分支 → os.RemoveAll 父目录）；② 目录分支同病
// （靠 filepath.Rel("") 报错兜底，成因措辞误导）；③ 裸 HasPrefix(rel, "..") 误拒 "..foo"。
package app

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// emptyRootApp 构造「两级根解析全空」的 App：FilesRoot 未配 + 平台默认根不可达。
// pathMgr 注入 fakePathMgr{repo: ""}——否则 Windows 桌面实现虽返回空串，
// 但测试会依赖真实平台实现（Android 实现返回固定公共路径），口径不稳。
func emptyRootApp(t *testing.T) *App {
	t.Helper()
	orig := pathMgr
	t.Cleanup(func() { pathMgr = orig })
	pathMgr = fakePathMgr{repo: ""}
	return repoApp(t, types.AppConfig{})
}

// TestDeleteResourcePack_EmptyRootFailFast_File 防「仓库根全空 → 文件分支 fail-open」回归：
// 未配置资源根时 fileops.DeleteModelFile("", path) 的两道 `if root != ""` 守卫整体跳过，
// ysm.json 入参直达 os.RemoveAll(父目录)——仓库外模型夹被裸删且返回 nil（静默数据丢失）。
// 核心断言：报错 **且** 磁盘上文件与父目录都还在。
func TestDeleteResourcePack_EmptyRootFailFast_File(t *testing.T) {
	a := emptyRootApp(t)
	// 独立于任何已配置根之外的目录（本用例根本没配根，等价于「盘上任意位置」）
	dir := filepath.Join(t.TempDir(), "Group")
	testutil.NoError(t, os.MkdirAll(dir, 0o755), "MkdirAll")
	entry := filepath.Join(dir, "ysm.json")
	testutil.NoError(t, os.WriteFile(entry, []byte("{}"), 0o644), "WriteFile")

	err := a.DeleteResourcePack(entry, "ysm")
	testutil.NotNil(t, err, "未配置资源根时删除必须 fail-fast 报错")

	var ae types.AppError
	if !errors.As(err, &ae) {
		t.Fatalf("应为结构化 AppError（前端 friendlyError 按 Code 映射 i18n），实得 %T: %v", err, err)
	}
	if ae.Code != types.ErrInvalidPath {
		t.Errorf("AppError.Code = %q, 期望 %q", ae.Code, types.ErrInvalidPath)
	}
	// 核心断言：磁盘未被触碰（fail-open 时这里会红——父目录整个消失）
	testutil.FileExists(t, entry, "fail-fast 后 ysm.json 必须仍在")
	if _, serr := os.Stat(dir); serr != nil {
		t.Errorf("fail-fast 后父目录必须仍在，实得 %v", serr)
	}
}

// TestDeleteResourcePack_EmptyRootFailFast_Dir 目录分支同病（对称）：root 全空时原实现
// 并无真守卫，只靠 `filepath.Rel("", ...)` 在某些形态下「恰好」报错兜底——实测
// EvalSymlinks("Group") 保持相对形态 → Rel("", "Group") 返回 ("Group", nil) 不报错
// → 守卫判据全不命中 → 放行 os.RemoveAll("Group")，按进程 CWD 裸删目录。
// 本用例用相对路径形态把它钉成红：必须显式 AppError（且自述真实成因）+ 目录仍在。
// CWD 经 t.Chdir 钉在临时目录内（t.Chdir 与 t.Parallel 互斥，本用例不加 Parallel）。
func TestDeleteResourcePack_EmptyRootFailFast_Dir(t *testing.T) {
	a := emptyRootApp(t)
	t.Chdir(t.TempDir())
	testutil.NoError(t, os.MkdirAll("Group", 0o755), "MkdirAll")
	testutil.NoError(t, os.WriteFile(filepath.Join("Group", "ysm.json"), []byte("{}"), 0o644), "WriteFile")

	// rtype=maid-model（isDir=true）走目录分支；相对路径——GUI 不会这么传，但守卫
	// 不变量是「root 为空绝不落到无守卫删盘路径」，与入参形态无关。
	err := a.DeleteResourcePack(filepath.Join("Group", "ysm.json"), "maid-model")
	testutil.NotNil(t, err, "未配置资源根时目录型删除必须 fail-fast 报错")

	var ae types.AppError
	if !errors.As(err, &ae) {
		t.Fatalf("应为结构化 AppError，实得 %T: %v", err, err)
	}
	if ae.Code != types.ErrInvalidPath {
		t.Errorf("AppError.Code = %q, 期望 %q", ae.Code, types.ErrInvalidPath)
	}
	// 成因须可读：旧实现由 Rel(\"\") 报错兜底，Reason 是「路径超出仓库目录」——而此处
	// 根本没有仓库根，提示误导用户去查路径越权（2026-10 锐评复盘）。
	if !strings.Contains(err.Error(), "未配置") {
		t.Errorf("拒绝原因须点明未配置资源根，实得: %v", err)
	}
	if _, serr := os.Stat("Group"); serr != nil {
		t.Errorf("fail-fast 后目标目录必须仍在（旧代码按 CWD 裸删），实得 %v", serr)
	}
}

// TestDeleteResourcePack_DotDotFooDirAllowed 防「裸 HasPrefix(rel, \"..\") 误拒合法 ..foo 目录」回归：
// rel=="..foo" 是仓库内的正常子目录，旧判定按 ".." 前缀一刀切 → 报「路径超出仓库目录」。
// 口径：精确段比较（rel==".." 或 ".."+分隔符 前缀）才是越权。
func TestDeleteResourcePack_DotDotFooDirAllowed(t *testing.T) {
	base := t.TempDir()
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	root := repoRootFor(t, a, "maid-model") // isDir=true → 目录分支

	dir := filepath.Join(root, "..foo")
	testutil.NoError(t, os.MkdirAll(dir, 0o755), "MkdirAll")
	entry := filepath.Join(dir, "ysm.json")
	testutil.NoError(t, os.WriteFile(entry, []byte("{}"), 0o644), "WriteFile")

	err := a.DeleteResourcePack(entry, "maid-model")
	testutil.NoError(t, err, "仓库内 ..foo 目录删除不应被误拒（旧裸 HasPrefix(rel, \"..\") 会报「路径超出仓库目录」）")
	if _, serr := os.Stat(dir); !os.IsNotExist(serr) {
		t.Errorf("..foo 目录应已被删除，实得 %v", serr)
	}
}

// TestDeleteResourcePack_OutsideRootRejected 防「修 fail-fast/段比较时把真越权也放行」回归：
// 仓库根外的路径在文件与目录两个分支都必须仍被拒绝，且是结构化 AppError。
func TestDeleteResourcePack_OutsideRootRejected(t *testing.T) {
	base := t.TempDir()
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	repoRootFor(t, a, "maid-model") // 建好类型根，确保守卫拿到非空 root（本用例只考越权拒绝）

	// 与 root 平行的兄弟目录（真越权；两分支各自起一个独立 temp 防互相污染）
	outsideFile := filepath.Join(t.TempDir(), "outside.ysm")
	testutil.NoError(t, os.WriteFile(outsideFile, []byte("x"), 0o644), "WriteFile")
	outsideYsmJSON := filepath.Join(t.TempDir(), "Group", "ysm.json")
	testutil.NoError(t, os.MkdirAll(filepath.Dir(outsideYsmJSON), 0o755), "MkdirAll")
	testutil.NoError(t, os.WriteFile(outsideYsmJSON, []byte("{}"), 0o644), "WriteFile")

	// 文件分支（ysm 非 isDir）：普通文件 + ysm.json 两条路径都要拒
	testutil.NotNil(t, a.DeleteResourcePack(outsideFile, "ysm"), "仓库外普通文件必须被拒")
	testutil.NotNil(t, a.DeleteResourcePack(outsideYsmJSON, "ysm"), "仓库外 ysm.json 必须被拒")
	// 目录分支
	testutil.NotNil(t, a.DeleteResourcePack(outsideYsmJSON, "maid-model"), "仓库外目录型必须被拒")

	// 越权拒绝不得带走磁盘内容
	testutil.FileExists(t, outsideFile, "拒绝后仓库外文件必须仍在")
	testutil.FileExists(t, outsideYsmJSON, "拒绝后仓库外 ysm.json 必须仍在")
}
