// Package sync 整合包同步：仓库 ↔ 实例（custom 目录）的资源同步、diff、推送与重链接。
//
// ⚠️ 包名与标准库 `sync` 同名，外部引用一律显式 alias：
//
//	import ysmsync "ysm-model-manager/go/sync"
//
// 本包内部同时 import 标准库 "sync"（锁原语，见下方 import 块），故 alias 是编译期必需，
// **不是命名 stutter** —— 勿发起「消除 stutter」的重命名，决策与实证数据见 ADR-236。
// 2026-10 拆分：原 595 行按职责分为 sync.go（本文件：toggle 开关状态同步）/
// sync_resource.go（资源同步与推送）。
package sync

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// 锁统一（ADR-056 共享单锁）：同步与安装并发操作同一 custom 目录文件（Rename 竞态），
// 原两包各自定义 installLock/syncLock 互不感知——现统一复用 installer.InstallLock

// ScanFunc 扫描模型（函数类型，由 app.go 注入）
type ScanFunc func(dir string) []types.ModelEntry

// toggleFileInfo 实例目录待判文件清单条目（SyncToggleStatus 阶段 1 收集）
type toggleFileInfo struct {
	path              string
	isCurrentlyBanned bool
	actualPath        string
}

// toggleRenameOp 一条待执行的启禁改名（阶段 3 计划 → 阶段 4 执行）。
// 提为包级类型：阶段 3/4 已拆为独立函数，局部类型无法跨函数传递。
type toggleRenameOp struct {
	src string
	dst string
}

// SyncToggleStatus 同步启用/禁用状态
// 持锁分段设计：阶段 1 与阶段 3+4 各为独立持锁段（段内 defer 释放），
// 中间锁外算哈希。若锁外阶段 panic，不会出现「头部 defer Unlock 对已手动
// 释放的锁二次 Unlock」而掩盖原错误的场景——每段锁的生命周期由段内 defer 保证。
// 拆解后各阶段的锁归属不变：阶段 1 的锁在 collectToggleRepoIndex 内自持自放；
// 阶段 3（planToggleRenames）与阶段 4（applyToggleRenames）由本函数下方同一段
// Lock/defer Unlock 覆盖，两者之间不存在释放点。
func SyncToggleStatus(instanceCustomDir, filesRoot string, scanFn ScanFunc) (int, int, error) {
	if scanFn == nil {
		return 0, 0, fmt.Errorf("scanFn 为空")
	}

	// 阶段 1（持锁）：构建仓库禁启用索引 + 收集实例目录文件清单。
	repoHash, repoName, fileInfos, err := collectToggleRepoIndex(filesRoot, instanceCustomDir, scanFn)
	if err != nil {
		return 0, 0, err
	}

	// 阶段 2（锁外）：预计算 relKey miss 文件的哈希
	// 锁外哈希评估 TOCTOU 风险：文件在锁外被外部进程修改/替换的概率极低（用户主动操作除外），
	// 且哈希仅作 relKey miss 时的改名/移动文件的内容关联兜底，改名场景下文件名已变、
	// 内容匹配是近似判定。若文件被修改导致哈希变化，纯文件名 fallback 仍会兜底匹配。
	customDirClean := strings.ToLower(filepath.Clean(instanceCustomDir)) + string(filepath.Separator)
	precomputedHashes := precomputeRelKeyMissHashes(fileInfos, customDirClean, repoName)

	// 重新持锁，执行匹配 + rename（阶段 3+4 必须同段：计划与执行之间不得有并发改名）
	installer.InstallLocker.Lock()
	defer installer.InstallLocker.Unlock()
	defer InvalidateSyncScanCaches() // 启禁会改实例目录名，清同步扫盘缓存防陈旧

	ops := planToggleRenames(fileInfos, customDirClean, repoName, repoHash, precomputedHashes)
	disableCount, enableCount, failures := applyToggleRenames(ops)
	if len(failures) > 0 {
		return disableCount, enableCount, fmt.Errorf("同步完成: 成功禁用 %d 启用 %d，失败 %d: %s",
			disableCount, enableCount, len(failures), strings.Join(failures, "; "))
	}
	return disableCount, enableCount, nil
}

