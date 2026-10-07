// installer.go：安装锁 + 单文件安装主入口（原 installer.go 拆分，2026-10 文件行数治理）。
// 2026-10 拆分：原 819 行按职责分为 installer.go（本文件：锁 + Install）/
// installer_dir.go（目录安装）/ installer_file.go（文件安装与错误映射）。
package installer

import (
	"errors"
	"log"
	"path/filepath"
	"strings"
	"sync"

	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// InstallLock 防止安装操作与后台同步并发（sync 包复用同一把锁，见 sync.go——
// 原两包各自定义 installLock/syncLock 互不感知，watcher 同步与用户安装可并发
// Rename 同一 custom 目录文件 → 竞态/丢更新；ADR-056 统一为共享单锁）。
// 使用 LockTracker（非裸 sync.Mutex）——owner 追踪使 HasLock() 能精确区分
// 「本 goroutine 持有」与「他人持有」，消除 *Locked 断言的 TryLock 误判窗口。
var InstallLock LockTracker

// InstallLocker 是 InstallLock 的可换入口（ADR-202 刀3）：
// 生产默认实现恒为全局 InstallLock（语义零变化，所有消费点经它加锁）；
// 锁协议测试可注入 stub（t.Cleanup 恢复），使持锁/非重入断言确定性触发，
// 不再依赖「真实全局锁 + goroutine + 超时」的脆弱编排（685829f70 类补丁）。
// ⚠️ 生产代码不得重赋值此变量。
var InstallLocker sync.Locker = &InstallLock

// ErrPartialInstall 标记目录安装「部分成功」——目录已建、部分条目已落地，
// 但个别条目（文件拷贝/子目录递归）失败。与致命错误（目录创建/读取失败）区分：
// 致命错误触发整树回滚清理残渣；partial 错误保留已成功落地的兄弟文件，
// 让用户看到「哪些装上了、哪些没装上」，重装时只补失败项。
var ErrPartialInstall = errors.New("部分安装失败")

// cleanAbs 封装 filepath.Abs(filepath.Clean(path))
func cleanAbs(path string) string {
	p, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		log.Printf("[installer] 解析路径失败 %s: %v", path, err)
		return path
	}
	return p
}

// isSupportedModelExt 判断模型文件扩展名是否受支持（含禁用后缀变体）
// 禁用后缀剥离委托 registry.StripDisableSuffix（单一事实来源）。
func isSupportedModelExt(src string) bool {
	ext := strings.ToLower(filepath.Ext(src))
	if registry.IsDisableSuffix(src) {
		ext = strings.ToLower(filepath.Ext(registry.StripDisableSuffix(src)))
	}
	return registry.IsSupportedExt(ext)
}

// Install 安装模型到目标目录（支持链接模式）
func Install(src, customDir, filesRoot, linkMode string) error {
	InstallLocker.Lock()
	defer InstallLocker.Unlock()
	return InstallLocked(src, customDir, filesRoot, linkMode)
}

// validateInstallPaths 单文件安装前的双向路径安全守卫（原 InstallLocked 阶段 2 提纯）。
// 共四道守卫，顺序与语义严格保持与拆分前一致：
//  1. customClean：直接字符串 ContainsMinecraftMarker（防穿越到 .minecraft 外）
//  2. customClean：filepath.EvalSymlinks 解析真实路径后再次 ContainsMinecraftMarker
//     （防 symlink 段绕过字符串守卫，EvalSymlinks 失败属正常——路径不存在时保持原守卫结论）
//  3. filesRoot 非空时：IsInside(filesRoot, srcClean) —— 验证 src 在仓库目录内（防任意文件写入）
//  4. filesRoot 非空时：EvalSymlinks(srcClean) + EvalSymlinks(filesRoot) 后再次 IsInside
//     （防 src/filesRoot 两侧任一方 symlink 段绕过；Windows 下短名 ZHUJIE~1 与长名混用
//     导致 IsInside 误判越权，两侧必须同步归一化到长名；任一侧失败保持原结论不放宽）
//
// 参数 src / customDir 传原始未 trim 字符串仅用于 AppError SourcePath 字段显示，
// 不参与校验计算（校验使用 srcClean / customClean / filesRoot 归一化值）。
func validateInstallPaths(srcClean, customClean, filesRoot, src, customDir string) error {
	// 验证 customDir 在 .minecraft 内（防路径穿越）
	if !paths.ContainsMinecraftMarker(customClean) {
		return types.AppError{Code: types.ErrInvalidPath, Operation: "安装模型", SourcePath: customDir, Reason: "目标目录不在 .minecraft 路径内", Suggestion: "请确保整合包的 custom 目录位于 .minecraft 内"}
	}
	// 防符号链接段绕过字符串守卫——ContainsMinecraftMarker 不追踪
	// symlink（safe.go:52 注释要求调用方解析），customDir 若含指向 .minecraft 外的符号链接段，
	// 字符串守卫会误判安全。解析真实路径后重新校验；EvalSymlinks 失败（路径不存在）时
	// 保持原校验结果不放宽不放窄（原守卫已通过则继续）
	if resolvedCustom, err := filepath.EvalSymlinks(customClean); err == nil {
		if !paths.ContainsMinecraftMarker(resolvedCustom) {
			return types.AppError{Code: types.ErrInvalidPath, Operation: "安装模型", SourcePath: customDir, Reason: "目标目录不在 .minecraft 路径内", Suggestion: "请确保整合包的 custom 目录位于 .minecraft 内"}
		}
	}

	// 验证 src 在仓库目录内（防任意文件写入）
	if filesRoot != "" {
		if err := paths.IsInside(filesRoot, srcClean); err != nil {
			return types.AppError{Code: types.ErrInvalidPath, Operation: "安装模型", SourcePath: src, Reason: "源文件不在仓库目录内", Suggestion: "请确保模型文件位于已选择的仓库目录中"}
		}
		// 防符号链接段绕过字符串守卫——IsInside 不追踪 symlink
		// （safe.go:21 注释要求调用方解析），src 若含指向仓库外的符号链接段会误判安全。
		// 解析真实路径后重新校验；base 也须同步解析——Windows 下 cleanAbs 可能产出 8.3 短名
		// （如 ZHUJIE~1）而 EvalSymlinks 归一化为长名，短/长名混比会让 IsInside 误判越权。
		// 任一侧 EvalSymlinks 失败（路径不存在）时保持原校验结果不放宽不放窄
		if resolvedSrc, err := filepath.EvalSymlinks(srcClean); err == nil {
			if resolvedFiles, err := filepath.EvalSymlinks(filesRoot); err == nil {
				if err := paths.IsInside(resolvedFiles, resolvedSrc); err != nil {
					return types.AppError{Code: types.ErrInvalidPath, Operation: "安装模型", SourcePath: src, Reason: "源文件不在仓库目录内", Suggestion: "请确保模型文件位于已选择的仓库目录中"}
				}
			}
		}
	}
	return nil
}

