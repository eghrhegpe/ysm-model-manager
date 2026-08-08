// ===== 文件操作 + 预览提取 + 包信息（ADR-003 P3 Logic Sinking）=====
// 从 internal/app/app_files.go 下沉：文件 CRUD、预览图/纹理提取、包信息、启用/禁用。
// 纯 Go 逻辑，无 Wails runtime 依赖；root 参数由薄壳注入（原 a.ysmRoot()）。
package fileops

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// ========== 目录操作 ==========

// CreateDir 在 root 下创建子目录（校验非法字符，与 RenameDir 对齐）
func CreateDir(root, dir string) error {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return fmt.Errorf("目录名为空")
	}
	if strings.ContainsAny(dir, `\/:*?"<>|`) {
		return fmt.Errorf("目录名包含非法字符")
	}
	if dir == "." || dir == ".." || strings.Contains(dir, ".."+string(filepath.Separator)) || strings.HasSuffix(dir, "..") {
		return fmt.Errorf("目录名包含非法路径段")
	}
	fullPath := filepath.Join(root, dir)
	return os.MkdirAll(fullPath, 0755)
}

// RenameDir 重命名目录（仅改末段，保持父目录）
func RenameDir(oldPath, newName string) error {
	oldPath = strings.TrimSpace(oldPath)
	newName = strings.TrimSpace(newName)
	if oldPath == "" || newName == "" {
		return fmt.Errorf("参数为空")
	}
	// P2 修复：与 RenameFile 对齐，newName 必须通过非法字符 + 穿越校验。
	// 原实现 `filepath.Join(parent, "../x")` 可逃出父目录/仓库。
	if strings.ContainsAny(newName, `\/:*?"<>|`) {
		return fmt.Errorf("目录名包含非法字符")
	}
	if newName == "." || newName == ".." || strings.Contains(newName, ".."+string(filepath.Separator)) || strings.HasSuffix(newName, "..") {
		return fmt.Errorf("目录名包含非法路径段")
	}
	parent := filepath.Dir(oldPath)
	newPath := filepath.Join(parent, newName)
	return os.Rename(oldPath, newPath)
}

// RemoveDir 递归删除目录
func RemoveDir(dir string) error {
	return os.RemoveAll(strings.TrimSpace(dir))
}

// RenameFile 重命名文件（校验非法字符；ysm.json 为模型目录清单，禁止改名）
func RenameFile(oldPath, newName string) error {
	oldPath = strings.TrimSpace(oldPath)
	newName = strings.TrimSpace(newName)
	if oldPath == "" || newName == "" {
		return fmt.Errorf("参数为空")
	}
	if strings.ContainsAny(newName, `\/:*?"<>|`) {
		return fmt.Errorf("文件名包含非法字符")
	}
	// ADR-038 D3：ysm.json 是模型目录清单（游戏按目录名识别模型），禁止单文件改名
	if types.IsYsmEntryJSON(filepath.Base(oldPath)) {
		return fmt.Errorf("ysm.json 是模型目录清单，请重命名所在文件夹（整组操作）")
	}
	parent := filepath.Dir(oldPath)
	newPath := filepath.Join(parent, newName)
	return os.Rename(oldPath, newPath)
}

// ========== 预览提取 ==========

