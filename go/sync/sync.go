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

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// 锁统一（ADR-056 共享单锁）：同步与安装并发操作同一 custom 目录文件（Rename 竞态），
// 原两包各自定义 installLock/syncLock 互不感知——现统一复用 installer.InstallLock

// ScanFunc 扫描模型（函数类型，由 app.go 注入）
type ScanFunc func(dir string) []types.ModelEntry

// toggleFileInfo 实例目录待判条目清单（SyncToggleStatus 阶段 1 收集）。
// isDir（ADR-345 D1）：目录粒度禁用（模型夹 X/ ↔ X.disabled/）的载体是**目录**，
// 只收文件会让整条目录启禁链在实例侧不可见（探针实证两方向均 0/0/nil 静默失效）。
type toggleFileInfo struct {
	path              string
	isCurrentlyBanned bool
	actualPath        string
	isDir             bool
}

// toggleRenameOp 一条待执行的启禁改名（阶段 3 计划 → 阶段 4 执行）。
// 提为包级类型：阶段 3/4 已拆为独立函数，局部类型无法跨函数传递。
type toggleRenameOp struct {
	src string
	dst string
}

// SyncToggleStatus 同步启用/禁用状态
// 锁范围：阶段 1（仓库索引 + 实例目录遍历，纯读）与阶段 2（哈希）均**锁外**执行，
// 仅阶段 3+4（计划 + rename 操作段）持 InstallLock——与 RelinkDir 的「锁外扫描 + 锁内
// 仅覆盖操作段」对齐，避免仓库全量扫描（scanner 缓存冷启动时整段走盘，watcher 触发的
// syncAll 恰是冷启动路径：文件变更后 scanner 缓存刚失效，下一次 toggle 必冷扫）阻塞
// 所有并发同步/安装/推送。锁外阶段的 TOCTOU 容忍理由见 collectToggleRepoIndex 注释；
// 回归锁 TestSyncToggleStatus_ScanNotHeldLock 钉住本契约。
// 阶段 3（planToggleRenames）与阶段 4（applyToggleRenames）由本函数下方同一段
// Lock/defer Unlock 覆盖，两者之间不存在释放点——计划与执行期间目录结构保持稳定。
func SyncToggleStatus(instanceCustomDir, filesRoot string, scanFn ScanFunc) (int, int, error) {
	if scanFn == nil {
		return 0, 0, fmt.Errorf("scanFn 为空")
	}

	// 阶段 1（锁外，纯读）：构建仓库禁启用索引 + 收集实例目录文件清单。
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

	// 持锁执行匹配 + rename（阶段 3+4 必须同段：计划与执行之间不得有并发改名）
	installer.InstallLocker.Lock()
	defer installer.InstallLocker.Unlock()
	defer scanner.InvalidateCache() // 启禁会改实例目录名：走 scanner 单漏斗清扫描缓存，级联清 instance 同步结果（锐评 P0-① 失效不对称）

	ops := planToggleRenames(fileInfos, customDirClean, repoName, repoHash, precomputedHashes, filesRoot)
	disableCount, enableCount, failures := applyToggleRenames(ops)
	if len(failures) > 0 {
		return disableCount, enableCount, fmt.Errorf("同步完成: 成功禁用 %d 启用 %d，失败 %d: %s",
			disableCount, enableCount, len(failures), strings.Join(failures, "; "))
	}
	return disableCount, enableCount, nil
}

// collectToggleRepoIndex 是 SyncToggleStatus 阶段 1：**锁外**构建仓库禁用状态索引
// （hash → banned 与 relPath → banned 两路）并收集实例目录待判清单。
// 锁外执行（镜像 RelinkDir 的锁外扫描，见 sync_relink.go|RelinkDir 注释）：本函数四步
// 全是纯读操作——仓库全量扫描（含 SHA256 哈希）、内存索引构建、禁用载体 Walk、实例目录
// Walk——持锁却不保护任何写操作。原实现在临界区内跑 scanFn，而 scanFn 在 scanner 缓存
// 冷启动时整段走盘（watcher 触发 syncAll 恰是冷启动路径：文件变更后 scanner 缓存刚失效，
// 下一次 toggle 必冷扫），期间会阻塞所有并发同步/安装/推送操作。
// TOCTOU 容忍：索引快照与执行之间（阶段 2 锁外哈希 + 阶段 3+4 锁内）目录可能被外部
// 改动，但 planToggleRenames 执行前对目标做 os.Stat 存在性预检、applyToggleRenames 的
// os.Rename 失败即记入 failures 并随 error 返回——不会静默搬错对象（相对 RelinkDir 的
// dstSnapshots 身份复验粒度更弱，但 rename 本身原子，同风险模型已被同包接受）。
// 回归锁 TestSyncToggleStatus_ScanNotHeldLock 钉住「扫描不在锁内」契约。
func collectToggleRepoIndex(filesRoot, instanceCustomDir string, scanFn ScanFunc) (map[string]bool, map[string]bool, []toggleFileInfo, error) {
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
	if len(repoHash) == 0 && len(repoName) == 0 && !hasDisabledDirCarrier(filesRoot) {
		return nil, nil, nil, fmt.Errorf("仓库中未找到模型文件")
	}
	return repoHash, repoName, collectToggleFileInfos(instanceCustomDir), nil
}

