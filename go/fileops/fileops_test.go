// ===== go/fileops 单测（ADR-003 P3 下沉验证）=====
package fileops

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

const perm = 0o644

// ====== RenameFile ======

func TestRenameFile_IllegalChars(t *testing.T) {
	t.Parallel()
	testutil.NotNil(t, RenameFile("/x", "bad:name"), "非法字符应报错")
	testutil.NotNil(t, RenameFile("", "name"), "空路径应报错")
}

func TestRenameFile_Ok(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	oldPath := filepath.Join(dir, "a.ysm")
	if err := os.WriteFile(oldPath, []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NoError(t, RenameFile(oldPath, "b.ysm"))
	testutil.FileExists(t, filepath.Join(dir, "b.ysm"))
}

func TestRenameFile_TargetExists(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	a := filepath.Join(dir, "a.ysm")
	b := filepath.Join(dir, "b.ysm")
	if err := os.WriteFile(a, []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(b, []byte("y"), perm); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NotNil(t, RenameFile(a, "b.ysm"), "目标已存在应报错")
	testutil.FileExists(t, a, "原文件应保留")
	data, _ := os.ReadFile(b)
	testutil.Equal(t, string(data), "y", "目标文件不应被覆盖")
}

func TestRenameFile_BlockYsmJson(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	modelDir := makeYsmModelDir(dir, "模型E")
	ysmPath := filepath.Join(modelDir, "ysm.json")
	testutil.NotNil(t, RenameFile(ysmPath, "renamed.json"), "ysm.json 单文件重命名应被拒绝")
	// 普通文件重命名不受影响
	testutil.NoError(t, RenameFile(filepath.Join(modelDir, "main.json"), "new-main.json"))
}

// ====== CreateDir ======

func TestCreateDir_Validation(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	testutil.NoError(t, CreateDir(root, "ok"))
	testutil.FileExists(t, filepath.Join(root, "ok"))
	testutil.NotNil(t, CreateDir(root, "../escape"), "路径穿越应被拦截")
	testutil.NotNil(t, CreateDir(root, "  "), "空目录名应报错")
}

// ====== MoveModelFile ======

func TestMoveModelFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	src := filepath.Join(dir, "a.ysm")
	if err := os.WriteFile(src, []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}
	dst := filepath.Join(dir, "sub")
	testutil.NoError(t, MoveModelFile(dir, src, dst))
	testutil.FileExists(t, filepath.Join(dst, "a.ysm"))
	testutil.NotNil(t, MoveModelFile(dir, "", dst), "空源应报错")
	// root 守卫：源在仓库外应拒绝
	outside := t.TempDir()
	testutil.NotNil(t, MoveModelFile(dir, outside+"/x.ysm", dst), "仓库外源应被拒绝")
}

func TestMoveModelFile_YsmJsonLiftsParentDir(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	srcRepo := filepath.Join(base, "src")
	dstRepo := filepath.Join(base, "dst")
	_ = os.MkdirAll(srcRepo, 0755)
	_ = os.MkdirAll(dstRepo, 0755)
	modelDir := makeYsmModelDir(srcRepo, "模型A")

	testutil.NoError(t, MoveModelFile(base, filepath.Join(modelDir, "ysm.json"), dstRepo))
	moved := filepath.Join(dstRepo, "模型A")
	testutil.FileExists(t, filepath.Join(moved, "ysm.json"))
	for _, f := range []string{"main.json", "arm.animation.json", "zh_cn.json", "textures/skin.png"} {
		testutil.FileExists(t, filepath.Join(moved, f), "组内 "+f+" 应随目录移动")
	}
	testutil.FileNotExists(t, modelDir)
}

func TestMoveModelFile_DirMovesWholeDir(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	srcRepo := filepath.Join(base, "src")
	dstRepo := filepath.Join(base, "dst")
	_ = os.MkdirAll(srcRepo, 0755)
	_ = os.MkdirAll(dstRepo, 0755)
	modelDir := makeYsmModelDir(srcRepo, "模型B")

	testutil.NoError(t, MoveModelFile(base, modelDir, dstRepo))
	testutil.FileExists(t, filepath.Join(dstRepo, "模型B", "ysm.json"))
	testutil.FileNotExists(t, modelDir)
}

func TestMoveModelFile_TargetExists(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	src1 := filepath.Join(base, "a.ysm")
	if err := os.WriteFile(src1, []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}
	dstDir := filepath.Join(base, "sub")
	testutil.NoError(t, MoveModelFile(base, src1, dstDir))
	testutil.FileExists(t, filepath.Join(dstDir, "a.ysm"))
	// 同名第二个源 → 防覆盖
	src2Dir := filepath.Join(base, "other")
	if err := os.MkdirAll(src2Dir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	src2 := filepath.Join(src2Dir, "a.ysm")
	if err := os.WriteFile(src2, []byte("y"), perm); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NotNil(t, MoveModelFile(base, src2, dstDir), "目标已存在应报错")
	testutil.FileExists(t, filepath.Join(dstDir, "a.ysm"), "首次移动目标应保留")
}

func TestMoveModelFile_YsmJsonLiftSelfNestingRejected(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	dstDir := filepath.Join(modelDir, "sub")
	testutil.NotNil(t, MoveModelFile(base, filepath.Join(modelDir, "ysm.json"), dstDir), "ysm.json 提升后 dstDir 位于模型目录内部应被拒绝")
	testutil.FileNotExists(t, dstDir, "被拒移动不得留空 junk 目录")
	testutil.FileExists(t, filepath.Join(modelDir, "ysm.json"))
}

func TestMoveModelFile_SelfNestingRejected(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	dstDir := filepath.Join(modelDir, "inner", "deeper")
	testutil.NotNil(t, MoveModelFile(base, modelDir, dstDir), "dstDir 位于 src 子树内应被拒绝")
	testutil.FileNotExists(t, dstDir)
}

func TestMoveModelFile_YsmJsonLiftWithoutRoot(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	dstDir := filepath.Join(base, "dst")
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NoError(t, MoveModelFile("", filepath.Join(modelDir, "ysm.json"), dstDir))
	testutil.FileExists(t, filepath.Join(dstDir, "模型A", "ysm.json"))
	testutil.FileNotExists(t, modelDir)
}

func TestMoveCopyModelFile_SymlinkMiddleSegmentRejected(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 不支持 os.Symlink（需管理员权限）")
	}
	t.Parallel()
	base := t.TempDir()
	repo := filepath.Join(base, "repo")
	if err := os.MkdirAll(repo, 0755); err != nil {
		testutil.NoError(t, err)
	}
	src := filepath.Join(repo, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}
	outside := t.TempDir()
	symDir := filepath.Join(repo, "symdir")
	if err := os.Symlink(outside, symDir); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NotNil(t, MoveModelFile(repo, src, filepath.Join(symDir, "sub")), "MoveModelFile 应拦截指向仓库外的 symlink 中间段")
	testutil.NotNil(t, CopyModelFile(repo, src, filepath.Join(symDir, "sub")), "CopyModelFile 应拦截指向仓库外的 symlink 中间段")
	testutil.FileNotExists(t, filepath.Join(outside, "sub", "m.ysm"))
}

// ====== CopyModelFile ======

func TestCopyModelFile_PathSafety(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	src := filepath.Join(root, "a.ysm")
	if err := os.WriteFile(src, []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}
	// 目录外 → 拦截
	testutil.NotNil(t, CopyModelFile(root, src, t.TempDir()), "目录外目标应被拒绝")
	// 目录内 → 成功
	dst := filepath.Join(root, "sub")
	testutil.NoError(t, CopyModelFile(root, src, dst))
	// 防覆盖
	testutil.NotNil(t, CopyModelFile(root, src, dst), "目标已存在应报错")
	// root 为空跳过校验
	testutil.NoError(t, CopyModelFile("", src, t.TempDir()))
}

func TestCopyModelFile_YsmJsonLiftsParentDir(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	srcRepo := filepath.Join(base, "src")
	dstRepo := filepath.Join(base, "dst")
	_ = os.MkdirAll(srcRepo, 0755)
	_ = os.MkdirAll(dstRepo, 0755)
	modelDir := makeYsmModelDir(srcRepo, "模型C")

	testutil.NoError(t, CopyModelFile(base, filepath.Join(modelDir, "ysm.json"), dstRepo))
	copied := filepath.Join(dstRepo, "模型C")
	for _, f := range []string{"ysm.json", "main.json", "arm.animation.json", "zh_cn.json", "textures/skin.png"} {
		testutil.FileExists(t, filepath.Join(copied, f))
	}
	testutil.FileExists(t, filepath.Join(modelDir, "ysm.json"), "原模型应保留")
}

func TestCopyModelFile_DirRecursiveCopiesBan(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	srcRepo := filepath.Join(base, "src")
	dstRepo := filepath.Join(base, "dst")
	_ = os.MkdirAll(srcRepo, 0755)
	_ = os.MkdirAll(dstRepo, 0755)
	modelDir := makeYsmModelDir(srcRepo, "模型D")
	if err := os.WriteFile(filepath.Join(modelDir, "ysm.json.ban"), []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}

	testutil.NoError(t, CopyModelFile(base, modelDir, dstRepo))
	testutil.FileExists(t, filepath.Join(dstRepo, "模型D", "ysm.json.ban"))
	testutil.NotNil(t, CopyModelFile(base, modelDir, dstRepo), "重复复制到已存在目标应报错")
}

func TestCopyModelFile_SelfNestingRejected(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	dstDir := filepath.Join(modelDir, "inner")
	testutil.NotNil(t, CopyModelFile(base, modelDir, dstDir), "dstDir 位于 src 子树内应被拒绝")
	testutil.FileNotExists(t, dstDir)
}

func TestWriteModelFolder_SymlinkParentRejected(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 不支持 os.Symlink（需管理员权限）")
	}
	t.Parallel()
	repo := t.TempDir()
	outside := t.TempDir()
	symDir := filepath.Join(repo, "symdir")
	if err := os.Symlink(outside, symDir); err != nil {
		testutil.NoError(t, err)
	}
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{}`)}}
	testutil.NotNil(t, WriteModelFolder(repo, "", "symdir", files), "父目录为 symlink 应拒绝写入")
}

func TestWriteModelFolder_SymlinkFileRejected(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 不支持 os.Symlink（需管理员权限）")
	}
	t.Parallel()
	repo := t.TempDir()
	modelDir := filepath.Join(repo, "模型A")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	outside := t.TempDir()
	target := filepath.Join(outside, "leaked.txt")
	if err := os.WriteFile(target, []byte("original"), perm); err != nil {
		testutil.NoError(t, err)
	}
	symFile := filepath.Join(modelDir, "ysm.json")
	if err := os.Symlink(target, symFile); err != nil {
		testutil.NoError(t, err)
	}
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{"spec":1}`)}}
	testutil.NotNil(t, WriteModelFolder(repo, "", "模型A", files), "目标文件为 symlink 应拒绝")
}

