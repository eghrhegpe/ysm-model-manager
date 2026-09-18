package fsutil

// dirsize.go — 目录占用统计的**唯一出口**（ADR-262 D3「全库前 N 大」目标集）。
//
// 立因：`scanner.ScanEntries` 给目录式模型（解包 YSM 目录）的 `ModelEntry.Size` 是入口
// `ysm.json` **清单本身**的字节数（fixture 实测 115B），不是模型占用。按它排名会把最大的
// 解包模型排到最后——「全库前 N 大」必须按目录内容合计算，才与 web 适配器填同一字段的口径一致。
//
// 与 `recycle` 的口径统一：该包原有的包私有 `dirSize`（回收站文件夹条目显示大小）已改为调用本函数，
// 避免同一语义两份实现各自漂移。

import (
	"os"
	"path/filepath"
)

// DirSize 递归统计路径占用字节数：
//   - 目录 → 其下全部普通文件的字节合计（只读权限失败的子项跳过，返回已统计到的部分）；
//   - 普通文件 → 该文件自身大小（调用方无需先判类型）；
//   - 不存在的路径 → (0, error)。
//
// 符号链接按 `os.DirEntry` 的 lstat 结果计数（不追随链接目标），与 scanner 的遍历口径一致，
// 避免链接环导致无限遍历或体量虚高。
func DirSize(path string) (int64, error) {
	if path == "" {
		return 0, os.ErrNotExist
	}
	if _, err := os.Lstat(path); err != nil {
		return 0, err
	}
	var total int64
	err := filepath.WalkDir(path, func(_ string, d os.DirEntry, err error) error {
		if err != nil {
			// 单个子项读不到（权限/竞态）不该让整次统计归零：跳过并继续，
			// 让调用方拿到「至少这么多」的下界——比静默 0 更接近事实。
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if info, infoErr := d.Info(); infoErr == nil {
			total += info.Size()
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return total, nil
}
