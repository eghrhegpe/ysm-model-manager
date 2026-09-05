// ===== 哈希计算（ADR-040 拆分；对比归并 ADR-064 收敛至 sync_diff.go）=====
package sync

import (
	"ysm-model-manager/go/scanner"
)

func computeHash(path string) string {
	// 与 scanner.ComputeFileHash 同口径（>500MB 返回空、全量哈希、读错误返回空），
	// 否则 >100MB 文件的哈希与仓库侧不一致，哈希匹配静默失效
	return scanner.ComputeFileHash(path)
}
