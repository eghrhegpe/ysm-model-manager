// ===== go/importer 测试反推（补充错误分支/边界/回滚路径覆盖）=====
// 覆盖策略：表驱动优先；聚焦此前未覆盖的失败路径——
// 路径遍历防护、磁盘根目录防护、目标已存在时的备份替换与回滚、
// 失败后的临时文件清理（不留 .import-*.tmp / .tmp_import_* 残渣）、
// 结构化错误码（AppError.Code）、ZIP 类型检测边界。
package importer

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
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
	if !errors.As(err, &ae) {
		t.Fatalf("错误应为 AppError，实际: %v", err)
	}
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
		t.Fatal(err)
	}
	// dstDir 的父级被文件占据 → MkdirAll 失败
	blockerParent := t.TempDir()
	blocker := filepath.Join(blockerParent, "afile")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
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
			msg := NewSimpleCopy("test").Import(tc.src, tc.dst)
			if msg == "" {
				t.Fatalf("Import(%q, %q) 应报错，实际成功", tc.src, tc.dst)
			}
			if !strings.Contains(msg, tc.want) {
				t.Fatalf("错误消息 %q 应包含 %q", msg, tc.want)
			}
		})
	}
}

func TestSimpleCopyImporter_Import_FileOverwrite(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	srcFile := filepath.Join(srcDir, "a.bin")
	if err := os.WriteFile(srcFile, []byte("newdata"), 0644); err != nil {
		t.Fatal(err)
	}
	dstFile := filepath.Join(dstDir, "a.bin")
	if err := os.WriteFile(dstFile, []byte("OLD"), 0644); err != nil {
		t.Fatal(err)
	}

	msg := NewSimpleCopy("test").Import(srcFile, dstDir)
	if msg != "" {
		t.Fatalf("覆盖导入应成功，实际: %q", msg)
	}
	data, _ := os.ReadFile(dstFile)
	if string(data) != "newdata" {
		t.Fatalf("覆盖后内容 = %q, 期望 newdata", string(data))
	}
}

func TestSimpleCopyImporter_Import_FileTargetIsDir(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	srcFile := filepath.Join(srcDir, "a.bin")
	if err := os.WriteFile(srcFile, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 目标同名位置已存在为目录 → 文件导入必须失败且不留临时残渣
	if err := os.MkdirAll(filepath.Join(dstDir, "a.bin"), 0755); err != nil {
		t.Fatal(err)
	}
	msg := NewSimpleCopy("test").Import(srcFile, dstDir)
	if msg == "" {
		t.Fatal("目标为目录时文件导入应报错")
	}
	if n := globCount(t, dstDir, ".import-*.tmp"); n != 0 {
		t.Fatalf("失败后不应有 .import-*.tmp 残留，实际 %d 个", n)
	}
	if n := globCount(t, dstDir, ".tmp_import_*"); n != 0 {
		t.Fatalf("失败后不应有 .tmp_import_* 残留，实际 %d 个", n)
	}
}

func TestSimpleCopyImporter_Import_DirOverwrite(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	folder := filepath.Base(srcDir)
	if err := os.WriteFile(filepath.Join(srcDir, "new.txt"), []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	// 目标同名目录已存在（含旧文件）→ 应备份替换
	oldDir := filepath.Join(dstDir, folder)
	if err := os.MkdirAll(oldDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldDir, "old.txt"), []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}

	msg := NewSimpleCopy("test").Import(srcDir, dstDir)
	if msg != "" {
		t.Fatalf("目录覆盖导入应成功，实际: %q", msg)
	}
	if _, err := os.Stat(filepath.Join(oldDir, "new.txt")); err != nil {
		t.Fatalf("新文件未导入: %v", err)
	}
	if _, err := os.Stat(filepath.Join(oldDir, "old.txt")); err == nil {
		t.Fatal("旧目录内容应被整体替换，old.txt 不应存在")
	}
	// 备份目录应被清理
	if n := globCount(t, dstDir, folder+".import-bak-*"); n != 0 {
		t.Fatalf("备份目录应被清理，实际残留 %d 个", n)
	}
}

// 缺陷A回归：copyDirRecursive 复制空子目录不得丢失（copyDirContents 修复前会丢）
func TestSimpleCopyImporter_Import_DirEmptySubdir(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	empty := filepath.Join(srcDir, "emptydir")
	if err := os.MkdirAll(empty, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "b.txt"), []byte("b"), 0644); err != nil {
		t.Fatal(err)
	}

	msg := NewSimpleCopy("test").Import(srcDir, dstDir)
	if msg != "" {
		t.Fatalf("Import(dir) = %q, want empty", msg)
	}
	info, err := os.Stat(filepath.Join(dstDir, filepath.Base(srcDir), "emptydir"))
	if err != nil || !info.IsDir() {
		t.Fatalf("空子目录应保留: %v", err)
	}
}

