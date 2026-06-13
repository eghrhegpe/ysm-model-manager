// ========== 文件操作 + 预览提取 + 包信息 ==========
// 从 app.go 拆分：文件 CRUD、预览图、纹理提取、包信息、启用/禁用
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// ========== 目录操作 ==========
func (a *App) CreateDir(dir string) error {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return fmt.Errorf("目录名为空")
	}
	if strings.Contains(dir, "..") || strings.Contains(dir, "~") {
		return fmt.Errorf("目录名包含非法字符")
	}
	fullPath := filepath.Join(a.RepoRoot, dir)
	return os.MkdirAll(fullPath, 0755)
}

func (a *App) RenameDir(oldPath, newName string) error {
	oldPath = strings.TrimSpace(oldPath)
	newName = strings.TrimSpace(newName)
	if oldPath == "" || newName == "" {
		return fmt.Errorf("参数为空")
	}
	parent := filepath.Dir(oldPath)
	newPath := filepath.Join(parent, newName)
	return os.Rename(oldPath, newPath)
}

func (a *App) RemoveDir(dir string) error {
	return os.RemoveAll(strings.TrimSpace(dir))
}

func (a *App) RenameFile(oldPath, newName string) error {
	oldPath = strings.TrimSpace(oldPath)
	newName = strings.TrimSpace(newName)
	if oldPath == "" || newName == "" {
		return fmt.Errorf("参数为空")
	}
	if strings.ContainsAny(newName, "\\/:*?\"<>|") {
		return fmt.Errorf("文件名包含非法字符")
	}
	parent := filepath.Dir(oldPath)
	newPath := filepath.Join(parent, newName)
	return os.Rename(oldPath, newPath)
}

// ========== 预览提取 ==========
func (a *App) FindPreviewImage(modelPath string) string {
	dir := filepath.Dir(modelPath)
	base := strings.TrimSuffix(filepath.Base(modelPath), filepath.Ext(modelPath))
	candidates := []string{
		filepath.Join(dir, base+".png"),
		filepath.Join(dir, base+".jpg"),
		filepath.Join(dir, "preview.png"),
		filepath.Join(dir, "cover.png"),
		filepath.Join(dir, "thumbnail.png"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			data, err := os.ReadFile(c)
			if err == nil && len(data) > 0 {
				mime := "image/png"
				if strings.HasSuffix(strings.ToLower(c), ".jpg") {
					mime = "image/jpeg"
				}
				return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
			}
		}
	}
	return ""
}

func (a *App) ExtractPreviewTexture(modelPath string) string {
	ext := strings.ToLower(filepath.Ext(modelPath))
	var png []byte

	if ext == ".zip" {
		data, err := os.ReadFile(modelPath)
		if err != nil {
			return ""
		}
		png = extractPNGFromZip(data, int64(len(data)))
	} else if ext == ".7z" {
		data, err := os.ReadFile(modelPath)
		if err != nil {
			return ""
		}
		png = extractPNGFrom7z(data, int64(len(data)))
	} else if ext == ".ysm" {
		png = a.extractTextureViaYSM(modelPath)
	} else if ext == ".json" {
		// 解压后的 YSM 模型：查找 textures/ 子目录中的 PNG
		dir := filepath.Dir(modelPath)
		texDir := filepath.Join(dir, "textures")
		if d, err := os.Stat(texDir); err == nil && d.IsDir() {
			entries, _ := os.ReadDir(texDir)
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				if strings.HasSuffix(strings.ToLower(e.Name()), ".png") {
					texPath := filepath.Join(texDir, e.Name())
					png, _ = os.ReadFile(texPath)
					if len(png) > 0 {
						break
					}
				}
			}
		}
		// 也搜同目录 PNG
		if len(png) == 0 {
			entries, _ := os.ReadDir(dir)
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				if strings.HasSuffix(strings.ToLower(e.Name()), ".png") {
					texPath := filepath.Join(dir, e.Name())
					png, _ = os.ReadFile(texPath)
					if len(png) > 0 {
						break
					}
				}
			}
		}
	}

	if len(png) == 0 {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
}

