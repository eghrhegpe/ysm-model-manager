// ===== hashEntriesParallel 逐条目 panic 守卫测试（2026-10-14 锐评 P2）=====
// 去重侧 R27 修复链已有 worker panic 守卫，扫描侧曾漏：哈希 worker panic 时
// 条目 Hash 静默留空（下游同步按「空哈希跳过匹配」口径处理，但用户无留痕、
// 裸 panic 栈只进 stderr、GUI 下不可见）。本测试经 hashFn 注入点（与 dedup 的
// computeHash 同范式）模拟单条 panic，断言「worker 存活 + 该条留空 + 其余照常回填」。
package scanner

import (
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// TestHashEntriesParallel_WorkerPanicRecover: 单条 panic 不打死 worker；
// 该条 Hash 留空（log-and-skip，与读失败同口径），其余可哈希条目正常回填；
// 不可哈希扩展名（.txt）不受影响。
func TestHashEntriesParallel_WorkerPanicRecover(t *testing.T) {
	entries := []types.ModelEntry{
		{Name: "a.ysm", Path: "/repo/a.ysm", Ext: ".ysm"},
		{Name: "boom.ysm", Path: "/repo/boom.ysm", Ext: ".ysm"},
		{Name: "c.ysm", Path: "/repo/c.ysm", Ext: ".ysm"},
		{Name: "note.txt", Path: "/repo/note.txt", Ext: ".txt"}, // 不在哈希清单（ShouldHashExt 排除）
	}

	setHashFn(func(path string) string {
		if strings.Contains(path, "boom") {
			panic("simulated hash crash")
		}
		return "sha:" + filepath.Base(path)
	})
	t.Cleanup(func() { setHashFn(nil) }) // nil 恢复 ComputeFileHash

	// B1（ADR-348）：哈希段带持久索引参数——传临时目录根（索引文件落自己地盘，不写 CWD）
	hashEntriesParallel(entries, t.TempDir())

	if entries[1].Hash != "" {
		t.Errorf("panic 条目 Hash 应留空，got %q", entries[1].Hash)
	}
	if entries[0].Hash != "sha:a.ysm" || entries[2].Hash != "sha:c.ysm" {
		t.Errorf("非 panic 条目应照常回填，got %q / %q", entries[0].Hash, entries[2].Hash)
	}
	if entries[3].Hash != "" {
		t.Errorf("不可哈希扩展名不应回填，got %q", entries[3].Hash)
	}
}
