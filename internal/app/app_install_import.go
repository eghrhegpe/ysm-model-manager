// ========== 安装 + 导入（拆分自 app_install.go）==========
// 从 app_install.go 拆分：模型安装/导入核心逻辑
package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/importer"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/instance"
	"ysm-model-manager/go/paths"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
)

// ========== 安装 ==========
func (a *App) InstallModelFile(src, mcRoot string) (string, error) {
	return installer.InstallToGlobal(src, mcRoot)
}

func (a *App) InstallModelTo(src, customDir string) error {
	// 注册表驱动路由仓库根：取代硬编码 a.ysmRoot()，使 vrm/vmd/nbt/zip 等非 YSM
	// 资源也能通过 installer.Install 的 IsInside 路径守卫，进入硬链接分支。
	// YSM 走 GetRepoRoot("ysm") 与 a.ysmRoot() 结果完全一致，行为零回归。
	rtype := a.DetectResourceType(src)
	if rtype == "" {
		rtype = "ysm" // 兜底兼容原行为
	}
	root, _ := a.GetRepoRoot(rtype)
	err := installer.Install(src, customDir, root, a.getLinkMode())
	if err != nil {
		a.logger.Add(filepath.Base(src), src, customDir, 0, "failed", err.Error())
	} else {
		a.logger.Add(filepath.Base(src), src, customDir, 0, "success", "")
	}
	return err
}

func (a *App) InstallModelWithOverlay(src, customDir string) (string, error) {
	return installer.InstallWithOverlay(src, customDir)
}

// SyncCustomToRepo 同步整合包自定义目录到仓库（执行逻辑下沉 go/sync）
func (a *App) SyncCustomToRepo(customDir, repoDir string) (int, error) {
	n, err := ysmsync.SyncCustomToRepo(customDir, repoDir, a.ScanModelEntries, a.logger.Add)
	// 收编会改全局仓库目录；显式清同步结果缓存（该入口当前不走 scanner.InvalidateCache）。
	instance.InvalidateSyncItemsCache()
	ysmsync.InvalidateSyncScanCaches()
	return n, err
}

func (a *App) ImportModelFile(fileName, base64Data string) error {
	return a.importModelFile(fileName, base64Data, false)
}

// DetectZipType 通过 ZIP 内容检测资源类型（供前端导入路由使用）
func (a *App) DetectZipType(base64Data string) string {
	// 尾部探针优先（audit #1）：解码 base64 末尾窗口解析中央目录，内存 O(4MB) 与包
	// 体积无关——探测能力覆盖到导入上限 MaxImportSize(500MB)，50~500MB 合法 zip
	// 不再被 50MB 探测上限误杀为 unknown
	if id, ok := importer.DetectZipTypeFromBase64Tail(base64Data); ok {
		return id
	}
	// 兜底：7z 等头部指纹格式、zip64/中央目录超出尾部窗口的 zip → 整包解码，
	// 上限对齐导入上限（与 ImportModelFile 同口径，不再有探测/导入真空带）
	data, err := fsutil.DecodeBase64Limited(base64Data, types.MaxImportSize)
	if err != nil {
		return "unknown"
	}
	return importer.DetectZipType(data)
}

func (a *App) ImportModelFileSkipCheck(fileName, base64Data string) error {
	return a.importModelFile(fileName, base64Data, true)
}

func (a *App) importModelFile(fileName, base64Data string, skipCheck bool) error {
	_, _, err := a.importModelFileWithOptions(fileName, base64Data, importOptions{skipCheck: skipCheck})
	return err
}

func (a *App) ImportModelFileOverwrite(fileName, base64Data string) error {
	_, _, err := a.importModelFileWithOptions(fileName, base64Data, importOptions{overwrite: true})
	return err
}

type importOptions struct {
	skipCheck bool
	overwrite bool
}

// importModelFileWithOptions 导入模型文件（校验+写文件核心下沉 go/importer）。
// 返回 (destPath, rtype)：落盘路径 + 判定类型，供「先入仓库再推送」组合链路消费。
func (a *App) importModelFileWithOptions(fileName, base64Data string, opts importOptions) (string, string, error) {
	destPath, rtype, err := importer.ImportFromBase64(fileName, base64Data, importer.ImportOptions{
		SkipCheck: opts.skipCheck,
		Overwrite: opts.overwrite,
	}, func(rtype string) string {
		dir, _ := a.GetRepoRoot(rtype)
		return dir
	}, a.logger.Add)
	if err == nil {
		// Go 侧统一失效，不赌前端每条导入入口都记得 ClearScanCache：
		// 否则新增的 30s 同步结果缓存会让导入后整合包页静默陈旧 ≤30s。
		a.ClearScanCache()
	}
	return destPath, rtype, err
}

