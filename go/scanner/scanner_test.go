// ===== go/scanner 单测（ADR-003 P2 下沉验证）=====
package scanner

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

const perm = 0o644

func TestScanEntries_FilterAndHash(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("data"), perm); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, "b.txt"), []byte("x"), perm)
	_ = os.WriteFile(filepath.Join(dir, "c.ysm.ban"), []byte("x"), perm)
	_ = os.WriteFile(filepath.Join(dir, "anim.json"), []byte("{}"), perm)
	_ = os.WriteFile(filepath.Join(dir, "ysm.json"), []byte("{}"), perm)
	recycle := filepath.Join(dir, ".recycle")
	if err := os.MkdirAll(recycle, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(recycle, "d.ysm"), []byte("x"), perm)

	entries := ScanEntries(dir)
	testutil.Equal(t, len(entries), 3, "应扫描到 3 个（a.ysm / c.ysm.ban / ysm.json）")
	for _, e := range entries {
		if e.Name == "a.ysm" && e.Hash == "" {
			t.Fatal("a.ysm 应计算 SHA256 哈希")
		}
		if e.Name == "c.ysm.ban" && e.Ext != ".ysm" {
			t.Fatalf(".ban 应恢复原扩展名: %s", e.Ext)
		}
	}
}

func TestScanEntries_Cache(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), perm)
	testutil.Equal(t, len(ScanEntries(dir)), 1, "首次扫描应 1 个")
	_ = os.WriteFile(filepath.Join(dir, "b.ysm"), []byte("x"), perm)
	testutil.Equal(t, len(ScanEntries(dir)), 1, "缓存命中应仍 1 个")
	InvalidateCache()
	testutil.Equal(t, len(ScanEntries(dir)), 2, "失效后应 2 个")
}

func TestInvalidatePath(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), perm)
	ScanEntries(dir)
	_ = os.WriteFile(filepath.Join(dir, "b.ysm"), []byte("x"), perm)
	InvalidatePath(dir)
	testutil.Equal(t, len(ScanEntries(dir)), 2, "单目录失效后应 2 个")
}