// ====== ToggleModelEnable ======

func TestToggleModelEnable(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(path, []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}
	// 禁用
	enabled, err := ToggleModelEnable(dir, path)
	testutil.NoError(t, err, "禁用应返回 enabled=false")
	testutil.Equal(t, enabled, false, "禁用应返回 enabled=false")
	testutil.Equal(t, IsFileBanned(path+".disabled"), true, ".disabled 应被识别")
	// 启用
	enabled, err = ToggleModelEnable(dir, path+".disabled")
	testutil.NoError(t, err, "启用应返回 enabled=true")
	testutil.Equal(t, enabled, true, "启用应返回 enabled=true")
	testutil.FileExists(t, path)
}

func TestToggleModelEnable_RootRejected(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	_, err := ToggleModelEnable(dir, dir)
	testutil.NotNil(t, err, "path==root 应拒绝")
	testutil.FileNotExists(t, dir+".disabled", "根目录不得被改名成 .disabled")
	testutil.FileExists(t, dir)
}

func TestToggleModelEnable_RootRejectedCaseInsensitive(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	mixed := strings.ToUpper(dir)
	if runtime.GOOS == "windows" {
		_, err := ToggleModelEnable(dir, mixed)
		testutil.NotNil(t, err, "Windows 大小写不同的根应拒绝")
	} else {
		_, err := ToggleModelEnable(dir, mixed)
		testutil.Equal(t, err != nil && IsFileBanned(dir+".ban"), false, "POSIX 上根目录不得被改名")
	}
}