func (a *App) ImportModelFileTo(fileName, subpath, base64Data string) error {
	return a.importModelFileWithSubpath(fileName, subpath, base64Data, false)
}

func (a *App) ImportModelFileOverwriteTo(fileName, subpath, base64Data string) error {
	return a.importModelFileWithSubpath(fileName, subpath, base64Data, true)
}

// ImportModelFileToMMD 导入 MMD 模型文件到指定用途子目录（ADR-096）。
// mmdSubdir: MMD 用途子目录名（如 SceneModel/CustomAnim），对应 MMD 独立顶级类型。
// subpath: 文件在子目录内的相对路径（文件夹导入时保留层级）。
func (a *App) ImportModelFileToMMD(fileName, subpath, mmdSubdir, base64Data string) error {
	return a.importModelFileMMD(fileName, subpath, mmdSubdir, base64Data, false)
}

// ImportModelFileOverwriteToMMD 覆盖导入 MMD 模型文件到指定用途子目录。
func (a *App) ImportModelFileOverwriteToMMD(fileName, subpath, mmdSubdir, base64Data string) error {
	return a.importModelFileMMD(fileName, subpath, mmdSubdir, base64Data, true)
}

// importModelFileMMD 导入 MMD 模型文件。
// 壳-叶架构已移除：mmdSubdir 现在作为资源类型 ID（如 EntityPlayer、SceneModel），
// 直接走该类型的存储根目录与扩展名校验。
func (a *App) importModelFileMMD(fileName, subpath, mmdSubdir, base64Data string, overwrite bool) error {
	rtype := mmdSubdir
	if rtype == "" {
		rtype = "EntityPlayer"
	}
	root, _ := a.GetRepoRoot(rtype)
	if root == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}
	// 扩展名校验：按资源类型自声明的 extensions 白名单
	if allowedExts := types.SupportedExtsForType(rtype); len(allowedExts) > 0 {
		ext := strings.ToLower(filepath.Ext(fileName))
		extSet := make(map[string]bool, len(allowedExts))
		for _, e := range allowedExts {
			extSet[strings.ToLower(e)] = true
		}
		if !extSet[ext] {
			return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: fmt.Sprintf("文件格式不被 %s 类型支持", rtype), Suggestion: "仅允许: " + strings.Join(allowedExts, " / ")}
		}
	}
	// 拼接子目录：mmdSubdir 在前，subpath 在后（如有）。
	fullSubpath := mmdSubdir
	if subpath != "" {
		fullSubpath = mmdSubdir + "/" + subpath
	}
	return a.importModelFileWithSubpath(fileName, fullSubpath, base64Data, overwrite)
}

