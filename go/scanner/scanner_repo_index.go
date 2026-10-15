// scanner_repo_index.go：仓库 index.json 生成与 workflow（原 scanner.go 拆分，2026-10 文件行数治理）。
// GenerateRepoIndex / buildRepoIndexEntries / ensureRepoWorkflow / buildGenerateIndexWorkflow——
// 生成 index.json + GitHub Actions workflow（扫描结果持久化）。
package scanner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// ========== 仓库索引 ==========

// repoIndexEntry 是 index.json 的单条序列化格式（供 GitHub Actions/Linux 消费）
type repoIndexEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Size int64  `json:"size"`
	Hash string `json:"hash,omitempty"`
}

// GenerateRepoIndex 扫描仓库目录，生成 index.json（供 GitHub Actions/Linux 消费，正斜杠路径）
func GenerateRepoIndex(repoPath string) (string, error) {
	InvalidatePath(repoPath) // 索引必须最新：绕过 30s 扫描缓存
	entries := ScanEntries(repoPath)
	list := buildRepoIndexEntries(entries, repoPath)
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return "", fmt.Errorf("序列化 index 条目失败: %w", err)
	}
	indexPath := filepath.Join(repoPath, "index.json")
	if err := fsutil.WriteFileAtomic(indexPath, data); err != nil {
		return "", fmt.Errorf("写入 index.json 失败: %w", err)
	}
	ensureRepoWorkflow(repoPath)
	return indexPath, nil
}

// buildRepoIndexEntries 把扫描条目转为 index.json 的条目列表：
// 把绝对路径换算成相对 repoPath 的路径（filepath.Rel 优先，失败时前缀兜底），
// 并统一转为正斜杠（ADR-011：消费方为 GitHub Actions Linux）。
func buildRepoIndexEntries(entries []types.ModelEntry, repoPath string) []repoIndexEntry {
	list := make([]repoIndexEntry, 0, len(entries))
	for _, e := range entries {
		relPath := e.Path
		// 用 filepath.Rel 替代大小写敏感的前缀裁剪，
		// 避免相对/绝对路径拼写差异把绝对路径泄露进 index.json
		if rp, err := filepath.Rel(repoPath, e.Path); err == nil {
			relPath = rp
		} else if strings.HasPrefix(relPath, repoPath) {
			relPath = strings.TrimPrefix(relPath, repoPath)
			relPath = strings.TrimLeft(relPath, `\/`)
		}
		relPath = filepath.ToSlash(relPath)
		list = append(list, repoIndexEntry{Name: e.Name, Path: relPath, Size: e.Size, Hash: e.Hash})
	}
	return list
}

// ensureRepoWorkflow 确保 <repo>/.github/workflows/generate-index.yml 存在，
// 不存在则写入内嵌的 generateIndexWorkflow（供 CI push 时自动重生成 index.json）。
// 本函数不阻断主流程：任何失败都进错误回调留痕，调用方继续返回 indexPath。
func ensureRepoWorkflow(repoPath string) {
	workflowDir := filepath.Join(repoPath, ".github", "workflows")
	if err := os.MkdirAll(workflowDir, fsutil.DirPerms); err != nil {
		// index.json 已成功生成，workflow 属附带能力：失败留痕不阻断（排障盲区补齐）
		emitScanError("[scanner] 创建 workflow 目录失败 %s: %v", workflowDir, err)
		return
	}
	workflowPath := filepath.Join(workflowDir, "generate-index.yml")
	if _, err := os.Stat(workflowPath); !os.IsNotExist(err) {
		return // 已存在，不覆盖（用户自定义 workflow 保留）
	}
	// 裸 os.WriteFile 中途崩溃可能留残缺文件，被上方 os.Stat 误判为「已存在」而永久静默失效；
	// WriteFileAtomic（临时文件+rename，ADR-109 §4）保证目标「要么不存在、要么完整」。
	if err := fsutil.WriteFileAtomic(workflowPath, []byte(buildGenerateIndexWorkflow())); err != nil {
		// 写入失败留痕——静默失败会让 CI 自动重生成 index 静默失效，用户无感知
		emitScanError("[scanner] 写入 workflow %s 失败: %v", workflowPath, err)
	}
}

// extConditionPlaceholder 扩展名过滤条件注入位：buildGenerateIndexWorkflow 以
// registry.AllExts() 动态填充（原手抄清单是注册表之外的第三份平行实现，
// 注册表新增扩展后 CI 索引静默漏收——口径单一事实源回归 resource_types.json）。
const extConditionPlaceholder = "__EXT_CONDITION__"

// buildGenerateIndexWorkflow 生成 CI workflow 内容：扩展名过滤条件从注册表动态注入。
func buildGenerateIndexWorkflow() string {
	conds := make([]string, 0, 8)
	for _, ext := range registry.AllExts() {
		if ext == ".json" {
			continue // .json 仅放行 ysm.json，模板内走单独判定路径
		}
		conds = append(conds, `ext != "`+ext+`"`)
	}
	return strings.Replace(generateIndexWorkflowTemplate, extConditionPlaceholder, strings.Join(conds, " && "), 1)
}

