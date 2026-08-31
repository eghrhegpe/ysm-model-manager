package ysm

import (
	"encoding/json"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// TexInfo 轻量级纹理尺寸（不解析完整模型）
type TexInfo struct {
	Path      string `json:"path"`
	TexWidth  int    `json:"texWidth"`
	TexHeight int    `json:"texHeight"`
}

// ScanModelTexSizes 扫描仓库文件读取纹理尺寸，不调用 YSMParser/WASM
// 仅支持 zip/7z 格式（未加密模型），加密 .ysm 返回 0,0
func ScanModelTexSizes(entries []ModelEntry) []TexInfo {
	var results []TexInfo
	for _, e := range entries {
		path := e.Path
		tw, th := readTexSizeFromFile(path)
		results = append(results, TexInfo{
			Path:      path,
			TexWidth:  tw,
			TexHeight: th,
		})
	}
	return results
}

// ModelEntry 轻量级条目（仅用于纹理扫描签名，调用方传入完整路径）
type ModelEntry struct {
	Path string
	Name string
}

// readTexSizeFromFile 从文件读取纹理尺寸，不解析模型骨骼
func readTexSizeFromFile(path string) (int, int) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".zip":
		return readTexFromZip(path)
	case ".7z":
		return readTexFrom7z(path)
	default:
		// .ysm 加密模型无法在不解码的情况下读取纹理尺寸
		return 0, 0
	}
}

// readTexFromZip 从 zip 中提取 geometry JSON 读取纹理尺寸
func readTexFromZip(path string) (int, int) {
	// limit+1 探测截断（ADR-033 陷阱），两个循环共用
	const maxTexJSON = types.MaxReadLimit
	r, err := container.OpenZipPath(path)
	if err != nil {
		return 0, 0
	}
	defer r.Close()

	// 遍历所有 .json 条目（含非标准命名）找含 minecraft:geometry 的几何 JSON。
	// 原实现为两个逐字节相同的循环（首循环注释误标「查找 geometry JSON」却未按名过滤，
	// 与次循环完全等价），每个 JSON 条目被打开读取两次——合并为单循环，行为不变
	// （首命中即返回，两循环合起来同样是首命中返回）。
	for _, f := range r.Entries() {
		name := strings.ToLower(f.Name())
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		// ADR-044 策略 A：统一走 fsutil.ReadLimitedEntry（超限/错误返回 nil → 跳过）
		data := fsutil.ReadLimitedEntry(rc, int64(maxTexJSON))
		if data == nil {
			continue
		}
		if w, h := extractTexSizeFromGeometryBytes(data); w > 0 && h > 0 {
			return w, h
		}
	}
	return 0, 0
}

// readTexFrom7z 从 7z 读取纹理尺寸（真解压，遍历条目找 geometry JSON）。
// 复用 bodgit/sevenzip（go/geometry/archive.go 已用于 PNG 提取），OpenReader 路径
// 直开避免整读大 7z 进内存（原 64KB 文本扫描对压缩内容永不命中，静默返回 0,0——
// 子代理审计 P3：真实 .7z 的纹理尺寸一直缺失）。
func readTexFrom7z(path string) (int, int) {
	// 与 readTexFromZip 同上限（50MB/条目，ADR-033 截断防线）
	const maxTexJSON = types.MaxReadLimit
	zr, err := container.Open7zPath(path)
	if err != nil {
		return 0, 0
	}
	defer zr.Close()
	// 条目遍历模式对齐 readTexFromZip：非 .json 跳过，ysm.json 自身无 geometry 也跳过
	for _, f := range zr.Entries() {
		name := strings.ToLower(f.Name())
		if !strings.HasSuffix(name, ".json") || types.IsYsmEntryJSON(filepath.Base(name)) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		// ADR-044 策略 A：统一走 fsutil.ReadLimitedEntry（超限/错误返回 nil → 跳过）
		data := fsutil.ReadLimitedEntry(rc, int64(maxTexJSON))
		if data == nil {
			continue
		}
		if w, h := extractTexSizeFromGeometryBytes(data); w > 0 && h > 0 {
			return w, h
		}
	}
	return 0, 0
}

// clampTexDim P3 修复（子代理审计）：float64→int 溢出钳制——畸形 JSON 如
// texture_width:1e100（合法数字）int() 溢出为最小 int，巨大负数流入统计展示。
// 钳到 [0, 65536]，与 go/geometry/parse.go:66-73 口径一致（合法贴图远小于此）。
func clampTexDim(v float64) int {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	if v <= 0 {
		return 0
	}
	if v >= 65536 {
		return 65536
	}
	return int(v)
}

// extractTexSizeFromGeometryBytes 从 geometry JSON 字节提取纹理尺寸
func extractTexSizeFromGeometryBytes(data []byte) (w, h int) {
	var raw struct {
		Geometry []struct {
			Description struct {
				TextureWidth  float64 `json:"texture_width"`
				TextureHeight float64 `json:"texture_height"`
			} `json:"description"`
		} `json:"minecraft:geometry"`
	}
	if err := json.Unmarshal(data, &raw); err != nil || len(raw.Geometry) == 0 {
		return 0, 0
	}
	return clampTexDim(raw.Geometry[0].Description.TextureWidth), clampTexDim(raw.Geometry[0].Description.TextureHeight)
}

// ScanFiles 读取目录下所有支持的文件条目（供 ScanModelTexSizes 使用）
func ScanFiles(filesRoot string) []ModelEntry {
	var entries []ModelEntry
	// R29 P3-3：WalkDir 返回 error 显式记录（callback 总返回 nil，
	// 故 WalkDir 的 error 只会是根目录打开失败等不可恢复错误）
	if err := filepath.WalkDir(filesRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[ysm] Walk 错误 (忽略): %v", err)
			return nil
		}
		if d.IsDir() {
			// 深度限制：与 extracted.go:266 口径一致（10 层），
			// 避免畸形仓库深层嵌套目录导致遍历耗时过长
			rel, relErr := filepath.Rel(filesRoot, path)
			if relErr == nil && strings.Count(rel, string(filepath.Separator)) > 10 {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".ysm" || ext == ".zip" || ext == ".7z" {
			entries = append(entries, ModelEntry{
				Path: path,
				Name: d.Name(),
			})
		}
		return nil
	}); err != nil {
		log.Printf("[ysm] ScanFiles WalkDir 失败 (返回部分结果): %v", err)
	}
	return entries
}
