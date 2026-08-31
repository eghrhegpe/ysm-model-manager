// ===== 重链接执行（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 relinkDir 提取：按 SHA256 哈希比对
// 将整合包实例目录中的文件重新链接到仓库版本（原子替换，失败回滚）。
// scanFn（扫描）/ linkMode / logger 由薄壳注入。
package sync

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
)

// RelinkDir 按哈希比对重链接实例目录与仓库（原子替换，失败回滚）
func RelinkDir(customDir, filesRoot, rtype, linkMode string, scanFn func(string) []types.ModelEntry, logger Logger) (int, error) {
	// 整段持 installer.InstallLock：RelinkDir 自身对 custom 目录做 os.Rename/os.RemoveAll
	//（目录级分支的备份/回滚/清理）——ADR-056 要求同步与安装并发操作同一 custom 目录文件时
	// 互斥，这些目录级写操作不能只靠 installer 内部文件级锁覆盖。内部对
	// installer.Install/InstallDir/CopyFile 的调用改用对应 *Locked 变体，避免同一
	// goroutine 重入非重入 mutex 死锁（第六轮整段持锁 + 调用公开函数的死锁回归）。
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	defer InvalidateSyncScanCaches() // 重链接会改实例目录，清同步扫盘缓存防陈旧

	customDir = strings.TrimSpace(customDir)
	filesRoot = strings.TrimSpace(filesRoot)
	if customDir == "" || filesRoot == "" {
		return 0, fmt.Errorf("参数为空")
	}
	if scanFn == nil {
		return 0, fmt.Errorf("scanFn 为空")
	}
	repoEntries := scanFn(filesRoot)
	repoByHash := make(map[string][]types.ModelEntry)
	for _, e := range repoEntries {
		if e.Hash == "" {
			continue
		}
		// 仓库侧禁用条目只是禁用标记，不能作为重链接源（与 sync.go 对齐）
		if types.IsDisableSuffix(e.Name) {
			continue
		}
		repoByHash[e.Hash] = append(repoByHash[e.Hash], e)
	}
	customEntries := scanFn(customDir)
	count := 0
	for _, ce := range customEntries {
		if ce.Hash == "" {
			continue
		}
		// 重链接不得静默恢复禁用状态——禁用文件跳过（保持禁用），
		// 否则 Install 会把仓库活跃版装回实例、用户禁用被悄悄撤销
		if types.IsDisableSuffix(ce.Name) {
			continue
		}
		entries, found := repoByHash[ce.Hash]
		if !found {
			continue
		}
		var srcPath string
		for _, e := range entries {
			// 防御：即使构建时已跳过，查询仍只取第一个非禁用条目
			if types.IsDisableSuffix(e.Name) {
				continue
			}
			srcPath = e.Path
			break
		}
		if srcPath == "" {
			continue
		}
		// 目录型模型文件判定（ADR-064 锚定）：原硬编码 ysm.json/.pmx/.pmd；
		// 现为该类型注册表 dirLevelSync + 文件属于该类型——新增目录型类型自动生效
		baseName := types.StripDisableSuffix(strings.ToLower(filepath.Base(ce.Path)))
		isDirType := types.IsDirLevelSync(rtype) && types.IsTypeModelFile(baseName, rtype)
		// 注：此处传剥 .disabled/.ban 后的 baseName（relink 需识别禁用文件的目录型——
		// 原 ce.Path 未剥后缀时 filepath.Ext 得 ".ban" 不匹配任何扩展集，测试红）。
		// 代价：MMD 目录型 .zip 在 relink 不识别（裸名 zip 分支开不了文件）——
		// 如需 zip 目录型 relink，需拆路径感知 + 剥离感知的专门 API（本轮不做）
		if isDirType {
			srcDir := filepath.Dir(srcPath)
			// ce.Path 已在目标子目录内，父层才是 InstallDir 要写入的基础目录
			dstParent := filepath.Dir(ce.Path)
			// ysm.json/.pmx 平铺在 customDir 根层时（dstParent == customDir），
			// InstallDir 的「挪走整目录→重建→回滚」会连带把同目录其他模型一起 rename 走、
			// 重建失败回滚后其他模型也随备份 RemoveAll 丢失。根层平铺退化为单文件落地，
			// 不做整目录替换。
			// flat 判定大小写敏感——Windows 上实例目录名
			// 大小写与 customDir 不一致时落入 dir 分支，把整个 customDir 当模型目录
			// rename 走（数据丢失复现）。对齐 ADR-044③ 用 EqualFold。
			if strings.EqualFold(filepath.Clean(dstParent), filepath.Clean(customDir)) {
				// 用 CopyFile 装到 customDir 平铺位置——
				// installer.Install 按 rel(srcPath, repoRoot) 推导目标，仓库侧文件在子目录时
				// 会装到 <customDir>/<subdir>/<base> 而平铺位置 <customDir>/<base> 残留陈旧副本
				//（报告成功但游戏实际加载的文件未重链）。CopyFile 直接落地到平铺目录。
				if _, err := installer.CopyFileLocked(srcPath, customDir); err != nil {
					if logger != nil {
						logger(ce.Name, ce.Path, customDir, 0, "failed", "relink 失败: "+err.Error())
					}
					continue
				}
				count++
				continue
			}
			// 但 InstallDir 会自动创建 {targetSubDir}，如果 dstParent 已经是模型目录
			// 则会二次嵌套。正确的做法：上一层目录作为 dstDir，让 InstallDir 创建子目录
			dstBase := filepath.Dir(dstParent)
			// 原子替换：先把旧目录挪走作备份，InstallDir 重建成功后再清理备份；
			// 失败则回滚恢复，避免目录整体丢失（旧实现先 RemoveAll 后重建，失败即丢）
			// 备份名带时间戳（R27 P2-4）：旧实现固定 ".relink-bak" + 无条件 RemoveAll，
			// 上一次 relink 失败留有的备份目录会被本次删除——恢复点丢失。
			// 时间戳版与 conflict.go 的 .bak-<ts> 口径对齐，避免备份覆盖。
			backup := fmt.Sprintf("%s.relink-bak-%d", dstParent, time.Now().UnixNano())
			if err := os.Rename(dstParent, backup); err != nil {
				if logger != nil {
					logger(ce.Name, ce.Path, dstParent, 0, "failed", "relink 备份目录失败: "+err.Error())
				}
				continue
			}
			if err := installer.InstallDirLocked(srcDir, dstBase, filesRoot, linkMode, rtype); err != nil {
				// 回滚：删除半成品，恢复原目录
				_ = os.RemoveAll(filepath.Join(dstBase, filepath.Base(srcDir)))
				// 回滚 rename 失败不再静默吞——原 `_ =` 吞错，
				// 原目录滞留 .relink-bak、实例目录缺失且函数继续执行（静默数据不可达）；
				// 记 logger 供用户排查（不 return——目录已损坏，继续无意义）
				if rbErr := os.Rename(backup, dstParent); rbErr != nil {
					if logger != nil {
						logger(ce.Name, ce.Path, dstParent, 0, "failed",
							"relink 失败且回滚失败，原目录滞留 "+filepath.Base(backup)+": "+rbErr.Error())
					}
				}
				if logger != nil {
					logger(ce.Name, ce.Path, dstParent, 0, "failed", "relink 失败: "+err.Error())
				}
				continue
			}
			_ = os.RemoveAll(backup)
			count++
			continue
		}
		// 传入基础 customDir，让 installer.Install 自行计算相对路径。
		// Install 内部对已存在的旧文件做原子替换（临时链接 + rename），失败不破坏原文件
		if err := installer.InstallLocked(srcPath, customDir, filesRoot, linkMode); err != nil {
			if logger != nil {
				logger(ce.Name, ce.Path, customDir, 0, "failed", "relink 失败: "+err.Error())
			}
			continue
		}
		count++
	}
	return count, nil
}
