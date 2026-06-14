// ========== 批量导出 + 高级搜索 + 模型扫描 ==========
// 从 app.go 拆分：骨骼导出、搜索、模型扫描、仓库索引
package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/installer"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
)

// ========== 批量导出骨骼结构 ==========
func (a *App) ExportBoneStructures(repoRoot string) (string, error) {
	entries := a.ScanModelEntries(repoRoot)
	if len(entries) == 0 {
		return "", fmt.Errorf("仓库中没有模型文件")
	}

	var lines []string
	lines = append(lines, "YSM Model Manager — 骨骼结构批量导出")
	lines = append(lines, fmt.Sprintf("仓库: %s", repoRoot))
	lines = append(lines, fmt.Sprintf("文件总数: %d", len(entries)))
	lines = append(lines, fmt.Sprintf("导出时间: %s", time.Now().Format("2006-01-02 15:04:05")))
	lines = append(lines, "")
	lines = append(lines, "="+strings.Repeat("=", 78))
	lines = append(lines, "")

	totalBones := 0
	totalCubes := 0
	parsedCount := 0
	failCount := 0

	for i, entry := range entries {
		model := a.AnalyzeBedrockModel(entry.Path)
		relPath := entry.Name
		lines = append(lines, fmt.Sprintf("[%d/%d] %s", i+1, len(entries), relPath))
		if model.BoneCount > 0 {
			parsedCount++
			totalBones += model.BoneCount
			totalCubes += model.CubeCount
			lines = append(lines, fmt.Sprintf("  🦴 骨骼: %d  |  📦 立方体: %d  |  📐 纹理: %dx%d",
				model.BoneCount, model.CubeCount, model.TexWidth, model.TexHeight))
			for _, b := range model.Bones {
				cs := len(b.Cubes)
				if cs > 0 {
					lines = append(lines, fmt.Sprintf("  ├─ %s (%d 方)", b.Name, cs))
				} else {
					lines = append(lines, fmt.Sprintf("  ├─ %s (结构骨骼)", b.Name))
				}
			}
		} else {
			failCount++
			lines = append(lines, "  ⚠️ 未解析到骨骼数据")
		}
		lines = append(lines, "")
	}
	lines = append(lines, "="+strings.Repeat("=", 78))
	lines = append(lines, "")
	lines = append(lines, fmt.Sprintf("✅ 成功解析: %d / %d", parsedCount, len(entries)))
	lines = append(lines, fmt.Sprintf("❌ 解析失败: %d", failCount))
	lines = append(lines, fmt.Sprintf("🦴 骨骼总数: %d", totalBones))
	lines = append(lines, fmt.Sprintf("📦 立方体总数: %d", totalCubes))
	lines = append(lines, "")
	lines = append(lines, "--- 生成完毕 ---")
	return strings.Join(lines, "\n"), nil
}

// ExportModelStructureJSON 导出单模型骨骼结构
func (a *App) ExportModelStructureJSON(modelPath string) string {
	model := a.AnalyzeBedrockModel(modelPath)
	if model.BoneCount == 0 {
		return "{}"
	}
	type boneInfo struct {
		Name   string     `json:"name"`
		Parent string     `json:"parent,omitempty"`
		Pivot  [3]float64 `json:"pivot"`
		Cubes  int        `json:"cubes"`
		TexIdx int        `json:"texIdx"`
	}
	type modelInfo struct {
		File       string     `json:"file"`
		BoneCount  int        `json:"boneCount"`
		CubeCount  int        `json:"cubeCount"`
		TexWidth   int        `json:"texWidth"`
		TexHeight  int        `json:"texHeight"`
		TextureCnt int        `json:"textureCount"`
		Bones      []boneInfo `json:"bones"`
	}
	info := modelInfo{
		File: filepath.Base(modelPath), BoneCount: model.BoneCount,
		CubeCount: model.CubeCount, TexWidth: model.TexWidth,
		TexHeight: model.TexHeight, TextureCnt: len(model.Textures),
	}
	for _, b := range model.Bones {
		info.Bones = append(info.Bones, boneInfo{
			Name: b.Name, Parent: b.Parent, Pivot: b.Pivot,
			Cubes: len(b.Cubes), TexIdx: 0,
		})
	}
	data, _ := json.MarshalIndent(info, "", "  ")
	return string(data)
}

