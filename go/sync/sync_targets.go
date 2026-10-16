// sync_targets.go：推送目标三路推导单点（ADR-351 D4，2026-10-16 自 go/instance/status_counts.go 下沉）。
//
// 为什么在这里（ADR-351 D4 立因）：本函数的展开规则是 sync_push.go 推送路由的
// 镜像——files 逐条走 Install、dirs 整夹走 PushSingleResource 的目录分支
// （installDirUnitLocked，保层级）。原住 go/instance 时正确性靠注释复述本包行为
// （一处代码一处注释，必漂移）；下沉后路由知识与其实现同包，改推送路由时推导
// 就在手边。
package sync

import (
	"os"

	"ysm-model-manager/go/types"
)

// PushTargetsForUnit 把一个「待推送」单元展开为三路安装目标（ADR-310 §3 落地形态，
// 第三路 overwrites 见 ADR-340-d2）：
//
//	files      —— 仓库侧**文件级**绝对路径，走逐条 Install（一键安装主路）；
//	dirs       —— 仓库侧**目录单元**：夹内没有任何可逐文件安装的受支持文件时（如只含
//	              pack.mcmeta 的资源包夹、内容全不被 IsTypeModelFile 命中的 maid-model 夹），
//	              整夹交给 folder-aware 的 PushSingleResource（本包 sync_push.go 的目录
//	              分支 → installDirUnitLocked 保层级；面板行内推送同一条路）；
//	overwrites —— 上述目标中**会覆盖实例侧已修改副本**的那部分（⊂ files ∪ dirs）。
//
// 两路必须分开：files 的消费端逐条 Install，目录路径在那里语义是错的——
// internal/app 的 InstallResourceToInstance 对 isDir 类型走 InstallDir(filepath.Dir(src))，
// 传目录会把其**父目录**整棵装进实例（过度安装）；fileLevel 类型则落到 installer.Install(dir)，
// isSupportedModelExt("") 必判不支持。而 PushSingleResource 对目录走
// installDirUnitLocked(该目录)——装的正是这个夹，语义正确、无过度安装。
//
// 展开规则：
//   - 有 children（dirLevel 模型夹 / 嵌套容器）：递归取 status ∈ {missing, diverged} 的子项；
//   - 无 children 的文件单元：Path 本身（fileLevel missing，或 dirLevel 根下散文件）；
//   - 无 children 且 Path 是目录：先 DiffFolderContents（实例侧空串）展开夹内文件；
//     展开为空则整夹进 dirs（**不退化成把目录塞进 files**）；
//   - disabled 子项被排除（同消费方 foldUnit：禁用内容不推送）。
//
// overwrites 的收录口径（ADR-340-d2，宁少报不谎报）：
//   - 叶子文件 status==diverged → 其路径（仅仓库有 → missing，是新建不是覆盖）；
//   - 整夹推送（dirs 分支）且单元 status==diverged → 夹路径本身（整夹安装即覆盖该夹）；
//   - 已知盲区：单元 status==diverged 却展开成内层文件时（fileLevel 资源包夹内直接放 zip），
//     逐文件归因需要实例侧对应夹路径做**真实两侧** diff，而本函数拿不到该上下文（现传空串
//     = 全部按 missing 展开），故不逐文件声称覆盖。解药是给本函数注入实例侧对应夹路径
//     （那一改会同时改变安装目标清单，属行为变更，须单独拍板——记在 ADR-340-d2 遗留项）。
func PushTargetsForUnit(it types.ResourceSyncItem) (files, dirs, overwrites []string) {
	if len(it.Children) > 0 {
		for i := range it.Children {
			ch := it.Children[i]
			if ch.Status == types.SyncStatusMissing || ch.Status == types.SyncStatusDiverged {
				f, d, o := PushTargetsForUnit(ch)
				files = append(files, f...)
				dirs = append(dirs, d...)
				overwrites = append(overwrites, o...)
			}
		}
		return files, dirs, overwrites
	}
	if fi, err := os.Stat(it.Path); err == nil && fi.IsDir() {
		// 实例侧传空串：该夹在实例侧不存在，全部文件按 missing 列出。
		// 复用面板同一条 diff 实现（DiffFolderContents），不另写扩展名过滤口径。
		for _, d := range DiffFolderContents(it.Path, "", it.Type) {
			if d.Status == types.SyncStatusMissing || d.Status == types.SyncStatusDiverged {
				files = append(files, d.AbsPath)
			}
		}
		if len(files) == 0 {
			dirs = append(dirs, it.Path)
			if it.Status == types.SyncStatusDiverged {
				overwrites = append(overwrites, it.Path)
			}
		}
		return files, dirs, overwrites
	}
	if it.Status == types.SyncStatusDiverged {
		overwrites = append(overwrites, it.Path)
	}
	return append(files, it.Path), nil, overwrites
}
