// ===== 模型扫描 + 作者提取 + 仓库索引（ADR-003 P2 Logic Sinking）=====
// 从 internal/app/app_scan.go 下沉：目录扫描、SHA256 哈希、扫描缓存、
// 作者提取、index.json 生成。纯 Go 逻辑，无 Wails runtime 依赖；
// tagsStore 填充与 AddOpLog 日志由薄壳处理。
package scanner

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/types"
)

// ========== 扫描缓存（30s TTL）==========

var scanCache sync.Map

// cacheGen 缓存代际：InvalidateCache/InvalidatePath 递增。
// 在途扫描 Store 前比对代际，若扫描期间缓存已被失效则丢弃本次结果，
// 防止「刚失效又被旧扫描结果重新 Store」导致失效白做（P2 竞态修复）。
var cacheGen uint64

type scanCacheEntry struct {
	entries   []types.ModelEntry
	expiresAt time.Time
}

const scanCacheTTL = 30 * time.Second

// normalizeScanKey 统一缓存 key：TrimSpace + filepath.Clean（去尾部分隔符/相对路径归一）。
// ScanEntries 与 InvalidatePath 必须共用同一规整，否则失效 key 与扫描 key 字节级不一致会脱靶（P2 修复）。
func normalizeScanKey(dir string) string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return ""
	}
	return filepath.Clean(dir)
}

// InvalidateCache 清空全部扫描缓存（下载/导入/同步后调用）
func InvalidateCache() {
	cacheGen++
	scanCache.Range(func(key, _ interface{}) bool {
		scanCache.Delete(key)
		return true
	})
}

// InvalidatePath 删除指定目录的扫描缓存（启用/禁用 .ban 后调用）
func InvalidatePath(dir string) {
	cacheGen++
	scanCache.Delete(normalizeScanKey(dir))
}

// ========== 模型扫描 ==========

// ScanEntries 扫描目录下的模型文件（含 .recycle 排除、扩展名过滤、SHA256 哈希、30s TTL 缓存）
func ScanEntries(dir string) []types.ModelEntry {
	entries, _ := ScanEntriesWithHit(dir)
	return entries
}

