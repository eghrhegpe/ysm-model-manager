package ccheck

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// go-ts-complexity 契约向量：与 tests/test_complexity_parity.ts 读同一份 JSON，
// 双端把同一事件序列送入规约器，断言 (cognitive, maxNesting) 逐字一致。
// 防「TS 改了规约器、Go 侧手抄一份漂移」——锁死认知复杂度规约语义。

type fixtureEvent struct {
	K        string `json:"k"`
	KindName string `json:"kind"`
}

type fixtureCase struct {
	Name      string         `json:"name"`
	Seq       []fixtureEvent `json:"seq"`
	Cognitive int            `json:"cognitive"`
	Nesting   int            `json:"nesting"`
}

type fixtureFile struct {
	Reduce []fixtureCase `json:"reduce"`
}

// repoRoot 从包目录向上找 go.mod。
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	testutil.NoError(t, err, "Getwd")
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		// 纯串护栏改布尔化：到达根仍未命中 go.mod 即失败
		testutil.Equal(t, parent == dir, false, "未找到仓库根 go.mod")
		dir = parent
	}
}

func TestComplexityParityWithTS(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "tests", "parity", "go-ts-complexity.json"))
	testutil.NoError(t, err, "读取契约向量失败")
	var fx fixtureFile
	testutil.NoError(t, json.Unmarshal(raw, &fx), "解析契约向量失败")
	testutil.Equal(t, len(fx.Reduce) > 0, true, "契约向量为空（防空转守卫）")
	for _, c := range fx.Reduce {
		seq := make([]Event, 0, len(c.Seq))
		for _, e := range c.Seq {
			// fixtureEvent 与 Event 字段同序同型（K/KindName），直接转换。
			// 两者布局须保持一致：若 Event 增删字段，此处会编译失败而非静默漂移。
			seq = append(seq, Event(e))
		}
		gotC, gotN := CognitiveFromSeq(seq)
		if gotC != c.Cognitive || gotN != c.Nesting {
			t.Errorf("向量 %q：got cognitive=%d nesting=%d, 期望 %d/%d（seq=%+v）",
				c.Name, gotC, gotN, c.Cognitive, c.Nesting, seq)
		}
	}
}

// 规约器语义锚点（不依赖向量文件的直觉用例）：确保 1+depth 规则不被向量回归。
func TestCognitiveFromSeqBasics(t *testing.T) {
	// 平坦 if → 1/1
	c, n := CognitiveFromSeq([]Event{{K: "nest", KindName: "if"}, {K: "nestClose"}})
	// OR 拆序贯：cognitive 与 nesting 分别断言
	testutil.Equal(t, c, 1, "平坦 if: got %d/%d want 1/1", c, n)
	testutil.Equal(t, n, 1, "平坦 if: got %d/%d want 1/1", c, n)
	// 双嵌套 → 1+2=3/2
	deep := []Event{{K: "nest", KindName: "loop"}, {K: "nest", KindName: "if"}, {K: "nestClose"}, {K: "nestClose"}}
	c, n = CognitiveFromSeq(deep)
	testutil.Equal(t, c, 3, "双嵌套: got %d/%d want 3/2", c, n)
	testutil.Equal(t, n, 2, "双嵌套: got %d/%d want 3/2", c, n)
	// 空序列 → 0/0
	c, n = CognitiveFromSeq(nil)
	testutil.Equal(t, c, 0, "空序列: got %d/%d want 0/0", c, n)
	testutil.Equal(t, n, 0, "空序列: got %d/%d want 0/0", c, n)
}
