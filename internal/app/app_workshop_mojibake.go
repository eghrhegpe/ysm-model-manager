// ========== 社区创作者数据双重编码（mojibake）净化 ==========
// 背景：前端拉取 GitHub API 路时曾用 atob 解 base64（产 Latin-1 字符），UTF-8 字节被
// 逐字节当成 ISO-8859-1 码位，落盘的 creators.json 出现「雾雨波波沙」→「é¾¾é¨æ³¢æ³¢æ²」
// 这类双重编码乱码（2026-09-21 一次社区合并把 197 条乱码当新作者追加，按 name 去重
// 失效——乱码名 ≠ 干净名）。前端 fetch 已改为按 UTF-8 解码字节；本函数是 Go 合并闸的
// 防劣化兜底：任何脏源 JSON 在进入 MergeCommunityCreatorsFromJSON 时被还原回真实码位，
// 从而与既有干净条目同名合并，不再产生重复脏条目。
package app

import "unicode/utf8"

// repairMojibake 把「UTF-8 字节被误读为 Latin-1」产出的双重编码串还原为正确字符串。
// 判定（严格，防误伤）：
//  1. 串非空且全部码位 ≤ 0xFF（Latin-1 域）——含任一 >0xFF 字符即视为已是真多字节文本，原样返回；
//  2. 至少一个码位落在 0x80..0xFF——纯 ASCII 是合法内容（英文/拼音/数字），不动；
//  3. 由这些码位重建的字节序列须是合法 UTF-8——否则是真 Latin-1（如孤立 é），原样返回。
//
// 三者同时满足才还原（string(bytes) 按 UTF-8 解释）。
func repairMojibake(s string) string {
	if s == "" {
		return s
	}
	highByte := false
	b := make([]byte, 0, len(s))
	for _, r := range s {
		if r > 0xFF {
			return s // 含真多字节字符 → 非双重编码产物，不动
		}
		if r >= 0x80 {
			highByte = true
		}
		b = append(b, byte(r))
	}
	if !highByte {
		return s // 纯 ASCII，合法
	}
	if !utf8.Valid(b) {
		return s // 字节序列非合法 UTF-8 → 真 Latin-1，不动
	}
	out := string(b)
	if out == s {
		return s
	}
	return out
}

// repairCreatorMojibake 就地净化一条创作者记录的全部文本字段。
func repairCreatorMojibake(fields ...*string) {
	for _, p := range fields {
		if p != nil && *p != "" {
			*p = repairMojibake(*p)
		}
	}
}
