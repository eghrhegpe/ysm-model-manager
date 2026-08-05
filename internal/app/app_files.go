// ========== 文件操作 + 预览提取 + 包信息（薄壳，ADR-003 P3）==========
// 业务逻辑已下沉至 go/fileops（纯 Go 可测）；本文件仅做 Wails 绑定转发 +
// scanCache 缓存失效处理。
package app

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"ysm-model-manager/go/fileops"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// ========== 目录操作 ==========
func (a *App) CreateDir(dir string) error {
	return fileops.CreateDir(a.ysmRoot(), dir)
}

func (a *App) RenameDir(oldPath, newName string) error {
	if !a.isPathInRoot(oldPath) {
		return fmt.Errorf("路径超出仓库目录")
	}
	return fileops.RenameDir(oldPath, newName)
}

func (a *App) RemoveDir(dir string) error {
	if !a.isPathInRoot(dir) {
		return fmt.Errorf("路径超出仓库目录")
	}
	return fileops.RemoveDir(dir)
}

func (a *App) RenameFile(oldPath, newName string) error {
	return fileops.RenameFile(oldPath, newName)
}

// ========== 预览提取 ==========
func (a *App) FindPreviewImage(modelPath string) string {
	return fileops.FindPreviewImage(modelPath)
}

func (a *App) ExtractPreviewTexture(modelPath string) string {
	return fileops.ExtractPreviewTexture(modelPath)
}

// ========== 包信息 ==========
func (a *App) GetPackInfo(dirPath string) types.PackInfo {
	return fileops.GetPackInfo(a.ysmRoot(), dirPath)
}

// ========== 模型移动/复制 ==========
func (a *App) MoveModelFile(src, dstDir string) error {
	if !a.isPathInRoot(src) || !a.isPathInRoot(dstDir) {
		return fmt.Errorf("路径超出仓库目录")
	}
	return fileops.MoveModelFile(src, dstDir)
}

// CopyModelFile 复制（root 传 FilesRoot 做路径安全校验）
func (a *App) CopyModelFile(src, dstDir string) error {
	cfg := a.LoadAppConfig()
	return fileops.CopyModelFile(cfg.FilesRoot, src, dstDir)
}

// ImportModelFolder 文件夹型模型整组导入（YSM 解压目录，保留子目录层级，ADR-038 关联）
// folderName = 仓库文件夹名（模型名）；files = 相对路径 → base64 内容
func (a *App) ImportModelFolder(folderName, subpath string, files []types.ImportFileItem) error {
	root, _ := a.GetRepoRoot("ysm")
	if root == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}
	if err := fileops.WriteModelFolder(root, subpath, folderName, files); err != nil {
		return err
	}
	scanner.InvalidateCache()
	return nil
}

// ========== 在资源管理器中显示 ==========
func (a *App) RevealInExplorer(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("路径为空")
	}
	cmd := exec.Command("explorer", "/select,", filepath.FromSlash(path))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

// ========== 启用/禁用 ==========
// ToggleModelEnable 切换 .ban 状态（fileops 纯逻辑 + 薄壳缓存失效）
func (a *App) ToggleModelEnable(path string) (bool, error) {
	enabled, err := fileops.ToggleModelEnable(a.ysmRoot(), path)
	if err == nil {
		scanner.InvalidatePath(filepath.Dir(path))
	}
	return enabled, err
}

func (a *App) IsFileBanned(path string) bool {
	return fileops.IsFileBanned(path)
}
