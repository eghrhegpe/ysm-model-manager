package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/pinyin"

	gopinyin "github.com/mozillazg/go-pinyin"
)

func init() {
	// mutating（写生成物）故不走 RegisterCommandRO——不进前端桥只读白名单
	RegisterCommand("pinyin-table", "生成前端拼音表 pinyin-table.ts（ADR-343-d1 C1：搜索拼音面与 Go 侧同源同表；须在仓库根运行，产物随提交入 git）", runPinyinTable)
}

// runPinyinTable 由 go/pinyin.Table()（= mozillazg/go-pinyin PinyinDict 默认读音集）
// 生成 frontend/src/utils/search/pinyin-table.ts。跨语言判据「单源派生 + 金样例对账」
// 的派生侧：Go 侧直接用库，TS 侧读这张表——升级 go-pinyin 依赖后重跑本命令提交。
// 输出路径缺省相对仓库根（frontend/src/utils/search/pinyin-table.ts）；
// 输出到仓库外须显式 --output（生成物归属仍随提交）。
func runPinyinTable(ctx *CmdContext) error {
	fs := newCmdFlagSet("pinyin-table")
	out := fs.String("output", "", "输出路径（缺省 = 仓库根 frontend/src/utils/search/pinyin-table.ts）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	target := *out
	if target == "" {
		if _, statErr := os.Stat("frontend"); statErr != nil {
			return newParamErrf("缺省输出路径相对仓库根：请从仓库根运行（找不到 frontend/）: %v", statErr)
		}
		target = filepath.Join("frontend", "src", "utils", "search", "pinyin-table.ts")
	}
	tab := pinyin.Table()

	var b strings.Builder
	// 生成物文件头（仓规：生成物必须带「生成器命令 + 输入版本」头注释）
	b.WriteString("// 生成物 —— 勿手改（ADR-343-d1 C1 搜索拼音面单源派生表）。\n")
	b.WriteString("// 生成器: go run . --cli --files-root <仓库根> pinyin-table\n")
	b.WriteString(fmt.Sprintf("// 输入版本: github.com/mozillazg/go-pinyin v%s（默认读音集，多音字取默认音；升级依赖后重跑本命令提交）\n", gopinyin.Version))
	b.WriteString("// 语义: 码点 → 无声调小写全拼；go/pinyin|FullPinyin 与 utils/search/match.ts 同表同源。\n")
	fmt.Fprintf(&b, "export const PINYIN_BY_CODE: Record<number, string> = {\n")
	for _, e := range tab {
		fmt.Fprintf(&b, "  %d: %q,\n", e.Codepoint, e.Pinyin)
	}
	b.WriteString("};\n")

	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return newRuntimeErrf("建目录失败: %v", err)
	}
	if err := os.WriteFile(target, []byte(b.String()), fsutil.FilePerms); err != nil {
		return newRuntimeErrf("写入失败: %v", err)
	}
	fmt.Printf("✅ 拼音表已生成: %s（%d 条目，go-pinyin v%s）\n", target, len(tab), gopinyin.Version)
	return nil
}
