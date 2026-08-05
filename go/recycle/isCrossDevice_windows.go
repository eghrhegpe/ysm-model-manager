//go:build windows

package recycle

import (
	"errors"
	"syscall"
)

// errNotSameDevice = ERROR_NOT_SAME_DEVICE（17）：Windows 跨卷移动的 rename 错误码。
// 标准库 syscall 未导出该常量（仅 golang.org/x/sys/windows 有），此处直接用字面值。
const errNotSameDevice = syscall.Errno(17)

// isCrossDeviceErr 判断 rename 失败是否为跨设备（EXDEV）。
// Windows 上跨卷移动报 ERROR_NOT_SAME_DEVICE（17），与 POSIX 的 EXDEV（18）
// 不同，需同时识别；os.Rename 返回的 *LinkError 可被 errors.Is 穿透。
func isCrossDeviceErr(err error) bool {
	return errors.Is(err, syscall.EXDEV) || errors.Is(err, errNotSameDevice)
}