// ===== copyDirRecursive / copyDirContents 错误与回滚 =====

func TestCopyDirRecursive_OverwriteExisting(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "target")
	if err := os.WriteFile(filepath.Join(src, "b.txt"), []byte("bbb"), 0644); err != nil {
		t.Fatal(err)
	}
	// 目标已存在（含旧文件）→ 备份替换
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "old.txt"), []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := copyDirRecursive(src, dst); err != nil {
		t.Fatalf("copyDirRecursive 覆盖失败: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(dst, "b.txt")); err != nil || string(data) != "bbb" {
		t.Fatalf("新文件缺失: %v %q", err, string(data))
	}
	if _, err := os.Stat(filepath.Join(dst, "old.txt")); err == nil {
		t.Fatal("旧文件应被整体替换")
	}
	if n := globCount(t, filepath.Dir(dst), filepath.Base(dst)+".import-bak-*"); n != 0 {
		t.Fatalf("备份目录应被清理，实际残留 %d 个", n)
	}
}

func TestCopyDirRecursive_DstMissing(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("aaa"), 0644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(t.TempDir(), "target")
	if err := copyDirRecursive(src, dst); err != nil {
		t.Fatalf("目标不存在时直接 rename 失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dst, "a.txt")); err != nil {
		t.Fatalf("目标文件缺失: %v", err)
	}
}

func TestCopyDirRecursive_Errors(t *testing.T) {
	src := t.TempDir()
	srcFile := filepath.Join(src, "f")
	if err := os.WriteFile(srcFile, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	blockerParent := t.TempDir()
	blocker := filepath.Join(blockerParent, "afile")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
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
			if err := copyDirRecursive(tc.src, tc.dst); err == nil {
				t.Fatalf("copyDirRecursive(%q, %q) 应报错", tc.src, tc.dst)
			}
		})
	}
}

func TestCopyDirContents_EmptySubdir(t *testing.T) {
	src := t.TempDir()
	if err := os.MkdirAll(filepath.Join(src, "emptydir"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("aaa"), 0644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(t.TempDir(), "out")
	if err := copyDirContents(src, dst); err != nil {
		t.Fatalf("copyDirContents 失败: %v", err)
	}
	info, err := os.Stat(filepath.Join(dst, "emptydir"))
	if err != nil || !info.IsDir() {
		t.Fatalf("空子目录应保留: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dst, "a.txt")); err != nil {
		t.Fatalf("文件缺失: %v", err)
	}
}

// ===== DirectoryCopyImporter 错误分支 =====

func TestDirectoryCopyImporter_Import_Errors(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	modelDir := filepath.Join(srcDir, "model")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	blockerParent := t.TempDir()
	blocker := filepath.Join(blockerParent, "afile")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
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
			msg := NewDirectoryCopy("EntityPlayer").Import(tc.src, tc.dst)
			if msg == "" {
				t.Fatalf("Import(%q, %q) 应报错，实际成功", tc.src, tc.dst)
			}
			if !strings.Contains(msg, tc.want) {
				t.Fatalf("错误消息 %q 应包含 %q", msg, tc.want)
			}
		})
	}
}