func TestToggleModelEnable_YsmJsonDisablesParentDir(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	ysmPath := filepath.Join(modelDir, "ysm.json")

	enabled, err := ToggleModelEnable(base, ysmPath)
	testutil.NoError(t, err, "禁用应返回 enabled=false")
	testutil.Equal(t, enabled, false, "禁用应返回 enabled=false")
	bannedDir := modelDir + ".disabled"
	testutil.FileExists(t, bannedDir)
	testutil.Equal(t, IsFileBanned(filepath.Join(bannedDir, "ysm.json")), true, "目录级 .disabled 下的 ysm.json 应识别为禁用")
	// 启用还原
	enabled, err = ToggleModelEnable(base, filepath.Join(bannedDir, "ysm.json"))
	testutil.NoError(t, err, "启用应返回 enabled=true")
	testutil.Equal(t, enabled, true, "启用应返回 enabled=true")
	testutil.FileExists(t, modelDir)
}

func TestToggleModelEnable_RootLevelYsmJsonFallsBack(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	rootYsm := filepath.Join(base, "ysm.json")
	if err := os.WriteFile(rootYsm, []byte(`{"spec":1}`), perm); err != nil {
		testutil.NoError(t, err)
	}
	modelDir := makeYsmModelDir(base, "模型A")

	enabled, err := ToggleModelEnable(base, rootYsm)
	testutil.NoError(t, err, "禁用应返回 enabled=false")
	testutil.Equal(t, enabled, false, "禁用应返回 enabled=false")
	testutil.FileExists(t, rootYsm+".disabled")
	testutil.FileNotExists(t, base+".disabled")
	testutil.FileExists(t, modelDir)
}

