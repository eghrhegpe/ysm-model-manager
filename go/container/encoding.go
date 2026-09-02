package container

import (
	"unicode/utf8"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/transform"
)

// normalizeEntryName 将 zip/7z 条目名归一化为合法 UTF-8。
//
// 背景：zip 规范条目名默认 CP437，仅 EFS 位（bit 11）置位才是 UTF-8；东亚打包工具
// （WinRAR 老版/好压/2345、日文 Windows 压缩）普遍按本地代码页（GBK/Shift-JIS/Big5）
// 写文件名且不置位。Go archive/zip 只置 NonUTF8 标志不做解码，原始字节透传即成乱码。
//
// 策略（移植自 MikuMikuAR internal/app/zipextract.go decodeZipName/bestDecode）：
//   - flag 未置且字节合法 UTF-8 → 快路径直通
//   - 否则 Shift-JIS / GBK / Big5 三路解码打分择优（MMD 圈日文 zip 为主、中文圈
//     GBK 次之、台湾作者 Big5 兜底），再清理控制字符与 RuneError。
//
// 对齐 zipEntry.Name() / sevenZipEntry.Name() 出口，avatar 提取、zipentry 指纹、
// 候选名三条消费链路零改动受益。
func normalizeEntryName(name string, nonUTF8 bool) string {
	if !nonUTF8 && utf8.ValidString(name) {
		return cleanControlChars(name)
	}
	return bestDecode(name)
}

// bestDecode 尝试 Shift-JIS、GBK、Big5 三种编码解码，返回得分最高者。
// 得分：无解码错误 +10；Shift-JIS 偏置 +3（MMD 模型 zip 主力编码）；
// CJK 统一表意文字 +2；假名 / CJK 标点 +1；全角半角形式 -1（疑似损坏）。
func bestDecode(raw string) string {
	type candidate struct {
		decoded string
		score   int
	}
	candidates := make([]candidate, 0, 3)

	for _, dec := range []struct {
		enc  transform.Transformer
		bias int
	}{
		{japanese.ShiftJIS.NewDecoder(), 3},
		{simplifiedchinese.GBK.NewDecoder(), 0},
		{traditionalchinese.Big5.NewDecoder(), 0},
	} {
		decoded, _, err := transform.String(dec.enc, raw)
		cleaned := cleanControlChars(decoded)
		if cleaned == "" {
			continue
		}
		score := dec.bias
		if err == nil {
			score += 10
		}
		for _, r := range cleaned {
			switch {
			case r >= 0x4E00 && r <= 0x9FFF:
				score += 2 // CJK Unified Ideographs
			case r >= 0x3040 && r <= 0x30FF:
				score += 1 // Hiragana/Katakana
			case r >= 0x3000 && r <= 0x303F:
				score += 1 // CJK Symbols and Punctuation
			case r >= 0xFF00 && r <= 0xFFEF:
				score -= 1 // Half-width / full-width forms (possible corruption)
			}
		}
		candidates = append(candidates, candidate{cleaned, score})
	}
	if len(candidates) == 0 {
		return cleanControlChars(raw)
	}
	best := candidates[0]
	for _, c := range candidates[1:] {
		if c.score > best.score {
			best = c
		}
	}
	return best.decoded
}

// cleanControlChars 剔除控制字符（保留 \t \n \r）与 RuneError。
func cleanControlChars(s string) string {
	cleaned := make([]rune, 0, len(s))
	for _, r := range s {
		if r == utf8.RuneError {
			continue
		}
		if r < 0x20 && r != 0x09 && r != 0x0A && r != 0x0D {
			continue
		}
		if r >= 0x7F && r <= 0x9F {
			continue
		}
		cleaned = append(cleaned, r)
	}
	return string(cleaned)
}
