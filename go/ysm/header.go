package ysm

import (
	"bufio"
	"bytes"
	"io"
	"log"
	"os"
	"strings"

	"ysm-model-manager/go/fsutil"
)

// ysgpMagic YSM 文件魔数（收敛 header.go:53/246/282 与 summary.go:667 四处手写字面量）
const ysgpMagic = "YSGP"

// YSMHeader 从 YSM 文件文本头部提取的元数据（适用于加密和非加密模型）
type YSMHeader struct {
	// 文件类型
	IsYSM   bool   `json:"isYsm"`
	IsFree  bool   `json:"isFree"`  // <free> true/false
	HasFree bool   `json:"hasFree"` // <free> 标签是否存在
	Hash    string `json:"hash,omitempty"`

	// 基本信息
	Name    string `json:"name"`
	License string `json:"license,omitempty"`

	// 作者信息
	AuthorName     string `json:"authorName,omitempty"`
	AuthorRole     string `json:"authorRole,omitempty"`
	AuthorBilibili string `json:"authorBilibili,omitempty"`
	AuthorAfdian   string `json:"authorAfdian,omitempty"`

	// 链接
	LinkHome   string `json:"linkHome,omitempty"`
	LinkUpdate string `json:"linkUpdate,omitempty"`

	// 编码版本
	Format int `json:"format,omitempty"`
	Crypto int `json:"crypto,omitempty"`

	// 导出信息
	Tips string `json:"tips,omitempty"`
}

// headerScanState 是 scanHeader 的行扫描累积状态（段游标 + 两类自由文本行）。
type headerScanState struct {
	section  string   // 当前段：metadata/tips/export/codec/source；空 = 未选定
	tips     []string // --- [Tips] 段的正文行
	preamble []string // 未选定段时的自由行（无 tips 段时降级为 tips）
}

// headerLineAction 是单行扫描的结果。
type headerLineAction int

const (
	headerLineNext headerLineAction = iota
	headerLineStop                  // 命中 === 或二进制段分隔符 → 结束扫描
)

// scanHeader 从 bufio.Scanner 读取 YSM 头部，提取元数据
func scanHeader(scanner *bufio.Scanner) YSMHeader {
	h := YSMHeader{}
	limit := 0
	st := headerScanState{}

	for scanner.Scan() && limit < 200 {
		limit++
		if scanHeaderLine(scanner, &h, &st) == headerLineStop {
			break
		}
	}

	h.Tips = buildHeaderTips(st.tips, st.preamble)
	// 检查 scanner.Err()，超长行（>64KB）时 log 标记
	if err := scanner.Err(); err != nil {
		log.Printf("[ysm] scanHeader scanner error: %v", err)
	}
	return h
}

// scanHeaderLine 处理单行：魔数识别 / 段分隔符 / 终止符 / 标签分派 / 自由文本收集。
// 拆自原 scanHeader 大循环体（逐字复刻分支语义，含「段已选定即吞掉整行」规则）。
func scanHeaderLine(scanner *bufio.Scanner, h *YSMHeader, st *headerScanState) headerLineAction {
	line := strings.TrimLeft(scanner.Text(), "\uFEFF")

	if line == ysgpMagic {
		h.IsYSM = true
		return headerLineNext
	}
	if sec, ok := headerSectionFromDelim(line); ok {
		st.section = sec
		return headerLineNext
	}
	if strings.HasPrefix(line, "===") {
		return headerLineStop
	}
	// 连续的 ---（无 [）是段落的结束分隔符，之后是二进制数据
	if isBinarySectionEnd(line) {
		skipTrailingBlankLines(scanner)
		return headerLineStop
	}
	if strings.HasPrefix(line, "<") {
		if tag, value, ok := splitTagValue(line); ok {
			applyHeaderTag(h, st.section, tag, value)
		}
		// 段已选定 → 本行归属于该段，不再落作者块 / preamble
		if st.section != "" {
			return headerLineNext
		}
	}
	collectHeaderFreeText(line, h, st)
	return headerLineNext
}

// headerSectionFromDelim 识别 `--- [Xxx]` 段分隔符并映射段名。
// ok=false 表示本行不是段分隔符；ok=true 且 section 为空即原 default 分支
// （未知段名）——调用方据此把段游标清空，后续自由行降级为 preamble。
func headerSectionFromDelim(line string) (section string, ok bool) {
	if !strings.HasPrefix(line, "---") || !strings.Contains(line, "[") {
		return "", false
	}
	switch {
	case strings.Contains(line, "Metadata"):
		return "metadata", true
	case strings.Contains(line, "Tips"):
		return "tips", true
	case strings.Contains(line, "Export"):
		return "export", true
	case strings.Contains(line, "Codec"):
		return "codec", true
	case strings.Contains(line, "SHA-256") || strings.Contains(line, "Source"):
		return "source", true
	default:
		return "", true
	}
}

// isBinarySectionEnd 判断本行是否为「段结束分隔符」：--- 且不含 [ 且长度 ≥ 10。
// 其后是二进制数据，扫描须终止。
func isBinarySectionEnd(line string) bool {
	return strings.HasPrefix(line, "---") && !strings.Contains(line, "[") && len(line) >= 10
}

