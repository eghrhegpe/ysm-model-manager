// sync_walk.go：同步收集 Walk 的统一剔除闸（ADR-351 D1，2026-10-16）。
//
// 背景：本包七个 Walk 收集器（toggle×2 / 资源 diff / dirLevel 收集 / 文件夹清单 /
// 实例独有保全 / 冲突检测）历史上各自手抄「跳过回收站 + relink 备份尸体」的
// SkipDir 谓词，且口径已漂移——两套回收站谓词（段级 hasRecycleSegment vs 基名级
// fsutil.IsRecycleDir）并存、conflict.go 的 collectFileEntries 完全缺失该过滤
// （回收站文件参与哈希比对，两侧同名 .recycle 子路径可产出幻影冲突）。ADR-342
// 修的正是「漏一处过滤」，但逐点补丁治不了类：下一个收集器还会漏。
//
// 本文件是 D1 落地：谓词单点 + 收集器回调目录分支一道闸 + fail-closed 契约测试
// （sync_walk_gate_test.go 扫本包全部 Walk/WalkDir 调用点，漏挂闸即红）。
// 新增收集器：回调的目录分支第一件事挂闸，不要自己写过滤谓词。
package sync

import (
	"path/filepath"

	"ysm-model-manager/go/fsutil"
)

// walkExcluded 单点谓词：路径落在同步收集必须剔除的子树内——
//   - 回收站 .recycle（段级判定，fsutil.HasRecycleSegment）；
//   - relink 备份尸体 <夹名>.relink-bak-<ts>（段含标记，fsutil.IsRelinkBackupPath）。
//
// 段级回收站判定与基名级 fsutil.IsRecycleDir 在「Walk 回调只见目录」的场景下等价
// （首个命中的目录即被 SkipDir，更深的祖先段不可达）；保留段级是为覆盖
// folderEntriesByRel 这类「对预收集清单按全路径过滤」的非 Walk 消费点（任意深度
// 命中）。谓词底座统一住 fsutil，本函数只做「两类剔除子树」的合取口径。
func walkExcluded(p string) bool {
	return fsutil.HasRecycleSegment(p) || fsutil.IsRelinkBackupPath(p)
}

// skipExcludedDir 收集器 Walk/WalkDir 回调【目录分支】顶部的统一剔除闸：
// 命中剔除子树 → filepath.SkipDir（整棵子树不再下钻）；root 恒放行
// （步行根目录自身不属「子树剔除」——既有六处口径一致）。
//
// 只挂目录分支：目录处 SkipDir 后其下文件不可达，文件分支无需重复判定。
// 这统一了历史口径差——旧 toggle 通道对文件也查谓词，名为「x.relink-bak-1.ysm」
// 的普通文件曾被误剔出 toggle 候选，而其余六个收集通道对同名文件照常收集
// （ADR-351 D1 行为收敛，详见知识卡 go-sync 裁定记录 2026-10-16）。
func skipExcludedDir(root, p string) error {
	if p == root {
		return nil
	}
	if walkExcluded(p) {
		return filepath.SkipDir
	}
	return nil
}
