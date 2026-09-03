package installer

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
)

// InstallLock 防止安装操作与后台同步并发（sync 包复用同一把锁，见 sync.go——
// 原两包各自定义 installLock/syncLock 互不感知，watcher 同步与用户安装可并发
// Rename 同一 custom 目录文件 → 竞态/丢更新；ADR-056 统一为共享单锁）
var InstallLock sync.Mutex

// ErrPartialInstall 标记目录安装「部分成功」——目录已建、部分条目已落地，
// 但个别条目（文件拷贝/子目录递归）失败。与致命错误（目录创建/读取失败）区分：
// 致命错误触发整树回滚清理残渣；partial 错误保留已成功落地的兄弟文件，
// 让用户看到「哪些装上了、哪些没装上」，重装时只补失败项（R26 P3）。
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
// 禁用后缀剥离委托 types.StripDisableSuffix（单一事实来源）。
func isSupportedModelExt(src string) bool {
	ext := strings.ToLower(filepath.Ext(src))
	if types.IsDisableSuffix(src) {
		ext = strings.ToLower(filepath.Ext(types.StripDisableSuffix(src)))
	}
	return types.IsSupportedExt(ext)
}

// Install 安装模型到目标目录（支持链接模式）
func Install(src, customDir, filesRoot, linkMode string) error {
	InstallLock.Lock()
	defer InstallLock.Unlock()
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
		return types.AppError{Code: types.ErrUnsupportedFmt, Operation: "安装模型", SourcePath: src, Reason: "不支持的文件类型", Suggestion: "支持格式: " + strings.Join(types.AllExts(), " / ")}
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
func InstallDir(srcDir, dstDir, filesRoot, linkMode, rtype string) error {
	InstallLock.Lock()
	defer InstallLock.Unlock()
	return installDirAtLocked(srcDir, dstDir, "", filesRoot, linkMode, rtype)
}

// InstallDirRel 安装目录到 dstRoot/<relSlash>（保留仓库多层物理路径）。
// relSlash 须为正斜杠分隔的相对路径（如 "vendor/character/modelA"），
// 空字符串回退到 InstallDir 原语义（basename 落位）。
// 用于多层物理路径同步——避免目录级推送拍扁层级结构。
func InstallDirRel(srcDir, dstRoot, relSlash, filesRoot, linkMode, rtype string) error {
	InstallLock.Lock()
	defer InstallLock.Unlock()
	return installDirAtLocked(srcDir, dstRoot, relSlash, filesRoot, linkMode, rtype)
}

// InstallDirLocked 与 InstallDir 语义相同，但不重复加锁——供已持锁调用方使用。
func InstallDirLocked(srcDir, dstDir, filesRoot, linkMode, rtype string) error {
	return installDirAtLocked(srcDir, dstDir, "", filesRoot, linkMode, rtype)
}

// InstallDirRelLocked 与 InstallDirRel 语义相同，但不重复加锁——供 sync.PushResources
// 等整段持 InstallLock 的调用方使用（防重入死锁）。
func InstallDirRelLocked(srcDir, dstRoot, relSlash, filesRoot, linkMode, rtype string) error {
	return installDirAtLocked(srcDir, dstRoot, relSlash, filesRoot, linkMode, rtype)
}

// normalizeInstallDirPaths 目录安装前的路径归一化与安全守卫（原 installDirAtLocked 阶段 1-3 提纯）。
// 执行顺序：TrimSpace → cleanAbs → evalSymlinksOrKeep（防 symlink 绕过字符串守卫）→ 空值拒绝 →
// sameDir 死递归守卫 → ContainsMinecraftMarker(.minecraft 内) → filesRoot 非空时 IsInside(仓库内) 守卫。
// 任一守卫失败立即返回 types.AppError；通过则返回归一化后的 (srcDir, dstDir, filesRoot) 三元组，
// 后续逻辑直接消费这些归一化值，不再重复解析。
func normalizeInstallDirPaths(srcDir, dstDir, filesRoot string) (string, string, string, error) {
	srcDir = strings.TrimSpace(srcDir)
	dstDir = strings.TrimSpace(dstDir)
	if srcDir == "" || dstDir == "" {
		return "", "", "", types.AppError{Code: types.ErrInvalidParam, Operation: "安装目录", Reason: "参数为空", Suggestion: "请检查输入"}
	}
	srcDir = cleanAbs(srcDir)
	dstDir = cleanAbs(dstDir)

	// 符号链接绕过字符串守卫——paths.IsInside/ContainsMinecraftMarker
	// 不追踪 symlink（go/paths/safe.go:22 注释明确「调用方应先用 filepath.EvalSymlinks 解析」），
	// src/dst 若含指向仓库外的符号链接段，字符串守卫会误判安全。此处先解析真实路径再校验：
	// 存在的路径解析到目标，不存在的路径保留原样（目标目录尚未创建时 EvalSymlinks 失败属正常）
	srcDir = evalSymlinksOrKeep(srcDir)
	dstDir = evalSymlinksOrKeep(dstDir)
	if filesRoot != "" {
		filesRoot = evalSymlinksOrKeep(filesRoot)
	}

	// 死递归守卫——srcDir==dstDir 时 finalDst 成为 srcDir 的
	// 子目录，os.ReadDir(srcDir) 会列到它 → 递归建 …/repo/repo/… 无限下钻直到路径
	// 超长报错（当前调用方不触发，但属无守卫的定时炸弹）。src/dst 同目录直接拒绝。
	// 用 sameDir（SameFile 判定真实同目录）而非 strings.EqualFold：
	// EqualFold 在大小写敏感 FS（Linux）上会把 /repo/SRC 与 /repo/src 两个不同目录
	// 误判为相同而拒绝合法安装（adversarial BUG-4）；大小写不敏感 FS（Windows/macOS）
	// 由 SameFile 正确识别同目录。dstDir 尚不存在（全新安装）时 Lstat 失败 →
	// 与已存在的 srcDir 必不同，仅字符串完全相同时拒绝。
	if sameDir(srcDir, dstDir) {
		return "", "", "", types.AppError{Code: types.ErrInvalidParam, Operation: "安装目录", SourcePath: srcDir, Reason: "源目录与目标目录相同"}
	}

	// 验证 dstDir 在 .minecraft 内
	if !paths.ContainsMinecraftMarker(dstDir) {
		return "", "", "", types.AppError{Code: types.ErrInvalidPath, Operation: "安装目录", SourcePath: dstDir, Reason: "目标目录不在 .minecraft 路径内"}
	}
	// 验证 srcDir 在仓库目录内
	if filesRoot != "" {
		if err := paths.IsInside(filesRoot, srcDir); err != nil {
			return "", "", "", types.AppError{Code: types.ErrInvalidPath, Operation: "安装目录", SourcePath: srcDir, Reason: "源目录不在仓库目录内"}
		}
	}
	return srcDir, dstDir, filesRoot, nil
}

// resolveFinalDst 计算最终落位路径 finalDst（原 installDirAtLocked 阶段 4 提纯）。
// relInside 控制规则：
//   - 空字符串：finalDst = dstDir/<basename(srcDir)>（InstallDir 原语义，向后兼容）
//   - 非空    ：finalDst = dstDir/<relInside>（保留仓库多层物理路径）
//
// relInside 须为正斜杠分隔的干净相对路径，以下非法形态直接拒绝（防穿越 / 防 ADS）：
//   - 清洗后为 "." 或 ".."
//   - 以 "../" 开头（父目录穿越）
//   - 绝对路径（filepath.IsAbs）
//   - 含 Windows 盘符（VolumeName != ""，如 "C:foo" 被 NTFS 解析为 ADS 流路径）
//   - 原始字符串以 "/" 开头（正斜杠根路径，FromSlash 后在 Windows 仍判为相对但有根歧义）
func resolveFinalDst(srcDir, dstDir, relInside string) (string, error) {
	if relInside != "" {
		// 路径清洗：防 ".." 穿越、绝对路径、Windows 盘符相对路径（ADS 风险）
		rel := filepath.FromSlash(relInside)
		rel = filepath.Clean(rel)
		if rel == "." || rel == ".." ||
			strings.HasPrefix(rel, ".."+string(filepath.Separator)) ||
			filepath.IsAbs(rel) ||
			filepath.VolumeName(rel) != "" ||
			strings.HasPrefix(relInside, "/") {
			return "", types.AppError{Code: types.ErrInvalidPath, Operation: "安装目录", SourcePath: relInside, Reason: "相对路径非法（禁止 .. 穿越、绝对路径或盘符前缀）"}
		}
		return filepath.Join(dstDir, rel), nil
	}
	return filepath.Join(dstDir, filepath.Base(srcDir)), nil
}

// callInstallDirRecursiveWithRollback 调用 installDirRecursive，并在失败时按错误分级决策回滚（R26 P3）。
//
// 错误分级与回滚策略：
//   - ErrPartialInstall（条目级软失败）：**不**回滚。目录已建、部分条目已落地；
//     整树删除会误删已成功的兄弟文件（MMD 多 texture 场景可感知）。保留部分，
//     让用户看到「哪些装上了、哪些没装上」，重装时只补失败项。
//   - 其他错误（致命：checkDstSymlinkSegments / MkdirAll / ReadDir 失败）：仅本次新建
//     才回滚删除。已存在（重装/覆盖）时不整树删除，避免误删旧数据。
//
// 先记录 finalDst 本次安装前是否已存在：
//   - 已存在（重装/覆盖）：finalDst 可能含用户既有数据，MkdirAll 复用旧目录，失败时**不**整树删除，
//     否则误删旧数据（对齐 fileops.copyDirRecursive 的整树回滚口径，同时防覆盖场景误删）
//   - 不存在（全新安装）：致命失败时 os.RemoveAll(finalDst) 清理部分文件；回滚失败时返回复合错误
//     （fmt.Errorf("%w; 回滚失败: %w")），让调用方能区分「安装失败」与「安装失败+残渣残留」。
func callInstallDirRecursiveWithRollback(srcDir, finalDst, linkMode, rtype, filesRoot string) error {
	dstExisted := false
	if _, err := os.Stat(finalDst); err == nil {
		dstExisted = true
	} else if !os.IsNotExist(err) {
		log.Printf("[installer] 检查目标目录状态失败 %s: %v", finalDst, err)
	}
	if err := installDirRecursive(srcDir, finalDst, linkMode, rtype, filesRoot); err != nil {
		// 条目级软失败：保留已落地文件，不回滚（R26 P3）。
		// 旧实现无差别整树回滚，把已成功的兄弟文件一起删掉，MMD 多 texture 场景用户可感知。
		if errors.Is(err, ErrPartialInstall) {
			return err
		}
		// 致命错误：仅本次新建目录才回滚删除；回滚失败时记录明确警告并返回复合错误，
		// 让调用方能区分「安装失败」与「安装失败 + 回滚失败留残渣」两种状态
		if !dstExisted {
			if rmErr := os.RemoveAll(finalDst); rmErr != nil {
				log.Printf("[installer] 回滚删除失败 %s: %v（磁盘上可能留有部分文件）", finalDst, rmErr)
				return fmt.Errorf("%w; 回滚失败: %w", err, rmErr)
			}
		}
		return err
	}
	return nil
}

// installDirAtLocked 安装目录到目标位置。relInside 控制最终落位：
//   - 空字符串：finalDst = dstDir/<basename>（InstallDir 原语义，向后兼容）
//   - 非空    ：finalDst = dstDir/<relInside>（保留仓库多层物理路径）
//
// relInside 须为正斜杠分隔的干净相对路径，禁止 ".." 穿越和绝对路径。
func installDirAtLocked(srcDir, dstDir, relInside, filesRoot, linkMode, rtype string) error {
	var err error
	if srcDir, dstDir, filesRoot, err = normalizeInstallDirPaths(srcDir, dstDir, filesRoot); err != nil {
		return err
	}
	finalDst, err := resolveFinalDst(srcDir, dstDir, relInside)
	if err != nil {
		return err
	}
	// finalDst 落在 srcDir 内同样死递归（srcDir 与 dstDir
	// 不同但嵌套时，如 dstDir 是 srcDir 的子目录）——在递归入口再守一道。
	// 分工说明（R26 P4-3）：normalize 的 sameDir 守卫（L232）仅防 srcDir==dstDir
	// 完全相同；本守卫防 srcDir 是 finalDst 的祖先（嵌套）。两道守卫互补，
	// 均不可省：sameDir 不防嵌套，本守卫不防完全相同（finalDst=dstDir/<basename>
	// 严格是 dstDir 子路径，IsInside(srcDir, finalDst) 在 srcDir==dstDir 时
	// rel=="." 不触发越权，需 sameDir 兜底）。
	if paths.IsInside(srcDir, finalDst) == nil {
		return types.AppError{Code: types.ErrInvalidPath, Operation: "安装目录", SourcePath: finalDst, Reason: "目标目录位于源目录内（潜在死递归）"}
	}
	return callInstallDirRecursiveWithRollback(srcDir, finalDst, linkMode, rtype, filesRoot)
}

// sameDir 判断 srcDir 与 dstDir 是否指向同一目录。
// SameFile（dev+inode 比较）优先，避免 strings.EqualFold 在大小写敏感 FS 上的
// 假阳性（/repo/SRC 与 /repo/src 是不同目录却被 EqualFold 判同）。
// 任一侧不存在时退化为字符串相等比较——目录存在性不一致时二者必不同目录。
func sameDir(srcDir, dstDir string) bool {
	if si, err := os.Lstat(srcDir); err == nil {
		if di, err := os.Lstat(dstDir); err == nil {
			return os.SameFile(si, di)
		}
		return srcDir == dstDir
	}
	return srcDir == dstDir
}

// checkDstSymlinkSegments 校验目标路径父链中已存在的符号链接段不越出 .minecraft。
// finalDst 的叶子（本次新建）通常尚不存在、无法整路径 EvalSymlinks，故从叶子向上
// Lstat 逐段检查——若中间组件是指向 .minecraft 外已存在目录的 symlink，MkdirAll
// 会跟随它在真实位置创建目录并写入穿透（字符串守卫 ContainsMinecraftMarker 不追踪
// symlink，会被绕过）。与 src 侧条目级拦截同口径：命中 symlink 时 EvalSymlinks
// 解析真实路径后重新校验。
func checkDstSymlinkSegments(finalDst string) error {
	p := cleanAbs(finalDst)
	for {
		if fi, err := os.Lstat(p); err == nil && fi.Mode()&os.ModeSymlink != 0 {
			if resolved, err := filepath.EvalSymlinks(p); err == nil && !paths.ContainsMinecraftMarker(resolved) {
				return types.AppError{Code: types.ErrInvalidPath, Operation: "安装目录", SourcePath: p, Reason: "目标父链符号链接指向 .minecraft 外", Suggestion: "请移除指向外部目录的符号链接"}
			}
		}
		parent := filepath.Dir(p)
		if parent == p {
			return nil
		}
		p = parent
	}
}

// isAllowedEntryName 纯函数：判断目录条目文件名是否允许落地（原 installDirRecursive 内 isAllowed 闭包升格）。
// 两级过滤：
//  1. 硬黑名单：可执行文件类（.exe/.bat/.dll/.cmd/.scr/.pif/.com/.msi/.ps1/.vbs）即使 rtype 为空也拒绝，
//     防模型目录内嵌的 .exe 被拷进 .minecraft（BUG-3 修复）；
//  2. 注册表驱动白名单：types.InstallExtsFor(rtype) 从 resource_types.json 读取（EntityPlayer/ysm
//     等声明模型+纹理配套扩展名），空=全放行（仅受硬黑名单限制），新增类型改 JSON 无需改本函数。
func isAllowedEntryName(name, rtype string) bool {
	low := strings.ToLower(name)
	ext := filepath.Ext(low)
	switch ext {
	case ".exe", ".bat", ".dll", ".cmd", ".scr", ".pif", ".com", ".msi", ".ps1", ".vbs":
		return false
	}
	installExts := types.InstallExtsFor(rtype)
	if len(installExts) == 0 {
		return true
	}
	for _, e := range installExts {
		if ext == e {
			return true
		}
	}
	return false
}

// applyInstallFileByMode 按 linkMode 分发单个文件到落地层（纯分发，无日志）。
// 与 InstallLocked 阶段 5 三分支同口径，为 installDirRecursive 循环提供单一入口。
// copyFileLocked 返回 (string, error)，其它返回 error，统一收口为 error。
func applyInstallFileByMode(srcFile, dstDir, linkMode string) error {
	switch linkMode {
	case "hardlink":
		return linkOrCopyLocked(srcFile, dstDir)
	case "symlink":
		return symlinkOrCopyLocked(srcFile, dstDir)
	default:
		_, err := copyFileLocked(srcFile, dstDir)
		return err
	}
}

// installSingleDirEntry 处理 installDirRecursive 主循环中的单个 DirEntry（循环体提纯）。
// 包含四个语义阶段：子目录递归 / 文件名白黑名单过滤 / 条目级 symlink 越权逃逸守卫 / 按 linkMode 落地。
// errs 由调用方传指针（in-place append），条目内部分失败仅记录、不打断整体遍历；
// 子目录分支递归调用 installDirRecursive，保持原深度优先顺序不变。
func installSingleDirEntry(entry os.DirEntry, srcDir, finalDst, linkMode, rtype, filesRoot string, errs *[]error) {
	name := entry.Name()
	if entry.IsDir() {
		// 递归处理子目录（MMD 的 spa/textures/toon 等深层子文件夹）
		subSrc := filepath.Join(srcDir, name)
		subDst := filepath.Join(finalDst, name)
		if err := installDirRecursive(subSrc, subDst, linkMode, rtype, filesRoot); err != nil {
			log.Printf("[installer] 递归安装 %s 失败: %v (继续)", subSrc, err)
			*errs = append(*errs, fmt.Errorf("%s: %w", name, err))
		}
		return
	}
	if !isAllowedEntryName(name, rtype) {
		return
	}
	srcFile := filepath.Join(srcDir, name)
	// 条目级符号链接逃逸——仓库内若存在指向仓库外的 symlink
	// （DirEntry.IsDir 对 symlink 恒为 false，指向仓库外目录的 symlink 也会落到本分支），
	// linkMode=symlink 时会把指向仓库外的链接直接落进游戏目录。解析真实路径后按
	// paths.IsInside(filesRoot, …) 校验（与 Install 的 src 守卫同口径），越权则跳过并记录；
	// EvalSymlinks 失败（断链/不存在）时保持放行，交给下方落地逻辑按原语义处理
	if fi, err := os.Lstat(srcFile); err == nil && fi.Mode()&os.ModeSymlink != 0 {
		if resolved, err := filepath.EvalSymlinks(srcFile); err == nil {
			if filesRoot != "" {
				if err := paths.IsInside(filesRoot, resolved); err != nil {
					log.Printf("[installer] 跳过越权符号链接条目 %s (真实目标 %s 不在仓库内): %v", srcFile, resolved, err)
					return
				}
			}
		}
	}
	if err := applyInstallFileByMode(srcFile, finalDst, linkMode); err != nil {
		log.Printf("[installer] 安装文件 %s 失败: %v (继续)", srcFile, err)
		// 条目级软失败用 ErrPartialInstall 包装标记，让父级 installDirRecursive
		// 分级时正确识别为 partial（code_review P1-2 修正）。
		*errs = append(*errs, fmt.Errorf("%w: %s: %w", ErrPartialInstall, name, err))
	}
}

// installDirRecursive 递归安装目录树
//
// 错误分级（R26 P3）：
//   - 致命错误（checkDstSymlinkSegments / MkdirAll / ReadDir 失败）：直接 return，
//     上层 callInstallDirRecursiveWithRollback 据此触发整树回滚清理残渣。
//   - 条目级软失败（单个文件拷贝失败、子目录递归部分失败）：收集到 errs，
//     返回 ErrPartialInstall 包装错误；上层据此**不**回滚——已成功落地的兄弟文件保留，
//     让用户看到「哪些装上了、哪些没装上」，重装时只补失败项。
func installDirRecursive(srcDir, finalDst, linkMode, rtype, filesRoot string) error {
	// 目标侧符号链接段校验——必须放在 MkdirAll 之前：MkdirAll 会跟随 symlink
	// 在真实位置建目录，若 finalDst 父链含指向 .minecraft 外的 symlink 段，
	// 先校验拒绝、避免写入穿透
	if err := checkDstSymlinkSegments(finalDst); err != nil {
		return err
	}
	// 目标子目录名 = 源文件夹名
	if err := os.MkdirAll(finalDst, fsutil.DirPerms); err != nil {
		return types.AppError{Code: types.ErrIO, Operation: "安装目录", TargetPath: finalDst, Reason: "无法创建目标目录"}
	}
	// 校验目标也在 .minecraft 内
	finalDst = cleanAbs(finalDst)
	if !paths.ContainsMinecraftMarker(finalDst) {
		return types.AppError{Code: types.ErrInvalidPath, Operation: "安装目录", SourcePath: finalDst, Reason: "目标子目录不在 .minecraft 路径内"}
	}

	entries, err := os.ReadDir(srcDir)
	if err != nil {
		log.Printf("[installer] readdir 失败 %s: %v", srcDir, err)
		return err
	}
	var errs []error
	for _, entry := range entries {
		installSingleDirEntry(entry, srcDir, finalDst, linkMode, rtype, filesRoot, &errs)
	}
	if len(errs) > 0 {
		// 分级 errs：fatal（非 ErrPartialInstall）直接返回，让上层触发整树回滚；
		// 全都是 partial 时才包装为 ErrPartialInstall（保留已落地兄弟文件）。
		// code_review P1-2 修正：旧实现统一包装为 ErrPartialInstall，
		// 子目录 MkdirAll/ReadDir 失败被误分类为 partial，跳过整树回滚，
		// 留下半截损坏目录树。
		var fatalErr error
		allPartial := true
		for _, e := range errs {
			if !errors.Is(e, ErrPartialInstall) {
				fatalErr = e
				allPartial = false
				break
			}
		}
		if !allPartial && fatalErr != nil {
			return fmt.Errorf("安装目录 %s 致命失败: %w", srcDir, fatalErr)
		}
		// 条目级软失败：用 ErrPartialInstall 标记，让上层保留已落地文件而非整树回滚。
		// 文案含「部分失败」子串以兼容旧测试断言（strings.Contains(err, "部分失败")）。
		return fmt.Errorf("%w: 安装目录 %s 部分失败: %w", ErrPartialInstall, srcDir, errors.Join(errs...))
	}
	return nil
}

// InstallToGlobal 安装到全局 custom 目录
func InstallToGlobal(src, mcRoot string) (string, error) {
	InstallLock.Lock()
	defer InstallLock.Unlock()

	if src == "" || mcRoot == "" {
		return "", types.AppError{Code: types.ErrInvalidParam, Operation: "安装到全局", Reason: "参数为空", Suggestion: "请检查输入"}
	}
	mcRoot = cleanAbs(mcRoot)
	if !paths.ContainsMinecraftMarker(mcRoot) {
		return "", types.AppError{Code: types.ErrInvalidPath, Operation: "安装到全局", SourcePath: mcRoot, Reason: "目标不在 .minecraft 路径内", Suggestion: "请确保 .minecraft 目录路径正确"}
	}
	src = cleanAbs(src)
	if !isSupportedModelExt(src) {
		return "", types.AppError{Code: types.ErrUnsupportedFmt, Operation: "安装到全局", SourcePath: src, Reason: "不支持的文件类型", Suggestion: "支持格式: " + strings.Join(types.AllExts(), " / ")}
	}
	// 固定布局约定：YSM mod 的全局模型目录固定在 config/yes_steve_model/custom（mod 加载约定），
	// 非用户可配置项；多实例根场景由上层传入具体 mcRoot，此处仅拼接布局。
	// ADR-064 锚定：路径走注册表 SubDirMap（原硬编码，YSM scanDir 变更时失联）
	customDir := filepath.Join(mcRoot, types.SubDirMap("ysm"))
	if err := os.MkdirAll(customDir, fsutil.DirPerms); err != nil {
		return "", types.AppError{Code: types.ErrIO, Operation: "安装到全局", TargetPath: customDir, Reason: "无法创建安装目录", Suggestion: "请检查磁盘权限或空间"}
	}
	return copyFileLocked(src, customDir)
}

// InstallWithOverlay 带冲突检查的安装
// 注意（R25 P4-1）：无 filesRoot 参数 → src 无仓库内 IsInside 守卫（目标侧有
// .minecraft 守卫，源侧仅靠调用方约束）；前端已 0 消费（Deprecated 绑定，
// 上层 InstallModelWithOverlay 仅兼容旧绑定面），待发版清理。
func InstallWithOverlay(src, customDir string) (string, error) {
	InstallLock.Lock()
	defer InstallLock.Unlock()

	if src == "" || customDir == "" {
		return "", types.AppError{Code: types.ErrInvalidParam, Operation: "安装模型（覆盖检查）", Reason: "参数为空", Suggestion: "请检查输入"}
	}
	src = cleanAbs(src)
	customDir = cleanAbs(customDir)
	if !paths.ContainsMinecraftMarker(customDir) {
		return "", types.AppError{Code: types.ErrInvalidPath, Operation: "安装模型（覆盖检查）", SourcePath: customDir, Reason: "目标目录不在 .minecraft 路径内", Suggestion: "请确保整合包的 custom 目录位于 .minecraft 内"}
	}
	if !isSupportedModelExt(src) {
		return "", types.AppError{Code: types.ErrUnsupportedFmt, Operation: "安装模型（覆盖检查）", SourcePath: src, Reason: "不支持的文件格式", Suggestion: "仅支持 " + strings.Join(types.AllExts(), " / ") + " 格式"}
	}
	if err := os.MkdirAll(customDir, fsutil.DirPerms); err != nil {
		return "", types.AppError{Code: types.ErrIO, Operation: "安装模型（覆盖检查）", TargetPath: customDir, Reason: "无法创建目录", Suggestion: "请检查磁盘权限或空间"}
	}
	// 防覆盖检查：在 InstallLock 临界区内先检查后写入（同一锁内天然原子，无 TOCTOU 窗口）。
	// 不能把检查下沉到 copyFileLocked —— 那会破坏 Install/RelinkDir 的覆盖替换语义
	dst := filepath.Join(customDir, filepath.Base(src))
	if _, err := os.Stat(dst); err == nil {
		return "CONFLICT:" + dst, types.AppError{Code: types.ErrAlreadyExists, Operation: "安装模型（覆盖检查）", TargetPath: dst, Reason: "文件已存在", Suggestion: "如需覆盖请先删除原文件"}
	}
	return copyFileLocked(src, customDir)
}

// copyFileLocked 复制文件到目标目录（调用方须持有 InstallLock，禁止直接调用）。
// 委托 fsutil.CopyFile（ADR-044 收敛：原子 tmp+rename + Sync + Chmod 0644 +
// 目录源前置拒绝 + 读毕早关 src），复用其步骤类型化错误 StepError，把差异化
// UI 文案留在本层 mapStepToAppError——机制归 fsutil、文案归 installer，职责分层不破。
func copyFileLocked(src, dstDir string) (string, error) {
	src = cleanAbs(src)
	dstDir = cleanAbs(dstDir)
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return "", err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	if src == dst {
		return dst, nil
	}
	if err := fsutil.CopyFile(src, dst); err != nil {
		var se *fsutil.StepError
		if errors.As(err, &se) {
			return "", mapStepToAppError(se.Step, src, dst, se.Err)
		}
		// 非 StepError（正常不会发生，防御兜底）
		return "", types.AppError{Code: types.ErrIO, Operation: "复制文件", SourcePath: src, TargetPath: dst, Reason: "复制文件失败", Suggestion: "请重试或检查磁盘状态"}
	}
	return dst, nil
}

// mapStepToAppError 将 fsutil.StepError 的中性步骤名映射为 installer 的差异化
// AppError 文案（与收敛前 copyFileLocked 六档逐字一致，回归护栏见 TestMapStepToAppError）。
// 纯函数表：只读输入 → 只出输出，不含任何 IO。
func mapStepToAppError(step, src, dst string, err error) types.AppError {
	base := types.AppError{Code: types.ErrIO, Operation: "复制文件", SourcePath: src, TargetPath: dst}
	switch step {
	case fsutil.StepStat, fsutil.StepOpen:
		base.Reason, base.Suggestion = "无法读取源文件", "请检查文件是否被占用或已删除"
	case fsutil.StepCloseSrc:
		base.Reason, base.Suggestion = "源文件读取未正常完成", "请检查文件访问权限"
	case fsutil.StepMkdir:
		base.Reason, base.Suggestion = "无法创建目录", "请检查磁盘权限或空间"
	case fsutil.StepCreateTmp:
		base.Reason, base.Suggestion = "无法创建临时文件", "请检查磁盘空间或权限"
	case fsutil.StepCopy:
		base.Reason, base.Suggestion = "写入临时文件失败", "请检查磁盘空间或权限"
	case fsutil.StepSync:
		base.Reason, base.Suggestion = "临时文件落盘失败", "请检查磁盘空间或权限"
	case fsutil.StepClose:
		base.Reason, base.Suggestion = "临时文件写入未完成", "请检查磁盘空间或权限"
	case fsutil.StepChmod:
		base.Reason, base.Suggestion = "设置文件权限失败", "请检查目标位置权限"
	case fsutil.StepRename:
		base.Operation = "安装模型"
		base.Reason, base.Suggestion = "替换目标文件失败", "请检查目标文件是否被占用或为只读"
	default:
		base.Reason, base.Suggestion = "复制文件失败", "请重试或检查磁盘状态"
	}
	return base
}

// CopyFile 复制文件到目标目录（带互斥锁）
func CopyFile(src, dstDir string) (string, error) {
	InstallLock.Lock()
	defer InstallLock.Unlock()
	return CopyFileLocked(src, dstDir)
}

// CopyFileLocked 复制文件到目标目录（调用方须已持有 InstallLock，禁止直接调用）。
// 语义与 CopyFile 一致，但不重复加锁——供 sync.RelinkDir 等已持锁调用方使用（防重入死锁）。
func CopyFileLocked(src, dstDir string) (string, error) {
	return copyFileLocked(src, dstDir)
}

// linkOrCopyLocked 以硬链接落地 src 到 dstDir（调用方须持有 InstallLock，禁止直接调用）；
// 目标已存在时：
//   - 同源（已是到 src 的硬链接）→ 幂等返回
//   - 不同源（旧副本/旧版本）→ 先建临时链接再原子替换，失败不破坏原文件
func linkOrCopyLocked(src, dstDir string) error {
	src = cleanAbs(src)
	dstDir = cleanAbs(dstDir)
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	// hardlink 模式：wantSymlink=false——目标若是指向 src 的符号链接则视为不同源，强制转硬链接
	if same, err := sameSource(src, dst, false); err == nil && same {
		return nil
	}
	tmp := dst + ".link-tmp"
	_ = os.Remove(tmp)
	if err := os.Link(src, tmp); err != nil {
		return linkErr(src, dst, err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return types.AppError{Code: types.ErrIO, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "替换目标文件失败", Suggestion: "请检查目标文件是否被占用或为只读"}
	}
	return nil
}

// linkOrCopy 以硬链接落地 src 到 dstDir（带互斥锁）
func linkOrCopy(src, dstDir string) error {
	InstallLock.Lock()
	defer InstallLock.Unlock()
	return linkOrCopyLocked(src, dstDir)
}

// symlinkOrCopyLocked 以符号链接落地 src 到 dstDir（调用方须持有 InstallLock，禁止直接调用）；
// 目标已存在时与 linkOrCopyLocked 同语义
func symlinkOrCopyLocked(src, dstDir string) error {
	src = cleanAbs(src)
	dstDir = cleanAbs(dstDir)
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return err
	}
	// os.Symlink 不要求目标存在，src 缺失时会创建悬空链接并静默返回 nil——
	// 先显式校验 src 存在，缺失时报错而非留下悬空链接
	if _, err := os.Stat(src); err != nil {
		return types.AppError{Code: types.ErrIO, Operation: "创建符号链接",
			SourcePath: src, Reason: "源文件不存在", Suggestion: "请检查模型文件是否已被删除"}
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	// symlink 模式：wantSymlink=true——目标若是硬链接则视为不同源，强制转符号链接
	if same, err := sameSource(src, dst, true); err == nil && same {
		return nil
	}
	tmp := dst + ".symlink-tmp"
	_ = os.Remove(tmp)
	if err := os.Symlink(src, tmp); err != nil {
		return symlinkErr(src, dst, err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return types.AppError{Code: types.ErrIO, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "替换目标文件失败", Suggestion: "请检查目标文件是否被占用或为只读"}
	}
	return nil
}

// symlinkOrCopy 以符号链接落地 src 到 dstDir（带互斥锁）
func symlinkOrCopy(src, dstDir string) error {
	InstallLock.Lock()
	defer InstallLock.Unlock()
	return symlinkOrCopyLocked(src, dstDir)
}

// sameSource 判断 dst 是否已是 src 的有效落地点（同一文件 / 指向 src 的链接）。
// wantSymlink：hardlink 模式传 false（要求 dst 非符号链接）、symlink 模式传 true
// （要求 dst 是符号链接）——P2 修复（子代理审计）：原实现只用 os.Stat+SameFile，
// 对「dst 是指向 src 的 symlink」与「dst 是 src 的 hardlink」无法区分，hardlink 模式
// 遇 symlink 静默放行不转换、symlink 模式遇 hardlink 也放行，linkMode 语义不落地。
// 不存在、断链或内容不同的旧副本均返回 false 语义（err != nil 或 !same）
func sameSource(src, dst string, wantSymlink bool) (bool, error) {
	dstInfo, err := os.Lstat(dst)
	if err != nil {
		return false, err
	}
	// 链接类型匹配：hardlink 模式拒绝符号链接目标（需转为硬链接）、
	// symlink 模式要求目标是符号链接（硬链接需转为符号链接）
	if wantSymlink != (dstInfo.Mode()&os.ModeSymlink != 0) {
		return false, nil
	}
	si, err := os.Stat(src)
	if err != nil {
		return false, err
	}
	di, err := os.Stat(dst)
	if err != nil {
		return false, err
	}
	return os.SameFile(si, di), nil
}

// errnoIs 按平台匹配 errno：Windows 用 Win32 错误码（如 ERROR_NOT_SAME_DEVICE=17），
// Unix 用 POSIX errno（如 EXDEV=18）——两端语义不同，必须分平台判断
func errnoIs(err error, unix, win int) bool {
	if runtime.GOOS == "windows" {
		return errors.Is(err, syscall.Errno(win))
	}
	return errors.Is(err, syscall.Errno(unix))
}

// linkErr 将硬链接错误分类为可操作的提示
func linkErr(src, dst string, err error) error {
	// errno 优先：跨设备（Unix EXDEV=18 / Win ERROR_NOT_SAME_DEVICE=17）、
	// 权限（Unix EACCES=13 / EPERM=1，Win ERROR_ACCESS_DENIED=5）
	if fsutil.IsCrossDeviceErr(err) {
		return types.AppError{Code: types.ErrLinkFailed, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "仓库与游戏目录在不同分区，不支持硬链接", Suggestion: "请在设置中切换为复制模式"}
	}
	if errnoIs(err, 13, 5) || errnoIs(err, 1, 5) {
		return types.AppError{Code: types.ErrLinkFailed, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "权限不足，无法创建硬链接", Suggestion: "请以管理员身份运行，或在设置中切换为复制模式"}
	}
	// errno 未命中的异常错误直落通用提示（文本兜底已删——陷阱 #11 禁止文本匹配错误分类；
	// errors.Is 可链式穿透 LinkError/PathError，errno 判定已覆盖主路径）
	return types.AppError{Code: types.ErrLinkFailed, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "硬链接失败", Suggestion: "请在设置中切换为复制模式"}
}

// symlinkErr 将符号链接错误分类为可操作的提示
func symlinkErr(src, dst string, err error) error {
	// errno 优先：权限（Unix EPERM=1 / EACCES=13，Win ERROR_PRIVILEGE_NOT_HELD=1314 / ERROR_ACCESS_DENIED=5）
	if errnoIs(err, 1, 1314) || errnoIs(err, 13, 5) {
		return types.AppError{Code: types.ErrLinkFailed, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "创建符号链接需要管理员权限", Suggestion: "请以管理员身份运行，或在设置中切换为复制模式"}
	}
	// 文本兜底已删（陷阱 #11），errno 未命中直落通用提示
	return types.AppError{Code: types.ErrLinkFailed, Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "符号链接失败", Suggestion: "请在设置中切换为复制模式"}
}

// IsValidRepoRoot 禁止选择系统敏感目录作为仓库
// 跨平台实现：禁止根目录、系统关键目录
func IsValidRepoRoot(path string) bool {
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return false
	}

	// 禁止任何盘符根目录（Windows）和根目录 /
	for _, root := range []string{"/", "\\"} {
		if abs == root || strings.TrimRight(abs, "\\/") == "" {
			return false
		}
	}
	// Windows 盘符根目录（C:\ D:\ 等）
	if len(abs) >= 3 && abs[1] == ':' && (abs[2] == '\\' || abs[2] == '/') && len(abs) == 3 {
		return false
	}

	// 系统关键目录（按平台）
	absLower := strings.ToLower(abs) + string(filepath.Separator)
	var forbidden []string
	if runtime.GOOS == "windows" {
		// Windows 系统目录——按目标所在盘符动态拼前缀（VolumeName），而非枚举 c:/d:/e:
		// （原枚举漏掉 F: 等盘上的 windows/program files）
		vol := strings.ToLower(filepath.VolumeName(abs))
		if vol != "" {
			prefix := vol + string(filepath.Separator)
			forbidden = append(forbidden,
				prefix+"windows"+string(filepath.Separator),
				prefix+"program files"+string(filepath.Separator),
				prefix+"program files (x86)"+string(filepath.Separator),
			)
		}
	} else {
		// Linux/macOS 系统目录
		forbidden = []string{
			"/etc" + string(filepath.Separator),
			"/usr" + string(filepath.Separator),
			"/bin" + string(filepath.Separator),
			"/sbin" + string(filepath.Separator),
			"/var" + string(filepath.Separator),
			"/dev" + string(filepath.Separator),
			"/proc" + string(filepath.Separator),
			"/sys" + string(filepath.Separator),
			"/System" + string(filepath.Separator),
			"/private" + string(filepath.Separator),
		}
	}

	for _, f := range forbidden {
		if strings.HasPrefix(absLower, f) || strings.EqualFold(abs, strings.TrimRight(f, string(filepath.Separator))) {
			return false
		}
	}

	return true
}
