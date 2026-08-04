// ===== go/scanner 单测（ADR-003 P2 下沉验证）=====
package scanner

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

func TestScanEntries_FilterAndHash(t *testing.T) {
	dir := t.TempDir()
	// 支持的扩展名
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	// 不支持的
	_ = os.WriteFile(filepath.Join(dir, "b.txt"), []byte("x"), 0644)
	// .ban 恢复原扩展名
	_ = os.WriteFile(filepath.Join(dir, "c.ysm.ban"), []byte("x"), 0644)
	// .json 非 ysm.json 排除
	_ = os.WriteFile(filepath.Join(dir, "anim.json"), []byte("{}"), 0644)
	_ = os.WriteFile(filepath.Join(dir, "ysm.json"), []byte("{}"), 0644)
	// .recycle 排除
	recycle := filepath.Join(dir, ".recycle")
	if err := os.MkdirAll(recycle, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(recycle, "d.ysm"), []byte("x"), 0644)

	entries := ScanEntries(dir)
	if len(entries) != 3 {
		t.Fatalf("应扫描到 3 个（a.ysm / c.ysm.ban / ysm.json），实际 %d", len(entries))
	}
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
	_ = os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644)
	if got := len(ScanEntries(dir)); got != 1 {
		t.Fatalf("首次扫描应 1 个，实际 %d", got)
	}
	// 新增文件后（缓存内）仍返回旧结果
	_ = os.WriteFile(filepath.Join(dir, "b.ysm"), []byte("x"), 0644)
	if got := len(ScanEntries(dir)); got != 1 {
		t.Fatalf("缓存命中应仍 1 个，实际 %d", got)
	}
	// 失效后重新扫描
	InvalidateCache()
	if got := len(ScanEntries(dir)); got != 2 {
		t.Fatalf("失效后应 2 个，实际 %d", got)
	}
}

func TestInvalidatePath(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644)
	ScanEntries(dir)
	_ = os.WriteFile(filepath.Join(dir, "b.ysm"), []byte("x"), 0644)
	InvalidatePath(dir)
	if got := len(ScanEntries(dir)); got != 2 {
		t.Fatalf("单目录失效后应 2 个，实际 %d", got)
	}
}

func TestComputeFileHash(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "f")
	if err := os.WriteFile(p, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	h := ComputeFileHash(p)
	if len(h) != 64 {
		t.Fatalf("SHA256 应为 64 hex，实际 %d", len(h))
	}
	if ComputeFileHash(filepath.Join(dir, "missing")) != "" {
		t.Fatal("不存在文件应返回空")
	}
}

func TestListModelAuthors(t *testing.T) {
	entries := []types.ModelEntry{
		{Name: "[作者A]模型.ysm"},
		{Name: "[作者A]模型2.ysm"},
		{Name: "[作者B]模型.ysm"},
		{Name: "无作者.ysm"},
		{Name: "[作者A]禁用.ysm.ban"},
	}
	authors := ListModelAuthors(entries)
	if len(authors) != 2 {
		t.Fatalf("应 2 个作者，实际 %d", len(authors))
	}
	if authors[0].Name != "作者A" || authors[0].Count != 3 {
		t.Fatalf("作者A 应 count=3（含 .ban），实际 %+v", authors[0])
	}
	if authors[1].Count != 1 {
		t.Fatalf("作者B 应 count=1，实际 %+v", authors[1])
	}
}

func TestScanLocalAuthors(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "[作者C]模型.ysm"), []byte("x"), 0644)
	creators := ScanLocalAuthors(map[string]string{"ysm": dir, "mmd-skin": ""})
	if len(creators) != 1 {
		t.Fatalf("应 1 个创作者，实际 %d", len(creators))
	}
	if creators[0].Name != "作者C" || creators[0].Type != "ysm" {
		t.Fatalf("创作者解析失败: %+v", creators[0])
	}
}

func TestGenerateRepoIndex(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(dir, "b.txt"), []byte("x"), 0644)
	indexPath, err := GenerateRepoIndex(dir)
	if err != nil {
		t.Fatalf("生成失败: %v", err)
	}
	data, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	s := string(data)
	if !strings.Contains(s, `"name": "a.ysm"`) {
		t.Fatalf("index.json 应含 a.ysm: %s", s)
	}
	if strings.Contains(s, "b.txt") {
		t.Fatal("index.json 不应含 b.txt")
	}
	// workflow 文件生成
	if _, err := os.Stat(filepath.Join(dir, ".github", "workflows", "generate-index.yml")); err != nil {
		t.Fatalf("workflow 应生成: %v", err)
	}
}