// FindPreviewImage 查找模型同目录的预览图并转 data URI
func FindPreviewImage(modelPath string) string {
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

// ExtractPreviewTexture 从模型文件中提取预览纹理（zip/7z/ysm/json）
func ExtractPreviewTexture(modelPath string) string {
	ext := strings.ToLower(filepath.Ext(modelPath))
	var png []byte

	if ext == ".zip" {
		data, err := os.ReadFile(modelPath)
		if err != nil {
			return ""
		}
		png = extractFirstPNGFromZip(data, int64(len(data)))
	} else if ext == ".7z" {
		data, err := os.ReadFile(modelPath)
		if err != nil {
			return ""
		}
		png = extractFirstPNGFrom7z(data, int64(len(data)))
	} else if ext == ".ysm" {
		if r, err := extractTextureViaYSM(modelPath); err == nil {
			png = r
		}
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

// extractTextureViaYSM 调 YSM CLI 解析器提取纹理
func extractTextureViaYSM(modelPath string) ([]byte, error) {
	parserPath := ysm.FindCLI()
	if parserPath == "" {
		return nil, fmt.Errorf("YSM CLI 解析器未找到")
	}
	tmpDir, err := os.MkdirTemp("", "ysm-tex-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)

	inDir := filepath.Join(tmpDir, "input")
	outDir := filepath.Join(tmpDir, "output")
	if err := os.MkdirAll(inDir, 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return nil, err
	}

	ysmCopy := filepath.Join(inDir, filepath.Base(modelPath))
	if err := copyFile(modelPath, ysmCopy); err != nil {
		return nil, err
	}

	// 超时护栏：YSMParser 若挂起则 goroutine 永久阻塞，故加 30s 硬上限（ADR 审计 P2 #7）
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, parserPath, "-i", inDir, "-o", outDir)
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		return nil, err
	}

	var png []byte
	_ = filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || png != nil {
			return nil
		}
		low := strings.ToLower(p)
		if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
			png, _ = os.ReadFile(p)
		}
		return nil
	})
	return png, nil
}

func extractFirstPNGFromZip(data []byte, size int64) []byte {
	return geometry.ExtractFirstPNGFromZip(data, size)
}

func extractFirstPNGFrom7z(data []byte, size int64) []byte {
	return geometry.ExtractFirstPNGFrom7z(data, size)
}

// ========== 包信息 ==========

