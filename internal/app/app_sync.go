// ========== 同步冲突检测与解决（P1 优先级） ==========
package app

import (
	"encoding/json"
	"fmt"
	"log"

	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
)

// getSyncDirs 解析同步/冲突操作所需的全局目录与整合包目录。
// DetectConflicts 与 ResolveConflicts 原各自重复这段校验（约 22 行逐字复制），
// 收敛为单一实现：取配置 → 校验 McRoot → 全局目录 → 整合包目录。
func (a *App) getSyncDirs(rtype, instanceName string) (globalDir, targetDir string, err error) {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return "", "", fmt.Errorf("未配置游戏根目录")
	}

	globalDir, gErr := a.filesRootForSync(rtype)
	if gErr != nil || globalDir == "" {
		if gErr != nil {
			log.Printf("[conflict] 获取全局资源目录失败: %v", gErr)
			return "", "", fmt.Errorf("获取全局资源目录失败: %w", gErr)
		}
		return "", "", fmt.Errorf("未找到全局资源目录")
	}

	targetDir, tErr := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if tErr != nil || targetDir == "" {
		if tErr != nil {
			log.Printf("[conflict] 获取整合包目录失败: %v", tErr)
			return "", "", fmt.Errorf("获取整合包目录失败: %w", tErr)
		}
		return "", "", fmt.Errorf("未找到整合包目录: %s", instanceName)
	}
	return globalDir, targetDir, nil
}

// DetectConflicts 检测指定整合包与全局仓库之间的文件冲突
// 返回 typed ConflictReport（Wails codegen 自动序列化），失败 → error
func (a *App) DetectConflicts(rtype, instanceName string) (*ysmsync.ConflictReport, error) {
	globalDir, targetDir, err := a.getSyncDirs(rtype, instanceName)
	if err != nil {
		return nil, err
	}

	report, err := ysmsync.DetectConflicts(targetDir, globalDir, rtype)
	if err != nil {
		log.Printf("[conflict] DetectConflicts 失败: %v", err)
		return nil, fmt.Errorf("冲突检测失败: %w", err)
	}

	return report, nil
}

// ResolveConflicts 批量解决冲突
// conflictsJSON: 冲突列表 JSON（来自 DetectConflicts）
// defaultStrategy: 默认解决策略 (force_remote/force_local/manual)
// rtype: 资源类型 ID
// instanceName: 整合包名称
// 返回 typed SyncResolveResult，失败 → error
func (a *App) ResolveConflicts(conflictsJSON, defaultStrategy, rtype, instanceName string) (*types.SyncResolveResult, error) {
	globalDir, targetDir, err := a.getSyncDirs(rtype, instanceName)
	if err != nil {
		return nil, err
	}

	// 解析冲突列表
	var conflicts []ysmsync.FileConflict
	if err := json.Unmarshal([]byte(conflictsJSON), &conflicts); err != nil {
		log.Printf("[conflict] 解析冲突列表失败: %v", err)
		return nil, fmt.Errorf("解析冲突列表失败: %w", err)
	}

	if len(conflicts) == 0 {
		return &types.SyncResolveResult{Resolved: 0, Failed: 0, Manual: 0}, nil
	}

	// 执行解决
	resolved, failed, manual := ysmsync.ResolveConflicts(
		conflicts,
		ysmsync.ResolutionStrategy(defaultStrategy),
		targetDir,
		globalDir,
	)

	return &types.SyncResolveResult{Resolved: resolved, Failed: failed, Manual: manual}, nil
}
