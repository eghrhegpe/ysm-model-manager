// relink_backup.go：relink 备份目录（`<目录名>.relink-bak-<UnixNano>`）的统一识别谓词。
//
// 单点事实源（ADR-342 D6，原为 go/sync 包私有 isRelinkBackupPath 下沉至此）：
//   - go/sync：RelinkDir 主循环 / repoByHash 构建 / SyncToggleStatus WalkDir / 同步 diff
//     四条 collect 通道豁免（尸体哈希恒等于仓库原件，否则套娃再生备份、污染恢复点）；
//   - go/scanner：仓库树 / 搜索 / 作者提取不得把尸体内模型当活跃条目（幻影模型）；
//   - go/dedup：`clean` 保留分组内 Path 排序首个——`a.relink-bak-1\a.ysm` 的 '.'(0x2E) <
//     '\'(0x5C) 使它排在活文件**之前**，不豁免就会保尸体、把活模型移进回收站（数据丢失）；
//   - go/repoaudit：体检统计（TotalFiles/命中率/评分）不计尸体。
//
// 禁止各包自行内联判定——口径漂移会让某一消费方重新把尸体当模型。
package fsutil

import (
	"path/filepath"
	"strings"
)

// relinkBackupMarker 是 relink 备份目录名的中缀标记（后缀形态：`<模型夹名>.relink-bak-<ts>`）。
const relinkBackupMarker = ".relink-bak-"

// IsRelinkBackupPath 判断路径是否落在某次 relink 的备份目录子树内（大小写不敏感）。
//
// 判「任一路径段含标记」而非只判 basename：备份目录**内部**的文件（Path 含该段）同样要命中。
// 后缀是形态而非独立段名，故不能照抄 IsRecycleDir 的基名精确匹配——同理也不能用
// 纯子串 Contains(path)，那会误伤文件名里恰好含该串的合法模型（如 `my.relink-bak-x.ysm` 之外的
// 正常命名无需担心，但仍以段为单位收窄判定面）。
func IsRelinkBackupPath(path string) bool {
	for _, seg := range strings.Split(path, string(filepath.Separator)) {
		if strings.Contains(strings.ToLower(seg), relinkBackupMarker) {
			return true
		}
	}
	return false
}
