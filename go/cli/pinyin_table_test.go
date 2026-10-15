package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/internal/app"
)

// ADR-343-d1 C1 拼音表生成器回归锁：产物三行头注释契约（生成物/生成器/输入版本/语义）
// + 单源派生表结构 + 已知码点抽检（中=20013→zhong，无声调小写全拼）。
// 同时覆盖生成器主链路变更行（diff-coverage 门禁）。
func TestRunPinyinTable_GeneratesArtifact(t *testing.T) {
	out := filepath.Join(t.TempDir(), "pinyin-table.ts")
	testutil.NoError(t, runPinyinTable(&CmdContext{App: &app.App{}, Args: []string{"--output", out}}))

	data, err := os.ReadFile(out)
	testutil.NoError(t, err)
	s := string(data)

	for _, want := range []string{"// 生成物 —— 勿手改", "// 生成器: go run . --cli", "// 输入版本: github.com/mozillazg/go-pinyin v", "export const PINYIN_BY_CODE: Record<number, string> = {", `20013: "zhong",`} {
		if !strings.Contains(s, want) {
			t.Errorf("拼音表产物缺 %q（前 200 字节：%s）", want, s[:min(200, len(s))])
		}
	}
}
