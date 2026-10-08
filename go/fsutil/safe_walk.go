package fsutil

import (
	"io/fs"
	"log"
	"path/filepath"
)

// SafeWalk 是 filepath.WalkDir 的失败可见包装（ADR-030 健壮性契约落地）：
// 遍历某个目录条目失败时，filepath.WalkDir 会把 err 透传给回调——调用方若
// 对 err != nil 直接 `return nil`（跳过该条目）而不记录，失败便静默消失，
// 上层拿到的清单/差异可能部分缺失却无感知。
//
// SafeWalk 在委托原回调后，若回调对「err != nil 的条目」返回 nil（即选择跳过），
// 补记一条日志，恢复失败可见性；回调返回非 nil（ErrSkipDir/SkipAll/自定义错误）
// 时照原样透传，不做任何干预。
//
// 注意：已被调用方自行 log 过的站点（watcher/recycle/sync/ysm 的其它 WalkDir
// 回调）不要改走 SafeWalk，否则会重复记录——SafeWalk 只服务「此前纯吞 err」
// 的站点（如 ysm/extracted.go 的纹理查找、launcher/detect.go 的实例探测）。
// 对「根目录本身不可读」这类顶层 err，filepath.WalkDir 会把它作为首个回调
// 调用的 err 透传，SafeWalk 同样兜底记录一次。
func SafeWalk(root string, fn fs.WalkDirFunc) error {
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		innerErr := fn(p, d, err)
		if err != nil && innerErr == nil {
			// 条目访问失败且调用方选择静默跳过 → 补记日志恢复可见性
			log.Printf("[fsutil] SafeWalk 跳过访问失败的条目 %s: %v", p, err)
		}
		return innerErr
	})
}
