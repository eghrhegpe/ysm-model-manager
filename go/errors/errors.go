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
		{[]string{"sharing violation", "used by another process", "is locked", "file exists"}, "文件被其他程序占用，请关闭相关程序后重试"},
		{[]string{"empty", "no files"}, "目录为空，没有可操作的文件"},
		{[]string{"timeout", "timed out"}, "连接超时，请检查网络"},
		{[]string{"refused", "connection refused"}, "连接被拒绝，请检查网络或防火墙"},
		{[]string{"network", "proxy"}, "网络连接异常"},
		{[]string{"invalid argument", "invalid"}, "参数无效"},
		{[]string{"already exists"}, "文件已存在"},
		{[]string{"disk full", "no space", "disk quota"}, "磁盘空间不足"},
		{[]string{"unsupported", "not supported"}, "不支持的格式或操作"},
		{[]string{"too many"}, "操作过于频繁，请稍后重试"},
		{[]string{"not a directory"}, "路径不是目录"},
		{[]string{"is a directory"}, "路径是目录，不是文件"},
	}

	for _, m := range mappings {
		for _, p := range m.patterns {
			if strings.Contains(strings.ToLower(msg), p) {
				return fmt.Errorf(m.msg)
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
