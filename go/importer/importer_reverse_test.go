// ===== go/importer 测试反推（补充错误分支/边界/回滚路径覆盖）=====
// 覆盖策略：表驱动优先；聚焦此前未覆盖的失败路径——
// 路径遍历防护、磁盘根目录防护、目标已存在时的备份替换与回滚、
// 失败后的临时文件清理（不留 .import-*.tmp / .tmp_import_* 残渣）、
// 结构化错误码（AppError.Code）、ZIP 类型检测边界。
package importer

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
	typereg "ysm-model-manager/go/types/registry"
)

// ===== 工具 =====

// volRoot 返回当前平台的卷根（Windows: C:\，Unix: /），用于磁盘根目录防护用例
func volRoot(t *testing.T) string {
	t.Helper()
	vol := filepath.VolumeName(t.TempDir())
	if vol != "" {
		return vol + string(filepath.Separator)
	}
	return string(filepath.Separator)
}

// appErrCode 提取 AppError.Code；非 AppError 直接失败
func appErrCode(t *testing.T, err error) types.ErrorCode {
	t.Helper()
	var ae types.AppError
	testutil.Equal(t, errors.As(err, &ae), true, "错误应为 AppError，实际: %v", err)
	return ae.Code
}

// globCount 统计 dir 下匹配 pattern 的残渣数量
func globCount(t *testing.T, dir, pattern string) int {
	t.Helper()
	matches, _ := filepath.Glob(filepath.Join(dir, pattern))
	return len(matches)
}

// ===== SimpleCopyImporter 错误分支 =====

func TestSimpleCopyImporter_Import_Errors(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	srcFile := filepath.Join(srcDir, "ok.txt")
	if err := os.WriteFile(srcFile, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// dstDir 的父级被文件占据 → MkdirAll 失败
	blockerParent := t.TempDir()
	blocker := filepath.Join(blockerParent, "afile")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	badDst := filepath.Join(blocker, "sub", "out")

	tests := []struct {
		name string
		src  string
		dst  string
		want string // 期望错误消息包含的子串
	}{
		{"源路径穿越", "../etc/passwd", dstDir, "非法路径"},
		{"目标路径穿越", srcFile, "../evil", "非法路径"},
		{"源不存在", filepath.Join(srcDir, "nope.txt"), dstDir, "无法访问源路径"},
		{"源为磁盘根目录", volRoot(t), dstDir, "磁盘根目录"},
		{"目标目录创建失败", srcFile, badDst, "创建目标目录失败"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := NewSimpleCopy("test").Import(tc.src, tc.dst)
			testutil.ErrorContains(t, err, tc.want, "Import(%q, %q) 应报错", tc.src, tc.dst)
		})
	}
}

