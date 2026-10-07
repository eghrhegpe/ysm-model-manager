// installer_dir.go：目录安装（原 installer.go 拆分，2026-10 文件行数治理）。
// InstallDir / InstallDirLocked / installDirRecursive / installDirAtLocked——
// 目录型资源（MMD/VRM 等）安装到仓库根，含 rollback 与 symlink 段校验。
package installer

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func InstallDir(srcDir, dstDir, filesRoot, linkMode, rtype string) error {
	InstallLocker.Lock()
	defer InstallLocker.Unlock()
	return installDirAtLocked(srcDir, dstDir, "", filesRoot, linkMode, rtype)
}

// InstallDirRel 安装目录到 dstRoot/<relSlash>（保留仓库多层物理路径）。
// relSlash 须为正斜杠分隔的相对路径（如 "vendor/character/modelA"），
// 空字符串回退到 InstallDir 原语义（basename 落位）。
// 用于多层物理路径同步——避免目录级推送拍扁层级结构。
func InstallDirRel(srcDir, dstRoot, relSlash, filesRoot, linkMode, rtype string) error {
	InstallLocker.Lock()
	defer InstallLocker.Unlock()
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

// callInstallDirRecursiveWithRollback 调用 installDirRecursive，并在失败时按错误分级决策回滚。
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
	// 顶层入口：rtype 整树恒定，预计算一次安装扩展名白名单透传递归链，
	// 避免每条目都经 registry.InstallExtsFor 重新加锁扫描（大目录树 N 次锁竞争）。
	installExts := registry.InstallExtsFor(rtype)
	if err := installDirRecursive(srcDir, finalDst, linkMode, rtype, filesRoot, installExts); err != nil {
		// 条目级软失败：保留已落地文件，不回滚。
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
	// normalize 的 sameDir 守卫（L232）仅防 srcDir==dstDir
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
//
// 防无限循环：最大迭代深度 256 层（防异常文件系统下 Dir 行为不一致导致循环不终止）。
func checkDstSymlinkSegments(finalDst string) error {
	p := cleanAbs(finalDst)
	const maxDepth = 256
	for i := 0; i < maxDepth; i++ {
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
	return types.AppError{Code: types.ErrInvalidPath, Operation: "安装目录", SourcePath: finalDst, Reason: "目标路径父链过深（超过 256 层）或存在循环", Suggestion: "请简化目录结构"}
}

// isAllowedEntryName 纯函数：判断目录条目文件名是否允许落地（原 installDirRecursive 内 isAllowed 闭包升格）。
// 两级过滤：
//  1. 硬黑名单：可执行文件类（.exe/.bat/.dll/.cmd/.scr/.pif/.com/.msi/.ps1/.vbs）即使 rtype 为空也拒绝，
//     防模型目录内嵌的 .exe 被拷进 .minecraft（BUG-3 修复）；
//  2. 注册表驱动白名单：registry.InstallExtsFor(rtype) 从 resource_types.json 读取（EntityPlayer/ysm
//     等声明模型+纹理配套扩展名），空=全放行（仅受硬黑名单限制），新增类型改 JSON 无需改本函数。
//
// isAllowedEntryName 按文件名白黑名单过滤安装条目。installExts 由调用方按 rtype 预计算
// 一次透传（rtype 整树恒定），避免每条目都经 registry.InstallExtsFor → LoadRegistry 加锁
// + 线性扫描 + 三份深拷贝（大目录树递归时被放大为 N 次锁竞争，见 #1 审计发现）。
func isAllowedEntryName(name string, installExts []string) bool {
	low := strings.ToLower(name)
	ext := filepath.Ext(low)
	switch ext {
	case ".exe", ".bat", ".dll", ".cmd", ".scr", ".pif", ".com", ".msi", ".ps1", ".vbs":
		return false
	}
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
// CopyFileLocked 返回 (string, error)，其它返回 error，统一收口为 error。
func applyInstallFileByMode(srcFile, dstDir, linkMode string) error {
	switch linkMode {
	case "hardlink":
		return LinkOrCopyLocked(srcFile, dstDir)
	case "symlink":
		return SymlinkOrCopyLocked(srcFile, dstDir)
	default:
		_, err := CopyFileLocked(srcFile, dstDir)
		return err
	}
}

// installSingleDirEntry 处理 installDirRecursive 主循环中的单个 DirEntry（循环体提纯）。
// 包含四个语义阶段：子目录递归 / 文件名白黑名单过滤 / 条目级 symlink 越权逃逸守卫 / 按 linkMode 落地。
// errs 由调用方传指针（in-place append），条目内部分失败仅记录、不打断整体遍历；
// 子目录分支递归调用 installDirRecursive，保持原深度优先顺序不变。
func installSingleDirEntry(entry os.DirEntry, srcDir, finalDst, linkMode, rtype, filesRoot string, installExts []string, errs *[]error) {
	name := entry.Name()
	if entry.IsDir() {
		// 递归处理子目录（MMD 的 spa/textures/toon 等深层子文件夹）
		subSrc := filepath.Join(srcDir, name)
		subDst := filepath.Join(finalDst, name)
		if err := installDirRecursive(subSrc, subDst, linkMode, rtype, filesRoot, installExts); err != nil {
			log.Printf("[installer] 递归安装 %s 失败: %v (继续)", subSrc, err)
			*errs = append(*errs, fmt.Errorf("%s: %w", name, err))
		}
		return
	}
	if !isAllowedEntryName(name, installExts) {
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
		// 分级时正确识别为 partial。
		*errs = append(*errs, fmt.Errorf("%w: %s: %w", ErrPartialInstall, name, err))
	}
}

// installDirRecursive 递归安装目录树
//
// 错误分级：
//   - 致命错误（checkDstSymlinkSegments / MkdirAll / ReadDir 失败）：直接 return，
//     上层 callInstallDirRecursiveWithRollback 据此触发整树回滚清理残渣。
//   - 条目级软失败（单个文件拷贝失败、子目录递归部分失败）：收集到 errs，
//     返回 ErrPartialInstall 包装错误；上层据此**不**回滚——已成功落地的兄弟文件保留，
//     让用户看到「哪些装上了、哪些没装上」，重装时只补失败项。
func installDirRecursive(srcDir, finalDst, linkMode, rtype, filesRoot string, installExts []string) error {
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
		installSingleDirEntry(entry, srcDir, finalDst, linkMode, rtype, filesRoot, installExts, &errs)
	}
	if len(errs) > 0 {
		// 分级 errs：fatal（非 ErrPartialInstall）直接返回，让上层触发整树回滚；
		// 全都是 partial 时才包装为 ErrPartialInstall（保留已落地兄弟文件）。
		// 旧实现统一包装为 ErrPartialInstall，子目录 MkdirAll/ReadDir 失败被误分类为 partial，跳过整树回滚，留下半截损坏目录树。
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
