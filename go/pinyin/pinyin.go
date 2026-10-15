// Package pinyin — 搜索关键词拼音/首字母匹配单点判据（ADR-343-d1 C1 搜索语义收敛）。
//
// 依赖 github.com/mozillazg/go-pinyin（默认读音集，多音字取默认音）；
// PinyinDict 是码点→拼音映射表，CLI pinyin-table 命令据此派生前端同判据表
// （frontend/src/utils/search/pinyin-table.ts，生成物入 git）——Go/TS 两侧
// 拼音判据同源同表，防跨语言手抄漂移（仓内「金样例对账」范式）。
package pinyin

import (
	"strings"
	"unicode"

	gopinyin "github.com/mozillazg/go-pinyin"
)

// CharPinyin 码点→拼音映射条目（Table 生成物 / CLI 派生 TS 表用）
type CharPinyin struct {
	Codepoint int
	Pinyin    string
}

// Table 返回 CJK 基本区（U+4E00..U+9FFF）有默认拼音数据的字符映射（同源单一事实源）。
// 按码点升序；生成前端 pinyin-table.ts 的输入。
// 裁切口径：PinyinDict 全量 4 万+ 条目（含扩展 A-H 生僻区）进前端模块过重；
// 基本区 ≈ 覆盖模型名用字全集。判据差（无害超集）：Go 侧 FullPinyin/Initials 直接走
// 库（全量覆盖），TS 侧读本表（基本区）——扩展区字符在 Go 面可命中、TS 面不命中，
// 只会少不误，金样例只锁基本区。
func Table() []CharPinyin {
	out := make([]CharPinyin, 0, 9000)
	for cp := 0x4E00; cp <= 0x9FFF; cp++ {
		if py := PinyinOf(rune(cp)); py != "" {
			out = append(out, CharPinyin{Codepoint: cp, Pinyin: py})
		}
	}
	// 生成序即码点升序（生成物稳定 diff）；PinyinOf 内部已小写
	return out
}

// PinyinOf 单字符默认读音（无声调、小写）；无拼音数据的字符返回空串
func PinyinOf(r rune) string {
	res := gopinyin.SinglePinyin(r, gopinyin.NewArgs())
	if len(res) == 0 {
		return ""
	}
	return strings.ToLower(res[0])
}

// FullPinyin 全拼展开：汉字逐字取默认拼音，其余字符原样保留；整体小写。
// "小红书模型" → "xiaohongshumoxing"
func FullPinyin(s string) string {
	var b strings.Builder
	for _, r := range s {
		if py := PinyinOf(r); py != "" {
			b.WriteString(py)
			continue
		}
		b.WriteRune(r)
	}
	return strings.ToLower(b.String())
}

// Initials 首字母串：汉字取拼音首字母（zh/ch/sh 保留完整），其余字符原样保留；整体小写。
// "小红书模型" → "xhsmx"
func Initials(s string) string {
	var b strings.Builder
	for _, r := range s {
		if py := PinyinOf(r); py != "" {
			b.WriteByte(py[0])
			continue
		}
		b.WriteRune(r)
	}
	return strings.ToLower(b.String())
}

// isLatins 关键词是否全为 ASCII 字母/数字——拼音面只对键盘拉丁输入生效；
// 含 CJK 的混合词（如「狐li」）不走拼音展开（语义未定义，宁漏勿误）
func isLatins(s string) bool {
	if s == "" {
		return true
	}
	for _, r := range s {
		if !(unicode.IsLetter(r) || unicode.IsNumber(r)) || r > unicode.MaxASCII {
			return false
		}
	}
	return true
}

// MatchKeyword 关键词匹配单口径（ADR-343-d1 决策①）：
//
//	hit = 空关键词（命中全部）
//	      || name / relPath 小写子串命中（CJK 直接面）
//	      || 关键词纯拉丁时：name 的全拼 / 首字母串子串命中（拼音面）
//
// relPath = 仓库根相对路径（'/' 分隔；绝对路径匹配废止——「2024 撞作者文件夹墙」
// 的一半噪音面）。TS 侧 utils/search/match.ts 用同源表实现同语义，
// 金样例 tests/fixtures/search-golden.json 双读对账。
func MatchKeyword(name, relPath, keyword string) bool {
	kw := strings.ToLower(strings.TrimSpace(keyword))
	if kw == "" {
		return true
	}
	nameL := strings.ToLower(name)
	if strings.Contains(nameL, kw) {
		return true
	}
	if strings.Contains(strings.ToLower(relPath), kw) {
		return true
	}
	if isLatins(kw) {
		full := FullPinyin(name)
		if strings.Contains(full, kw) {
			return true
		}
		if strings.Contains(Initials(name), kw) {
			return true
		}
	}
	return false
}
