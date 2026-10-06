package scanner

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestWalkDirParallel_MatchesWalkDir 逐条对标 filepath.WalkDir：
// 同一棵树、同一回调，排序后条目集合必须完全一致。
func TestWalkDirParallel_MatchesWalkDir(t *testing.T) {
	root := t.TempDir()
	// 建一棵三层树：model_0000/ysm.json, model_0000/f00.ysm, ...
	for f := 0; f < 20; f++ {
		d := filepath.Join(root, fmt.Sprintf("model_%04d", f))
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
		for j := 0; j < 4; j++ {
			p := filepath.Join(d, fmt.Sprintf("f%02d.ysm", j))
			if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.WriteFile(filepath.Join(d, "ysm.json"), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// 顺序基准
	var seq []string
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		seq = append(seq, p)
		return nil
	})
	sort.Strings(seq)

	// 并行对照
	var mu sync.Mutex
	var par []string
	err := walkDirParallel(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		mu.Lock()
		par = append(par, p)
		mu.Unlock()
		return nil
	})
	if err != nil {
		t.Fatalf("walkDirParallel 返回错误: %v", err)
	}
	sort.Strings(par)

	if len(seq) != len(par) {
		t.Fatalf("条目数不一致: WalkDir=%d walkDirParallel=%d", len(seq), len(par))
	}
	for i := range seq {
		if seq[i] != par[i] {
			t.Fatalf("第 %d 条不一致:\n  WalkDir:        %s\n  walkDirParallel: %s", i, seq[i], par[i])
		}
	}
}

