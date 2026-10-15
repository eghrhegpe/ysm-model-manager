// ===== SearchModels 关键词拼音面回归锁（ADR-343-d1 C1）=====
// 金样例对账在 go/pinyin|TestMatchKeyword_Golden 与 TS match.test.ts（同读
// tests/fixtures/parity/search-golden.json）；本锁守 SearchModels 调用面的接线：
// 拼音面命中经 go/pinyin.MatchKeyword 单点（绝对路径匹配废止，相对路径口径）
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// TestSearchModels_KeywordPinyinFace：中文模型名经全拼/首字母命中，
// 绝对路径面废止（根前缀关键词不命中），相对路径目录段可命中
func TestSearchModels_KeywordPinyinFace(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "小红书", 3)
	writeYsmModelFixture(t, ysmRoot, "warrior", 5)

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 全拼子串「xiao」→ 小红书命中，warrior 不命中
	results := a.SearchModels(base, types.SearchFilters{Keyword: "xiao"})
	if len(results) != 1 {
		t.Fatalf("搜索 xiao 期望 1 个结果（小红书），got %d", len(results))
	}
	if results[0].Name != "小红书" {
		t.Fatalf("命中条目应为 小红书，got %s", results[0].Name)
	}

	// 首字母「xhs」同样命中
	results = a.SearchModels(base, types.SearchFilters{Keyword: "xhs"})
	if len(results) != 1 || results[0].Name != "小红书" {
		t.Fatalf("首字母 xhs 应命中 小红书.ysm，got %+v", results)
	}

	// 绝对路径面废止：仓库根前缀（base 的绝对路径片段）不得成为关键词命中面
	probe := filepath.Base(filepath.Dir(base)) // temp 目录父级名（如 …/001）
	results = a.SearchModels(base, types.SearchFilters{Keyword: probe})
	if len(results) != 0 {
		t.Fatalf("根前缀关键词 %q 不应命中（绝对路径面已废止），got %d", probe, len(results))
	}

	// 相对路径目录段「ysm」命中（原绝对路径面可命中，相对路径面语义不变）
	results = a.SearchModels(base, types.SearchFilters{Keyword: "ysm"})
	if len(results) != 2 {
		t.Fatalf("目录段关键词 ysm 应命中全部 2 条目，got %d", len(results))
	}
}