// skipTrailingBlankLines 跳过二进制段前可能存在的空行，然后停止扫描。
func skipTrailingBlankLines(scanner *bufio.Scanner) {
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) != "" {
			break
		}
	}
}

// splitTagValue 拆分 `<tag>value</tag>` 形态，要求首个 '>' 的位置 > 0
// （idx==0 即无标签名）。调用方保证 line 以 '<' 开头。
func splitTagValue(line string) (tag, value string, ok bool) {
	idx := strings.Index(line, ">")
	if idx <= 0 {
		return "", "", false
	}
	tag = strings.TrimSpace(line[1:idx])
	value = stripClosingTag(strings.TrimSpace(line[idx+1:]))
	return tag, value, true
}

// applyHeaderTag 按当前段分派 `<tag>value`：
//   - metadata 段：name/free/hash/license/link-home/link-update（tag 小写比较）
//   - codec 段：format/crypto（tag 原样比较，与 metadata 的大小写口径不同）
//   - export 段无字段；source 等段一律忽略（但仍算「段已选定」，不落作者块）
//
// 空 license 视为「未声明」而不置空。原实现在该分支 `continue` 提前结束本行，
// 但只有 section == "metadata" 才可能到达，与调用方「段非空即结束本行」等价，
// 故此处只做「不赋值」。
func applyHeaderTag(h *YSMHeader, section, tag, value string) {
	switch section {
	case "metadata":
		switch strings.ToLower(tag) {
		case "name":
			h.Name = value
		case "free":
			h.IsFree = value == "true"
			h.HasFree = true
		case "hash":
			h.Hash = value
		case "license":
			if value != "" {
				h.License = value
			}
		case "link-home":
			h.LinkHome = value
		case "link-update", "link_update":
			h.LinkUpdate = value
		}
	case "codec":
		switch tag {
		case "format":
			h.Format = parseInt(value)
		case "crypto":
			h.Crypto = parseInt(value)
		}
	}
}

// collectHeaderFreeText 收集未被「段已选定」规则吞掉的自由行：
//   - tips 段正文 → tipsLines
//   - 形如 `<tag>value` 的行 → 作者块（缩进行在段未选定时才走到这里）
//   - 段未选定且非空的行 → preambleLines
func collectHeaderFreeText(line string, h *YSMHeader, st *headerScanState) {
	if st.section == "tips" && strings.TrimSpace(line) != "" {
		st.tips = append(st.tips, strings.TrimSpace(line))
	}
	if strings.HasPrefix(strings.TrimSpace(line), "<") && strings.Contains(line, ">") {
		if tag, value, ok := splitTagValue(strings.TrimSpace(line)); ok {
			applyAuthorTag(h, strings.ToLower(tag), value)
		}
	}
	if st.section == "" && strings.TrimSpace(line) != "" {
		st.preamble = append(st.preamble, line)
	}
}

// applyAuthorTag 作者块标签分派（tag 已小写）。历史头部同时存在
// 连字符 / 下划线 / 无分隔三种写法，三种都收。
func applyAuthorTag(h *YSMHeader, tag, value string) {
	switch tag {
	case "name":
		if h.AuthorName == "" {
			h.AuthorName = value
		}
	case "role":
		h.AuthorRole = value
	case "contact-bilibili", "contact_bilibili", "contactbilibili":
		h.AuthorBilibili = value
	case "contact-afdian", "contact_afdian", "contactafdian":
		h.AuthorAfdian = value
	}
}

// buildHeaderTips 组装 Tips：优先 tips 段正文，否则用 preamble 行
// （逐行剥 // # ; 注释前缀）。
func buildHeaderTips(tipsLines, preambleLines []string) string {
	if len(tipsLines) > 0 {
		return strings.Join(tipsLines, "\n")
	}
	if len(preambleLines) == 0 {
		return ""
	}
	cleaned := make([]string, len(preambleLines))
	for i, l := range preambleLines {
		s := strings.TrimSpace(l)
		s = strings.TrimPrefix(s, "//")
		s = strings.TrimPrefix(s, "#")
		s = strings.TrimPrefix(s, ";")
		cleaned[i] = strings.TrimSpace(s)
	}
	return strings.Join(cleaned, "\n")
}

