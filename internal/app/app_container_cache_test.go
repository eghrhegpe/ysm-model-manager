// ===== containerTypeCache 组件单测（ADR-134）=====
// 抽离自 app_scan.go 的包级全局 var containerTypeCache sync.Map（隐藏耦合，非循环依赖）。
// 组件自检语义：未命中→调 detectFn；命中（modtime+size 指纹）→不再调；
// 文件变化→指纹失效重检；不存在文件→返回空；Clear→重置。
// detectFn 可注入（复用 DownloadQueue 回调注入范式 ADR-002 P1），无需真实容器文件即可断言。
package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

// countDetect 返回一个累计调用次数的 detectFn（断言缓存是否短路检测）
func countDetect(t *testing.T, p *int) func(string, *types.ResourceTypeRegistry) string {
	t.Helper()
	return func(path string, _ *types.ResourceTypeRegistry) string {
		*p++
		return "ysm"
	}
}

func TestContainerTypeCache_MissThenHit(t *testing.T) {
	var calls int
	c := newContainerTypeCache(countDetect(t, &calls))
	p := filepath.Join(t.TempDir(), "m.zip")
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if got := c.Get(p, types.LoadRegistry()); got != "ysm" {
		t.Fatalf("首次 Get 应返回 detectFn 结果, got %q", got)
	}
	if calls != 1 {
		t.Fatalf("首次应调用 detectFn 1 次, got %d", calls)
	}

	if got := c.Get(p, types.LoadRegistry()); got != "ysm" {
		t.Fatalf("缓存命中 Get 应返回同结果, got %q", got)
	}
	if calls != 1 {
		t.Fatalf("缓存命中不应再调用 detectFn, 期望累计 1 次, 实际 %d", calls)
	}
}

func TestContainerTypeCache_FileChangedInvalidates(t *testing.T) {
	var calls int
	c := newContainerTypeCache(countDetect(t, &calls))
	p := filepath.Join(t.TempDir(), "m.zip")
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	c.Get(p, types.LoadRegistry())

	// 改文件内容（size + modtime 同步变化）→ 指纹失效，应重新检测
	time.Sleep(15 * time.Millisecond)
	if err := os.WriteFile(p, []byte("yy"), 0o644); err != nil {
		t.Fatal(err)
	}
	c.Get(p, types.LoadRegistry())

	if calls != 2 {
		t.Fatalf("文件变化后应重新检测, 期望累计 2 次, 实际 %d", calls)
	}
}

func TestContainerTypeCache_NotFoundReturnsEmpty(t *testing.T) {
	c := newContainerTypeCache(func(path string, _ *types.ResourceTypeRegistry) string {
		return "ysm"
	})
	if got := c.Get(filepath.Join(t.TempDir(), "nope.zip"), types.LoadRegistry()); got != "" {
		t.Fatalf("不存在文件应返回空串, got %q", got)
	}
}

func TestContainerTypeCache_ClearResets(t *testing.T) {
	var calls int
	c := newContainerTypeCache(countDetect(t, &calls))
	p := filepath.Join(t.TempDir(), "m.zip")
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	c.Get(p, types.LoadRegistry())
	c.Clear()
	c.Get(p, types.LoadRegistry())

	if calls != 2 {
		t.Fatalf("Clear 后应重新检测, 期望累计 2 次, 实际 %d", calls)
	}
}

func TestContainerTypeCache_DistinctPathsIndependent(t *testing.T) {
	var calls int
	c := newContainerTypeCache(countDetect(t, &calls))
	a := filepath.Join(t.TempDir(), "a.zip")
	b := filepath.Join(t.TempDir(), "b.zip")
	if err := os.WriteFile(a, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(b, []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	c.Get(a, types.LoadRegistry())
	c.Get(b, types.LoadRegistry())
	c.Get(a, types.LoadRegistry())
	// a/b 各一次未命中 + a 一次命中 → 共 2 次调用
	if calls != 2 {
		t.Fatalf("不同路径缓存独立, 期望累计 2 次, 实际 %d", calls)
	}
}
