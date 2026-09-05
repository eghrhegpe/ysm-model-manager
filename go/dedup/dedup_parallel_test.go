package dedup

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"

	"ysm-model-manager/internal/testutil"
)

// pathsOf 取组内文件路径列表（断言排序用）
func pathsOf(files []FileEntry) []string {
	paths := make([]string, len(files))
	for i, f := range files {
		paths[i] = f.Path
	}
	return paths
}

// buildParallelFixture 构造越过并行管道的大文件集：
// 200 个唯一文件 + 3 组重复（每组 3 副本，内容不同）。
// 遍历按文件名词法序：dupA_* < dupB_* < dupC_* < unique_*，
// 故组顺序应为 A → B → C（hash 首次出现顺序，ADR-119 确定性）。
func buildParallelFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for i := 0; i < 200; i++ {
		testutil.CreateTestFile(t, dir, fmt.Sprintf("unique_%04d.txt", i), fmt.Sprintf("unique-content-%d", i))
	}
	dups := []struct{ name, content string }{
		{"dupA_1.txt", "AAA"}, {"dupA_2.txt", "AAA"}, {"dupA_3.txt", "AAA"},
		{"dupB_1.txt", "BBB"}, {"dupB_2.txt", "BBB"}, {"dupB_3.txt", "BBB"},
		{"dupC_1.txt", "CCC"}, {"dupC_2.txt", "CCC"}, {"dupC_3.txt", "CCC"},
	}
	for _, d := range dups {
		testutil.CreateTestFile(t, dir, d.name, d.content)
	}
	return dir
}

// 并行管道正确性 + 确定性：大文件集下组顺序=首次出现序、组内路径有序（ADR-119）
func TestFindDuplicateFiles_ParallelLarge(t *testing.T) {
	dir := buildParallelFixture(t)
	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 3 {
		t.Fatalf("期望 3 组重复，got %d", len(groups))
	}
	// 组顺序 = 首次出现序：A → B → C；组内按 Path 排序（确定性）
	wantFirsts := []string{"dupA_1.txt", "dupB_1.txt", "dupC_1.txt"}
	for i, g := range groups {
		if len(g.Files) != 3 {
			t.Fatalf("组 %d 应 3 副本，got %d", i, len(g.Files))
		}
		if got := filepath.Base(g.Files[0].Name); got != wantFirsts[i] {
			t.Fatalf("组 %d 首文件应为 %s，got %s（组顺序=首次出现序被破坏）", i, wantFirsts[i], got)
		}
		if !sort.StringsAreSorted(pathsOf(g.Files)) {
			t.Fatalf("组 %d 内路径未排序: %v", i, pathsOf(g.Files))
		}
	}
}