func TestToggleModelEnable_MixedDirEnableSymmetry(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	looseYsm := filepath.Join(modelDir, "loose.ysm")
	if err := os.WriteFile(looseYsm, []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}

	_, err := ToggleModelEnable(base, filepath.Join(modelDir, "ysm.json"))
	testutil.NoError(t, err)
	bannedDir := modelDir + ".disabled"
	bannedLoose := filepath.Join(bannedDir, "loose.ysm")
	testutil.Equal(t, IsFileBanned(bannedLoose), true, "目录级 .disabled 下的松散 .ysm 应识别为禁用")
	enabled, err := ToggleModelEnable(base, bannedLoose)
	testutil.NoError(t, err, "启用应返回 enabled=true")
	testutil.Equal(t, enabled, true, "启用应返回 enabled=true")
	testutil.FileExists(t, modelDir)
	testutil.FileExists(t, looseYsm, "松散 .ysm 不应被重命名")
}

func TestToggleModelEnable_UpperBanSuffix(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	bannedDir := modelDir + ".BAN"
	if err := os.Rename(modelDir, bannedDir); err != nil {
		testutil.NoError(t, err)
	}
	bannedYsm := filepath.Join(bannedDir, "ysm.json")
	testutil.Equal(t, IsFileBanned(bannedYsm), true, "父目录级 .BAN 应识别为禁用")
	enabled, err := ToggleModelEnable(base, bannedYsm)
	testutil.NoError(t, err, "启用应返回 enabled=true")
	testutil.Equal(t, enabled, true, "启用应返回 enabled=true")
	testutil.FileExists(t, modelDir)
}

// ====== IsFileBanned ======

func TestIsFileBanned(t *testing.T) {
	t.Parallel()
	cases := []struct {
		path string
		want bool
	}{
		{"x.ysm.ban", true},
		{"x.ysm.disabled", true},
		{"x.ysm", false},
		{"X.YSM.BAN", true},
		{"X.YSM.DISABLED", true},
		{filepath.Join("模型A.ban", "ysm.json"), true},
		{filepath.Join("模型A.disabled", "ysm.json"), true},
		{filepath.Join("模型A", "ysm.json"), false},
	}
	for _, c := range cases {
		if got := IsFileBanned(c.path); got != c.want {
			t.Errorf("IsFileBanned(%q) = %v, 期望 %v", c.path, got, c.want)
		}
	}
}

func TestIsFileBanned_DirBan(t *testing.T) {
	t.Parallel()
	cases := []struct {
		path string
		want bool
	}{
		{"x.ysm.ban", true},
		{"x.ysm.disabled", true},
		{filepath.Join("模型A.ban", "ysm.json"), true},
		{filepath.Join("模型A.disabled", "ysm.json"), true},
		{filepath.Join("模型A", "ysm.json"), false},
	}
	for _, c := range cases {
		if got := IsFileBanned(c.path); got != c.want {
			t.Errorf("IsFileBanned(%q) = %v, 期望 %v", c.path, got, c.want)
		}
	}
}