func (a *App) importModelFileWithSubpath(fileName, subpath, base64Data string, overwrite bool) error {
	root, _ := a.GetRepoRoot("ysm")
	if root == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	if !types.IsSupportedExt(ext) {
		return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式", Suggestion: "支持格式: " + strings.Join(types.AllExts(), " / ")}
	}
	// ysm 包内 json 白名单：.json 仅允许 ysm.json 入口清单（与 go/importer + go/scanner 对齐，ADR-038 D2）
	if ext == ".json" && !types.IsYsmEntryJSON(filepath.Base(fileName)) {
		return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "仅支持 ysm.json 清单文件", Suggestion: "YSM 包内 json 资源（geometry/animation/语言文件）不可单独导入，请导入 .ysm/.zip/.7z 或解压目录中的 ysm.json"}
	}
	// base64 受限解码：预检+解码+复检统一走 fsutil.DecodeBase64Limited
	//（原「解码后才查 len(data)」会在 500MB 输入上先白白物化再拒绝，与 importer_file.go 口径不一）
	data, err := fsutil.DecodeBase64Limited(base64Data, types.MaxImportSize)
	if errors.Is(err, fsutil.ErrB64TooLarge) {
		// 文案绑定 MaxImportSizeMB 常量——原硬编码 "500MB"
		// 与 MaxImportSize 无绑定，改常量后漂移即编译期暴露
		return types.AppError{Code: types.ErrFileTooLarge, Operation: "导入模型", SourcePath: fileName, Reason: fmt.Sprintf("文件大小超过 %dMB 限制", types.MaxImportSizeMB), Suggestion: fmt.Sprintf("请压缩文件至 %dMB 以内", types.MaxImportSizeMB)}
	}
	if err != nil {
		return types.AppError{Code: types.ErrDecodeFailed, Operation: "导入模型", Reason: "Base64 解码失败", Suggestion: "文件可能已损坏，请重新下载"}
	}
	// 路径穿越防护（对齐 importer_file.go 契约）：
	// - subpath 允许嵌套目录（folder/sub 保持目录结构），拒绝 .. 穿越段
	// - fileName 拒绝 .. 序列与路径分隔符（仅纯文件名）
	if paths.HasTraversal(subpath) {
		return types.AppError{Code: types.ErrInvalidPath, Operation: "导入模型", SourcePath: subpath, Reason: "非法子目录路径", Suggestion: "子目录仅支持纯目录名层级"}
	}
	if paths.HasTraversal(fileName) {
		return types.AppError{Code: types.ErrFileNameInvalid, Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含路径穿越", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	if strings.ContainsAny(fileName, `\/`) {
		return types.AppError{Code: types.ErrFileNameInvalid, Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含非法路径分隔符", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	if len(data) == 0 {
		return types.AppError{Code: types.ErrFileEmpty, Operation: "导入模型", SourcePath: fileName, Reason: "文件内容为空", Suggestion: "请检查文件是否损坏"}
	}
	destPath := filepath.Join(root, subpath, fileName)
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, fsutil.DirPerms); err != nil {
		return types.AppError{Code: types.ErrMkdirFailed, Operation: "导入模型", TargetPath: destDir, Reason: "无法创建目标目录", Suggestion: "请检查磁盘权限或空间"}
	}
	if !overwrite {
		if _, err := os.Stat(destPath); err == nil {
			return types.AppError{Code: types.ErrFileExists, Operation: "导入模型", SourcePath: fileName, Reason: "文件已存在", Suggestion: "如需替换请先删除原文件"}
		}
	}
	// subpath 导入路径复用 importer.WriteFileAtomic——原 `os.WriteFile`
	// 直写目标，磁盘满/IO 中断留半截文件且非覆盖模式再次导入命中 FILE_EXISTS 死锁；
	// 与 ImportFromBase64 的原子写入语义保持一致
	if err := importer.WriteFileAtomic(destPath, data); err != nil {
		return err
	}
	// Go 侧统一失效：导入后立即清扫描缓存/容器指纹缓存/同步结果缓存，
	// 不依赖前端事后 ClearScanCache（否则漏一条路径就吃 30s 陈旧窗）。
	a.ClearScanCache()
	return nil
}

// ========== 整合包卡片拖拽导入（先入仓库再推送，复用右键推送管线） ==========
// 数据流与下载→安装同构：外部产物先入仓库（单一事实源），再由仓库落盘产物
// 装进整合包实例（硬链接模式由此成立）。前端只编排调用，类型判定与落点全在 Go 侧。

// ImportFileAndPushToInstance 单文件先入仓库（importer 类型路由判定落点与类型），
// 再把仓库落盘产物推送到指定整合包实例。先验证实例存在再写入：未知实例不落仓库残档。
func (a *App) ImportFileAndPushToInstance(fileName, base64Data, instanceName string) error {
	// 根级目录级安装入口前置拒绝（与 pushRepoPathToInstance 兜底防线构成双保险）：
	// .pmx/.pmd/ysm.json 单文件在推送侧会触发 InstallDir(父目录)，父目录=仓库根 →
	// 整仓落地灾难。前置到落盘前拦截，不留下「入仓成功但推送必败」的仓库残档
	// （ysm.json 与前端 directImport 的提示口径一致）。
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(fileName)))
	if ext == ".pmx" || ext == ".pmd" {
		return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "根级 .pmx/.pmd 不可单独推送（会触发父目录级整组安装）", Suggestion: "MMD 模型请整体选择包含贴图的模型文件夹拖入"}
	}
	if strings.EqualFold(strings.TrimSpace(fileName), "ysm.json") {
		return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "光杆 ysm.json 不可单独推送", Suggestion: "请拖入含 ysm.json 的整个模型文件夹"}
	}
	cfg := a.LoadAppConfig()
	if err := requireMcRoot(cfg); err != nil {
		return err
	}
	if err := a.requireInstance(cfg.McRoot, instanceName); err != nil {
		return err
	}
	destPath, rtype, err := a.importModelFileWithOptions(fileName, base64Data, importOptions{})
	if err != nil {
		return err
	}
	return a.pushRepoPathToInstance(rtype, instanceName, destPath)
}