// AnalyzeYSMHeader 读取 YSM 文件的文本头部，提取元数据
func AnalyzeYSMHeader(path string) YSMHeader {
	// 先尝试检测 YSGP（V2）二进制头部
	if h := detectYSGPHeader(path); h != nil {
		// 检查文件是否包含文本头部（有些纯二进制 YSGP 文件没有文本段）
		if hasTextHeader(path) {
			f, err := os.Open(path)
			if err == nil {
				rich := scanHeader(bufio.NewScanner(f))
				_ = f.Close()
				// 合并
				if rich.Name != "" {
					h.Name = rich.Name
				}
				if rich.License != "" {
					h.License = rich.License
				}
				if rich.AuthorName != "" {
					h.AuthorName = rich.AuthorName
				}
				if rich.AuthorRole != "" {
					h.AuthorRole = rich.AuthorRole
				}
				if rich.AuthorBilibili != "" {
					h.AuthorBilibili = rich.AuthorBilibili
				}
				if rich.AuthorAfdian != "" {
					h.AuthorAfdian = rich.AuthorAfdian
				}
				if rich.LinkHome != "" {
					h.LinkHome = rich.LinkHome
				}
				if rich.LinkUpdate != "" {
					h.LinkUpdate = rich.LinkUpdate
				}
				if rich.Tips != "" {
					h.Tips = rich.Tips
				}
				if rich.Format > 0 {
					h.Format = rich.Format
				}
				if rich.Crypto > 0 {
					h.Crypto = rich.Crypto
				}
				if rich.HasFree {
					h.HasFree = true
					h.IsFree = rich.IsFree
				}
			}
		}
		return *h
	}

	f, err := os.Open(path)
	if err != nil {
		return YSMHeader{}
	}
	defer func() { _ = f.Close() }()
	return scanHeader(bufio.NewScanner(f))
}

// hasTextHeader 检查 YSGP 文件是否包含可读的文本头部
func hasTextHeader(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()
	var buf [512]byte
	n, _ := io.ReadFull(f, buf[:])
	if n < 16 {
		return false
	}
	data := buf[:n]
	// 跳过 BOM
	if bytes.HasPrefix(data, fsutil.UTF8BOM) {
		data = data[3:]
	}
	// 跳过 YSGP 和后续空行
	start := 0
	if len(data) >= 4 && string(data[:4]) == ysgpMagic {
		start = 4
	}
	// 在剩余数据中查找文本头部特征
	rest := string(data[start:])
	rest = strings.ToLower(rest)
	return strings.Contains(rest, "--- [") ||
		strings.Contains(rest, "<name>") ||
		strings.Contains(rest, "<free>") ||
		strings.Contains(rest, "metadata")
}

// detectYSGPHeader 检测 YSGP（YSM V2）二进制格式并提取基本信息
// 支持标准 YSGP 和带 BOM + 文本头部的变体
func detectYSGPHeader(path string) *YSMHeader {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer func() { _ = f.Close() }()

	// 读取前 100 字节分析头部
	var header [100]byte
	n, err := io.ReadFull(f, header[:])
	if err != nil && n < 4 {
		return nil
	}
	data := header[:n]

	// 跳过可能的 UTF-8 BOM
	offset := 0
	if bytes.HasPrefix(data, fsutil.UTF8BOM) {
		offset = 3
	}

	// 检查 YSGP 魔数
	if n < offset+4 || string(data[offset:offset+4]) != ysgpMagic {
		return nil
	}

	h := &YSMHeader{
		IsYSM:  true,
		Format: 2, // YSGP = V2
	}

	// 尝试从文本头部中提取模型名称
	// 文本头部格式：<name> 模型名
	textPortion := string(data)
	if idx := strings.Index(textPortion, "<name>"); idx >= 0 {
		rest := textPortion[idx+6:]
		if nl := strings.IndexAny(rest, "\r\n"); nl > 0 {
			name := strings.TrimSpace(rest[:nl])
			// 跳过 <author> 块内的 <name>
			if !strings.HasPrefix(textPortion[idx:], "<name> ") {
				// 检查前面有无 <author> 标记
				before := textPortion[:idx]
				lastSection := ""
				if li := strings.LastIndex(before, "--- ["); li >= 0 {
					lastSection = before[li:]
				}
				if !strings.Contains(lastSection, "Author") &&
					!strings.Contains(lastSection, "author") {
					h.Name = name
				}
			} else if !strings.Contains(textPortion[:idx], "<author>") {
				h.Name = name
			}
		}
	}

	return h
}

// AnalyzeYSMHeaderFromBytes 从字节数据解析 YSM 头部（适用于 base64 导入场景）
func AnalyzeYSMHeaderFromBytes(data []byte) YSMHeader {
	if len(data) > 4096 {
		data = data[:4096]
	}
	return scanHeader(bufio.NewScanner(bytes.NewReader(data)))
}

func parseInt(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	neg := false
	start := 0
	switch s[0] {
	case '-':
		neg = true
		start = 1
	case '+':
		start = 1
	}
	n := 0
	for _, c := range s[start:] {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
			// 溢出守卫：畸形头部如 <format>99999999999999999999 静默溢出为负数/零，
			// 钳到 0 让调用方按「未声明」处理（format/crypto 版本号合理值 < 100）
			if n > 1<<20 {
				return 0
			}
		} else {
			return 0
		}
	}
	if neg {
		n = -n
	}
	return n
}

// stripClosingTag removes the closing XML tag from a value string.
// e.g. "TestModel</name>" → "TestModel", "abc123</hash>" → "abc123"
func stripClosingTag(v string) string {
	if idx := strings.Index(v, "</"); idx >= 0 {
		return strings.TrimSpace(v[:idx])
	}
	return v
}