// ====== GetPackInfo ======

func TestGetPackInfo(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	info := GetPackInfo("", dir)
	testutil.Equal(t, info.Name, "", "无 pack.json 应返回空: %+v", info)
	content := `{"name":"测试包","description":"描述"}`
	jsonPath := filepath.Join(dir, "ysm-pack.json")
	if err := os.WriteFile(jsonPath, []byte(content), perm); err != nil {
		testutil.NoError(t, err)
	}
	info = GetPackInfo("", dir)
	testutil.Equal(t, info.Name, "测试包")
	testutil.Equal(t, info.Description, "描述")
	// BOM 前缀剥离
	bom := append([]byte{0xEF, 0xBB, 0xBF}, []byte(content)...)
	if err := os.WriteFile(jsonPath, bom, perm); err != nil {
		testutil.NoError(t, err)
	}
	info = GetPackInfo("", dir)
	testutil.Equal(t, info.Name, "测试包")
	// root 相对路径
	info = GetPackInfo(filepath.Dir(dir), filepath.Base(dir))
	testutil.Equal(t, info.Name, "测试包")
}

// ====== FindPreviewImage ======

func TestFindPreviewImage(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	model := filepath.Join(dir, "m.ysm")
	testutil.Equal(t, FindPreviewImage(model), "", "无预览图应返回空")
	pngPath := filepath.Join(dir, "m.png")
	if err := os.WriteFile(pngPath, []byte("PNGDATA"), perm); err != nil {
		testutil.NoError(t, err)
	}
	got := FindPreviewImage(model)
	testutil.Equal(t, strings.HasPrefix(got, "data:image/png;base64,"), true, "应返回 data URI: %q", got)
}

func TestFindPreviewImage_JpgMime(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	model := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(filepath.Join(dir, "m.jpg"), []byte("JPGDATA"), perm); err != nil {
		testutil.NoError(t, err)
	}
	got := FindPreviewImage(model)
	testutil.Equal(t, strings.HasPrefix(got, "data:image/jpeg;base64,"), true, ".jpg 应返回 image/jpeg data URI: %q", got)
}

func TestFindPreviewImage_FallbackCandidates(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	model := filepath.Join(dir, "m.ysm")
	candidates := []string{"preview.png", "cover.png", "thumbnail.png"}
	for _, c := range candidates {
		_ = os.Remove(filepath.Join(dir, "preview.png"))
		_ = os.Remove(filepath.Join(dir, "cover.png"))
		_ = os.Remove(filepath.Join(dir, "thumbnail.png"))
		if err := os.WriteFile(filepath.Join(dir, c), []byte(c), perm); err != nil {
			testutil.NoError(t, err)
		}
		got := FindPreviewImage(model)
		testutil.Equal(t, strings.HasPrefix(got, "data:image/png;base64,"), true, "候选 %s 应命中: %q", c, got)
	}
}

// ====== RenameDir ======

func TestRenameDir_Ok(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	oldPath := filepath.Join(dir, "olddir")
	if err := os.MkdirAll(oldPath, 0755); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NoError(t, RenameDir(oldPath, "newdir"))
	testutil.FileExists(t, filepath.Join(dir, "newdir"))
	testutil.FileNotExists(t, oldPath)
}

func TestRenameDir_EmptyArgs(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	testutil.NotNil(t, RenameDir("", "new"), "空 oldPath 应报错")
	testutil.NotNil(t, RenameDir(dir, ""), "空 newName 应报错")
}

func TestRenameDir_NonExistent(t *testing.T) {
	t.Parallel()
	testutil.NotNil(t, RenameDir("/nonexistent/path", "new"), "不存在的目录应报错")
}

