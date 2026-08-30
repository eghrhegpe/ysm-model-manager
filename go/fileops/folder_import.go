// ===== 文件夹型模型整组导入（ADR-038 关联）=====
// 解压目录（ysm.json 清单 + geometry json + animations/ + textures/）作为整体导入仓库，
// 保留子目录层级。前端拖拽文件夹收集全部文件（relPath + base64）经此写入。
package fileops

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
)

// WriteModelFolder 写入文件夹整组到仓库（YSM 解压目录或普通模型文件夹）。
// folderName 为仓库中的文件夹名（= 模型名）；files 为相对路径 → base64 内容，保留子目录层级。
// 校验：至少含 1 个支持文件（.ysm/.zip/.7z/ysm.json 等，防杂物文件夹入仓）；防覆盖；路径安全（拒绝 .. / 绝对路径 / 逃逸）。
func WriteModelFolder(filesRoot, subpath, folderName string, files []types.ImportFileItem) error {
	opMu.Lock()
	defer opMu.Unlock()
	filesRoot = strings.TrimSpace(filesRoot)
	folderName = strings.TrimSpace(folderName)
	if filesRoot == "" || folderName == "" {
		return fmt.Errorf("参数空")
	}
	if fsutil.ContainsIllegalNameChar(folderName) {
		return fmt.Errorf("文件夹名包含非法字符")
	}
	// 拒绝 . / ..（原实现 folderName=="." 会直接写进 repoRoot/subpath，绕过模型文件夹抽象）
	if folderName == "." || folderName == ".." {
		return fmt.Errorf("文件夹名非法: %s", folderName)
	}
	// 子路径防穿越：统一入口 paths.HasTraversal
	subpath = strings.Trim(subpath, `\/`)
	if subpath != "" {
		clean := filepath.Clean(filepath.FromSlash(subpath))
		if paths.HasTraversal(clean) || filepath.IsAbs(clean) {
			return fmt.Errorf("子路径非法: %s", subpath)
		}
	}
	dstRoot := filepath.Join(filesRoot, subpath, folderName)
	// 防覆盖（与单文件导入 FILE_EXISTS 语义一致）
	if _, err := os.Stat(dstRoot); err == nil {
		return fmt.Errorf("目标已存在: %s", dstRoot)
	}
	// subpath 中间组件 symlink 逃逸——repoRoot/sub 若是预置
	// symlink 指向仓库外，os.Stat(dstRoot) 因外部目标不存在而放行，MkdirAll 穿透
	// symlink 建到外部、WriteFileAtomic 遂写入仓库外（写入前逐组件 Lstat 校验）。
	// folderName 已由调用方保证非 symlink（新目录），subpath 各段是唯一风险面
	if err := checkNoSymlinkInPath(filesRoot, subpath); err != nil {
		return err
	}
	if len(files) == 0 {
		return fmt.Errorf("文件列表为空")
	}
	// 至少含 1 个支持文件（防杂物文件夹入仓）。
	// 支持判定：扩展名在资源类型白名单，且 .json 仅放行 ysm.json（与 scanner 白名单对齐）。
	// 包内资源（main.json / *.animation.json / textures/*.png）不计数但照常写入。
	hasSupported := false
	for _, f := range files {
		clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(f.RelPath)))
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return fmt.Errorf("文件路径非法: %s", f.RelPath)
		}
		if isSupportedEntryFile(clean) {
			hasSupported = true
		}
	}
	if !hasSupported {
		return fmt.Errorf("文件夹内没有可识别的模型文件（需至少 1 个 .ysm/.zip/.7z/ysm.json 等支持文件）")
	}
	// 写入失败时清理已写的半成品目录（RemoveAll dstRoot），
	// 防止残留 + 下次被「目标已存在」永久阻塞（陷阱 #8 变体）
	if err := writeModelFolderFiles(dstRoot, files); err != nil {
		_ = os.RemoveAll(dstRoot)
		return err
	}
	return nil
}