// ========== 高级搜索 ==========
func (a *App) SearchModels(repoRoot string, keyword string, minBones, maxBones, minCubes, maxCubes, minTex, maxTex int) []types.SearchResult {
	entries := a.ScanModelEntries(repoRoot)
	if len(entries) == 0 {
		return nil
	}
	var results []types.SearchResult
	kw := strings.ToLower(strings.TrimSpace(keyword))
	for _, entry := range entries {
		if kw != "" {
			name := strings.ToLower(entry.Name)
			if !strings.Contains(name, kw) && !strings.Contains(strings.ToLower(entry.Path), kw) {
				continue
			}
		}
		model := a.AnalyzeBedrockModel(entry.Path)
		if model.BoneCount == 0 {
			continue
		}
		if minBones > 0 && model.BoneCount < minBones {
			continue
		}
		if maxBones > 0 && model.BoneCount > maxBones {
			continue
		}
		if minCubes > 0 && model.CubeCount < minCubes {
			continue
		}
		if maxCubes > 0 && model.CubeCount > maxCubes {
			continue
		}
		if minTex > 0 && (model.TexWidth < minTex || model.TexHeight < minTex) {
			continue
		}
		if maxTex > 0 && (model.TexWidth > maxTex || model.TexHeight > maxTex) {
			continue
		}
		results = append(results, types.SearchResult{
			Name: entry.Name, Path: entry.Path,
			BoneCount: model.BoneCount, CubeCount: model.CubeCount,
			TexWidth: model.TexWidth, TexHeight: model.TexHeight,
		})
	}
	return results
}

func (a *App) SetRepoRoot(dir string) {
	if !installer.IsValidRepoRoot(dir) {
		return
	}
	a.RepoRoot = dir
}

// GenerateRepoIndex 扫描仓库目录，生成 index.json
func (a *App) GenerateRepoIndex(repoPath string) (string, error) {
	entries := a.ScanModelEntries(repoPath)
	type indexEntry struct {
		Name string `json:"name"`
		Path string `json:"path"`
		Size int64  `json:"size"`
		Hash string `json:"hash,omitempty"`
	}
	var list []indexEntry
	for _, e := range entries {
		relPath := e.Path
		if strings.HasPrefix(relPath, repoPath) {
			relPath = strings.TrimPrefix(relPath, repoPath)
			relPath = strings.TrimPrefix(relPath, "\\")
			relPath = strings.TrimPrefix(relPath, "/")
		}
		list = append(list, indexEntry{Name: e.Name, Path: relPath, Size: e.Size, Hash: e.Hash})
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return "", err
	}
	indexPath := filepath.Join(repoPath, "index.json")
	if err := os.WriteFile(indexPath, data, 0644); err != nil {
		return "", err
	}

	workflowDir := filepath.Join(repoPath, ".github", "workflows")
	if err := os.MkdirAll(workflowDir, 0755); err == nil {
		workflowPath := filepath.Join(workflowDir, "generate-index.yml")
		if _, err := os.Stat(workflowPath); os.IsNotExist(err) {
			os.WriteFile(workflowPath, []byte(generateIndexWorkflow), 0644)
		}
	}
	return indexPath, nil
}

const generateIndexWorkflow = `name: Generate index.json
on:
  push:
    branches: [main]
    paths:
      - "**.ysm"
      - "**.zip"
      - "**.7z"
  workflow_dispatch:
permissions:
  contents: write
jobs:
  generate-index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: 生成 index.json
        run: |
          cat > genindex.go << 'GOEOF'
          package main
          import (
            "crypto/sha256" "encoding/json" "fmt" "io" "os" "path/filepath" "strings"
          )
          type entry struct {
            Name string ` + "`json:\"name\"`" + `
            Path string ` + "`json:\"path\"`" + `
            Size int64  ` + "`json:\"size\"`" + `
            Hash string ` + "`json:\"hash,omitempty\"`" + `
          }
          func main() {
            var list []entry
            filepath.WalkDir(".", func(p string, d os.DirEntry, err error) error {
              if err != nil || d.IsDir() { return nil }
              ext := strings.ToLower(filepath.Ext(p))
              if ext != ".ysm" && ext != ".zip" && ext != ".7z" { return nil }
              if strings.Contains(p, "/.github") { return nil }
              rel, _ := filepath.Rel(".", p)
              rel = strings.ReplaceAll(rel, "\\", "/")
              fi, _ := d.Info()
              size := int64(0)
              if fi != nil { size = fi.Size() }
              hashStr := ""
              if f, err := os.Open(p); err == nil {
                h := sha256.New(); io.Copy(h, f); hashStr = fmt.Sprintf("%x", h.Sum(nil)); f.Close()
              }
              list = append(list, entry{Name: d.Name(), Path: rel, Size: size, Hash: hashStr})
              return nil
            })
            data, _ := json.MarshalIndent(list, "", "  ")
            os.WriteFile("index.json", data, 0644)
          }
          GOEOF
          go run genindex.go
          rm genindex.go
      - name: 提交更新
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add index.json
          if git diff --cached --quiet; then
            echo "index.json 无变化，跳过提交"
          else
            git commit -m ":arrows_counterclockwise: 自动更新 index.json"
            git push
          fi
`