func TestRenameDir_TargetExists(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	old := filepath.Join(dir, "old")
	existing := filepath.Join(dir, "new")
	if err := os.MkdirAll(old, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.MkdirAll(existing, 0755); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NotNil(t, RenameDir(old, "new"), "目标已存在应报错")
	testutil.FileExists(t, old)
}

// ====== RemoveDir ======

func TestRemoveDir_Ok(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	sub := filepath.Join(dir, "subdir")
	if err := os.MkdirAll(sub, 0755); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NoError(t, RemoveDir(sub))
	testutil.FileNotExists(t, sub)
}

func TestRemoveDir_NonExistent(t *testing.T) {
	t.Parallel()
	testutil.NoError(t, RemoveDir("/nonexistent/path"))
}

func TestRemoveDir_Empty(t *testing.T) {
	t.Parallel()
	_ = RemoveDir("") // 只需不 panic
}

// ====== ExtractPreviewTexture ======

func TestExtractPreviewTexture_NonExistent(t *testing.T) {
	t.Parallel()
	got := ExtractPreviewTexture("/nonexistent/file.zip")
	testutil.Equal(t, got, "")
}

func TestExtractPreviewTexture_FromZip(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, _ := w.Create("preview.png")
	f.Write([]byte("PNGDATA123"))
	w.Close()
	zipPath := filepath.Join(dir, "model.zip")
	if err := os.WriteFile(zipPath, buf.Bytes(), perm); err != nil {
		testutil.NoError(t, err)
	}
	got := ExtractPreviewTexture(zipPath)
	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Errorf("应返回 data URI, 得到 %q", got)
	}
}

func TestExtractPreviewTexture_FromZipNoPNG(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, _ := w.Create("readme.txt")
	f.Write([]byte("hello"))
	w.Close()
	zipPath := filepath.Join(dir, "model.zip")
	if err := os.WriteFile(zipPath, buf.Bytes(), perm); err != nil {
		testutil.NoError(t, err)
	}
	got := ExtractPreviewTexture(zipPath)
	testutil.Equal(t, got, "")
}

func TestExtractPreviewTexture_From7zBadData(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "model.7z")
	if err := os.WriteFile(path, []byte("not7z"), perm); err != nil {
		testutil.NoError(t, err)
	}
	got := ExtractPreviewTexture(path)
	testutil.Equal(t, got, "")
}

func TestExtractPreviewTexture_FromYSM(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "model.ysm")
	if err := os.WriteFile(path, []byte("fake ysm data"), perm); err != nil {
		testutil.NoError(t, err)
	}
	got := ExtractPreviewTexture(path)
	testutil.Equal(t, got, "")
}

func TestExtractPreviewTexture_FromJSON(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	if err := os.WriteFile(jsonPath, []byte("{}"), perm); err != nil {
		testutil.NoError(t, err)
	}
	texDir := filepath.Join(dir, "textures")
	if err := os.MkdirAll(texDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(texDir, "tex.png"), []byte("TEXDATA"), perm); err != nil {
		testutil.NoError(t, err)
	}
	got := ExtractPreviewTexture(jsonPath)
	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Errorf("应返回 data URI, 得到 %q", got)
	}
}

func TestExtractPreviewTexture_FromJSONFallback(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	if err := os.WriteFile(jsonPath, []byte("{}"), perm); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "tex.png"), []byte("FALLBACK"), perm); err != nil {
		testutil.NoError(t, err)
	}
	got := ExtractPreviewTexture(jsonPath)
	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Errorf("应返回 data URI, 得到 %q", got)
	}
}

func TestExtractPreviewTexture_BanSuffixStripped(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, _ := w.Create("preview.png")
	_, _ = f.Write([]byte("PNGDATA123"))
	_ = w.Close()
	zipPath := filepath.Join(dir, "model.zip.ban")
	if err := os.WriteFile(zipPath, buf.Bytes(), perm); err != nil {
		testutil.NoError(t, err)
	}
	got := ExtractPreviewTexture(zipPath)
	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Errorf(".ban 后缀应剥离后按 .zip 提取, 得到 %q", got)
	}
}

func TestExtractPreviewTexture_JsonEmptyTexturesFallback(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "model.json")
	if err := os.WriteFile(jsonPath, []byte("{}"), perm); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "textures"), 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "tex.png"), []byte("FALLBACK"), perm); err != nil {
		testutil.NoError(t, err)
	}
	got := ExtractPreviewTexture(jsonPath)
	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Errorf("textures/ 空目录应回退同目录 PNG, 得到 %q", got)
	}
}

// ====== WriteModelFolder（ADR-038 关联：文件夹型模型整组导入）======

func b64(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}