// hasDisabledDirCarrier 扫仓库里是否存在「禁用载体目录」（名字带禁用后缀的目录）。
// 为什么需要（复核 P2-2）：scanner 对禁用目录 SkipDir → 仓库索引里没有任何条目，
// 若此时仍按「索引为空 = 仓库没有模型」早退，则「仓库侧只有禁用夹」这一场景的
// 禁用方向依旧静默失效（探针实证：禁用 0 启用 0 err=仓库中未找到模型文件）。
// 代价只在索引为空的罕见路径上付：命中即短路，不遍历完。
func hasDisabledDirCarrier(repoRoot string) bool {
	found := false
	_ = filepath.WalkDir(repoRoot, func(p string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() || p == repoRoot {
			return nil
		}
		// 统一剔除闸（ADR-351 D1）：回收站 + relink 备份尸体，谓词单点见 sync_walk.go
		if err := skipExcludedDir(repoRoot, p); err != nil {
			return err
		}
		if registry.IsDisableSuffix(d.Name()) {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	return found
}

// collectToggleFileInfos 遍历实例目录收集待判条目（不计算哈希）。
// 除文件外**还收目录**（ADR-345 D1）：目录级禁用载体（`X.disabled/`）必须成为候选，
// 否则仓库侧禁用/启用整夹时实例侧永远匹配不上（探针实证 0/0/nil）。载体登记后
// `SkipDir` 不再下钻——改的是这个目录本身，改名会搬走整棵子树，下钻产生的文件候选
// 路径在改名后立即失效。
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
			// 统一剔除闸（ADR-351 D1）：回收站 + relink 备份尸体整棵跳过。
			// 旧实现另对文件分支查谓词——目录处 SkipDir 后子树内文件不可达，
			// 该层属死代码且致「x.relink-bak-1.ysm 类命名文件被 toggle 独家剔除」
			// 的通道间口径漂移，随统一收敛移除（其余六通道本就只剔目录）。
			if err := skipExcludedDir(instanceCustomDir, p); err != nil {
				return err
			}
			if p == instanceCustomDir {
				return nil // 根目录自身不是单元
			}
			isBanned := registry.IsDisableSuffix(d.Name())
			actualPath := p
			if isBanned {
				actualPath = registry.StripDisableSuffix(p)
			}
			// 目录粒度候选：活跃目录与禁用载体都发出（活跃目录可能"应该"被禁用），
			// 真值由阶段 3 探测仓库侧同路径的活跃/载体形态决定。
			fileInfos = append(fileInfos, toggleFileInfo{
				path:              p,
				isCurrentlyBanned: isBanned,
				actualPath:        actualPath,
				isDir:             true,
			})
			if isBanned {
				return filepath.SkipDir
			}
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
		// 目录候选不需要内容哈希（阶段 3 的目录分支只看仓库侧形态），
		// 排除掉可省下每目录一次 os.Open——computeHash(目录) 必然返回空串（复核 P3-1）。
		if fi.isDir {
			continue
		}
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
// → 纯文件名兜底 的顺序判定每个实例**文件**的目标启禁态；**目录**候选另走仓库文件系统探测
// （ADR-345 D1：scanner 按 ADR-038 D3.7 对禁用目录 SkipDir，仓库索引里根本没有禁用夹，
// 故目录粒度不能用索引判真值——改为探测 repoRoot/<rel> 与 repoRoot/<rel>+后缀，
// 恰好一侧存在才判 matched）。产出待执行改名计划。
// 只读盘（os.Stat 目标存在性预检）不改名——阶段 4 才动盘，使目录结构在执行期内稳定。
// 调用方须持 installer.InstallLock（本函数不自行加锁，避免 sync.Mutex 重入死锁）。
func planToggleRenames(fileInfos []toggleFileInfo, customDirClean string,
	repoName, repoHash map[string]bool, precomputedHashes map[string]string, repoRoot string) []toggleRenameOp {
	var ops []toggleRenameOp
	for _, fi := range fileInfos {
		p := fi.path
		var shouldBeBanned bool
		var matched bool
		pLower := strings.ToLower(p)
		if fi.isDir {
			// 目录粒度：rel 的尾段就是载体名（载体不下钻，不会出现「祖先带后缀」的 rel）
			rel := strings.ToLower(filepath.Base(fi.actualPath))
			if strings.HasPrefix(pLower, customDirClean) {
				rel = registry.StripDisableSuffix(strings.TrimPrefix(pLower, customDirClean))
			}
			shouldBeBanned, matched = dirToggleDecision(repoRoot, rel)
		} else {
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

// dirToggleDecision 探测仓库侧某相对路径的启禁真值（ADR-345 D1）：
//   - 活跃形态是目录、无禁用载体 → (false, true)：实例侧该目录应为活跃
//   - 活跃形态不存在、禁用载体是目录 → (true, true)：实例侧该目录应为禁用
//   - 两者并存 / 都不存在 → (false, false)：**保守不动作**
//
// ⚠️ 并存必须真判成 no-op（复核 P1-1）：早前借 fsutil 谓词判载体，而该谓词在活跃存在时
// 恒不命中 → 「并存」永远落进「应活跃」分支，把用户既有的禁用载体**强制启用**（探针实证
// 禁用 0 启用 1）。故两个形态各自独立 stat，并存就是并存——仓库里同时留着活跃与载体
// 说明状态不明，猜错即数据事故。
//
// 载体判定走 fsutil.DisabledDirCounterpart（**限定目录**：同名杂散文件不是禁用意图，
// 复核 P2-1；后缀表归 registry，含历史 .ban）。
func dirToggleDecision(repoRoot, rel string) (banned bool, matched bool) {
	if repoRoot == "" || rel == "" {
		return false, false
	}
	active := filepath.Join(repoRoot, filepath.FromSlash(rel))
	activeOK, _, carrierOK := fsutil.DisabledTwinForms(active)
	switch {
	case activeOK && !carrierOK:
		return false, true
	case !activeOK && carrierOK:
		return true, true
	default:
		return false, false // 并存（状态不明）或都不存在（仓库没有该单元）
	}
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