// ImportFolderAndPushToInstance 文件夹整组先入仓库（inferFolderType 内容推断类型，
// 与 ImportModelFolder 同源），再把仓库落盘的文件夹根推送到指定整合包实例
// （ysmsync.PushSingleResource 对目录走 InstallDir 整组安装，扩展名白名单按类型过滤）。
// subpath 保留多级拖入的父目录层级（拖「分类1/狐狸」→ 仓库 分类1/狐狸/）。
func (a *App) ImportFolderAndPushToInstance(folderName, subpath string, files []types.ImportFileItem, instanceName string) error {
	cfg := a.LoadAppConfig()
	if err := requireMcRoot(cfg); err != nil {
		return err
	}
	if err := a.requireInstance(cfg.McRoot, instanceName); err != nil {
		return err
	}
	rtype := inferFolderType(files)
	root, _ := a.GetRepoRoot(rtype)
	if root == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}
	if err := a.importModelFolderAs(rtype, folderName, subpath, files); err != nil {
		return err
	}
	return a.pushRepoPathToInstance(rtype, instanceName, filepath.Join(root, subpath, folderName))
}

// requireInstance 校验 mcRoot 下存在指定名称的整合包实例（ListVersionInstances 同源发现）。
func (a *App) requireInstance(mcRoot, instanceName string) error {
	for _, ins := range a.ListVersionInstances(mcRoot) {
		if ins.Name == instanceName {
			return nil
		}
	}
	return fmt.Errorf("未找到整合包: %s", instanceName)
}

// pushRepoPathToInstance 把仓库内已落盘的文件/目录推送到指定整合包实例。
// 与 PushSingleResourceToInstance 同一管线（filesRootForSync + findInstanceDir +
// ysmsync.PushSingleResource），区别仅在于实例目录只解析一次、调用方自持 rtype
// （文件夹整组按组类型推送，不逐文件重判型导致纹理错根）。
func (a *App) pushRepoPathToInstance(rtype, instanceName, repoPath string) error {
	cfg := a.LoadAppConfig()
	if err := requireMcRoot(cfg); err != nil {
		return err
	}
	globalDir, _ := a.filesRootForSync(rtype)
	if globalDir == "" {
		return fmt.Errorf("未设置 %s 类型的仓库目录", rtype)
	}
	customDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil {
		return err
	}
	// 防目录级安装整仓落地的兜底防线（入口 ImportFileAndPushToInstance 已前置拦截
	// 单文件 .pmx/.pmd/ysm.json；此处覆盖未来其他调用方直推根级文件的场景）：
	// .pmx/.pmd/ysm.json 触发 InstallDir(父目录)，父目录=仓库根时会把整棵仓库推进实例。
	if filepath.Dir(repoPath) == filepath.Clean(globalDir) {
		ext := strings.ToLower(filepath.Ext(repoPath))
		if ext == ".pmx" || ext == ".pmd" || (ext == ".json" && types.IsYsmEntryJSON(repoPath)) {
			return types.AppError{Code: types.ErrInvalidPath, Operation: "推送资源", SourcePath: repoPath, Reason: "根级目录级安装入口被拒绝", Suggestion: "请将模型放入仓库子文件夹后再推送"}
		}
	}
	opErr := ysmsync.PushSingleResource(repoPath, customDir, globalDir, a.getLinkMode(), rtype)
	if opErr != nil {
		a.logger.Add(filepath.Base(repoPath), repoPath, customDir, 0, "failed", opErr.Error())
		return opErr
	}
	a.logger.Add(filepath.Base(repoPath), repoPath, customDir, 0, "success", "")
	// 推送会改实例目录；与 PushSingleResourceToInstance 同款显式失效（保持刷新即时）
	instance.InvalidateSyncItemsCache()
	ysmsync.InvalidateSyncScanCaches()
	return nil
}
