// Package dedup 提供文件去重检测——纯函数，不绑定回收站或任何 UI
package dedup

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// ErrSymlinkRoot 扫描根目录自身是符号链接——去重只处理实际文件，符号链接根
// 会导致「假绿」（静默返回无重复但实际未扫描到目标树）。调用方应以 errors.Is 判定，
// 禁止 strings.Contains(err.Error(), ...) 文本匹配（陷阱 #11 错误分类）。
var ErrSymlinkRoot = errors.New("dedup: 扫描根目录是符号链接")

// FileEntry 文件条目
type FileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
}

// Group 重复文件分组
type Group struct {
	Hash  string      `json:"hash"`  // 算法生成的唯一标识
	Size  int64       `json:"size"`  // 单文件大小
	Files []FileEntry `json:"files"` // 文件列表
}

// ===== 共享并行哈希管道（ADR-119）=====
// 两个公开函数 FindDuplicateFiles / CountDuplicates 必须消费同一份管道——
// 串行收集 → 并行哈希 → 序号还原 → 分组，输出与串行实现逐字节一致。

// fileInfo 收集到的待哈希文件（保留遍历顺序，idx 即组序确定性的输入流序号）
type fileInfo struct {
	idx  int
	path string
	size int64
	mod  int64 // ModTime UnixMilli（对齐 FileEntry.ModTime）
}

// hashResult 并行哈希结果，按 fileInfo.idx 槽位落位（零共享写竞争）
type hashResult struct {
	hash string
	ok   bool // 读失败为 false（log-and-skip，与串行一致）
}

// computeHash 可注入变量：默认委托 algo.ComputeHash（策略化哈希）；测试可替换以
// 模拟读失败/计数（P3 并行读失败回归，与 texture_cache removeFile 同款手法）。
// 注：49afd979 曾删除本注入点（哈希统一走 algo 接口）但未同步 dedup_parallel_test.go，
// 导致测试包 undefined: computeHash 编译失败——恢复注入点并适配策略签名。
var computeHash = func(path string, algo HashAlgorithm) (string, error) {
	return algo.ComputeHash(path)
}

// collectFiles 串行 WalkDir 收集有效文件，保留遍历顺序。
// 收敛 FindDuplicateFiles 与 CountDuplicates 的共用遍历（原 walkHashedFiles，索引 6.8a）：
//   - 跳过符号链接（根本身是符号链接时返回 ErrSymlinkRoot——静默返回「无重复」= 假绿，
//     陷阱 #11：sentinel + errors.Is 判定，禁文本匹配）；
//   - 跳过目录（skipRecycle 时回收站目录 SkipDir，统一走 fsutil.IsRecycleDir）；
//   - 跳过空文件（不同用途的空文件不是重复文件）。
func collectFiles(dir string, skipRecycle bool) ([]fileInfo, error) {
	var files []fileInfo
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[dedup] 访问 %s 失败: %v", p, err)
			return nil
		}
		// 跳过符号链接（去重只处理实际文件）
		if d.Type()&os.ModeSymlink != 0 {
			if p == dir {
				return fmt.Errorf("%w: %s", ErrSymlinkRoot, dir)
			}
			return nil
		}
		if d.IsDir() {
			// ADR-044 策略 A：回收站排除统一走 fsutil.IsRecycleDir（EqualFold 大小写不敏感）
			if skipRecycle && fsutil.IsRecycleDir(p) {
				return filepath.SkipDir
			}
			return nil
		}

		// 只处理普通文件
		info, err := d.Info()
		if err != nil || info == nil {
			return nil
		}
		if info.Size() == 0 {
			// 跳过空文件——不同用途的空文件（占位符、空 .animation 等）不是重复文件
			return nil
		}
		files = append(files, fileInfo{
			idx:  len(files),
			path: p,
			size: info.Size(),
			mod:  info.ModTime().UnixMilli(),
		})
		return nil
	})
	return files, err
}

// hashFilesParallel 并行计算哈希，结果按收集顺序（idx 槽位）落位。
// workers = min(files, GOMAXPROCS)——小文件集自然 workers=1，与串行开销等价
// （ADR-119 P4：不设阈值双路径，统一走本管道）。
//
// size 预分组（零语义损失）：不同 size 的文件不可能同 hash（SHA256 同 ⟹ 内容同 ⟹ size 同），
// 唯一 size 的文件必不成组，跳过其哈希——消解大文件长尾（占死 worker 的大文件通常尺寸唯一），
// 输出逐字节不变（唯一尺寸文件本就永不进 len>1 组）。
// hashFilesParallel 的「读失败可见性不对称」（R27 P3-2 确认）：
//   - 唯一 size 文件不进 job（有意跳过哈希），其读失败不可见、不记日志
//   - 同 size 文件读失败会 log-and-skip
//
// 这是有意的取舍：唯一 size 文件本就不参与成组（无重复可能），
// 跳过哈希省一次 I/O。代价是「唯一 size 但读失败」的文件静默归类为「唯一 size 跳过」。
// 注意：唯一 size 文件**不被打开**（不进 job），其读失败自然不可见、不记日志——
// 这是有意的（该文件本就不参与成组），与「读失败 log-and-skip」仅针对已入 job 文件。
func hashFilesParallel(files []fileInfo, algo HashAlgorithm) []hashResult {
	n := len(files)
	results := make([]hashResult, n)
	if n == 0 {
		return results
	}
	sizeCount := make(map[int64]int, n)
	for _, f := range files {
		sizeCount[f.size]++
	}
	workers := runtime.GOMAXPROCS(0)
	if workers > n {
		workers = n
	}
	jobs := make(chan fileInfo)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// recover 防止 worker panic 导致主 goroutine 死锁：
			// 无缓冲 jobs channel 在 jobs <- f 处阻塞，worker panic 后
			// wg 永不 Done、close(jobs) 永不执行（R27 P3-1）。
			// panic 的槽位 results[idx] 留零值（ok=false），调用方见 log-and-skip。
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[dedup] worker panic: %v", r)
				}
			}()
			for f := range jobs {
				hash, err := computeHash(f.path, algo)
				if err != nil {
					log.Printf("[dedup] 哈希计算失败 %s: %v", f.path, err)
					continue // log-and-skip
				}
				results[f.idx] = hashResult{hash: hash, ok: true}
			}
		}()
	}
	for _, f := range files {
		if sizeCount[f.size] > 1 { // 唯一 size 不进 job（results 槽留零值 ok=false）
			jobs <- f
		}
	}
	close(jobs)
	wg.Wait()
	return results
}

