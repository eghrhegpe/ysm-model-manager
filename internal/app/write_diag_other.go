//go:build !windows

package app

// runWriteDiag 非 Windows 空实现：写入自诊断依赖 x/sys/windows（令牌/完整性级别），
// 仅桌面排障用（YSM_WRITE_DIAG=1 启用），其他平台静默跳过。
func runWriteDiag() {}
