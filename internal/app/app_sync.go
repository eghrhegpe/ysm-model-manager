// ========== 同步冲突检测与解决（P1 优先级） ==========
package app

import (
	"fmt"
	"log"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/instance"
	"ysm-model-manager/go/paths"
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

// conflictLocalPath 把冲突的相对路径解析为整合包内的绝对路径，并做越界守卫。
//
// 抽成纯函数（root + relPath → abs，不触达 App/配置/资源管理器）的唯一理由是**可单测**：
// 越界判定是安全边界（relPath 现由前端递入，属不可信输入），而端到端调用会真的拉起
// 资源管理器——测试不能靠启动 explorer.exe 来验证一条路径拼接。
func conflictLocalPath(root, relPath string) (string, error) {
	rel := strings.TrimSpace(relPath)
	if rel == "" {
		return "", fmt.Errorf("冲突路径为空")
	}
	abs := filepath.Join(root, filepath.FromSlash(rel))
	if _, err := paths.RelInside(root, abs); err != nil {
		return "", fmt.Errorf("冲突路径越界 %q: %w", rel, err)
	}
	return abs, nil
}

// RevealConflictFile 在资源管理器中定位某条冲突的**本地（整合包侧）文件**。
//
// 为什么路径解析必须归 Go，而不是让前端拼绝对路径（2026-10-14 拍板）：
//   - `FileConflict.Path` 是相对路径，而 `RevealInExplorer` 要绝对路径——Windows 侧
//     `explorer /select,` 按**进程 cwd** 解析，相对路径会指向别处或静默失败；
//   - 「整合包目录 + 资源子目录」的布局知识单一事实源在 Go（`getSyncDirs`，与
//     DetectConflicts / ResolveConflicts 同一解析路径）：前端复制一份就是第二份真相，
//     迟早出现「检测说在 A 目录、定位跳到 B 目录」；
//   - 越界守卫同样归 Go：`conflictLocalPath` 复用 `paths.RelInside`（与 `ResolveConflict`
//     同款防线），防调用方递来的 relPath 穿越出整合包目录。
//
// 前端据此只需递**它已经持有的身份**（rtype / instance / 相对路径），无需知道任何绝对路径；
// 入口按 `can("RevealInExplorer")` 门控（web/Android 无此能力 → 不渲染按钮，不造幽灵入口）。
func (a *App) RevealConflictFile(rtype, instanceName, relPath string) error {
	_, targetDir, err := a.getSyncDirs(rtype, instanceName)
	if err != nil {
		return err
	}
	abs, err := conflictLocalPath(targetDir, relPath)
	if err != nil {
		return err
	}
	return a.RevealInExplorer(abs)
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
// conflicts: 冲突列表（DetectConflicts 返回的同构 struct 切片，typed 入参直连——
// 低优先①：原 conflictsJSON string + json.Unmarshal 把类型契约降级成文本协议，
// 前端改名/漏字段编译期零感知；参照 EnqueueDownloads([]types.DownloadTask) 先例）
// defaultStrategy: 默认解决策略 (force_remote/force_local/manual)
// rtype: 资源类型 ID
// instanceName: 整合包名称
// 返回 typed SyncResolveResult，失败 → error
func (a *App) ResolveConflicts(conflicts []ysmsync.FileConflict, defaultStrategy, rtype, instanceName string) (*types.SyncResolveResult, error) {
	globalDir, targetDir, err := a.getSyncDirs(rtype, instanceName)
	if err != nil {
		return nil, err
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
	// 冲突解决会改实例/全局两侧目录（ResolveConflict 内部 CopyFile 覆盖），但 go/sync
	// 不能反向依赖 go/instance（instance 导入 sync），故 instance 同步结果缓存的失效
	// 归 app 层配对——与其余六条写入口（push/pull/toggle/relink/收编/单条推拉）同口径，
	// 缺这一条则整合包页继续展示旧同步状态 ≤TTL（锐评 2026-10-10 配对审计唯一漏网）。
	// 无条件清：失败计数 >0 时也可能已有部分文件被改。
	instance.InvalidateSyncItemsCache()
	ysmsync.InvalidateSyncScanCaches()

	return &types.SyncResolveResult{Resolved: resolved, Failed: failed, Manual: manual}, nil
}
