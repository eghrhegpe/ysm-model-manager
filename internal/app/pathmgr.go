// ========== PathManager 平台抽象层（ADR-046 P2，参照 MikuMikuAR ADR-018）==========
// 平台差异收敛点：配置/日志/标签的根目录在不同平台语义不同——
//   desktop（Windows/macOS/Linux）→ os.UserConfigDir()（%APPDATA% / ~/Library/Application Support / ~/.config）
//   android                    → 应用沙盒私有目录（/data/data/<pkg>/files 或 HOME）
// 选择包级单例 + build tags 而非运行时 GOOS 检查的原因（同 ADR-018）：
//   平台实现完全不同（系统 API vs 沙盒路径），build tags 让编译器保证只包含正确实现，零运行时开销。

package app

import "log"

// pathManager 定义平台路径获取接口
type pathManager interface {
	// AppDataRoot 返回应用配置根目录（不含 "YSM-Model-Manager" 子目录）
	AppDataRoot() (string, error)
	// DefaultRepoRoot 返回默认公共仓库根目录（不含类型子目录）。
	// desktop：空串（仓库路径由用户在设置页配置，不自动拼接）；
	// android：固定公共路径（如 /storage/emulated/0/YSM-Model-Manager），
	// 授权 MANAGE_EXTERNAL_STORAGE 后 os.* 直读（对齐 MikuMikuAR /sdcard/MMD 模式）
	DefaultRepoRoot() string
}

// pathMgr 包级单例（由平台文件 init 注入实现）
var pathMgr pathManager

// appDataRoot 委托平台实现；失败返回空串并明示原因（不静默降级为 "."——
// Android 上 "." 即 CWD=/ 不可写根，配置/日志将静默不落盘，P1 审核发现）。
// 调用方以空串区分处理（app_config.go 已有 `appData != ""` 守卫）。
func appDataRoot() string {
	if pathMgr == nil {
		return ""
	}
	dir, err := pathMgr.AppDataRoot()
	if err != nil || dir == "" {
		log.Printf("[pathmgr] AppDataRoot 失败: %v ——配置/日志落点不可用", err)
		return ""
	}
	return dir
}

// defaultRepoRoot 返回平台默认公共仓库根（无平台实现时为空）
func defaultRepoRoot() string {
	if pathMgr == nil {
		return ""
	}
	return pathMgr.DefaultRepoRoot()
}
