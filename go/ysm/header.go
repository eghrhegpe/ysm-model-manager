package ysm

import (
	"bufio"
	"bytes"
	"io"
	"os"
	"strings"
)

// YSMHeader 从 YSM 文件文本头部提取的元数据（适用于加密和非加密模型）
type YSMHeader struct {
	// 文件类型
	IsYSM  bool   `json:"isYsm"`
	IsFree bool   `json:"isFree"` // <free> true/false
	Hash   string `json:"hash,omitempty"`

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

// scanHeader 从 bufio.Scanner 读取 YSM 头部，提取元数据
func scanHeader(scanner *bufio.Scanner) YSMHeader {
	h := YSMHeader{}
	limit := 0
	currentSection := ""
	var tipsLines []string
	var preambleLines []string

	for scanner.Scan() && limit < 200 {
		limit++
		line := strings.TrimLeft(scanner.Text(), "\uFEFF")

		if line == "YSGP" {
			h.IsYSM = true
			continue
		}
		if strings.HasPrefix(line, "---") && strings.Contains(line, "[") {
			if strings.Contains(line, "Metadata") {
				currentSection = "metadata"
			} else if strings.Contains(line, "Tips") {
				currentSection = "tips"
			} else if strings.Contains(line, "Export") {
				currentSection = "export"
			} else if strings.Contains(line, "Codec") {
				currentSection = "codec"
			} else if strings.Contains(line, "SHA-256") || strings.Contains(line, "Source") {
				currentSection = "source"
			} else {
				currentSection = ""
			}
			continue
		}
		if strings.HasPrefix(line, "===") {
			break
		}
		if strings.HasPrefix(line, "<") {
			if idx := strings.Index(line, ">"); idx > 0 {
				tag := strings.TrimSpace(line[1:idx])
				value := strings.TrimSpace(line[idx+1:])
				switch currentSection {
				case "metadata":
					switch tag {
					case "name":
						h.Name = value
					case "free":
						h.IsFree = value == "true"
					case "hash":
						h.Hash = value
					case "license":
						if value == "" {
							continue
						}
						h.License = value
					case "link-home":
						h.LinkHome = value
					case "link-update", "link_update":
						h.LinkUpdate = value
					}
				case "export":
				case "codec":
					switch tag {
					case "format":
						h.Format = parseInt(value)
					case "crypto":
						h.Crypto = parseInt(value)
					}
				}
			}
			continue
		}
		if currentSection == "tips" && strings.TrimSpace(line) != "" {
			tipsLines = append(tipsLines, strings.TrimSpace(line))
		}
		if strings.HasPrefix(strings.TrimSpace(line), "<") && strings.Contains(line, ">") {
			trimmed := strings.TrimSpace(line)
			if idx := strings.Index(trimmed, ">"); idx > 0 {
				tag := trimmed[1:idx]
				value := strings.TrimSpace(trimmed[idx+1:])
				switch tag {
				case "name":
					if h.AuthorName == "" {
						h.AuthorName = value
					}
				case "role":
					h.AuthorRole = value
				case "contact-Bilibili", "contact_Bilibili", "contactBilibili":
					h.AuthorBilibili = value
				case "contact-Afdian", "contact_Afdian", "contactAfdian":
					h.AuthorAfdian = value
				}
			}
		}
		if currentSection == "" && strings.TrimSpace(line) != "" {
			preambleLines = append(preambleLines, line)
		}
	}

	if len(tipsLines) > 0 {
		h.Tips = strings.Join(tipsLines, "\n")
	} else if len(preambleLines) > 0 {
		for i, l := range preambleLines {
			cleaned := strings.TrimSpace(l)
			cleaned = strings.TrimPrefix(cleaned, "//")
			cleaned = strings.TrimPrefix(cleaned, "#")
			cleaned = strings.TrimPrefix(cleaned, ";")
			preambleLines[i] = strings.TrimSpace(cleaned)
		}
		h.Tips = strings.Join(preambleLines, "\n")
	}
	return h
}

// AnalyzeYSMHeader 读取 YSM 文件的文本头部，提取元数据
func AnalyzeYSMHeader(path string) YSMHeader {
	// 先尝试检测 YSGP（V2）二进制头部
	if h := detectYSGPHeader(path); h != nil {
		return *h
	}

	f, err := os.Open(path)
	if err != nil {
		return YSMHeader{}
	}
	defer f.Close()
	return scanHeader(bufio.NewScanner(f))
}

// detectYSGPHeader 检测 YSGP（YSM V2）二进制格式并提取基本信息
// 支持标准 YSGP 和带 BOM + 文本头部的变体
func detectYSGPHeader(path string) *YSMHeader {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	// 读取前 100 字节分析头部
	var header [100]byte
	n, err := io.ReadFull(f, header[:])
	if err != nil && n < 4 {
		return nil
	}
	data := header[:n]

	// 跳过可能的 UTF-8 BOM
	offset := 0
	if n >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf {
		offset = 3
	}

	// 检查 YSGP 魔数
	if n < offset+4 || string(data[offset:offset+4]) != "YSGP" {
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
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		} else {
			break
		}
	}
	return n
}