func TestDirectoryCopyImporter_Import_Overwrite(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	folderName := "mmd_model"
	modelDir := filepath.Join(srcDir, folderName)
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.pmx"), []byte("pmx"), 0644); err != nil {
		t.Fatal(err)
	}
	// 目标同名目录已存在 → 备份替换
	oldDir := filepath.Join(dstDir, folderName)
	if err := os.MkdirAll(oldDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldDir, "stale.pmx"), []byte("stale"), 0644); err != nil {
		t.Fatal(err)
	}

	msg := NewDirectoryCopy("EntityPlayer").Import(modelDir, dstDir)
	if msg != "" {
		t.Fatalf("覆盖导入应成功，实际: %q", msg)
	}
	if _, err := os.Stat(filepath.Join(oldDir, "model.pmx")); err != nil {
		t.Fatalf("新文件缺失: %v", err)
	}
	if _, err := os.Stat(filepath.Join(oldDir, "stale.pmx")); err == nil {
		t.Fatal("旧文件应被整体替换")
	}
	if n := globCount(t, dstDir, folderName+".import-bak-*"); n != 0 {
		t.Fatalf("备份目录应被清理，实际残留 %d 个", n)
	}
}

func TestDirectoryCopyImporter_Import_EmptyDir(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	empty := filepath.Join(srcDir, "emptymodel")
	if err := os.MkdirAll(empty, 0755); err != nil {
		t.Fatal(err)
	}
	msg := NewDirectoryCopy("EntityPlayer").Import(empty, dstDir)
	if msg != "" {
		t.Fatalf("空目录导入应成功，实际: %q", msg)
	}
	info, err := os.Stat(filepath.Join(dstDir, "emptymodel"))
	if err != nil || !info.IsDir() {
		t.Fatalf("目标空目录应存在: %v", err)
	}
}

// ===== copyFile =====

func TestCopyFile(t *testing.T) {
	src := filepath.Join(t.TempDir(), "src.txt")
	if err := os.WriteFile(src, []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	// 目标父目录不存在 → MkdirAll 自动创建
	dst := filepath.Join(t.TempDir(), "nested", "deep", "dst.txt")
	if err := copyFile(src, dst); err != nil {
		t.Fatalf("copyFile 失败: %v", err)
	}
	data, err := os.ReadFile(dst)
	if err != nil || string(data) != "content" {
		t.Fatalf("内容错误: %v %q", err, string(data))
	}
	if runtime.GOOS != "windows" {
		info, _ := os.Stat(dst)
		if perm := info.Mode().Perm(); perm != 0644 {
			t.Fatalf("权限 = %o, 期望 644", perm)
		}
	}
}

func TestCopyFile_Errors(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(srcDir, "ok.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 目标已存在为目录 → os.Create 失败
	dirTarget := filepath.Join(dstDir, "d")
	if err := os.MkdirAll(dirTarget, 0755); err != nil {
		t.Fatal(err)
	}
	// 目标父级是文件 → MkdirAll 失败
	blocker := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
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
			if err := copyFile(tc.src, tc.dst); err == nil {
				t.Fatalf("copyFile(%q, %q) 应报错", tc.src, tc.dst)
			}
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
			if err == nil {
				t.Fatalf("ImportFromBase64(%q) 应报错", tc.fileName)
			}
			if code := appErrCode(t, err); code != tc.wantCode {
				t.Fatalf("错误码 = %q, 期望 %q（%v）", code, tc.wantCode, err)
			}
		})
	}

	t.Run("存储路径未设置", func(t *testing.T) {
		_, _, err := ImportFromBase64("m.ysm", base64.StdEncoding.EncodeToString([]byte("x")), ImportOptions{},
			func(rtype string) string { return "" }, logFn)
		if err == nil {
			t.Fatal("rootFn 返回空应报错")
		}
		if !strings.Contains(err.Error(), "请先设置文件存储路径") {
			t.Fatalf("错误消息 %q 应包含存储路径提示", err.Error())
		}
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
		if _, _, err := ImportFromBase64(name, b64, opts, rootFn, logFn); err != nil {
			t.Fatalf("导入应成功: %v", err)
		}
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
			if tc.wantWarn && len(logs) == 0 {
				t.Fatalf("应产生 warn 日志，实际无")
			}
			if !tc.wantWarn && len(logs) != 0 {
				t.Fatalf("不应产生 warn 日志，实际 %v", logs)
			}
			if tc.wantWarn && !strings.HasPrefix(logs[0], "warn:") {
				t.Fatalf("日志状态应为 warn，实际 %q", logs[0])
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
			if err == nil {
				t.Fatalf("坏容器应报错（识别不出就是识别不出），实际导入成功")
			}
			if code := appErrCode(t, err); code != "FILE_TYPE_UNSUPPORTED" {
				t.Fatalf("错误码 = %q, 期望 FILE_TYPE_UNSUPPORTED", code)
			}
		})
	}
}

