// Package errors 提供用户友好的中文错误信息
package errors

import (
	"fmt"
	"strings"
)

// Friendly 将错误转换为用户能看懂的中文提示。
// 如果错误已经是中文（含汉字），直接返回原文。
func Friendly(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()

	// 已经有汉字 → 直接返回（已有友好提示）
	if hasChinese(msg) {
		return err
	}

	// 常见系统错误映射
	mappings := []struct {
		patterns []string
		msg      string
	}{
		{[]string{"access is denied", "permission denied", "eacces"}, "权限不足，无法访问文件"},
		{[]string{"no such file", "not found", "cannot find", "does not exist"}, "文件或目录不存在"},
		{[]string{"sharing violation", "used by another process", "is locked", "file exists"}, "文件被其他程序占用"},
		// "empty" 过于宽泛（如 "empty response body" 会被误分类），只匹配目录/文件为空的具体短语
		{[]string{"directory is empty", "no files", "folder is empty"}, "目录为空，没有可操作的文件"},
		{[]string{"timeout", "timed out"}, "连接超时，请检查网络"},
		{[]string{"refused", "connection refused"}, "连接被拒绝，请检查网络或防火墙"},
		{[]string{"connection reset", "broken pipe", "reset by peer"}, "网络连接中断"},
		{[]string{"network", "proxy"}, "网络连接异常"},
		// 裸 "invalid" 会误伤 "invalid model name" 等（应为文件名/格式错误而非参数无效），
		// 只匹配 syscall.EINVAL 对应的 "invalid argument"
		{[]string{"invalid argument"}, "参数无效"},
		{[]string{"already exists"}, "文件已存在"},
		{[]string{"disk full", "no space left", "disk quota"}, "磁盘空间不足，请清理后重试"},
		{[]string{"unsupported", "not supported"}, "不支持的格式或操作"},
		{[]string{"too many"}, "操作过于频繁，请稍后重试"},
		{[]string{"not a directory"}, "路径不是目录"},
		{[]string{"is a directory"}, "路径是目录，不是文件"},
	}

	for _, m := range mappings {
		for _, p := range m.patterns {
			if strings.Contains(strings.ToLower(msg), p) {
				return fmt.Errorf("%s: %s", m.msg, msg)
			}
		}
	}

	// 英文错误加前缀
	return fmt.Errorf("操作失败: %s", msg)
}

func hasChinese(s string) bool {
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF {
			return true
		}
	}
	return false
}