// collectToggleRepoIndex 是 SyncToggleStatus 阶段 1：在 InstallLock 内构建仓库
// 禁用状态索引（hash → banned 与 relPath → banned 两路）并收集实例目录待判清单。
// 锁由本函数自持自放（段内 defer）——调用方不得在此之后再假定锁仍被自己持有。
func collectToggleRepoIndex(filesRoot, instanceCustomDir string, scanFn ScanFunc) (map[string]bool, map[string]bool, []toggleFileInfo, error) {
	installer.InstallLocker.Lock()
	defer installer.InstallLocker.Unlock()

	repoEntries := scanFn(filesRoot)
	repoHash := make(map[string]bool) // hash → banned
	repoName := make(map[string]bool) // relPath(去禁用后缀) → banned，用于同名不同文件夹的文件
	filesRootClean := strings.ToLower(filepath.Clean(filesRoot)) + string(filepath.Separator)
	for _, e := range repoEntries {
		banned := registry.IsDisableSuffix(e.Name)
		// 用路径前缀限定：relPath 带至少一级父文件夹，避免跨文件夹撞名
		ePath := strings.ToLower(e.Path)
		if strings.HasPrefix(ePath, filesRootClean) {
			rel := strings.TrimPrefix(ePath, filesRootClean)
			rel = registry.StripDisableSuffix(rel)
			repoName[rel] = banned
		} else {
			// fallback：纯文件名（顶层文件）
			baseName := strings.ToLower(e.Name)
			baseName = registry.StripDisableSuffix(baseName)
			repoName[baseName] = banned
		}
		if e.Hash != "" {
			repoHash[e.Hash] = banned
		}
	}
	if len(repoHash) == 0 && len(repoName) == 0 {
		return nil, nil, nil, fmt.Errorf("仓库中未找到模型文件")
	}
	return repoHash, repoName, collectToggleFileInfos(instanceCustomDir), nil
}

// collectToggleFileInfos 遍历实例目录收集待判文件路径（不计算哈希）。
// WalkDir 仅用于遍历，遍历中途错误已在回调内逐条 log 并跳过；
// 返回值仅反映「回调是否主动中断」，本处回调恒返回 nil，故 best-effort 丢弃。
func collectToggleFileInfos(instanceCustomDir string) []toggleFileInfo {
	var fileInfos []toggleFileInfo
	_ = filepath.WalkDir(instanceCustomDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[sync] WalkDir 错误 %s: %v", p, err)
			return nil
		}
		if d.IsDir() {
			return nil
		}
		// 逐段判定（对齐 fsutil.IsRecycleDir/download.stripRecycleSegments 口径）：
		if hasRecycleSegment(p) {
			return nil
		}
		// relink 备份尸体同样剔除（ADR-296 D3）：尸体哈希匹配仓库原件，
		// 不跳则对备份目录内的模型做 .disabled 改名，污染恢复点
		if isRelinkBackupPath(p) {
			return nil
		}
		actualPath := p
		isCurrentlyBanned := registry.IsDisableSuffix(p)
		if isCurrentlyBanned {
			actualPath = registry.StripDisableSuffix(p)
		}
		ext := strings.ToLower(filepath.Ext(actualPath))
		if !registry.IsSupportedExt(ext) {
			return nil
		}
		fileInfos = append(fileInfos, toggleFileInfo{
			path:              p,
			isCurrentlyBanned: isCurrentlyBanned,
			actualPath:        actualPath,
		})
		return nil
	})
	return fileInfos
}

// precomputeRelKeyMissHashes 是 SyncToggleStatus 阶段 2（锁外）：对 relKey 未命中的
// 文件预计算内容哈希，供阶段 3 的内容关联兜底。分两趟（先分类、后哈希）是刻意的——
// 哈希只对确定 miss 的文件算，避免为路径已能对应的文件白读盘。
func precomputeRelKeyMissHashes(fileInfos []toggleFileInfo, customDirClean string, repoName map[string]bool) map[string]string {
	relKeyMissPaths := make([]string, 0, len(fileInfos))
	for _, fi := range fileInfos {
		pLower := strings.ToLower(fi.path)
		var matched bool
		if strings.HasPrefix(pLower, customDirClean) {
			rel := strings.TrimPrefix(pLower, customDirClean)
			rel = registry.StripDisableSuffix(rel)
			_, matched = repoName[rel]
		}
		if !matched {
			relKeyMissPaths = append(relKeyMissPaths, fi.path)
		}
	}
	precomputedHashes := make(map[string]string, len(relKeyMissPaths))
	for _, p := range relKeyMissPaths {
		precomputedHashes[p] = computeHash(p)
	}
	return precomputedHashes
}

