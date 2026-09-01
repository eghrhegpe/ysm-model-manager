// ========== 同步冲突检测与解决（P1 优先级） ==========
package app

import (
	"encoding/json"
	"fmt"
	"log"

	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
)

// DetectConflicts 检测指定整合包与全局仓库之间的文件冲突
// 返回 typed ConflictReport（Wails codegen 自动序列化），失败 → error
func (a *App) DetectConflicts(rtype, instanceName string) (*ysmsync.ConflictReport, error) {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return nil, fmt.Errorf("未配置游戏根目录")
	}

	globalDir, err := a.filesRootForSync(rtype)
	if err != nil || globalDir == "" {
		if err != nil {
			log.Printf("[conflict] 获取全局资源目录失败: %v", err)
			return nil, fmt.Errorf("获取全局资源目录失败: %w", err)
		}
		return nil, fmt.Errorf("未找到全局资源目录")
	}

	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil || targetDir == "" {
		if err != nil {
			log.Printf("[conflict] 获取整合包目录失败: %v", err)
			return nil, fmt.Errorf("获取整合包目录失败: %w", err)
		}
		return nil, fmt.Errorf("未找到整合包目录: %s", instanceName)
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
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return nil, fmt.Errorf("未配置游戏根目录")
	}

	globalDir, err := a.filesRootForSync(rtype)
	if err != nil || globalDir == "" {
		if err != nil {
			log.Printf("[conflict] 获取全局资源目录失败: %v", err)
			return nil, fmt.Errorf("获取全局资源目录失败: %w", err)
		}
		return nil, fmt.Errorf("未找到全局资源目录")
	}

	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil || targetDir == "" {
		if err != nil {
			log.Printf("[conflict] 获取整合包目录失败: %v", err)
			return nil, fmt.Errorf("获取整合包目录失败: %w", err)
		}
		return nil, fmt.Errorf("未找到整合包目录: %s", instanceName)
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