// P1 共享管道：CountDuplicates 与 FindDuplicateFiles 必须消费同一批结果，
// 计数与分组推导完全一致（禁止双实现漂移）。
func TestCountDuplicates_ParallelConsistency(t *testing.T) {
	dir := buildParallelFixture(t)
	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	gCount, extra, err := CountDuplicates(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if gCount != len(groups) {
		t.Fatalf("CountDuplicates 组数=%d 应等于 FindDuplicateFiles 组数=%d", gCount, len(groups))
	}
	var wantExtra int
	for _, g := range groups {
		wantExtra += len(g.Files) - 1
	}
	if extra != wantExtra {
		t.Fatalf("extra=%d 应等于 ∑(副本-1)=%d", extra, wantExtra)
	}
}

// P3 并行模式下部分文件读失败：该文件 log-and-skip（不进入任何组），
// 其余同内容文件仍正确成组（与串行 log-and-skip 语义一致）。
func TestFindDuplicateFiles_ReadFailureSkipped(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "a.txt", "same")
	testutil.CreateTestFile(t, dir, "b.txt", "same")
	testutil.CreateTestFile(t, dir, "c.txt", "same")

	old := computeHash
	t.Cleanup(func() { computeHash = old })
	computeHash = func(path string, algo HashAlgorithm) (string, error) {
		if strings.HasSuffix(path, "c.txt") {
			return "", errors.New("injected read failure")
		}
		return algo.ComputeHash(path)
	}

	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 {
		t.Fatalf("期望 1 组（a/b 成组，c 读失败跳过），got %d", len(groups))
	}
	if len(groups[0].Files) != 2 {
		t.Fatalf("组内应 2 副本（c 被跳过），got %d", len(groups[0].Files))
	}
	for _, f := range groups[0].Files {
		if strings.HasSuffix(f.Path, "c.txt") {
			t.Fatal("读失败的文件不应出现在结果中")
		}
	}
	// 并行管道不留幽灵槽：CountDuplicates 同样跳过读失败文件
	gCount, extra, err := CountDuplicates(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if gCount != 1 || extra != 1 {
		t.Fatalf("CountDuplicates 应 1 组 1 多余（c 跳过），got groups=%d extra=%d", gCount, extra)
	}
}

// size 预分组（零语义损失）：不同 size 的文件不可能同 hash，唯一 size 的文件必不成组，
// 应跳过其哈希（消解大文件长尾）。注入 computeHash 计数验证不触发。
func TestHashFilesParallel_UniqueSizeSkipsHash(t *testing.T) {
	dir := t.TempDir()
	// a/c 同尺寸(4B)但内容不同（需哈希、不重复）；b 唯一尺寸(7B)（应跳过哈希）
	testutil.CreateTestFile(t, dir, "a.txt", "aaaa")
	testutil.CreateTestFile(t, dir, "b.txt", "bbbbbbb")
	testutil.CreateTestFile(t, dir, "c.txt", "cccc")

	called := map[string]int{}
	var calledMu sync.Mutex // 测试桩计数被多个 worker 并发写，需加锁
	old := computeHash
	t.Cleanup(func() { computeHash = old })
	computeHash = func(path string, algo HashAlgorithm) (string, error) {
		calledMu.Lock()
		called[path]++
		calledMu.Unlock()
		return algo.ComputeHash(path)
	}

	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := called[filepath.Join(dir, "b.txt")]; ok {
		t.Fatal("唯一尺寸文件不应被哈希（size 预分组）")
	}
	if _, ok := called[filepath.Join(dir, "a.txt")]; !ok {
		t.Fatal("同尺寸文件 a 应被哈希（可能成组）")
	}
	if _, ok := called[filepath.Join(dir, "c.txt")]; !ok {
		t.Fatal("同尺寸文件 c 应被哈希（可能成组）")
	}
	if len(groups) != 0 {
		t.Fatalf("a/c 内容不同不应成组，got %d 组", len(groups))
	}
	// CountDuplicates 同样跳过唯一尺寸（共享管道，P1 一致性）
	_, _, err = CountDuplicates(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := called[filepath.Join(dir, "b.txt")]; ok {
		t.Fatal("CountDuplicates 也不应哈希唯一尺寸文件")
	}
}

// size 预分组不破坏成组：同尺寸同内容仍成组，唯一尺寸文件不影响（确定性）
func TestFindDuplicateFiles_SizeGrouping_Mixed(t *testing.T) {
	dir := t.TempDir()
	dup := "same-size-same-content"
	testutil.CreateTestFile(t, dir, "dup1.txt", dup)
	testutil.CreateTestFile(t, dir, "dup2.txt", dup)
	testutil.CreateTestFile(t, dir, "dup3.txt", dup)
	testutil.CreateTestFile(t, dir, "uniq1.txt", "unique-content-number-one")
	testutil.CreateTestFile(t, dir, "uniq2.txt", "unique-content-number-x")

	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 {
		t.Fatalf("应 1 组重复，got %d", len(groups))
	}
	if len(groups[0].Files) != 3 {
		t.Fatalf("组内应 3 副本，got %d", len(groups[0].Files))
	}
	if !sort.StringsAreSorted(pathsOf(groups[0].Files)) {
		t.Fatalf("组内路径未排序: %v", pathsOf(groups[0].Files))
	}
}

// serialReference 测试内串行参照实现：与并行管道共享 collectFiles（串行收集），
// 哈希逐个顺序执行、分组按首次出现序、组内按 Path 排序——逐字节对应串行旧实现语义。
// 用于锁死 ADR-119「并行输出与串行逐字节一致」：若并行管道破坏 results[idx]↔files[i]
// 对齐、或组序随哈希完成序漂移，黄金对照测试会确定性变红（code_review P3-2 回归点）。
func serialReference(t *testing.T, dir string) []Group {
	t.Helper()
	files, err := collectFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	algo := &DeepHash{}
	byHash := map[string]*Group{}
	var order []string
	for _, f := range files {
		h, err := algo.ComputeHash(f.path)
		if err != nil {
			continue // log-and-skip，与并行语义一致
		}
		entry := FileEntry{Name: filepath.Base(f.path), Path: f.path, Size: f.size, ModTime: f.mod}
		if g, ok := byHash[h]; ok {
			g.Files = append(g.Files, entry)
		} else {
			byHash[h] = &Group{Hash: h, Size: f.size, Files: []FileEntry{entry}}
			order = append(order, h)
		}
	}
	var out []Group
	for _, h := range order {
		g := byHash[h]
		if len(g.Files) > 1 {
			sort.Slice(g.Files, func(i, j int) bool { return g.Files[i].Path < g.Files[j].Path })
			out = append(out, *g)
		}
	}
	return out
}

// 黄金对照：并行管道输出与串行参照实现全字段逐字节一致（组序 + 组内路径 + Size/ModTime）。
// fixture 含大文件集（200 唯一 + 3 重复组）+ 一个唯一尺寸文件（串并行都跳过哈希、不成组）。
func TestParallelEqualsSerial_Golden(t *testing.T) {
	dir := buildParallelFixture(t)
	testutil.CreateTestFile(t, dir, "solo.txt", "a-very-unique-size-content")

	parallel, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	serial := serialReference(t, dir)

	if len(parallel) != len(serial) {
		t.Fatalf("组数不一致：并行=%d 串行=%d", len(parallel), len(serial))
	}
	for i := range parallel {
		p, s := parallel[i], serial[i]
		if p.Hash != s.Hash || p.Size != s.Size {
			t.Fatalf("组 %d 头元不一致：并行{hash=%s size=%d} 串行{hash=%s size=%d}", i, p.Hash, p.Size, s.Hash, s.Size)
		}
		if len(p.Files) != len(s.Files) {
			t.Fatalf("组 %d 副本数不一致：并行=%d 串行=%d", i, len(p.Files), len(s.Files))
		}
		for j := range p.Files {
			pf, sf := p.Files[j], s.Files[j]
			if pf.Path != sf.Path || pf.Size != sf.Size || pf.ModTime != sf.ModTime {
				t.Fatalf("组 %d 文件 %d 不一致：并行{path=%s size=%d mod=%d} 串行{path=%s size=%d mod=%d}",
					i, j, pf.Path, pf.Size, pf.ModTime, sf.Path, sf.Size, sf.ModTime)
			}
		}
	}
	// 唯一尺寸文件不应出现在任何组（串并行都跳过哈希）
	for _, g := range parallel {
		for _, f := range g.Files {
			if filepath.Base(f.Path) == "solo.txt" {
				t.Fatal("唯一尺寸文件 solo.txt 不应出现在任何组")
			}
		}
	}
}
