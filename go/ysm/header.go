package ysm

import (
	"bufio"
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

// AnalyzeYSMHeader 读取 YSM 文件的文本头部，提取元数据
// 适用于所有 YSM 文件（加密和非加密），不需要解压
func AnalyzeYSMHeader(path string) YSMHeader {
	h := YSMHeader{}

	f, err := os.Open(path)
	if err != nil {
		return h
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	// 只读前 200 行（头部信息不会超过这个范围）
	limit := 0
	currentSection := ""
	var tipsLines []string

	for scanner.Scan() && limit < 200 {
		limit++
		line := scanner.Text()

		// 检测文件头
		if line == "YSGP" {
			h.IsYSM = true
			continue
		}

		// 检测分区
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

		// 遇到分割线停止
		if strings.HasPrefix(line, "===") {
			break
		}

		// 解析 <tag> value
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
						// <license> 可能后面有子标签，取整行
						if value == "" {
							// 看下一行是否是子标签
							continue
						}
						h.License = value
					case "link-home":
						h.LinkHome = value
					case "link-update", "link_update":
						h.LinkUpdate = value
					}
				case "export":
					switch tag {
					case "time", "rand":
						// 不需要
					}
				case "codec":
					switch tag {
					case "format":
						h.Format = parseInt(value)
					case "crypto":
						h.Crypto = parseInt(value)
					}
				}

				// 处理作者子标签
				if tag == "name" && currentSection == "" {
					// 可能是 author 的子标签
				}
			}
			continue
		}

		// 处理 tips 文本
		if currentSection == "tips" && strings.TrimSpace(line) != "" {
			tipsLines = append(tipsLines, strings.TrimSpace(line))
		}

		// 处理作者子标签：缩进的 <tag> value
		if strings.HasPrefix(strings.TrimSpace(line), "<") && strings.Contains(line, ">") {
			trimmed := strings.TrimSpace(line)
			if idx := strings.Index(trimmed, ">"); idx > 0 {
				tag := trimmed[1:idx]
				value := strings.TrimSpace(trimmed[idx+1:])
				// 这些通常是作者的子标签
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
	}

	if len(tipsLines) > 0 {
		h.Tips = strings.Join(tipsLines, "\n")
	}

	return h
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