func TestSimpleCopyImporter_Import_FileOverwrite(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	srcFile := filepath.Join(srcDir, "a.bin")
	if err := os.WriteFile(srcFile, []byte("newdata"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	dstFile := filepath.Join(dstDir, "a.bin")
	if err := os.WriteFile(dstFile, []byte("OLD"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	err := NewSimpleCopy("test").Import(srcFile, dstDir)
	testutil.NoError(t, err, "覆盖导入应成功，实际")
	data, _ := os.ReadFile(dstFile)
	testutil.Equal(t, string(data), "newdata", "覆盖后内容")
}

func TestSimpleCopyImporter_Import_FileTargetIsDir(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	srcFile := filepath.Join(srcDir, "a.bin")
	if err := os.WriteFile(srcFile, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 目标同名位置已存在为目录 → 文件导入必须失败且不留临时残渣
	if err := os.MkdirAll(filepath.Join(dstDir, "a.bin"), 0755); err != nil {
		testutil.NoError(t, err)
	}
	err := NewSimpleCopy("test").Import(srcFile, dstDir)
	testutil.NotNil(t, err, "目标为目录时文件导入应报错")
	testutil.Equal(t, globCount(t, dstDir, ".import-*.tmp"), 0, "失败后不应有 .import-*.tmp 残留")
	testutil.Equal(t, globCount(t, dstDir, ".tmp_import_*"), 0, "失败后不应有 .tmp_import_* 残留")
}

func TestSimpleCopyImporter_Import_DirOverwrite(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	folder := filepath.Base(srcDir)
	if err := os.WriteFile(filepath.Join(srcDir, "new.txt"), []byte("new"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 目标同名目录已存在（含旧文件）→ 应备份替换
	oldDir := filepath.Join(dstDir, folder)
	if err := os.MkdirAll(oldDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(oldDir, "old.txt"), []byte("old"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	err := NewSimpleCopy("test").Import(srcDir, dstDir)
	testutil.NoError(t, err, "目录覆盖导入应成功，实际")
	testutil.FileExists(t, filepath.Join(oldDir, "new.txt"), "新文件未导入")
	testutil.FileNotExists(t, filepath.Join(oldDir, "old.txt"), "旧目录内容应被整体替换，old.txt 不应存在")
	// 备份目录应被清理
	testutil.Equal(t, globCount(t, dstDir, folder+".import-bak-*"), 0, "备份目录应被清理")
}

// 缺陷A回归：copyDirRecursive 复制空子目录不得丢失（copyDirContents 修复前会丢）
func TestSimpleCopyImporter_Import_DirEmptySubdir(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	empty := filepath.Join(srcDir, "emptydir")
	if err := os.MkdirAll(empty, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "b.txt"), []byte("b"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	err := NewSimpleCopy("test").Import(srcDir, dstDir)
	testutil.NoError(t, err, "Import(dir) 应成功")
	info, err := os.Stat(filepath.Join(dstDir, filepath.Base(srcDir), "emptydir"))
	testutil.NoError(t, err, "空子目录应保留")
	testutil.Equal(t, info.IsDir(), true, "空子目录应保留")
}

// ===== copyDirRecursive 错误与回滚 =====

func TestCopyDirRecursive_OverwriteExisting(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "target")
	if err := os.WriteFile(filepath.Join(src, "b.txt"), []byte("bbb"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 目标已存在（含旧文件）→ 备份替换
	if err := os.MkdirAll(dst, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(dst, "old.txt"), []byte("old"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NoError(t, copyDirRecursive(src, dst), "copyDirRecursive 覆盖失败")
	data, err := os.ReadFile(filepath.Join(dst, "b.txt"))
	testutil.NoError(t, err, "新文件缺失")
	testutil.Equal(t, string(data), "bbb", "新文件缺失")
	testutil.FileNotExists(t, filepath.Join(dst, "old.txt"), "旧文件应被整体替换")
	testutil.Equal(t, globCount(t, filepath.Dir(dst), filepath.Base(dst)+".import-bak-*"), 0, "备份目录应被清理")
}

func TestCopyDirRecursive_DstMissing(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("aaa"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	dst := filepath.Join(t.TempDir(), "target")
	testutil.NoError(t, copyDirRecursive(src, dst), "目标不存在时直接 rename 失败")
	testutil.FileExists(t, filepath.Join(dst, "a.txt"), "目标文件缺失")
}

func TestCopyDirRecursive_Errors(t *testing.T) {
	src := t.TempDir()
	srcFile := filepath.Join(src, "f")
	if err := os.WriteFile(srcFile, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	blockerParent := t.TempDir()
	blocker := filepath.Join(blockerParent, "afile")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	tests := []struct {
		name string
		src  string
		dst  string
	}{
		{"源是文件（ReadDir 失败）", srcFile, filepath.Join(t.TempDir(), "out")},
		{"临时目录创建失败（dst 父级是文件）", src, filepath.Join(blocker, "sub", "out")},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			testutil.NotNil(t, copyDirRecursive(tc.src, tc.dst), "copyDirRecursive(%q, %q) 应报错", tc.src, tc.dst)
		})
	}
}

// ===== DirectoryCopyImporter 错误分支 =====

func TestDirectoryCopyImporter_Import_Errors(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	modelDir := filepath.Join(srcDir, "model")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	blockerParent := t.TempDir()
	blocker := filepath.Join(blockerParent, "afile")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	badDst := filepath.Join(blocker, "sub", "out")

	tests := []struct {
		name string
		src  string
		dst  string
		want string
	}{
		{"空源路径", "", dstDir, "源文件路径为空"},
		{"空目标路径", modelDir, "", "目标目录为空"},
		{"源路径穿越", "../etc/passwd", dstDir, "非法路径"},
		{"目标路径穿越", modelDir, "../evil", "非法路径"},
		{"源不存在", filepath.Join(srcDir, "nope"), dstDir, "无法访问源路径"},
		{"源为磁盘根目录", volRoot(t), dstDir, "磁盘根目录"},
		{"目标目录创建失败", modelDir, badDst, "创建目标目录失败"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := NewDirectoryCopy("EntityPlayer").Import(tc.src, tc.dst)
			testutil.ErrorContains(t, err, tc.want, "Import(%q, %q) 应报错", tc.src, tc.dst)
		})
	}
}

func TestDirectoryCopyImporter_Import_Overwrite(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	folderName := "mmd_model"
	modelDir := filepath.Join(srcDir, folderName)
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.pmx"), []byte("pmx"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 目标同名目录已存在 → 备份替换
	oldDir := filepath.Join(dstDir, folderName)
	if err := os.MkdirAll(oldDir, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(oldDir, "stale.pmx"), []byte("stale"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	err := NewDirectoryCopy("EntityPlayer").Import(modelDir, dstDir)
	testutil.NoError(t, err, "覆盖导入应成功，实际")
	testutil.FileExists(t, filepath.Join(oldDir, "model.pmx"), "新文件缺失")
	testutil.FileNotExists(t, filepath.Join(oldDir, "stale.pmx"), "旧文件应被整体替换")
	testutil.Equal(t, globCount(t, dstDir, folderName+".import-bak-*"), 0, "备份目录应被清理")
}

func TestDirectoryCopyImporter_Import_EmptyDir(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	empty := filepath.Join(srcDir, "emptymodel")
	if err := os.MkdirAll(empty, 0755); err != nil {
		testutil.NoError(t, err)
	}
	err := NewDirectoryCopy("EntityPlayer").Import(empty, dstDir)
	testutil.NoError(t, err, "空目录导入应成功，实际")
	info, err := os.Stat(filepath.Join(dstDir, "emptymodel"))
	testutil.NoError(t, err, "目标空目录应存在")
	testutil.Equal(t, info.IsDir(), true, "目标空目录应存在")
}

// ===== copyFile =====

func TestCopyFile(t *testing.T) {
	src := filepath.Join(t.TempDir(), "src.txt")
	if err := os.WriteFile(src, []byte("content"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 目标父目录不存在 → MkdirAll 自动创建
	dst := filepath.Join(t.TempDir(), "nested", "deep", "dst.txt")
	testutil.NoError(t, fsutil.CopyFile(src, dst), "copyFile 失败")
	data, err := os.ReadFile(dst)
	testutil.NoError(t, err, "内容错误")
	testutil.Equal(t, string(data), "content", "内容错误")
	if runtime.GOOS != "windows" {
		info, _ := os.Stat(dst)
		testutil.Equal(t, info.Mode().Perm(), os.FileMode(0644), "权限应为 644")
	}
}

func TestCopyFile_Errors(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(srcDir, "ok.txt"), []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 目标已存在为目录 → os.Create 失败
	dirTarget := filepath.Join(dstDir, "d")
	if err := os.MkdirAll(dirTarget, 0755); err != nil {
		testutil.NoError(t, err)
	}
	// 目标父级是文件 → MkdirAll 失败
	blocker := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	tests := []struct {
		name string
		src  string
		dst  string
	}{
		{"源不存在", filepath.Join(srcDir, "nope.txt"), filepath.Join(dstDir, "out.txt")},
		{"目标已存在为目录", filepath.Join(srcDir, "ok.txt"), dirTarget},
		{"目标父级是文件", filepath.Join(srcDir, "ok.txt"), filepath.Join(blocker, "sub", "out.txt")},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			testutil.NotNil(t, fsutil.CopyFile(tc.src, tc.dst), "fsutil.CopyFile(%q, %q) 应报错", tc.src, tc.dst)
		})
	}
}

// ===== ImportFromBase64 校验与错误码 =====

func TestImportFromBase64_Validation(t *testing.T) {
	root := t.TempDir()
	rootFn := func(rtype string) string { return root }
	logFn := func(name, src, dst string, size int64, status, msg string) {}

	tests := []struct {
		name     string
		fileName string
		b64      string
		opts     ImportOptions
		wantCode types.ErrorCode
	}{
		{"路径穿越 ../", "../evil.ysm", base64.StdEncoding.EncodeToString([]byte("x")), ImportOptions{}, "FILENAME_INVALID"},
		{"路径穿越 ..\\", "..\\evil.ysm", base64.StdEncoding.EncodeToString([]byte("x")), ImportOptions{}, "FILENAME_INVALID"},
		{"路径分隔符 /", "a/b.ysm", base64.StdEncoding.EncodeToString([]byte("x")), ImportOptions{}, "FILENAME_INVALID"},
		{"路径分隔符 \\", "a\\b.ysm", base64.StdEncoding.EncodeToString([]byte("x")), ImportOptions{}, "FILENAME_INVALID"},
		{"不支持扩展名", "evil.txt", base64.StdEncoding.EncodeToString([]byte("x")), ImportOptions{}, "FILE_TYPE_UNSUPPORTED"},
		{"无扩展名", "noext", base64.StdEncoding.EncodeToString([]byte("x")), ImportOptions{}, "FILE_TYPE_UNSUPPORTED"},
		{"base64 非法", "m.ysm", "!!!not-base64!!!", ImportOptions{}, "DECODE_FAILED"},
		{"内容为空", "m.ysm", base64.StdEncoding.EncodeToString([]byte{}), ImportOptions{}, "FILE_EMPTY"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := ImportFromBase64(tc.fileName, tc.b64, tc.opts, rootFn, logFn)
			testutil.NotNil(t, err, "ImportFromBase64(%q) 应报错", tc.fileName)
			testutil.Equal(t, appErrCode(t, err), tc.wantCode, "错误码不符（err=%v）", err)
		})
	}

	t.Run("存储路径未设置", func(t *testing.T) {
		_, _, err := ImportFromBase64("m.ysm", base64.StdEncoding.EncodeToString([]byte("x")), ImportOptions{},
			func(rtype string) string { return "" }, logFn)
		testutil.ErrorContains(t, err, "请先设置文件存储路径", "rootFn 返回空应报错")
	})
}

// 魔数校验 warn 分支：仅 zip/ysm/7z 非匹配魔数时通知，SkipCheck 或匹配时静默
func TestImportFromBase64_MagicWarn(t *testing.T) {
	root := t.TempDir()
	rootFn := func(rtype string) string { return root }
	badZip := base64.StdEncoding.EncodeToString([]byte{0xDE, 0xAD, 0xBE, 0xEF, 0x00})
	bad7z := base64.StdEncoding.EncodeToString([]byte{0x01, 0x02, 0x03, 0x04, 0x05})
	short := base64.StdEncoding.EncodeToString([]byte{0x50, 0x4B})

	// 合法 ysm 字节（不校验魔数，仅验证 .ysm 路径 warn 分支保留）
	run := func(name, b64 string, opts ImportOptions) []string {
		var logs []string
		logFn := func(n, s, d string, size int64, status, msg string) {
			logs = append(logs, status+":"+msg)
		}
		// Overwrite 允许各用例复用同一 root 下的同名文件
		opts.Overwrite = true
		_, _, err := ImportFromBase64(name, b64, opts, rootFn, logFn)
		testutil.NoError(t, err, "导入应成功")
		return logs
	}

	tests := []struct {
		name     string
		fileName string
		b64      string
		opts     ImportOptions
		wantWarn bool
	}{
		// ADR-082 续：坏 zip/7z 在类型检测阶段即被拦截（无特征 → 空 rtype → 报错），
		// 魔数 warn 路径仅剩 .ysm（扩展名单归属，魔数不匹配仍导入 + warn）
		{"ysm 魔数不匹配", "m.ysm", badZip, ImportOptions{}, true},
		{"数据不足4字节", "m.ysm", short, ImportOptions{}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			logs := run(tc.fileName, tc.b64, tc.opts)
			testutil.Equal(t, tc.wantWarn && len(logs) == 0, false, "应产生 warn 日志，实际无")
			testutil.Equal(t, !tc.wantWarn && len(logs) != 0, false, "不应产生 warn 日志，实际 %v", logs)
			// logs[0] 仅在 wantWarn=true 时安全（原 if 短路语义），须保持惰性求值
			if tc.wantWarn {
				testutil.Equal(t, strings.HasPrefix(logs[0], "warn:"), true, "日志状态应为 warn，实际 %q", logs[0])
			}
		})
	}

	// 坏 zip/7z：无特征 → 明确报错（不假装 ysm 导入）
	badCases := []struct {
		name     string
		fileName string
		b64      string
	}{
		{"zip 魔数不匹配", "m.zip", badZip},
		{"7z 魔数不匹配", "m.7z", bad7z},
	}
	for _, tc := range badCases {
		t.Run(tc.name, func(t *testing.T) {
			var logs []string
			logFn := func(n, s, d string, size int64, status, msg string) { logs = append(logs, msg) }
			_, _, err := ImportFromBase64(tc.fileName, tc.b64, ImportOptions{Overwrite: true}, rootFn, logFn)
			testutil.NotNil(t, err, "坏容器应报错（识别不出就是识别不出），实际导入成功")
			testutil.Equal(t, appErrCode(t, err), "FILE_TYPE_UNSUPPORTED", "错误码不符（err=%v）", err)
		})
	}
}

// 缺陷B回归：logger 为 nil 时不得 panic（.ysm 魔数不匹配仍应正常导入）
func TestImportFromBase64_NilLogger(t *testing.T) {
	root := t.TempDir()
	badYsm := base64.StdEncoding.EncodeToString([]byte{0xDE, 0xAD, 0xBE, 0xEF, 0x00})
	_, _, err := ImportFromBase64("m.ysm", badYsm, ImportOptions{}, func(rtype string) string { return root }, nil)
	testutil.NoError(t, err, "nil logger 不应影响导入")
	testutil.FileExists(t, filepath.Join(root, "m.ysm"), "文件应已写入")
}

// 目标目录创建失败 → MKDIR_FAILED 错误码
func TestImportFromBase64_MkdirFailed(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	rootFn := func(rtype string) string { return filepath.Join(blocker, "sub", "repo") }
	_, _, err := ImportFromBase64("m.ysm", base64.StdEncoding.EncodeToString([]byte("x")), ImportOptions{}, rootFn,
		func(n, s, d string, size int64, status, msg string) {})
	testutil.NotNil(t, err, "目标目录创建失败应报错")
	testutil.Equal(t, appErrCode(t, err), "MKDIR_FAILED", "错误码不符（err=%v）", err)
}

// 类型路由：rootFn 收到正确的 rtype（ZIP 内容检测优先，扩展名回退）
func TestImportFromBase64_RtypeRouting(t *testing.T) {
	root := t.TempDir()
	// 标准 ZIP fixture（buildZipStd：zip.NewWriter 完整 central directory，
	// 对齐 DetectContainerType 的 zip.NewReader 收敛——锐评 #16）
	buildZip := func(entryName string) []byte {
		return buildZipStd(zipEntry{entryName, nil})
	}
	got := map[string]int{}
	rootFn := func(rtype string) string {
		got[rtype]++
		return root
	}
	logFn := func(n, s, d string, size int64, status, msg string) {}

	tests := []struct {
		name     string
		fileName string
		data     []byte
		wantType string
		wantErr  bool
	}{
		{"zip 内 pack.mcmeta → resourcepack", "p.zip", buildZip("pack.mcmeta"), "resourcepack", false},
		// ADR-082 续：zip 无特征 → 空 rtype → 报错（识别不出就是识别不出，不假装 ysm）
		{"zip 无特征 → 报错", "p.zip", buildZip("random.txt"), "", true},
		{"pmx 扩展名 → EntityPlayer", "model.pmx", []byte("pmx"), "EntityPlayer", false},
		{"vrm 扩展名 → EntityPlayer", "model.vrm", []byte("vrm"), "EntityPlayer", false},
		{"nbt 扩展名 → blueprint", "build.nbt", []byte("nbt"), "blueprint", false},
		{"litematic 扩展名 → litematic", "build.litematic", []byte("li"), "litematic", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			clear(got)
			_, _, err := ImportFromBase64(tc.fileName, base64.StdEncoding.EncodeToString(tc.data), ImportOptions{Overwrite: true}, rootFn, logFn)
			if tc.wantErr {
				testutil.NotNil(t, err, "应报错（无特征容器不得假装 ysm），实际导入成功")
				return
			}
			testutil.NoError(t, err, "导入失败")
			testutil.Equal(t, got[tc.wantType] > 0, true, "rootFn 应收到 %q，实际 %v", tc.wantType, got)
		})
	}
}

// 大小超限 → FILE_TOO_LARGE（500MB 边界；-short 时跳过以省内存）
func TestImportFromBase64_FileTooLarge(t *testing.T) {
	if testing.Short() {
		t.Skip("short 模式跳过 500MB 边界用例")
	}
	root := t.TempDir()
	big := make([]byte, typereg.MaxImportSize+1)
	b64 := base64.StdEncoding.EncodeToString(big)
	_, _, err := ImportFromBase64("big.ysm", b64, ImportOptions{}, func(rtype string) string { return root },
		func(n, s, d string, size int64, status, msg string) {})
	testutil.NotNil(t, err, "超过 500MB 应报错")
	testutil.Equal(t, appErrCode(t, err), "FILE_TOO_LARGE", "错误码不符（err=%v）", err)
}

// ===== WriteFileAtomic 错误码包装 =====

func TestWriteFileAtomic_ErrorCodes(t *testing.T) {
	t.Run("成功", func(t *testing.T) {
		dest := filepath.Join(t.TempDir(), "ok.txt")
		testutil.NoError(t, WriteFileAtomic(dest, []byte("data")), "WriteFileAtomic 应成功")
		data, _ := os.ReadFile(dest)
		testutil.Equal(t, string(data), "data", "内容不符")
	})

	t.Run("落地失败 → WRITE_FAILED", func(t *testing.T) {
		root := t.TempDir()
		// destPath 已存在为目录 → Rename 必然失败
		dirTarget := filepath.Join(root, "blocked.ysm")
		if err := os.MkdirAll(dirTarget, 0755); err != nil {
			testutil.NoError(t, err)
		}
		err := WriteFileAtomic(dirTarget, []byte("x"))
		testutil.NotNil(t, err, "目标为目录时落地应失败")
		testutil.Equal(t, appErrCode(t, err), "WRITE_FAILED", "错误码不符（err=%v）", err)
		testutil.Equal(t, globCount(t, root, ".atomic-*.tmp"), 0, "失败后不应有 .atomic-*.tmp 残留")
	})
}

// ===== 符号链接复制（copyDir / 两个 Importer 的目录导入共用）=====

// makeSymlinkFixture 创建含文件链接与目录链接的源目录；环境不支持 symlink 时返回 false
func makeSymlinkFixture(t *testing.T, src string) bool {
	t.Helper()
	sub := filepath.Join(src, "sub")
	if err := os.MkdirAll(sub, 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(sub, "real.txt"), []byte("real"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(src, "file.txt"), []byte("file"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.Symlink(filepath.Join(src, "file.txt"), filepath.Join(src, "file-link")); err != nil {
		return false
	}
	if err := os.Symlink(filepath.Join(src, "sub"), filepath.Join(src, "dir-link")); err != nil {
		return false
	}
	return true
}

// assertSymlinkCopied 断言 dst 下存在符号链接且指向相同目标
func assertSymlinkCopied(t *testing.T, linkPath, wantTarget string) {
	t.Helper()
	info, err := os.Lstat(linkPath)
	testutil.NoError(t, err, "符号链接应被复制")
	testutil.Equal(t, info.Mode()&os.ModeSymlink == 0, false, "%s 应为符号链接，实际 %v", linkPath, info.Mode())
	gotTarget, err := os.Readlink(linkPath)
	testutil.NoError(t, err, "读取链接目标失败")
	testutil.Equal(t, gotTarget, wantTarget, "链接目标不符")
}

func TestCopyDir_Symlink(t *testing.T) {
	src := t.TempDir()
	if !makeSymlinkFixture(t, src) {
		t.Skip("环境不支持创建符号链接，跳过")
	}
	dst := filepath.Join(t.TempDir(), "copied")
	testutil.NoError(t, copyDir(src, dst), "copyDir 失败")
	assertSymlinkCopied(t, filepath.Join(dst, "file-link"), filepath.Join(src, "file.txt"))
	assertSymlinkCopied(t, filepath.Join(dst, "dir-link"), filepath.Join(src, "sub"))
	// 普通文件与目录照常复制
	testutil.FileExists(t, filepath.Join(dst, "file.txt"), "普通文件缺失")
	testutil.FileExists(t, filepath.Join(dst, "sub", "real.txt"), "目录内容缺失")
}

func TestSimpleCopyImporter_Import_DirSymlink(t *testing.T) {
	src := t.TempDir()
	if !makeSymlinkFixture(t, src) {
		t.Skip("环境不支持创建符号链接，跳过")
	}
	dst := t.TempDir()
	testutil.NoError(t, NewSimpleCopy("test").Import(src, dst), "Import 应成功")
	copied := filepath.Join(dst, filepath.Base(src))
	assertSymlinkCopied(t, filepath.Join(copied, "file-link"), filepath.Join(src, "file.txt"))
	assertSymlinkCopied(t, filepath.Join(copied, "dir-link"), filepath.Join(src, "sub"))
}

func TestDirectoryCopyImporter_Import_Symlink(t *testing.T) {
	src := t.TempDir()
	if !makeSymlinkFixture(t, src) {
		t.Skip("环境不支持创建符号链接，跳过")
	}
	dst := t.TempDir()
	imp := NewDirectoryCopy("EntityPlayer")
	testutil.NoError(t, imp.Import(src, dst), "Import 应成功")
	copied := filepath.Join(dst, filepath.Base(src))
	assertSymlinkCopied(t, filepath.Join(copied, "file-link"), filepath.Join(src, "file.txt"))
	assertSymlinkCopied(t, filepath.Join(copied, "dir-link"), filepath.Join(src, "sub"))
}

// ===== DetectContainerType 边界 =====

// zipEntry 构造测试 zip 的条目
type zipEntry struct {
	name string
	comp []byte
}

// buildZipStd 构造标准 ZIP（zip.NewWriter 写完整 local header + central directory）：
// DetectContainerType 已收敛到 container.OpenZipBytes / zip.NewReader（锐评 #16），
// 旧手写 local-header-only 字节流不再可解析，测试 fixture 同步标准库构造。
// entries 顺序即写入顺序。
func buildZipStd(entries ...zipEntry) []byte {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, e := range entries {
		f, _ := w.Create(e.name)
		_, _ = f.Write(e.comp)
	}
	_ = w.Close()
	return buf.Bytes()
}

func TestDetectContainerType_More(t *testing.T) {
	plain := zipEntry{"random.txt", []byte("abcd")}

	tests := []struct {
		name string
		data []byte
		want string
	}{
		{"shaders 精确匹配", buildZipStd(zipEntry{"shaders", nil}), "shaderpack"},
		{"ysm.json 后缀匹配", buildZipStd(zipEntry{"foo/ysm.json", nil}), "ysm"},
		{"大小写不敏感", buildZipStd(zipEntry{"Pack.McMeta", nil}), "resourcepack"},
		{"多 entry 跳过压缩数据后识别", buildZipStd(plain, zipEntry{"shaders/x.fsh", nil}), "shaderpack"},
		{"首 entry 无特征多 entry 无特征 → 空", buildZipStd(plain, zipEntry{"data.bin", nil}), ""},
		{"截断 header", []byte{0x50, 0x4B, 0x03}, ""},
		{"文件名超长截断", append([]byte{0x50, 0x4B, 0x03, 0x04}, make([]byte, 26)...), ""},
		{"非 ZIP 开头", []byte("PK\x00\x00"), ""},
		{"空数据", nil, ""},
		{"7z 魔数非 7z 内容 → 空", append([]byte{0x37, 0x7A, 0xBC, 0xAF}, []byte("not7z")...), ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			testutil.Equal(t, DetectContainerType(tc.data), tc.want, "DetectContainerType 类型不符")
		})
	}
}