// ScanEntriesWithHit 同 ScanEntries，但额外返回是否命中 30s 缓存。
// 调用方据此决定是否记录扫描日志，避免 30s 内重复访问同一目录时刷屏操作日志面板。
func ScanEntriesWithHit(dir string) ([]types.ModelEntry, bool) {
	dir = normalizeScanKey(dir)
	if dir == "" {
		return []types.ModelEntry{}, false
	}
	// 记录扫描开始时间（进入时），TTL 从此时刻算，不被扫描耗时侵蚀
	startTime := time.Now()
	// 记录进入时代际：扫描期间若缓存被失效，Store 前比对并丢弃结果
	gen := cacheGen
	// 检查缓存
	if v, ok := scanCache.Load(dir); ok {
		entry := v.(scanCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			// P2 修复：命中路径克隆后返回，避免调用方（app_scan.go HasTags 填充）写回内部切片，
			// 污染缓存后备数组 + 并发扫描数据竞争
			return append([]types.ModelEntry(nil), entry.entries...), true
		}
	}
	entries := []types.ModelEntry{}
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			fmt.Printf("[scanner] walk error: %s: %v\n", p, err)
			return nil
		}
		if d.IsDir() {
			// P2 修复：用 d.Name() + EqualFold 精确匹配 .recycle 目录，
			// 与 go/sync 排除口径一致，避免子串误杀 foo.recycle.ysm 等合法文件
			if strings.EqualFold(d.Name(), ".recycle") {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		originalExt := ext
		if strings.HasSuffix(strings.ToLower(p), ".ban") {
			originalExt = strings.ToLower(filepath.Ext(p[:len(p)-4]))
		}
		if !types.IsSupportedExt(originalExt) {
			return nil
		}
		// .json 只允许 ysm.json（动作/动画文件不应单独扫描推送）
		if originalExt == ".json" {
			baseName := strings.ToLower(filepath.Base(p))
			baseName = strings.TrimSuffix(baseName, ".ban")
			if !types.IsYsmEntryJSON(baseName) {
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
		// 蓝图文件（.nbt/.schematic/.litematic）通常较小，计入哈希以支持同步对比
		if originalExt == ".ysm" || originalExt == ".zip" || originalExt == ".7z" || originalExt == ".json" ||
			originalExt == ".nbt" || originalExt == ".schematic" || originalExt == ".litematic" {
			e.Hash = ComputeFileHash(p)
		}
		entries = append(entries, e)
		return nil
	})
	// P3 修复：克隆 slice 后 Store，避免 sync.Map.Load 读到 WalkDir 中途
	// append 的部分写入（单线程 Wails 场景安全，但并发扫描无 race）
	stored := append([]types.ModelEntry(nil), entries...)
	// P2 修复：扫描期间缓存被失效（cacheGen 已变）则丢弃结果，不重新 Store，
	// 否则刚执行的 Invalidate 被在途扫描的旧结果覆盖（带全新 30s TTL）
	if cacheGen == gen {
		scanCache.Store(dir, scanCacheEntry{entries: stored, expiresAt: startTime.Add(scanCacheTTL)})
	}
	return entries, false
}

// ComputeFileHash 计算文件的 SHA256 哈希（用于同步系统文件匹配）
func ComputeFileHash(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	// P3 修复：检查 io.Copy 读错误，读失败返回空哈希（与 open 失败一致），
	// 避免截断哈希静默进入同步匹配（截断哈希与完整哈希无法区分）
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

// ========== 作者提取 ==========

// ListModelAuthors 从扫描条目提取 [作者] 前缀统计（按出现次数降序）
func ListModelAuthors(entries []types.ModelEntry) []types.AuthorInfo {
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

// ScanLocalAuthors 扫描各资源类型根目录，从文件名提取 [作者]（roots: rtype→root）
func ScanLocalAuthors(roots map[string]string) []types.WorkshopCreator {
	seen := map[string]bool{}
	var result []types.WorkshopCreator

	for rtype, root := range roots {
		if root == "" {
			continue
		}
		entries := ScanEntries(root)
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
			key := author + "@" + rtype
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
				if !strings.Contains(result[existing].Type, rtype) {
					result[existing].Type += ";" + rtype
				}
			} else {
				result = append(result, types.WorkshopCreator{
					Name: author,
					Desc: "来自本地仓库",
					Type: rtype,
				})
			}
		}
	}
	return result
}

// ========== 仓库索引 ==========

// GenerateRepoIndex 扫描仓库目录，生成 index.json（供 GitHub Actions/Linux 消费，正斜杠路径）
func GenerateRepoIndex(repoPath string) (string, error) {
	entries := ScanEntries(repoPath)
	type indexEntry struct {
		Name string `json:"name"`
		Path string `json:"path"`
		Size int64  `json:"size"`
		Hash string `json:"hash,omitempty"`
	}
	var list []indexEntry
	for _, e := range entries {
		relPath := e.Path
		// P3 修复：用 filepath.Rel 替代大小写敏感的前缀裁剪，
		// 避免相对/绝对路径拼写差异把绝对路径泄露进 index.json
		if rp, err := filepath.Rel(repoPath, e.Path); err == nil {
			relPath = rp
		} else if strings.HasPrefix(relPath, repoPath) {
			relPath = strings.TrimPrefix(relPath, repoPath)
			relPath = strings.TrimLeft(relPath, `\/`)
		}
		// index.json 供 GitHub Actions（Linux）消费，路径统一正斜杠（ADR-011）
		relPath = filepath.ToSlash(relPath)
		list = append(list, indexEntry{Name: e.Name, Path: relPath, Size: e.Size, Hash: e.Hash})
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return "", err
	}
	indexPath := filepath.Join(repoPath, "index.json")
	// P3 修复：临时文件 + rename 原子替换，避免崩溃/中断留下半截 index.json（陷阱 #8 变体）
	tmpPath := indexPath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return "", err
	}
	if err := os.Rename(tmpPath, indexPath); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}

	workflowDir := filepath.Join(repoPath, ".github", "workflows")
	if err := os.MkdirAll(workflowDir, 0755); err == nil {
		workflowPath := filepath.Join(workflowDir, "generate-index.yml")
		if _, err := os.Stat(workflowPath); os.IsNotExist(err) {
			_ = os.WriteFile(workflowPath, []byte(generateIndexWorkflow), 0644)
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
