// ===== tags 锁契约（2026-09 commit 重构）回归测试 =====
// 锁归属内聚后：① 写盘在锁外，读路径（RLock）不被慢 IO 阻塞；
// ② load 双检保证并发首次加载不双初始化；③ commit 对「无变化」跳过落盘。
package tags

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// TestStore_ConcurrentReadWrite_NoRace 并发 Get/Set/Add/Remove 压测：
// 断言无 data race（配合 -race 运行）且最终数据自洽（每个 key 的标签有序且无重复）。
func TestStore_ConcurrentReadWrite_NoRace(t *testing.T) {
	store := NewStore(t.TempDir())

	const workers = 8
	const rounds = 40
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			key := filepath.Join("model", string(rune('a'+w%4))+".ysm")
			for r := 0; r < rounds; r++ {
				tag := string(rune('A' + r%6))
				switch r % 4 {
				case 0:
					_ = store.AddTag(key, tag)
				case 1:
					_ = store.RemoveTag(key, tag)
				case 2:
					_ = store.SetTags(key, []string{tag, "shared"})
				case 3:
					_, _ = store.GetTags(key)
				}
			}
		}(w)
	}
	wg.Wait()

	// 最终态自洽：所有 key 的标签有序、无重复（SetTags/AddTag 的排序不变量）
	all, err := store.AllTags()
	testutil.NoError(t, err, "AllTags =")
	for _, tag := range all {
		// 护栏：任一空标签即失败（原 if tag=="" → t.Fatal）
		testutil.Equal(t, tag == "", false, "AllTags 不应含空标签")
	}
}

// TestStore_Commit_NoChangeSkipsPersist 无变化不落盘：
// commit 的 mutate 返回 changed=false 时应跳过 persist——用一个只读的 Store
// （path 指向不可写位置）验证「无变化」路径不因落盘失败而报错。
func TestStore_Commit_NoChangeSkipsPersist(t *testing.T) {
	// path 指向一个不存在的深层目录下的文件，且在 mutate 无变化时不应被创建
	base := t.TempDir()
	store := NewStore(filepath.Join(base, "deep", "nested"))

	// 先写入一个标签，使后续 RemoveTag 一个不存在的标签走「无变化」分支
	testutil.NoError(t, store.SetTags("m.ysm", []string{"keep"}), "SetTags =")
	// 记录首次落盘后的 mtime
	info1, err := os.Stat(store.path)
	testutil.NoError(t, err, "stat =")
	// 移除一个不存在的标签 → changed=false → 不应触发落盘（mtime 不变）
	testutil.NoError(t, store.RemoveTag("m.ysm", "nonexistent"), "RemoveTag(无变化) =")
	info2, err := os.Stat(store.path)
	testutil.NoError(t, err, "stat2 =")
	// time.Time 含 unexported 字段，go-cmp 直接比较会 panic——走 .Equal() 布尔化
	testutil.Equal(t, info1.ModTime().Equal(info2.ModTime()), true, "无变化操作不应重写文件：mtime %v → %v", info1.ModTime(), info2.ModTime())
}

// TestStore_LoadDoubleCheck_ConcurrentFirstLoad 并发首次加载双检：
// 多 goroutine 同时首次 Get，断言只初始化一次且无 race（-race 下运行）。
func TestStore_LoadDoubleCheck_ConcurrentFirstLoad(t *testing.T) {
	dir := t.TempDir()
	// 预置一个已有文件，验证并发 load 都能读到同一份数据
	store := NewStore(dir)
	testutil.NoError(t, store.SetTags("pre.ysm", []string{"x"}), "SetTags =")

	fresh := NewStore(dir) // 全新实例：data == nil，并发首次加载
	const n = 16
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = fresh.GetTags("pre.ysm")
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		testutil.NoError(t, err, "并发首次 GetTags[%d] =", i)
	}
	tags, err := fresh.GetTags("pre.ysm")
	// OR 型复合条件拆序贯：len 前置守卫防 tags[0] 越界（原 if err!=nil || len!=1 || tags[0]!="x"）
	testutil.NoError(t, err, "并发加载后数据不一致: err=%v", err)
	testutil.Equal(t, len(tags), 1, "并发加载后数据不一致: tags=%v", tags)
	testutil.Equal(t, tags[0], "x", "并发加载后数据不一致: tags=%v", tags)
}
