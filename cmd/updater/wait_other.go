//go:build !windows

package main

import "time"

// isRetryableReplaceErr 非 Windows 平台：无共享冲突语义，一律不可重试。
func isRetryableReplaceErr(err error) bool { return false }

// waitMainExit 非 Windows 平台：无 PE 文件锁语义，直接返回（替换无需等待）。
func waitMainExit(pid uint32, waitTimeout time.Duration) error {
	_ = pid
	_ = waitTimeout
	return nil
}