func TestWriteModelFolder_Ok(t *testing.T) {
	t.Parallel()
	repo := t.TempDir()
	files := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: b64(`{"spec":1}`)},
		{RelPath: "main.json", Base64: b64(`{"geometry":{}}`)},
		{RelPath: "arm.animation.json", Base64: b64(`{}`)},
		{RelPath: "zh_cn.json", Base64: b64(`{}`)},
		{RelPath: "textures/skin.png", Base64: b64("PNG")},
	}
	testutil.NoError(t, WriteModelFolder(repo, "", "模型A", files))
	for _, f := range []string{"ysm.json", "main.json", "arm.animation.json", "zh_cn.json", "textures/skin.png"} {
		testutil.FileExists(t, filepath.Join(repo, "模型A", f))
	}
	testutil.FileExists(t, filepath.Join(repo, "模型A", "textures", "skin.png"))
}

func TestWriteModelFolder_MissingSupported(t *testing.T) {
	t.Parallel()
	repo := t.TempDir()
	files := []types.ImportFileItem{
		{RelPath: "main.json", Base64: b64(`{}`)},
		{RelPath: "zh_cn.json", Base64: b64(`{}`)},
	}
	testutil.NotNil(t, WriteModelFolder(repo, "", "模型B", files), "无支持文件应拒绝")
	testutil.NotNil(t, WriteModelFolder(repo, "", "模型B2", nil), "空文件列表应拒绝")
}

func TestWriteModelFolder_PlainFolderWithYsm(t *testing.T) {
	t.Parallel()
	repo := t.TempDir()
	files := []types.ImportFileItem{
		{RelPath: "模型A.ysm", Base64: b64("YSMBIN")},
		{RelPath: "模型B.ysm", Base64: b64("YSMBIN2")},
		{RelPath: "sub/说明.txt", Base64: b64("note")},
	}
	testutil.NoError(t, WriteModelFolder(repo, "", "合集", files))
	for _, f := range []string{"模型A.ysm", "模型B.ysm", filepath.Join("sub", "说明.txt")} {
		testutil.FileExists(t, filepath.Join(repo, "合集", f))
	}
}

func TestWriteModelFolder_MultiLevelNested(t *testing.T) {
	t.Parallel()
	repo := t.TempDir()
	files := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: b64(`{"spec":1}`)},
		{RelPath: "animations/run.animation.json", Base64: b64(`{}`)},
		{RelPath: "textures/char/deep/skin.png", Base64: b64("PNG")},
	}
	testutil.NoError(t, WriteModelFolder(repo, "", "模型C", files))
	for _, f := range []string{
		"ysm.json",
		filepath.Join("animations", "run.animation.json"),
		filepath.Join("textures", "char", "deep", "skin.png"),
	} {
		testutil.FileExists(t, filepath.Join(repo, "模型C", f))
	}
}

func TestWriteModelFolder_ExistsAndTraversal(t *testing.T) {
	t.Parallel()
	repo := t.TempDir()
	files := []types.ImportFileItem{{RelPath: "ysm.json", Base64: b64(`{}`)}}
	testutil.NoError(t, WriteModelFolder(repo, "", "模型C", files))
	testutil.NotNil(t, WriteModelFolder(repo, "", "模型C", files), "目标已存在应报错")
	evil := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: b64(`{}`)},
		{RelPath: "../evil.json", Base64: b64(`{}`)},
	}
	testutil.NotNil(t, WriteModelFolder(repo, "", "模型D", evil), "路径穿越应拒绝")
	testutil.NotNil(t, WriteModelFolder(repo, "", "a/b", files), "非法文件夹名应拒绝")
}

// ====== DeleteModelFile ======

func TestDeleteModelFile_YsmJsonRemovesParentDir(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	modelDir := makeYsmModelDir(base, "模型A")
	ysmPath := filepath.Join(modelDir, "ysm.json")
	testutil.NoError(t, DeleteModelFile(base, ysmPath))
	testutil.FileNotExists(t, modelDir)
}

func TestDeleteModelFile_SingleFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	fp := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(fp, []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NoError(t, DeleteModelFile(dir, fp))
	testutil.FileNotExists(t, fp)
	testutil.FileExists(t, dir, "父目录应保留")
}

func TestDeleteModelFile_EmptyArgs(t *testing.T) {
	t.Parallel()
	testutil.NotNil(t, DeleteModelFile("", ""), "空参数应报错")
}