// writeModelFolderFiles 顺序写文件夹内全部文件（独立函数便于失败回滚）
func writeModelFolderFiles(dstRoot string, files []types.ImportFileItem) error {
	for _, f := range files {
		// 受限解码：预检 + 复检（与 importer_file.go:60 同口径，防恶意 base64 解码后膨胀撑爆内存）
		data, err := fsutil.DecodeBase64Limited(f.Base64, previewReadLimit())
		if err != nil {
			return fmt.Errorf("base64 解码失败: %s", f.RelPath)
		}
		rel := filepath.Clean(filepath.FromSlash(strings.TrimSpace(f.RelPath)))
		if rel == "." {
			continue
		}
		dst := filepath.Join(dstRoot, rel)
		// 防逃逸：目标必须落在 dstRoot 内
		relDst, err := filepath.Rel(dstRoot, dst)
		if err != nil || relDst == ".." || strings.HasPrefix(relDst, ".."+string(filepath.Separator)) {
			return fmt.Errorf("路径越权: %s", f.RelPath)
		}
		if err := os.MkdirAll(filepath.Dir(dst), fsutil.DirPerms); err != nil {
			return err
		}
		// 写入前检查目标父目录不是符号链接——仓库内若预置
		// 指向外部的 symlink 目录，MkdirAll 返回 nil（已存在）后 CreateTemp 会穿透写入外部
		if fi, lerr := os.Lstat(filepath.Dir(dst)); lerr == nil && fi.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("拒绝写入符号链接目录: %s", filepath.Dir(dst))
		}
		// 目标文件自身若为 symlink（指向仓库外文件），Rename 会覆盖外部文件
		if fi, lerr := os.Lstat(dst); lerr == nil && fi.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("拒绝覆盖符号链接文件: %s", dst)
		}
		// 走 fsutil.WriteFileAtomic（CreateTemp + rename + Sync）——
		// 原直写 os.WriteFile 在磁盘满/IO 中断时留半截损坏文件（ADR-044 收敛，
		// fsutil 注释点名 fileops 应引用统一实现）
		if err := fsutil.WriteFileAtomic(dst, data); err != nil {
			return err
		}
	}
	return nil
}

// isSupportedEntryFile 判定文件是否可作为「支持文件」计数：
// 扩展名在资源类型白名单，且 .json 仅放行 ysm.json（与 scanner 白名单对齐）。
// 传入 rel 已 Clean。包内资源（main.json 等）返回 false——它们是跟随整组导入的附属，不单独计数。
func isSupportedEntryFile(rel string) bool {
	ext := strings.ToLower(filepath.Ext(rel))
	if ext == ".json" {
		return types.IsYsmEntryJSON(filepath.Base(rel))
	}
	return types.IsSupportedExt(ext)
}

// checkNoSymlinkInPath 从 base 逐组件向下 Lstat 校验 subpath 各段，任何一段为符号链接
// 即拒绝——P2 修复（子代理审计）：repoRoot/sub 若为预置 symlink 指向仓库外，os.Stat
// 对不存在的外部目标放行、MkdirAll 穿透 symlink 建到外部，WriteFileAtomic 遂写入
// 仓库外。subpath 为空时直接放行（folderName 由调用方保证新目录，非 symlink）。
func checkNoSymlinkInPath(base, subpath string) error {
	subpath = strings.Trim(subpath, `\/`)
	if subpath == "" {
		return nil
	}
	cur := filepath.Clean(base)
	for _, seg := range strings.Split(filepath.FromSlash(subpath), string(filepath.Separator)) {
		cur = filepath.Join(cur, seg)
		fi, err := os.Lstat(cur)
		if err != nil {
			// 不存在：后续 MkdirAll 会创建，无 symlink 逃逸面
			return nil
		}
		if fi.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("拒绝写入符号链接目录: %s", cur)
		}
	}
	return nil
}