// 缺陷B回归：logger 为 nil 时不得 panic（.ysm 魔数不匹配仍应正常导入）
func TestImportFromBase64_NilLogger(t *testing.T) {
	root := t.TempDir()
	badYsm := base64.StdEncoding.EncodeToString([]byte{0xDE, 0xAD, 0xBE, 0xEF, 0x00})
	_, _, err := ImportFromBase64("m.ysm", badYsm, ImportOptions{}, func(rtype string) string { return root }, nil)
	if err != nil {
		t.Fatalf("nil logger 不应影响导入: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "m.ysm")); err != nil {
		t.Fatalf("文件应已写入: %v", err)
	}
}

// 目标目录创建失败 → MKDIR_FAILED 错误码
func TestImportFromBase64_MkdirFailed(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	rootFn := func(rtype string) string { return filepath.Join(blocker, "sub", "repo") }
	_, _, err := ImportFromBase64("m.ysm", base64.StdEncoding.EncodeToString([]byte("x")), ImportOptions{}, rootFn,
		func(n, s, d string, size int64, status, msg string) {})
	if err == nil {
		t.Fatal("目标目录创建失败应报错")
	}
	if code := appErrCode(t, err); code != "MKDIR_FAILED" {
		t.Fatalf("错误码 = %q, 期望 MKDIR_FAILED", code)
	}
}

// 类型路由：rootFn 收到正确的 rtype（ZIP 内容检测优先，扩展名回退）
func TestImportFromBase64_RtypeRouting(t *testing.T) {
	root := t.TempDir()
	// 构造 ZIP 内含 pack.mcmeta 的 local file header
	buildZip := func(entryName string) []byte {
		hdr := make([]byte, 30)
		hdr[0], hdr[1], hdr[2], hdr[3] = 0x50, 0x4B, 0x03, 0x04
		hdr[26] = byte(len(entryName))
		return append(hdr, []byte(entryName)...)
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
				if err == nil {
					t.Fatalf("应报错（无特征容器不得假装 ysm），实际导入成功")
				}
				return
			}
			if err != nil {
				t.Fatalf("导入失败: %v", err)
			}
			if got[tc.wantType] == 0 {
				t.Fatalf("rootFn 应收到 %q，实际 %v", tc.wantType, got)
			}
		})
	}
}

