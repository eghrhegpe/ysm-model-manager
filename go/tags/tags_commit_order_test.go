// 并发写落盘顺序契约（2026-10-10 锐评：标签系统审计）。
// 立因：2026-09 commit 重构把 persist 移出写锁（目标=读路径不被慢 IO 阻塞，达成），
// 但留下对偶缺口——两个并发 commit 的「内存快照序」与「落盘序」不再同源：
// A 先取锁改数据+序列化、B 后取锁（快照含 A 的全部变更 + B 自己的），但磁盘写是
// 锁外裸执行——B 的 persist 可能先落盘、A 的旧快照后落盘把 B 的 key 整体盖掉。
// 内存态看着都对（同进程 GetTags 读 s.data），重启后 fresh Store 读盘即丢标签。
// 本测试用 N 个 goroutine 各写一个互不相同的 key，压满「序列化→落盘」窗口，
// 最终从磁盘重开 Store 断言 N 个 key 全在（丢更新即缺 key）。
package tags

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
)

func TestStore_ConcurrentCommit_DiskKeepsAllKeys(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	store := NewStore(dir)

	const n = 64
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := fmt.Sprintf("model/k%03d.ysm", i)
			// 多轮重试加大交错窗口命中概率：每轮 Set 全量列表，任何一轮的旧快照
			// 后落盘都会抹掉别的 key
			for r := 0; r < 8; r++ {
				if err := store.SetTags(key, []string{fmt.Sprintf("tag%03d", r)}); err != nil {
					t.Errorf("SetTags(%d): %v", i, err)
					return
				}
			}
		}(i)
	}
	wg.Wait()

	// 磁盘终态：重开全新 Store（只读盘），所有 n 个 key 必须都在
	fresh := NewStore(dir)
	all, err := fresh.ListByTag("tag007")
	if err != nil {
		t.Fatalf("fresh ListByTag: %v", err)
	}
	if len(all) != n {
		missing := make([]string, 0, n)
		seen := map[string]bool{}
		for _, k := range all {
			seen[k] = true
		}
		for i := 0; i < n; i++ {
			key := filepath.ToSlash(filepath.Join("model", fmt.Sprintf("k%03d.ysm", i)))
			if !seen[key] {
				missing = append(missing, key)
			}
		}
		t.Fatalf("并发 SetTags 后磁盘丢 key：期望 %d 个、实得 %d 个（缺 %v 个，样例 %v）",
			n, len(all), len(missing), firstN(missing, 5))
	}
}

func firstN(s []string, n int) []string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