func TestDeleteModelFile_RootLevelYsmJsonFallsBack(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	rootYsm := filepath.Join(base, "ysm.json")
	if err := os.WriteFile(rootYsm, []byte(`{"spec":1}`), perm); err != nil {
		testutil.NoError(t, err)
	}
	modelDir := makeYsmModelDir(base, "模型A")
	testutil.NoError(t, DeleteModelFile(base, rootYsm))
	testutil.FileNotExists(t, rootYsm)
	testutil.FileExists(t, base, "仓库根不应被删除")
	testutil.FileExists(t, modelDir, "仓库内模型不应被误删")
}

func TestDeleteModelFile_OutOfRootRejected(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	outside := t.TempDir()
	ysmPath := filepath.Join(outside, "ysm.json")
	if err := os.WriteFile(ysmPath, []byte(`{"spec":1}`), perm); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NotNil(t, DeleteModelFile(base, ysmPath), "仓库外 ysm.json 删除应被拒绝")
	testutil.FileExists(t, ysmPath)
}

// ====== failpath 补测 ======

func TestCopyModelFile_SourceNotFound(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	src := filepath.Join(root, "no-such-file.ysm")
	dst := filepath.Join(root, "sub")
	testutil.NotNil(t, CopyModelFile(root, src, dst), "源文件不存在应报错")
}

func TestCopyModelFile_SourceIsDir(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	srcDir := filepath.Join(root, "model_dir")
	if err := os.Mkdir(srcDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	dst := filepath.Join(root, "sub")
	testutil.NoError(t, CopyModelFile(root, srcDir, dst))
	testutil.FileExists(t, filepath.Join(dst, "model_dir"))
}

func TestCopyModelFile_TargetExists(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	src := filepath.Join(root, "a.ysm")
	if err := os.WriteFile(src, []byte("hello"), perm); err != nil {
		testutil.NoError(t, err)
	}
	dstDir := filepath.Join(root, "sub")
	testutil.NoError(t, CopyModelFile(root, src, dstDir))
	testutil.NotNil(t, CopyModelFile(root, src, dstDir), "目标已存在应报错")
}

func TestCopyModelFile_DstDirCreated(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	src := filepath.Join(root, "a.ysm")
	if err := os.WriteFile(src, []byte("content"), perm); err != nil {
		testutil.NoError(t, err)
	}
	dstDir := filepath.Join(root, "new_sub")
	testutil.NoError(t, CopyModelFile(root, src, dstDir))
	data, err := os.ReadFile(filepath.Join(dstDir, "a.ysm"))
	testutil.NoError(t, err)
	testutil.Equal(t, string(data), "content")
}

// ====== 内部函数 ======

func TestReadLimitedFile_Normal(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "small.txt")
	payload := []byte("hello world")
	if err := os.WriteFile(path, payload, perm); err != nil {
		testutil.NoError(t, err)
	}
	data := readLimitedFile(path)
	testutil.NotNil(t, data, "正常小文件应返回非 nil")
	testutil.Equal(t, string(data), string(payload))
}

func TestReadLimitedFile_Empty(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.txt")
	if err := os.WriteFile(path, []byte{}, perm); err != nil {
		testutil.NoError(t, err)
	}
	_ = readLimitedFile(path) // 只需不 panic
}

func TestReadLimitedFile_NonExistent(t *testing.T) {
	t.Parallel()
	data := readLimitedFile("/nonexistent/path/does/not/exist.txt")
	testutil.Nil(t, data, "不存在文件应返回 nil")
}

// ====== helper ======

func makeYsmModelDir(base, name string) string {
	modelDir := filepath.Join(base, name)
	_ = os.MkdirAll(filepath.Join(modelDir, "textures"), 0755)
	_ = os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(`{"spec":1}`), perm)
	_ = os.WriteFile(filepath.Join(modelDir, "main.json"), []byte(`{"geometry":{}}`), perm)
	_ = os.WriteFile(filepath.Join(modelDir, "arm.animation.json"), []byte(`{}`), perm)
	_ = os.WriteFile(filepath.Join(modelDir, "zh_cn.json"), []byte(`{}`), perm)
	_ = os.WriteFile(filepath.Join(modelDir, "textures", "skin.png"), []byte("PNG"), perm)
	return modelDir
}