// 大小超限 → FILE_TOO_LARGE（500MB 边界；-short 时跳过以省内存）
func TestImportFromBase64_FileTooLarge(t *testing.T) {
	if testing.Short() {
		t.Skip("short 模式跳过 500MB 边界用例")
	}
	root := t.TempDir()
	big := make([]byte, types.MaxImportSize+1)
	b64 := base64.StdEncoding.EncodeToString(big)
	big = nil // 释放源缓冲，降低峰值内存
	_, _, err := ImportFromBase64("big.ysm", b64, ImportOptions{}, func(rtype string) string { return root },
		func(n, s, d string, size int64, status, msg string) {})
	if err == nil {
		t.Fatal("超过 500MB 应报错")
	}
	if code := appErrCode(t, err); code != "FILE_TOO_LARGE" {
		t.Fatalf("错误码 = %q, 期望 FILE_TOO_LARGE", code)
	}
}

// ===== WriteFileAtomic 错误码包装 =====

func TestWriteFileAtomic_ErrorCodes(t *testing.T) {
	t.Run("成功", func(t *testing.T) {
		dest := filepath.Join(t.TempDir(), "ok.txt")
		if err := WriteFileAtomic(dest, []byte("data")); err != nil {
			t.Fatalf("WriteFileAtomic 应成功: %v", err)
		}
		data, _ := os.ReadFile(dest)
		if string(data) != "data" {
			t.Fatalf("内容 = %q", string(data))
		}
	})

	t.Run("落地失败 → WRITE_FAILED", func(t *testing.T) {
		root := t.TempDir()
		// destPath 已存在为目录 → Rename 必然失败
		dirTarget := filepath.Join(root, "blocked.ysm")
		if err := os.MkdirAll(dirTarget, 0755); err != nil {
			t.Fatal(err)
		}
		err := WriteFileAtomic(dirTarget, []byte("x"))
		if err == nil {
			t.Fatal("目标为目录时落地应失败")
		}
		if code := appErrCode(t, err); code != "WRITE_FAILED" {
			t.Fatalf("错误码 = %q, 期望 WRITE_FAILED", code)
		}
		if n := globCount(t, root, ".atomic-*.tmp"); n != 0 {
			t.Fatalf("失败后不应有 .atomic-*.tmp 残留，实际 %d 个", n)
		}
	})
}

// ===== 符号链接复制（copyDir / copyDirContents / 两个 Importer 的目录导入共用）=====