const generateIndexWorkflowTemplate = `name: Generate index.json
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
          // 每行一个 import：原为单行并列（"crypto/sha256" "encoding/json" …，把已退役的
          // cmd/genindex/main.go 压进 heredoc 时压掉了换行）——Go 的 ImportSpec 之间必须有
          // 分号或换行，单行并列是语法错误，CI 该步骤 go run genindex.go 恒失败、
          // index.json 永不由 CI 更新（与「CI 索引缺 ysm.json 条目」互为表里）。
          import (
            "crypto/sha256"
            "encoding/json"
            "fmt"
            "io"
            "os"
            "path/filepath"
            "strings"
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
              if err != nil { return nil }
              // 目录级跳过口径与 Go 侧 scanner.ScanEntries 同步（fsutil.IsRecycleDir 的
              // .recycle / fsutil.IsRelinkBackupPath 的 .relink-bak-<ts> 尸体子树 /
              // registry.IsDisableSuffix 的目录级禁用载体 / .github）——CI 若下钻这些子树，
              // 回收站副本、relink 尸体与目录级禁用模型会被当**活跃条目**写进 index.json，
              // 与应用内「生成索引」的产出互相漂移。
              if d.IsDir() {
                lowerName := strings.ToLower(d.Name())
                if lowerName == ".recycle" || d.Name() == ".github" || strings.Contains(lowerName, ".relink-bak-") || strings.HasSuffix(lowerName, ".disabled") || strings.HasSuffix(lowerName, ".ban") { return filepath.SkipDir }
                return nil
              }
              // 扩展名口径与 Go 侧 scanner.ScanEntries 对齐（含 .disabled/.ban 恢复、
              // .json 仅收 ysm.json）；扩展清单与 go/types 注册表（resource_types.json）同步
              lower := strings.ToLower(p)
              restored := ""
              if strings.HasSuffix(lower, ".disabled") { restored = p[:len(p)-len(".disabled")] } else if strings.HasSuffix(lower, ".ban") { restored = p[:len(p)-len(".ban")] }
              ext := strings.ToLower(filepath.Ext(p))
              if restored != "" { ext = strings.ToLower(filepath.Ext(restored)) }
              if ext == ".json" {
                // 判定基准必须是**原路径 p**，不是 restored：普通 ysm.json 无禁用后缀时
                // restored 为空串 → filepath.Base("") == "." → 恒不等于 ysm.json → 所有普通
                // ysm.json 组条目被静默丢弃（存量 bug：应用内 GenerateRepoIndex 含它们，
                // 用户点「生成索引」提交后 CI 重生成的 index.json 反而缺条目）。
                // 后缀剥离顺序与 registry.NormalizeResourceName 一致（先 .disabled 后 .ban）。
                base := strings.ToLower(filepath.Base(p))
                base = strings.TrimSuffix(base, ".disabled")
                base = strings.TrimSuffix(base, ".ban")
                if base != "ysm.json" { return nil }
              }
              // 走到这里的 .json 必是 ysm.json（上一段白名单已滤掉其余 .json）；扩展名否定链
              // 由 buildGenerateIndexWorkflow 从注册表生成时**刻意不含 .json**（注释：.json 走
              // 白名单单独判定）——若此处照常套用否定链，ext=".json" 与链上每一项都不等 →
              // 恒真 → 刚放行的 ysm.json 又被丢回门外（同一缺陷的第二道门，2026-10 锐评复盘）。
              if ext != ".json" && __EXT_CONDITION__ { return nil }
              if strings.Contains(p, "/.github") { return nil }
              rel, _ := filepath.Rel(".", p)
              rel = filepath.ToSlash(rel)
              // 条目 name 口径与应用内 scanner_scan.go|processScanDirEntry → buildRepoIndexEntries
              // **同源，防两侧互改**：ysm.json 组条目取父目录名（工坊列表按模型夹展示组），
              // 其余取盘上文件名——含 X.ysm.disabled 这类禁用态全名（应用侧判定用的是
              // filepath.Base(p) 原文，不做后缀剥离）。
              // 根级退化：应用侧 p 是绝对路径，filepath.Base(Dir(p)) 得**仓库夹名**；
              // CI 侧 p 相对（Dir("ysm.json") == "."），故取 CWD 基名对齐同一语义，不落 "."。
              // 不齐的后果：用户「生成索引」提交后 CI 重生成并回写一份 name 不同的
              // index.json → 两侧反复互改（提交抖动），工坊列表把组条目显示成 "ysm.json"。
              name := d.Name()
              if strings.EqualFold(strings.TrimSpace(name), "ysm.json") {
                name = filepath.Base(filepath.Dir(p))
                if name == "." {
                  if wd, err := os.Getwd(); err == nil { name = filepath.Base(wd) }
                }
              }
              fi, _ := d.Info()
              size := int64(0)
              if fi != nil { size = fi.Size() }
              hashStr := ""
              if f, err := os.Open(p); err == nil {
                h := sha256.New(); io.Copy(h, f); hashStr = fmt.Sprintf("%x", h.Sum(nil)); f.Close()
              }
              list = append(list, entry{Name: name, Path: rel, Size: size, Hash: hashStr})
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