// resolveScanRoot 入口校验公共段：TrimSpace → 空判 → Abs 化（相对路径下
// FileEntry.Path 为相对路径，下游 recycle.Move 按 CWD 解析可能移到错误位置）。
// Abs 失败（如 Windows 含 NUL 字节的路径）必须显式报错——静默退回入参形态会让
// WalkDir→Lstat 失败被 log 吞掉并返回「无重复」= 假绿（与 ErrSymlinkRoot 同类的
// 静默漏扫）。收敛 FindDuplicateFiles/CountDuplicates 重复入口（R21 审核 P3-3），
// 错误消息与两函数原实现逐字一致。
func resolveScanRoot(dir string) (string, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return "", fmt.Errorf("目录为空")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("dedup: 无法解析扫描目录 %q: %w", dir, err)
	}
	return abs, nil
}

// resolveHashAlgorithm 取首个去重配置并实例化哈希算法（nil → 默认 DeepHash）。
func resolveHashAlgorithm(config ...*types.DedupConfig) HashAlgorithm {
	var cfg *types.DedupConfig
	if len(config) > 0 {
		cfg = config[0]
	}
	return NewHashAlgorithm(cfg)
}

// FindDuplicateFiles 扫描目录，按配置的哈希算法分组，返回包含重复的分组
// skipRecycle 为 true 时跳过 .recycle 子目录
// config 为去重配置，传入 nil 则使用默认配置（DeepHash）
// 消费共享并行哈希管道（ADR-119）：collectFiles + hashFilesParallel + 串行分组，
// 组顺序 = hash 首次出现于遍历的顺序，组内 Files 按 Path 排序（确定性，逐字节与串行一致）。
func FindDuplicateFiles(dir string, skipRecycle bool, config ...*types.DedupConfig) ([]Group, error) {
	abs, err := resolveScanRoot(dir)
	if err != nil {
		return nil, err
	}
	dir = abs
	algo := resolveHashAlgorithm(config...)

	files, err := collectFiles(dir, skipRecycle)
	if err != nil {
		return nil, err
	}
	results := hashFilesParallel(files, algo)

	hashGroups := make(map[string]*Group)
	// 使用 map 保持插入顺序
	var orderedKeys []string
	for i, f := range files {
		r := results[i]
		if !r.ok {
			continue // 读失败 log-and-skip，与串行一致
		}
		if g, ok := hashGroups[r.hash]; ok {
			g.Files = append(g.Files, FileEntry{
				Name:    filepath.Base(f.path),
				Path:    f.path,
				Size:    f.size,
				ModTime: f.mod,
			})
		} else {
			hashGroups[r.hash] = &Group{
				Hash: r.hash,
				Size: f.size,
				Files: []FileEntry{{
					Name:    filepath.Base(f.path),
					Path:    f.path,
					Size:    f.size,
					ModTime: f.mod,
				}},
			}
			orderedKeys = append(orderedKeys, r.hash)
		}
	}

	// 只保留有重复的分组，按首次出现顺序
	result := []Group{}
	for _, key := range orderedKeys {
		g := hashGroups[key]
		if len(g.Files) > 1 {
			sort.Slice(g.Files, func(i, j int) bool {
				return g.Files[i].Path < g.Files[j].Path
			})
			result = append(result, *g)
		}
	}
	return result, nil
}

// CountDuplicates 统计重复文件数量（比 FindDuplicateFiles 轻量，只计数）
// 同样消费共享并行哈希管道（ADR-119 P1：与 FindDuplicateFiles 同源，禁止双实现漂移）。
func CountDuplicates(dir string, skipRecycle bool, config ...*types.DedupConfig) (groups int, extraFiles int, err error) {
	groups = 0
	extraFiles = 0

	abs, err := resolveScanRoot(dir)
	if err != nil {
		return 0, 0, err
	}
	dir = abs
	algo := resolveHashAlgorithm(config...)

	files, err := collectFiles(dir, skipRecycle)
	if err != nil {
		return 0, 0, err
	}
	results := hashFilesParallel(files, algo)

	hashCount := make(map[string]int)
	for i := range files {
		if !results[i].ok {
			continue // 读失败 log-and-skip
		}
		hashCount[results[i].hash]++
	}

	for _, count := range hashCount {
		if count > 1 {
			groups++
			extraFiles += count - 1
		}
	}
	return groups, extraFiles, nil
}