func (a *App) extractTextureViaYSM(modelPath string) []byte {
	parserPath := ysm.FindCLI()
	if parserPath == "" {
		return nil
	}
	tmpDir, err := os.MkdirTemp("", "ysm-tex-*")
	if err != nil {
		return nil
	}
	defer os.RemoveAll(tmpDir)

	inDir := filepath.Join(tmpDir, "input")
	outDir := filepath.Join(tmpDir, "output")
	os.MkdirAll(inDir, 0755)
	os.MkdirAll(outDir, 0755)

	ysmCopy := filepath.Join(inDir, filepath.Base(modelPath))
	if err := copyFile(modelPath, ysmCopy); err != nil {
		return nil
	}

	cmd := exec.Command(parserPath, "-i", inDir, "-o", outDir)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Run(); err != nil {
		return nil
	}

	var png []byte
	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || png != nil {
			return nil
		}
		low := strings.ToLower(p)
		if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
			png, _ = os.ReadFile(p)
		}
		return nil
	})
	return png
}

// ========== 包信息 ==========
func (a *App) GetPackInfo(dirPath string) types.PackInfo {
	dirPath = strings.TrimSpace(dirPath)
	if !filepath.IsAbs(dirPath) && a.RepoRoot != "" {
		dirPath = filepath.Join(a.RepoRoot, dirPath)
	}
	absPath, err := filepath.Abs(filepath.FromSlash(dirPath))
	if err != nil {
		return types.PackInfo{}
	}
	jsonPath := filepath.Join(absPath, "ysm-pack.json")
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return types.PackInfo{}
	}
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	var raw struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Lang        map[string]struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		} `json:"lang"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return types.PackInfo{}
	}
	info := types.PackInfo{Name: raw.Name, Description: raw.Description}
	if raw.Lang != nil {
		for lang, l := range raw.Lang {
			_ = lang
			if l.Name != "" {
				info.Name = l.Name
			}
			if l.Description != "" {
				info.Description = l.Description
			}
		}
	}
	imgPath := filepath.Join(absPath, "ysm-pack.png")
	if imgData, err := os.ReadFile(imgPath); err == nil {
		info.ImageBase64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(imgData)
	}
	return info
}

func extractPNGFromZip(data []byte, size int64) []byte {
	return geometry.ExtractFirstPNGFromZip(data, size)
}

func extractPNGFrom7z(data []byte, size int64) []byte {
	return geometry.ExtractFirstPNGFrom7z(data, size)
}

// ========== 模型移动 ==========
func (a *App) MoveModelFile(src, dstDir string) error {
	src = strings.TrimSpace(src)
	dstDir = strings.TrimSpace(dstDir)
	if src == "" || dstDir == "" {
		return fmt.Errorf("参数空")
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	return os.Rename(src, filepath.Join(dstDir, filepath.Base(src)))
}

// ========== 启用/禁用 ==========
func (a *App) ToggleModelEnable(path string) (bool, error) {
	if strings.HasSuffix(strings.ToLower(path), ".ban") {
		newPath := strings.TrimSuffix(path, ".ban")
		if err := os.Rename(path, newPath); err != nil {
			return false, err
		}
		scanCache.Delete(filepath.Dir(path))
		return true, nil // 启用
	}
	// 禁用
	newPath := path + ".ban"
	if _, err := os.Stat(newPath); err == nil {
		return false, fmt.Errorf("目标文件已存在: %s", newPath)
	}
	if err := os.Rename(path, newPath); err != nil {
		return false, err
	}
	scanCache.Delete(filepath.Dir(path))
	return false, nil // 已禁用
}

func (a *App) IsFileBanned(path string) bool {
	return strings.HasSuffix(strings.ToLower(path), ".ban")
}