func TestInvalidatePath_AncestorDescendant(t *testing.T) {
	// code_review 补测：失效 key 须同时清理相等/祖先/后代缓存 key，
	// 否则 toggle 子目录模型后根扫描仍返回 30s 陈旧结果
	base := t.TempDir()
	root := filepath.Join(base, "root")
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "b.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	testutil.Equal(t, len(ScanEntries(root)), 2, "root 首扫应 2 个（含 sub 递归）")
	testutil.Equal(t, len(ScanEntries(sub)), 1, "sub 首扫应 1 个")
	if err := os.WriteFile(filepath.Join(root, "c.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "d.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	testutil.Equal(t, len(ScanEntries(root)), 2, "缓存命中应仍 2 个")
	testutil.Equal(t, len(ScanEntries(sub)), 1, "缓存命中应仍 1 个")

	InvalidatePath(sub)
	testutil.Equal(t, len(ScanEntries(root)), 4, "失效子目录后祖先 root 应重新扫到 4 个")
	testutil.Equal(t, len(ScanEntries(sub)), 2, "失效 sub 应重新扫到 2 个")

	InvalidatePath(root)
	testutil.Equal(t, len(ScanEntries(sub)), 2, "失效祖先后后代 sub 应仍 2 个")
}

func TestInvalidatePath_UnrelatedKeyUntouched(t *testing.T) {
	base := t.TempDir()
	dirA := filepath.Join(base, "aaa")
	dirB := filepath.Join(base, "aab")
	if err := os.MkdirAll(dirA, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dirB, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dirA, "a.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dirB, "b.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	testutil.Equal(t, len(ScanEntries(dirA)), 1, "dirA 首扫应 1 个")
	testutil.Equal(t, len(ScanEntries(dirB)), 1, "dirB 首扫应 1 个")
	if err := os.WriteFile(filepath.Join(dirA, "c.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	InvalidatePath(dirA)
	testutil.Equal(t, len(ScanEntries(dirA)), 2, "失效 dirA 后应重新扫到 2 个")
	testutil.Equal(t, len(ScanEntries(dirB)), 1, "无关 dirB 缓存应保持 1 个")
}

func TestComputeFileHash(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	p := filepath.Join(dir, "f")
	if err := os.WriteFile(p, []byte("hello"), perm); err != nil {
		t.Fatal(err)
	}
	h := ComputeFileHash(p)
	testutil.Equal(t, len(h), 64, "SHA256 应为 64 hex")
	testutil.Equal(t, ComputeFileHash(filepath.Join(dir, "missing")), "", "不存在文件应返回空")
}

func TestListModelAuthors(t *testing.T) {
	t.Parallel()
	entries := []types.ModelEntry{
		{Name: "[作者A]模型.ysm"},
		{Name: "[作者A]模型2.ysm"},
		{Name: "[作者B]模型.ysm"},
		{Name: "无作者.ysm"},
		{Name: "[作者A]禁用.ysm.ban"},
	}
	authors := ListModelAuthors(entries)
	testutil.Equal(t, len(authors), 2, "应 2 个作者")
	if authors[0].Name != "作者A" || authors[0].Count != 3 {
		t.Fatalf("作者A 应 count=3（含 .ban），实际 %+v", authors[0])
	}
	testutil.Equal(t, authors[1].Count, 1, "作者B 应 count=1")
}

func TestListModelAuthors_BracketEdges(t *testing.T) {
	t.Parallel()
	entries := []types.ModelEntry{
		{Name: "[无右括号.ysm"},
		{Name: "[]空作者.ysm"},
		{Name: "[正常]作者.ysm"},
	}
	authors := ListModelAuthors(entries)
	testutil.Equal(t, len(authors), 1, "应只统计到 [正常]")
	if authors[0].Name != "正常" || authors[0].Count != 1 {
		t.Fatalf("作者解析失败: %+v", authors[0])
	}
}

func TestScanLocalAuthors(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "[作者C]模型.ysm"), []byte("x"), perm)
	creators := ScanLocalAuthors(map[string]string{"ysm": dir, "EntityPlayer": ""})
	testutil.Equal(t, len(creators), 1, "应 1 个创作者")
	if creators[0].Name != "作者C" || creators[0].Type != "ysm" {
		t.Fatalf("创作者解析失败: %+v", creators[0])
	}
}

func TestGenerateRepoIndex(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), perm)
	_ = os.WriteFile(filepath.Join(dir, "b.txt"), []byte("x"), perm)
	indexPath, err := GenerateRepoIndex(dir)
	testutil.NoError(t, err, "生成失败")
	data, err := os.ReadFile(indexPath)
	testutil.NoError(t, err)
	s := string(data)
	if !strings.Contains(s, `"name": "a.ysm"`) {
		t.Fatalf("index.json 应含 a.ysm: %s", s)
	}
	if strings.Contains(s, "b.txt") {
		t.Fatal("index.json 不应含 b.txt")
	}
	testutil.FileExists(t, filepath.Join(dir, ".github", "workflows", "generate-index.yml"), "workflow 应生成")
}

// ===== emitScanError 去重（ADR-082 续：防重复扫描刷屏环形日志面板）=====

// 注意：以下三个测试共享包级状态 dedupSeen / errorSink，必须串行执行，不加 t.Parallel()。

func TestEmitScanError_DedupWindow(t *testing.T) {
	dedupMu.Lock()
	dedupSeen = map[string]time.Time{}
	dedupMu.Unlock()

	var calls []string
	errorSink = func(msg string) { calls = append(calls, msg) }
	t.Cleanup(func() {
		errorSink = nil
		dedupMu.Lock()
		dedupSeen = map[string]time.Time{}
		dedupMu.Unlock()
	})

	emitScanError("[scanner] walk error: %s: %v", "/x", "perm")
	emitScanError("[scanner] walk error: %s: %v", "/x", "perm")
	emitScanError("[scanner] walk error: %s: %v", "/y", "perm")

	testutil.Equal(t, len(calls), 2, "窗口内同错误应去重（共 2 条）")
	if calls[0] == calls[1] {
		t.Fatalf("不同目录错误不应去重，实际两条相同: %v", calls)
	}
}

func TestEmitScanError_ExpiredWindow(t *testing.T) {
	dedupMu.Lock()
	dedupSeen = map[string]time.Time{}
	dedupMu.Unlock()

	var calls []string
	errorSink = func(msg string) { calls = append(calls, msg) }
	t.Cleanup(func() {
		errorSink = nil
		dedupMu.Lock()
		dedupSeen = map[string]time.Time{}
		dedupMu.Unlock()
	})

	emitScanError("same-error")
	dedupMu.Lock()
	dedupSeen["same-error"] = time.Now().Add(-scanErrorDedupWindow - time.Second)
	dedupMu.Unlock()
	emitScanError("same-error")

	testutil.Equal(t, len(calls), 2, "窗口过期后同错误应重新上报（共 2 条）")
}

func TestEmitScanError_NoSinkFallsBackToLog(t *testing.T) {
	errorSink = nil
	t.Cleanup(func() {
		errorSink = nil
		dedupMu.Lock()
		dedupSeen = map[string]time.Time{}
		dedupMu.Unlock()
	})
	emitScanError("fallback-msg")
}