// resolveInstallTargetDir 计算实际落地目录 targetDir（原 InstallLocked 阶段 4 提纯）。
// 规则：filesRoot 为空 → targetDir = customDir（不保留仓库层级，直接落到 customDir）；
// filesRoot 非空 → 用 filepath.Rel 计算 srcClean 相对仓库根的子路径 rel，取 Dir(rel)
// 作为相对子目录拼到 customDir 下（保持仓库内目录结构，避免 /repo/aaa/bbb.pmodel
// 直接落 custom/bbb.pmodel 与 /repo/ccc/bbb.pmodel 同名覆盖）。
// 拼出的 targetDir 再走 cleanAbs + ContainsMinecraftMarker 守卫（子目录也必须在 .minecraft 内）。
// filepath.Rel 失败（如跨盘符/跨根）时静默回退 customDir，不抛错——fail-soft 不影响主流程。
func resolveInstallTargetDir(srcClean, customDir, filesRoot, customClean string) (string, error) {
	targetDir := customDir
	if filesRoot != "" {
		absFiles := cleanAbs(filesRoot)
		rel, err := filepath.Rel(absFiles, srcClean)
		if err == nil {
			relDir := filepath.Dir(rel)
			if relDir != "." {
				targetDir = filepath.Join(customDir, relDir)
				// 再次校验子目录也在 .minecraft 内
				targetDir = cleanAbs(targetDir)
				if !paths.ContainsMinecraftMarker(targetDir) {
					return "", types.AppError{Code: types.ErrInvalidPath, Operation: "安装模型", SourcePath: targetDir, Reason: "子目录不在 .minecraft 路径内", Suggestion: "请确保整合包的 custom 目录位于 .minecraft 内"}
				}
			}
		}
	}
	return targetDir, nil
}

// InstallLocked 安装模型到目标目录（调用方须已持有 InstallLock，禁止直接调用）。
// 语义与 Install 一致，但不重复加锁——供 sync.RelinkDir 等已持锁调用方使用（防重入死锁）。
func InstallLocked(src, customDir, filesRoot, linkMode string) error {
	src = strings.TrimSpace(src)
	customDir = strings.TrimSpace(customDir)
	if src == "" || customDir == "" {
		return types.AppError{Code: types.ErrInvalidParam, Operation: "安装模型", Reason: "参数为空", Suggestion: "请检查输入"}
	}

	srcClean := cleanAbs(src)
	customClean := cleanAbs(customDir)
	if err := validateInstallPaths(srcClean, customClean, filesRoot, src, customDir); err != nil {
		return err
	}
	if !isSupportedModelExt(src) {
		return types.AppError{Code: types.ErrUnsupportedFmt, Operation: "安装模型", SourcePath: src, Reason: "不支持的文件类型", Suggestion: "支持格式: " + strings.Join(registry.AllExts(), " / ")}
	}
	// 计算相对路径，保持目录结构
	// 上方 IsInside 已 fail-fast 保证 srcClean 在仓库内，此处直接用 Clean 后路径算 rel，
	// 不用 HasPrefix 二次判断（无分隔符边界校验，/repo 会误匹配 /repository）
	targetDir, err := resolveInstallTargetDir(srcClean, customDir, filesRoot, customClean)
	if err != nil {
		return err
	}
	return applyInstallFileByMode(src, targetDir, linkMode)
}

// evalSymlinksOrKeep 解析路径中的符号链接段（真实路径），失败时保留原路径。
// paths.IsInside/ContainsMinecraftMarker 不追踪 symlink
// （safe.go:22 注释要求调用方解析）；存在路径解析到目标，不存在路径（目标尚未创建）
// 保留原样——EvalSymlinks 对不存在路径返回错误属正常，不拦截。
func evalSymlinksOrKeep(p string) string {
	if resolved, err := filepath.EvalSymlinks(p); err == nil {
		return resolved
	}
	return p
}

// InstallDir 安装整个目录下的所有文件到目标目录。
// 目录级类型（EntityPlayer/maid-model 等）使用此函数——它会将 srcDir 的
// 所有文件/子目录按类型白名单过滤后复制（或硬链接/克隆）到 dstDir/<basename>。
// 多层物理路径场景请使用 InstallDirRel 保留仓库层级。
// rtype 用于过滤文件类型（如 MMD 排除 .vrm）。
