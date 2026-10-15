//go:build !rust_backend

// ===== go/pinyin 搜索关键词匹配单点判据测试（ADR-343-d1 C1）=====
package pinyin

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

func TestPinyinOf_And_FullAndInitials(t *testing.T) {
	testutil.Equal(t, PinyinOf('小'), "xiao", "默认读音（无声调小写）")
	testutil.Equal(t, PinyinOf('x'), "", "非汉字无拼音数据")
	testutil.Equal(t, PinyinOf('.'), "", "标点无拼音数据")
	testutil.Equal(t, FullPinyin("小红书模型.ysm"), "xiaohongshumoxing.ysm", "全拼展开非汉字原样保留")
	testutil.Equal(t, Initials("小红书模型.ysm"), "xhsmx.ysm", "首字母串（zh/ch/sh 取首字母，标点原样）")
}

func TestMatchKeyword_CJKFace(t *testing.T) {
	testutil.Equal(t, MatchKeyword("狐狸.ysm", "组A/狐狸.ysm", "狐狸"), true, "name 直接面")
	testutil.Equal(t, MatchKeyword("狐狸.ysm", "组A/狐狸.ysm", "组A"), true, "relPath 目录段面")
	testutil.Equal(t, MatchKeyword("狐LI.ysm", "组A/狐LI.ysm", "huli"), true, "混合名大小写折叠子串")
	testutil.Equal(t, MatchKeyword("狐狸.ysm", "组A/狐狸.ysm", "组B"), false, "relPath 不命中")
}

func TestMatchKeyword_PinyinFace(t *testing.T) {
	testutil.Equal(t, MatchKeyword("小红书模型.ysm", "", "xiaohong"), true, "全拼子串")
	testutil.Equal(t, MatchKeyword("小红书模型.ysm", "", "xhsm"), true, "首字母子串")
	testutil.Equal(t, MatchKeyword("中二病.ysm", "", "zhong"), true, "单字全拼")
	testutil.Equal(t, MatchKeyword("fox.ysm", "组B/fox.ysm", "huli"), false, "拉丁名不误中拼音面")
	testutil.Equal(t, MatchKeyword("模型.ysm", "", "xx"), false, "首字母不命中")
}

func TestMatchKeyword_MixedKeywordSkipsPinyinFace(t *testing.T) {
	// 混合词（CJK+拉丁）拼音面语义未定义：只走 CJK 直接面，宁漏勿误
	testutil.Equal(t, MatchKeyword("狐狸.ysm", "", "狐li"), false, "混合词不走拼音展开")
	// 对照：纯拉丁 "li" 是全拼面——"狐狸" 全拼 fuli 含 li → 命中（首字母面 fl 不含 li，全拼面兜住）
	testutil.Equal(t, MatchKeyword("狐狸.ysm", "", "li"), true, "纯拉丁关键词走全拼面")
}

func TestMatchKeyword_EmptyKeywordHitsAll(t *testing.T) {
	testutil.Equal(t, MatchKeyword("任意.ysm", "任意/目录", ""), true, "空关键词 = 命中全部（调用方按既有 0=不限 口径短路）")
	testutil.Equal(t, MatchKeyword("任意.ysm", "任意/目录", "  "), true, "纯空白 = 空关键词")
}

func TestMatchKeyword_RelPathOnlyNoAbsolutePath(t *testing.T) {
	// 绝对路径匹配废止（ADR-343-d1 ①）：relPath 入参即仓库根相对路径，
	// 根前缀（如 C:/Users/…）不在匹配面内
	testutil.Equal(t, MatchKeyword("fox.ysm", "组B/fox.ysm", "C:/Users"), false, "根前缀不命中")
}

// TestMatchKeyword_Golden 金样例双读对账（Go 面）：
// tests/fixtures/parity/search-golden.json 与 TS（utils/search/match.test.ts）共读同一判据，
// 跨语言漂移在此拦下（genindex 双工范式：靠测试对账而非共享代码）
type goldenCase struct {
	Name    string `json:"name"`
	RelPath string `json:"relPath"`
	Keyword string `json:"keyword"`
	Hit     bool   `json:"hit"`
}

func TestMatchKeyword_Golden(t *testing.T) {
	data, err := os.ReadFile("../../tests/fixtures/parity/search-golden.json")
	testutil.NoError(t, err, "金样例读取")
	var doc struct {
		Cases []goldenCase `json:"cases"`
	}
	testutil.NoError(t, json.Unmarshal(data, &doc), "金样例解析")
	testutil.Equal(t, len(doc.Cases) >= 20, true, "金样例规模（>= 20 例防退化）")
	for i, c := range doc.Cases {
		got := MatchKeyword(c.Name, c.RelPath, c.Keyword)
		if got != c.Hit {
			t.Errorf("case %d（name=%s relPath=%s kw=%q）：期望 hit=%v 实际 %v", i, c.Name, c.RelPath, c.Keyword, c.Hit, got)
		}
	}
}

func TestTable_SortedAndLower(t *testing.T) {
	tab := Table()
	testutil.Equal(t, len(tab) > 5000, true, "PinyinDict 派生表规模（数千汉字）")
	for i := 1; i < len(tab); i++ {
		if tab[i].Codepoint < tab[i-1].Codepoint {
			t.Fatalf("Table 未按码点升序（生成物 diff 稳定性）：%d < %d", tab[i].Codepoint, tab[i-1].Codepoint)
		}
	}
	for _, e := range tab {
		if strings.ToLower(e.Pinyin) != e.Pinyin {
			t.Fatalf("Table 拼音必须小写：码点 %d = %q", e.Codepoint, e.Pinyin)
		}
	}
}