// progressReader 包装 io.Reader，下载时通过回调推送进度
type progressReader struct {
	reader     io.Reader
	total      int64
	downloaded int64
	lastPct    int
	onProgress func(downloaded, total int64)
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.reader.Read(p)
	pr.downloaded += int64(n)
	if pr.total > 0 {
		pct := int(pr.downloaded * 100 / pr.total)
		if pct > pr.lastPct {
			pr.lastPct = pct
			if pr.onProgress != nil {
				pr.onProgress(pr.downloaded, pr.total)
			}
		}
	} else if n > 0 && pr.onProgress != nil {
		kb := pr.downloaded / 256 / 1024
		if kb > int64(pr.lastPct) {
			pr.lastPct = int(kb)
			pr.onProgress(pr.downloaded, pr.downloaded)
		}
	}
	return n, err
}

// scanCache 目录扫描结果缓存，2s TTL
var scanCache sync.Map

type scanCacheEntry struct {
	entries   []types.ModelEntry
	expiresAt time.Time
}

const scanCacheTTL = 2 * time.Second

// ========== 模型扫描 ==========
func (a *App) ScanModelEntries(dir string) []types.ModelEntry {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return []types.ModelEntry{}
	}
	// 检查缓存
	if v, ok := scanCache.Load(dir); ok {
		entry := v.(scanCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.entries
		}
	}
	entries := []types.ModelEntry{}
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if strings.HasSuffix(strings.ToLower(p), "\\.recycle") || strings.HasSuffix(strings.ToLower(p), "/.recycle") {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		originalExt := ext
		if strings.HasSuffix(strings.ToLower(p), ".ban") {
			originalExt = strings.ToLower(filepath.Ext(p[:len(p)-4]))
		}
		if originalExt != ".ysm" && originalExt != ".zip" && originalExt != ".7z" && originalExt != ".json" && originalExt != ".pmx" && originalExt != ".pmd" && originalExt != ".vrca" && originalExt != ".vrm" && originalExt != ".nbt" && originalExt != ".schematic" {
			return nil
		}
		// .json 只允许 ysm.json（动作/动画文件不应单独扫描推送）
		if originalExt == ".json" {
			baseName := strings.ToLower(filepath.Base(p))
			baseName = strings.TrimSuffix(baseName, ".ban")
			if baseName != "ysm.json" {
				return nil
			}
		}
		info, _ := d.Info()
		e := types.ModelEntry{Name: filepath.Base(p), Path: p, Ext: originalExt}
		if info != nil {
			e.Size = info.Size()
			e.ModTime = info.ModTime().UnixMilli()
		}
		// 计算 SHA256 供同步系统使用（GetInstanceStatus 依赖哈希匹配）
		// 跳过非 YSM 类型的大文件（MMD/VRC 文件可达数十 MB，哈希全量太慢）
		if originalExt == ".ysm" || originalExt == ".zip" || originalExt == ".7z" || originalExt == ".json" {
			e.Hash = computeFileHash(p)
		}
		entries = append(entries, e)
		return nil
	})
	// 存入缓存
	scanCache.Store(dir, scanCacheEntry{entries: entries, expiresAt: time.Now().Add(scanCacheTTL)})
	return entries
}

// InvalidateScanCache 清空扫描缓存（同步完成后调用，确保下次扫描取最新数据）
func InvalidateScanCache() {
	scanCache.Range(func(key, _ interface{}) bool {
		scanCache.Delete(key)
		return true
	})
}

// computeFileHash 计算文件的 SHA256 哈希（用于同步系统文件匹配）
func computeFileHash(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	io.Copy(h, f)
	return fmt.Sprintf("%x", h.Sum(nil))
}