// makeSymlinkFixture 创建含文件链接与目录链接的源目录；环境不支持 symlink 时返回 false
func makeSymlinkFixture(t *testing.T, src string) bool {
	t.Helper()
	sub := filepath.Join(src, "sub")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "real.txt"), []byte("real"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "file.txt"), []byte("file"), 0644); err != nil {
		t.Fatal(err)
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
	if err != nil {
		t.Fatalf("符号链接应被复制: %v", err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("%s 应为符号链接，实际 %v", linkPath, info.Mode())
	}
	gotTarget, err := os.Readlink(linkPath)
	if err != nil || gotTarget != wantTarget {
		t.Fatalf("链接目标 = %q, 期望 %q (%v)", gotTarget, wantTarget, err)
	}
}

func TestCopyDir_Symlink(t *testing.T) {
	src := t.TempDir()
	if !makeSymlinkFixture(t, src) {
		t.Skip("环境不支持创建符号链接，跳过")
	}
	dst := filepath.Join(t.TempDir(), "copied")
	if err := copyDir(src, dst); err != nil {
		t.Fatalf("copyDir 失败: %v", err)
	}
	assertSymlinkCopied(t, filepath.Join(dst, "file-link"), filepath.Join(src, "file.txt"))
	assertSymlinkCopied(t, filepath.Join(dst, "dir-link"), filepath.Join(src, "sub"))
	// 普通文件与目录照常复制
	if _, err := os.Stat(filepath.Join(dst, "file.txt")); err != nil {
		t.Fatalf("普通文件缺失: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dst, "sub", "real.txt")); err != nil {
		t.Fatalf("目录内容缺失: %v", err)
	}
}

func TestCopyDirContents_Symlink(t *testing.T) {
	src := t.TempDir()
	if !makeSymlinkFixture(t, src) {
		t.Skip("环境不支持创建符号链接，跳过")
	}
	dst := filepath.Join(t.TempDir(), "out")
	// copyDirContents 的契约：目标目录由调用方创建（copyDirRecursive 传入已存在的 tmpDir）
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	if err := copyDirContents(src, dst); err != nil {
		t.Fatalf("copyDirContents 失败: %v", err)
	}
	assertSymlinkCopied(t, filepath.Join(dst, "file-link"), filepath.Join(src, "file.txt"))
	assertSymlinkCopied(t, filepath.Join(dst, "dir-link"), filepath.Join(src, "sub"))
}

func TestSimpleCopyImporter_Import_DirSymlink(t *testing.T) {
	src := t.TempDir()
	if !makeSymlinkFixture(t, src) {
		t.Skip("环境不支持创建符号链接，跳过")
	}
	dst := t.TempDir()
	if msg := NewSimpleCopy("test").Import(src, dst); msg != "" {
		t.Fatalf("Import = %q", msg)
	}
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
	if msg := imp.Import(src, dst); msg != "" {
		t.Fatalf("Import = %q", msg)
	}
	copied := filepath.Join(dst, filepath.Base(src))
	assertSymlinkCopied(t, filepath.Join(copied, "file-link"), filepath.Join(src, "file.txt"))
	assertSymlinkCopied(t, filepath.Join(copied, "dir-link"), filepath.Join(src, "sub"))
}

// ===== DetectZipType 边界 =====

func TestDetectZipType_More(t *testing.T) {
	type zipEntry struct {
		name string
		comp []byte
	}
	// 构造多 entry ZIP：每个 entry = 30 字节 local header + 文件名 + 压缩数据
	buildZip := func(entries ...zipEntry) []byte {
		var buf []byte
		for _, e := range entries {
			hdr := make([]byte, 30)
			hdr[0], hdr[1], hdr[2], hdr[3] = 0x50, 0x4B, 0x03, 0x04
			hdr[26] = byte(len(e.name))
			n := len(e.comp)
			hdr[18] = byte(n)
			hdr[19] = byte(n >> 8)
			hdr[20] = byte(n >> 16)
			hdr[21] = byte(n >> 24)
			buf = append(buf, hdr...)
			buf = append(buf, []byte(e.name)...)
			buf = append(buf, e.comp...)
		}
		return buf
	}
	plain := zipEntry{"random.txt", []byte("abcd")}

	tests := []struct {
		name string
		data []byte
		want string
	}{
		{"shaders 精确匹配", buildZip(zipEntry{"shaders", nil}), "shaderpack"},
		{"ysm.json 后缀匹配", buildZip(zipEntry{"foo/ysm.json", nil}), "ysm"},
		{"大小写不敏感", buildZip(zipEntry{"Pack.McMeta", nil}), "resourcepack"},
		{"多 entry 跳过压缩数据后识别", buildZip(plain, zipEntry{"shaders/x.fsh", nil}), "shaderpack"},
		{"首 entry 无特征多 entry 无特征 → 空", buildZip(plain, zipEntry{"data.bin", nil}), ""},
		{"截断 header", []byte{0x50, 0x4B, 0x03}, ""},
		{"文件名超长截断", append([]byte{0x50, 0x4B, 0x03, 0x04}, make([]byte, 26)...), ""},
		{"非 ZIP 开头", []byte("PK\x00\x00"), ""},
		{"空数据", nil, ""},
		{"7z 魔数非 7z 内容 → 空", append([]byte{0x37, 0x7A, 0xBC, 0xAF}, []byte("not7z")...), ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := DetectZipType(tc.data); got != tc.want {
				t.Fatalf("DetectZipType = %q, 期望 %q", got, tc.want)
			}
		})
	}
}