// planToggleRenames 是 SyncToggleStatus 阶段 3：按 relKey（路径对应）→ 哈希（内容对应）
// → 纯文件名兜底 的顺序判定每个实例文件的目标启禁态，产出待执行改名计划。
// 只读盘（os.Stat 目标存在性预检）不改名——阶段 4 才动盘，使目录结构在执行期内稳定。
// 调用方须持 installer.InstallLock（本函数不自行加锁，避免 sync.Mutex 重入死锁）。
func planToggleRenames(fileInfos []toggleFileInfo, customDirClean string,
	repoName, repoHash map[string]bool, precomputedHashes map[string]string) []toggleRenameOp {
	var ops []toggleRenameOp
	for _, fi := range fileInfos {
		p := fi.path
		var shouldBeBanned bool
		var matched bool
		pLower := strings.ToLower(p)
		if strings.HasPrefix(pLower, customDirClean) {
			// relKey 匹配（带文件夹限定）
			rel := strings.TrimPrefix(pLower, customDirClean)
			rel = registry.StripDisableSuffix(rel)
			shouldBeBanned, matched = repoName[rel]
		}
		if !matched {
			hash := precomputedHashes[p]
			if hash != "" {
				shouldBeBanned, matched = repoHash[hash]
			}
		}
		if !matched {
			// fallback：纯文件名（旧仓库或同名不同路径的特例）
			baseName := strings.ToLower(filepath.Base(fi.actualPath))
			shouldBeBanned, matched = repoName[baseName]
		}
		if !matched || shouldBeBanned == fi.isCurrentlyBanned {
			continue
		}
		if shouldBeBanned {
			// 禁用统一收敛到新标准后缀（.disabled）。
			newPath := p + registry.DisabledSuffix()
			if _, err := os.Stat(newPath); err == nil {
				continue // 目标已存在，跳过
			}
			ops = append(ops, toggleRenameOp{src: p, dst: newPath})
			continue
		}
		newPath := registry.StripDisableSuffix(p)
		// 启用分支补目标存在性检查
		if _, err := os.Stat(newPath); err == nil {
			continue
		}
		ops = append(ops, toggleRenameOp{src: p, dst: newPath})
	}
	return ops
}

// applyToggleRenames 是 SyncToggleStatus 阶段 4：统一执行改名（目录结构已稳定，无竞态）。
// 返回禁用数/启用数与失败明细；被占用（Windows 共享锁）的文件只记日志不计失败——
// 瞬时争用不是数据错误，报成失败会让整次同步以 error 收场。
// 调用方须持 installer.InstallLock（本函数不自行加锁，避免 sync.Mutex 重入死锁）。
func applyToggleRenames(ops []toggleRenameOp) (int, int, []string) {
	disableCount := 0
	enableCount := 0
	var failures []string
	for _, op := range ops {
		err := os.Rename(op.src, op.dst)
		if err != nil && isFileLocked(err) {
			// Windows 共享锁瞬时争用：等待后重试一次
			time.Sleep(fileLockRetryDelay)
			err = os.Rename(op.src, op.dst)
		}
		if err != nil {
			if isFileLocked(err) {
				log.Printf("[sync] 文件被占用，跳过: %s → %s: %v", op.src, op.dst, err)
			} else {
				failures = append(failures, fmt.Sprintf("%s→%s: %v", op.src, op.dst, err))
			}
			continue
		}
		if registry.IsDisableSuffix(op.dst) {
			disableCount++
		} else {
			enableCount++
		}
	}
	return disableCount, enableCount, failures
}

// 文件级同步深度上限：SyncResources 仅收集 scanDir 顶层文件，不递归进入嵌套子目录。
// 文件夹级类型（YSM/MMD 等）仍全树递归，由 SyncResourcesDirLevel 按文件夹名对比。
// SyncResources 对比两个目录的资源文件差异，按文件名匹配
// 用于资源库（资源包/光影包等）的全局 ↔ 整合包同步
// 只统计模型/资源相关扩展名的文件，忽略无关文件
// rtype 指定资源类型 ID：文件级类型（!dirLevelSync）仅在目标目录顶层收集文件（depth 1），
// 不递归进嵌套子目录；文件夹级类型仍全树递归。空 rtype 保持旧的全树递归行为（测试/兼容）。
// P3 修复：原实现无论类型一律全递归——Sable Schematics 等生成 .nbt 于嵌套子目录时，
// mapSrcToGlobal（顶层语义）算出相对路径以 ".." 开头误判越界 → 拉取报"不在目标目录内"。
// isMcmetaDetectorType 判断资源类型是否为资源包文件夹型（detector=mcmeta）。
// SyncResources 的 pack.mcmeta 文件夹收集仅对此类（及空 rtype 兼容）生效，
// 避免蓝图/YSM 等类型的仓库中误放的资源包文件夹被当成本类型同步单元。
func isMcmetaDetectorType(rtype string) bool {
	rt := registry.RegistryType(rtype)
	return rt != nil && rt.Detector == "mcmeta"
}

// relKey 计算文件相对 root 的规范化同步 key（小写、正斜杠、去 .disabled/.ban 尾部）。
// ADR-064 阶段二：文件级对比从「文件名」升级为「相对路径」——嵌套文件天然区分、
// 无同名冲突、与仓库树树状语义一致（原"只扫顶层"深度守卫随之取消）。
func relKey(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	rel = strings.ToLower(rel)
	rel = registry.StripDisableSuffix(rel)
	return rel
}