func (a *App) ScanCustomModels(dir string) []types.ModelEntry {
	return a.ScanModelEntries(strings.TrimSpace(dir))
}

func (a *App) ListModelAuthors() []types.AuthorInfo {
	if a.RepoRoot == "" {
		return nil
	}
	entries := a.ScanModelEntries(a.RepoRoot)
	type authorData struct {
		Count      int
		SampleFile string
	}
	authors := map[string]*authorData{}
	for _, e := range entries {
		name := e.Name
		if strings.HasSuffix(strings.ToLower(name), ".ban") {
			name = name[:len(name)-4]
		}
		if strings.HasPrefix(name, "[") {
			if idx := strings.Index(name, "]"); idx > 0 {
				author := name[1:idx]
				if author != "" {
					if _, ok := authors[author]; !ok {
						authors[author] = &authorData{SampleFile: e.Path}
					}
					authors[author].Count++
				}
			}
		}
	}
	var result []types.AuthorInfo
	for name, ad := range authors {
		result = append(result, types.AuthorInfo{Name: name, Count: ad.Count, SampleFile: ad.SampleFile})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Count > result[j].Count })
	return result
}

func (a *App) ListVersionInstances(mcRoot string) []types.VersionInstance {
	return ysmsync.ListVersions(strings.TrimSpace(mcRoot))
}

func (a *App) GetGlobalCustomDir(mcRoot string) string {
	return filepath.Join(mcRoot, "config", "yes_steve_model", "custom")
}

func (a *App) ListFileNames(dir string) []string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return []string{}
	}
	var names []string
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if strings.HasSuffix(strings.ToLower(p), "\\.recycle") || strings.HasSuffix(strings.ToLower(p), "/.recycle") {
				return filepath.SkipDir
			}
			return nil
		}
		names = append(names, filepath.Base(p))
		return nil
	})
	return names
}

func (a *App) CheckFileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ScanLocalAuthors 扫描所有本地资源目录，从文件名提取作者
// 返回统一格式的创作者列表（可直接合并到 creators.json）
func (a *App) ScanLocalAuthors() []types.WorkshopCreator {
	seen := map[string]bool{}
	var result []types.WorkshopCreator

	// 定义要扫描的目录和对应的类型标签
	type scanTarget struct {
		root string
		rtype string
		exts  []string
	}
	targets := []scanTarget{
		{a.GetRepoRoot("ysm"), "ysm", []string{".ysm", ".zip", ".7z", ".json"}},
		{a.GetRepoRoot("mmd-skin"), "mmd-skin", []string{".pmx", ".pmd"}},
		{a.GetRepoRoot("vrchat-avatar"), "vrchat-avatar", []string{".vrca", ".vrm"}},
		{a.GetRepoRoot("resourcepack"), "resourcepack", []string{".zip"}},
		{a.GetRepoRoot("shaderpack"), "shaderpack", []string{".zip"}},
		{a.GetRepoRoot("create-blueprint"), "create-blueprint", []string{".nbt", ".schematic"}},
	}

	for _, t := range targets {
		if t.root == "" {
			continue
		}
		entries := a.ScanModelEntries(t.root)
		for _, e := range entries {
			name := e.Name
			if strings.HasSuffix(strings.ToLower(name), ".ban") {
				name = name[:len(name)-4]
			}
			// 提取 [作者]
			if !strings.HasPrefix(name, "[") {
				continue
			}
			idx := strings.Index(name, "]")
			if idx <= 0 {
				continue
			}
			author := name[1:idx]
			if author == "" {
				continue
			}
			key := author + "@" + t.rtype
			if seen[key] {
				continue
			}
			seen[key] = true
			// 合并已有的 type 标签
			existing := -1
			for i, cr := range result {
				if cr.Name == author {
					existing = i
					break
				}
			}
			if existing >= 0 {
				// 追加类型标签
				if !strings.Contains(result[existing].Type, t.rtype) {
					result[existing].Type += ";" + t.rtype
				}
			} else {
				result = append(result, types.WorkshopCreator{
					Name: author,
					Desc: "来自本地仓库",
					Type: t.rtype,
				})
			}
		}
	}
	return result
}

func (a *App) OpenFolder(dir string) error {
	// 统一路径分隔符（Windows explorer 不接受混合斜杠）
	dir = filepath.Clean(dir)
	return exec.Command("explorer", dir).Start()
}