// TestWalkDirParallel_SkipDir 验证 SkipDir 语义：回调返回 SkipDir 时子树不展开。
func TestWalkDirParallel_SkipDir(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "keep"), 0o755)
	os.MkdirAll(filepath.Join(root, "skip", "nested"), 0o755)
	os.WriteFile(filepath.Join(root, "keep", "a.ysm"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(root, "skip", "b.ysm"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(root, "skip", "nested", "c.ysm"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(root, "root.ysm"), []byte("x"), 0o644)

	var mu sync.Mutex
	var got []string
	err := walkDirParallel(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && filepath.Base(p) == "skip" {
			return fs.SkipDir
		}
		if !d.IsDir() {
			mu.Lock()
			got = append(got, filepath.Base(p))
			mu.Unlock()
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walkDirParallel 返回错误: %v", err)
	}

	gotSet := map[string]bool{}
	for _, s := range got {
		gotSet[s] = true
	}
	if !gotSet["root.ysm"] {
		t.Error("根目录文件应被访问")
	}
	if !gotSet["a.ysm"] {
		t.Error("keep/ 下的文件应被访问")
	}
	if gotSet["b.ysm"] || gotSet["c.ysm"] {
		t.Error("skip/ 子树内的文件不应被访问（SkipDir 语义）")
	}
}

// TestWalkDirParallel_SkipAll 验证 fs.SkipAll 语义：回调返回 SkipAll 时中止遍历。
func TestWalkDirParallel_SkipAll(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 50; i++ {
		d := filepath.Join(root, fmt.Sprintf("d%02d", i))
		os.MkdirAll(d, 0o755)
		os.WriteFile(filepath.Join(d, "f.ysm"), []byte("x"), 0o644)
	}

	var count atomic.Int32
	err := walkDirParallel(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		c := count.Add(1)
		if c >= 5 {
			return fs.SkipAll
		}
		return nil
	})
	if err != fs.SkipAll {
		t.Fatalf("预期返回 fs.SkipAll，实际: %v", err)
	}
	if count.Load() < 5 {
		t.Fatalf("预期至少访问 5 个文件，实际: %d", count.Load())
	}
	// 中止后不应访问全部 50 个文件
	if count.Load() > 20 {
		t.Errorf("SkipAll 后不应继续遍历大部分文件，实际访问: %d", count.Load())
	}
}

// TestWalkDirParallel_RootNotExist 验证根不存在时的行为（对标 WalkDir）。
func TestWalkDirParallel_RootNotExist(t *testing.T) {
	nonExist := filepath.Join(t.TempDir(), "no_such_dir")
	called := 0
	err := walkDirParallel(nonExist, func(p string, d fs.DirEntry, err error) error {
		called++
		if err != nil {
			return nil // 对标 scanner 回调：记录错误后返回 nil
		}
		return nil
	})
	if err != nil {
		t.Fatalf("根不存在时 walkDirParallel 应返回 nil（回调已处理错误），实际: %v", err)
	}
	if called != 1 {
		t.Fatalf("预期仅回调一次（带 err），实际: %d", called)
	}
}

// TestWalkDirParallel_ContextCancel 验证 ctx 取消时中止遍历（ADR-197）。
func TestWalkDirParallel_ContextCancel(t *testing.T) {
	root := t.TempDir()
	// 树够大 + cancel 延迟够短：并行 worker 尚未跑完时 cancel 必然已触发。
	// 曾因树太小（100 文件）+ 5ms 延迟，24 核机器上 walk 在 cancel 前就结束——误报「未返回 SkipAll」。
	for i := 0; i < 800; i++ {
		d := filepath.Join(root, fmt.Sprintf("d%03d", i))
		os.MkdirAll(d, 0o755)
		for j := 0; j < 4; j++ {
			os.WriteFile(filepath.Join(d, fmt.Sprintf("f%02d.ysm", j)), []byte("x"), 0o644)
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(time.Millisecond)
		cancel()
	}()

	var visited atomic.Int32
	err := walkDirParallel(root, func(p string, d fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return fs.SkipAll
		}
		if err != nil || d.IsDir() {
			return nil
		}
		visited.Add(1)
		return nil
	})
	if err != fs.SkipAll {
		t.Fatalf("ctx 取消后预期返回 fs.SkipAll，实际: %v", err)
	}
	if visited.Load() >= 3200 {
		t.Errorf("ctx 取消后不应访问全部文件，实际: %d", visited.Load())
	}
}

func buildTree(root string, folders, per int) {
	for f := 0; f < folders; f++ {
		d := filepath.Join(root, fmt.Sprintf("model_%04d", f))
		os.MkdirAll(d, 0o755)
		for j := 0; j < per; j++ {
			os.WriteFile(filepath.Join(d, fmt.Sprintf("f%02d.ysm", j)), []byte("x"), 0o644)
		}
	}
}

// TestWalkDirParallel_Benchmark 对标 filepath.WalkDir 的吞吐——
// 40 文件夹 × 4 文件（对齐生产扫描器形态），直接比 readdir 并行收益。
func TestWalkDirParallel_Benchmark(t *testing.T) {
	root := t.TempDir()
	buildTree(root, 40, 4)

	// 预热
	for i := 0; i < 3; i++ {
		_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error { return nil })
		_ = walkDirParallel(root, func(p string, d fs.DirEntry, err error) error { return nil })
	}

	iters := 100
	tSeq := make([]time.Duration, iters)
	tPar := make([]time.Duration, iters)
	for i := 0; i < iters; i++ {
		t0 := time.Now()
		_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error { return nil })
		tSeq[i] = time.Since(t0)
		t1 := time.Now()
		_ = walkDirParallel(root, func(p string, d fs.DirEntry, err error) error { return nil })
		tPar[i] = time.Since(t1)
	}

	med := func(ts []time.Duration) time.Duration {
		s := make([]time.Duration, len(ts))
		copy(s, ts)
		for i := 0; i < len(s)-1; i++ {
			for j := i + 1; j < len(s); j++ {
				if s[j] < s[i] {
					s[i], s[j] = s[j], s[i]
				}
			}
		}
		return s[len(s)/2]
	}

	ms := func(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
	mSeq := med(tSeq)
	mPar := med(tPar)
	fmt.Printf("\n=== 并行遍历实测（40 文件夹 × 4 文件 = 164 条目）===\n")
	fmt.Printf("  filepath.WalkDir（现状）    中位 %7.1fms\n", ms(mSeq))
	fmt.Printf("  walkDirParallel（新）      中位 %7.1fms\n", ms(mPar))
	fmt.Printf("  → %.2fx\n", float64(mSeq)/float64(mPar))
}

// 20 个 worker 各遍历一棵独立树，验证 outstanding 计数与队列关闭无竞争。
func TestWalkDirParallel_Race(t *testing.T) {
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			root := t.TempDir()
			for f := 0; f < 10; f++ {
				d := filepath.Join(root, fmt.Sprintf("m%02d", f))
				os.MkdirAll(d, 0o755)
				os.WriteFile(filepath.Join(d, "f.ysm"), []byte("x"), 0o644)
			}
			var mu sync.Mutex
			var n int
			err := walkDirParallel(root, func(p string, d fs.DirEntry, err error) error {
				if err == nil && !d.IsDir() {
					mu.Lock()
					n++
					mu.Unlock()
				}
				return nil
			})
			if err != nil {
				t.Errorf("worker %d: walkDirParallel 返回错误: %v", idx, err)
			}
		}(i)
	}
	wg.Wait()
}