// GetPackInfo 读取 ysm-pack.json（root 为空时按绝对路径处理）
func GetPackInfo(root, dirPath string) types.PackInfo {
	dirPath = strings.TrimSpace(dirPath)
	if !filepath.IsAbs(dirPath) && root != "" {
		dirPath = filepath.Join(root, dirPath)
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
		for _, l := range raw.Lang {
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

// ========== 模型移动/复制 ==========

// MoveModelFile 移动 src 到 dstDir（保留原名）
// ADR-038 D3：src 为 ysm.json 时提升为移动整个模型目录（整组语义）；目录直接整组移动
func MoveModelFile(src, dstDir string) error {
	src = strings.TrimSpace(src)
	dstDir = strings.TrimSpace(dstDir)
	if src == "" || dstDir == "" {
		return fmt.Errorf("参数空")
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	// ysm.json 是模型目录清单：整组移动父目录（包内 geometry/animation/语言资源随目录一起走）
	if types.IsYsmEntryJSON(filepath.Base(src)) {
		src = filepath.Dir(src)
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	// P1 修复：移动前防覆盖检查，与 CopyModelFile 语义对齐——
	// 原实现 os.Rename 在 POSIX 上静默覆盖同名目标，Windows 上报错，行为不一致且可能数据丢失
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("目标已存在: %s", dst)
	}
	return os.Rename(src, dst)
}

// CopyModelFile 复制 src 到 dstDir（root 用于路径安全校验，空则跳过校验）
// ADR-038 D3：支持目录递归复制（含 .ban 状态文件）；src 为 ysm.json 时提升为复制整个模型目录
func CopyModelFile(root, src, dstDir string) error {
	src = strings.TrimSpace(src)
	dstDir = strings.TrimSpace(dstDir)
	if src == "" || dstDir == "" {
		return fmt.Errorf("参数空")
	}
	// 路径安全：dstDir 必须落在 FilesRoot 内
	if root != "" {
		absRoot, err := filepath.Abs(root)
		if err != nil {
			return err
		}
		absDst, err := filepath.Abs(dstDir)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(absRoot, absDst)
		if err != nil || strings.HasPrefix(rel, "..") || rel == ".." {
			return fmt.Errorf("目标目录必须在仓库内: %s", dstDir)
		}
		// P3 修复：src 也须落在仓库内——否则可把仓库外任意文件拷入仓库（读取越界）
		absSrc, err := filepath.Abs(src)
		if err != nil {
			return err
		}
		relSrc, err := filepath.Rel(absRoot, absSrc)
		if err != nil || strings.HasPrefix(relSrc, "..") || relSrc == ".." {
			return fmt.Errorf("源文件必须在仓库内: %s", src)
		}
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	// ysm.json 提升：复制整个模型目录（ADR-038 D3）
	if types.IsYsmEntryJSON(filepath.Base(src)) {
		src = filepath.Dir(src)
	}
	// P2 修复：拒绝目录自嵌套复制——dstDir 位于 src 子树内时（先 MkdirAll 在 src 内创建
	// dstDir，再 WalkDir 遍历到它）递归自嵌套无限膨胀直至 ENAMETOOLONG
	if absSrc, err := filepath.Abs(src); err == nil {
		if absDstDir, err := filepath.Abs(dstDir); err == nil {
			if relToSrc, err := filepath.Rel(absSrc, absDstDir); err == nil &&
				relToSrc != "." && relToSrc != ".." && !strings.HasPrefix(relToSrc, ".."+string(filepath.Separator)) {
				return fmt.Errorf("目标目录不能位于源目录内: %s", dstDir)
			}
		}
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	// 防覆盖：目标已存在直接报错（单文件与目录一致）
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("目标已存在: %s", dst)
	}
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return copyDirRecursive(src, dst)
	}
	if err := copyFile(src, dst); err != nil {
		return err
	}
	// 复制 .ban 状态文件（如果存在）
	banSrc := src + ".ban"
	if _, err := os.Stat(banSrc); err == nil {
		// P3 修复：.ban 副本写入失败不再吞掉——禁用状态丢失需透出错误（模型已复制但状态不一致）。
		// 同时回滚已复制的 dst，避免「目标已存在」阻塞重试（与目录路径整树回滚语义对齐）
		if err := copyFile(banSrc, dst+".ban"); err != nil {
			_ = os.Remove(dst)
			return fmt.Errorf("复制禁用标记失败: %w", err)
		}
	}
	return nil
}

// copyDirRecursive 递归复制目录（.ban 状态文件作为普通文件随遍历自然复制；防覆盖）
func copyDirRecursive(srcDir, dstDir string) error {
	// P2 修复：失败时整树回滚（RemoveAll dstDir），防止半棵树残留 + 下次「目标已存在」永久卡死
	err := copyDirRecursiveInner(srcDir, dstDir)
	if err != nil {
		// P3 修复（code_review）：回滚失败也要记录，否则残留半棵树且重试被「目标已存在」永久阻塞时无诊断线索
		if rmErr := os.RemoveAll(dstDir); rmErr != nil {
			log.Printf("[fileops] 复制失败回滚清理失败 %s: %v（原错误: %v）", dstDir, rmErr, err)
		}
	}
	return err
}

func copyDirRecursiveInner(srcDir, dstDir string) error {
	return filepath.WalkDir(srcDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, relErr := filepath.Rel(srcDir, p)
		if relErr != nil {
			return relErr
		}
		target := filepath.Join(dstDir, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		if _, err := os.Stat(target); err == nil {
			return fmt.Errorf("目标已存在: %s", target)
		}
		return copyFile(p, target)
	})
}

// ========== 启用/禁用 ==========

// DeleteModelFile 删除模型（目录感知，ADR-038 D3.6）：
// src 为 ysm.json 时删除整个模型目录（整组语义——包内 geometry/animation/语言资源随目录一起删）；
// 其余文件删除单文件。消除「单文件删除 vs 目录删除」双轨语义入口。
// root 为资源类型仓库根（可选，空则跳过守卫）：防止根级/盘符级 ysm.json 把整个仓库误删；
// 守卫拒绝时回退单文件删除（不整组、不误删仓库）。
func DeleteModelFile(root, path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("参数空")
	}
	if types.IsYsmEntryJSON(filepath.Base(path)) {
		parent := filepath.Dir(path)
		// 目录提升守卫：父目录必须严格深于仓库根（防根级 ysm.json 清空整个仓库）
		if root != "" {
			absRoot, err := filepath.Abs(root)
			if err != nil {
				return err
			}
			absParent, err := filepath.Abs(parent)
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(absRoot, absParent)
			if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				// 仓库外路径（rel 无法判定或 .. 前缀）：显式拒绝，不静默降级——
				// 否则只删 ysm.json 单文件会留下孤儿资源目录且前端误报「已删除」
				return fmt.Errorf("拒绝删除仓库外路径: %s", path)
			}
			if rel == "." {
				// 真正的根级 ysm.json（父目录 == 仓库根）：回退单文件删除（不整组提升，防误删仓库）
				return os.Remove(path)
			}
		}
		return os.RemoveAll(parent)
	}
	return os.Remove(path)
}

// ToggleModelEnable 切换 .ban 状态文件（返回是否处于启用态；缓存失效由薄壳处理）
// ADR-038 D3.7：src 为 ysm.json 时提升为父目录级 .ban——文件夹模型整组禁用，
// 目录重命名为 `父目录.ban`，几何/动画/语言资源随目录一起被隔离。
// root 为资源仓库根（可选，空则跳过守卫）：防止根级 ysm.json 把整个仓库根重命名成 .ban。
func ToggleModelEnable(root, path string) (bool, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return false, fmt.Errorf("参数为空")
	}
	// 目录级 .ban 识别（与 IsFileBanned 对称）：父目录名以 .ban 结尾 = 整组禁用态。
	// 启用方向：还原父目录名（去 .ban）；禁用方向：目录已在 .ban 内，幂等返回。
	parentBase := filepath.Base(filepath.Dir(path))
	if strings.HasSuffix(strings.ToLower(parentBase), ".ban") {
		bannedParent := filepath.Dir(path)
		if strings.HasSuffix(strings.ToLower(path), ".ban") {
			// 文件自身也带 .ban（旧状态残留）：优先还原父目录再还原文件
			fileNew := path[:len(path)-len(".ban")]
			if err := os.Rename(path, fileNew); err != nil {
				return false, err
			}
		}
		// 大小写不敏感去 .ban 后缀（Windows 上 .BAN 目录也能还原）
		dirNew := bannedParent[:len(bannedParent)-len(".ban")]
		if err := os.Rename(bannedParent, dirNew); err != nil {
			return false, err
		}
		return true, nil // 整组启用
	}
	// ysm.json 是模型目录清单：.ban 作用于整个模型目录（整组语义）
	if types.IsYsmEntryJSON(filepath.Base(path)) {
		parent := filepath.Dir(path)
		// 目录提升守卫：父目录必须严格深于仓库根（防根级 ysm.json 重命名仓库根）
		if root != "" {
			absRoot, err := filepath.Abs(root)
			if err != nil {
				return false, err
			}
			absParent, err := filepath.Abs(parent)
			if err != nil {
				return false, err
			}
			rel, err := filepath.Rel(absRoot, absParent)
			if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				// 根级 ysm.json：回退到文件级 .ban（不整组提升）
				path = parent + string(filepath.Separator) + filepath.Base(path)
			} else {
				path = parent
			}
		} else {
			path = filepath.Dir(path)
		}
	}
	if strings.HasSuffix(strings.ToLower(path), ".ban") {
		// P2 修复：用长度切片去 .ban 后缀（大小写不敏感，与目录级 L421 一致）。
		// 原 TrimSuffix 大小写敏感，`x.ysm.BAN` 触发检测后不剥离 → os.Rename(path,path) 空转假启用
		newPath := path[:len(path)-len(".ban")]
		if err := os.Rename(path, newPath); err != nil {
			return false, err
		}
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
	return false, nil // 已禁用
}

// IsFileBanned 判断路径是否被 .ban 标记（文件级或目录级，ADR-038 D3.7）
func IsFileBanned(path string) bool {
	path = strings.TrimSpace(path)
	if path == "" {
		return false
	}
	if strings.HasSuffix(strings.ToLower(path), ".ban") {
		return true
	}
	// 目录级 .ban：父目录名以 .ban 结尾（文件夹模型整组禁用）
	parent := filepath.Base(filepath.Dir(path))
	return strings.HasSuffix(strings.ToLower(parent), ".ban")
}

// ========== 内部工具 ==========

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if err != nil {
		// 半截文件清理：io.Copy 失败后删除目标文件，避免残留不完整数据
		// 与 installer.copyFileLocked 的 ok+os.Remove(dst) 模式对齐
		_ = os.Remove(dst)
		out.Close()
		return err
	}
	return out.Close()
}
