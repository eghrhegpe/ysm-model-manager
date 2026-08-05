//go:build !windows

package recycle

import (
	"errors"
	"syscall"
)

// isCrossDeviceErr 判断 rename 失败是否为跨设备（EXDEV）。
// os.Rename 返回的 *LinkError 可被 errors.Is 穿透。
func isCrossDeviceErr(err error) bool {
	return errors.Is(err, syscall.EXDEV)
}
