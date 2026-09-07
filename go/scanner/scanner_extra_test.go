// ===== go/scanner 边界补测（覆盖缺口：38% → 提升）=====
// 补充主测试未覆盖的边界：normalizeScanKey / 空目录 / 目录级 .ban 跳过 /
// 缓存代际失效（扫描中 Invalidate 丢弃在途结果）/ 哈希读失败 / ScanLocalAuthors 空 root 跳过。
package scanner

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ysm-model-manager/go/internal/testutil"
)

func TestNormalizeScanKey(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want string
	}{
		{"", ""},
		{"  ", ""},
		{"/a/b/", filepath.Clean("/a/b/")},
		{" /x/y ", filepath.Clean("/x/y")},
	}
	for _, c := range cases {
		testutil.Equal(t, normalizeScanKey(c.in), c.want, "normalizeScanKey(%q)", c.in)
	}
}

func TestScanEntries_EmptyDir(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	entries, hit := ScanEntriesWithHit(dir)
	testutil.Equal(t, hit, false, "空目录首次扫描不应命中缓存")
	testutil.Equal(t, len(entries), 0, "空目录应返回空列表")
	_, hit2 := ScanEntriesWithHit(dir)
	testutil.Equal(t, hit2, true, "二次扫描应命中缓存")
}

func TestScanEntries_EmptyKey(t *testing.T) {
	t.Parallel()
	entries, hit := ScanEntriesWithHit("   ")
	testutil.Equal(t, hit, false, "空 key 应返回空且不命中")
	testutil.Equal(t, len(entries), 0, "空 key 应返回空列表")
}

func TestScanEntries_DirBanSkipped(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	banDir := filepath.Join(dir, "modelA.ban")
	if err := os.MkdirAll(banDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(banDir, "inside.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "normal.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	entries := ScanEntries(dir)
	testutil.Equal(t, len(entries), 1, "应只扫到 normal.ysm")
	if entries[0].Name != "normal.ysm" {
		t.Fatalf("应只扫到 normal.ysm（.ban 目录跳过）, got %+v", entries)
	}
}

func TestScanEntries_CacheGenInvalidateDuringScan(t *testing.T) {
	dir := t.TempDir()
	ScanEntries(dir)
	InvalidateCache()
	entries, hit := ScanEntriesWithHit(dir)
	testutil.Equal(t, hit, false, "InvalidateCache 后扫描不应命中缓存")
	testutil.Equal(t, len(entries), 0, "空目录应返回空")
}

func TestScanEntries_ExpiredCacheLazyEviction(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	if _, hit := ScanEntriesWithHit(dir); hit {
		t.Fatal("首次扫描不应命中缓存")
	}
	if _, hit := ScanEntriesWithHit(dir); !hit {
		t.Fatal("30s 内二次扫描应命中缓存")
	}
	if v, ok := scanCache.Load(dir); ok {
		e := v.(scanCacheEntry)
		e.expiresAt = time.Now().Add(-time.Second)
		scanCache.Store(dir, e)
	} else {
		t.Fatal("扫描后缓存应有条目")
	}
	if err := os.WriteFile(filepath.Join(dir, "b.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	entries, hit := ScanEntriesWithHit(dir)
	testutil.Equal(t, hit, false, "过期缓存应视为未命中并惰性淘汰")
	testutil.Equal(t, len(entries), 2, "淘汰过期缓存后应扫到 2 个")
	if _, hit := ScanEntriesWithHit(dir); !hit {
		t.Error("重新扫描应命中缓存")
	}
}

func TestComputeFileHash_ReadError(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	testutil.Equal(t, ComputeFileHash(dir), "", "读目录应返回空哈希")
}

func TestScanLocalAuthors_EmptyRootsSkipped(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "[作者D]模型.ysm"), []byte("x"), perm)
	creators := ScanLocalAuthors(map[string]string{
		"ysm":    dir,
		"mmd":    "",
		"vrc":    "",
		"unused": "",
	})
	testutil.Equal(t, len(creators), 1, "应只从 ysm 根提取 1 个创作者")
	if creators[0].Name != "作者D" {
		t.Errorf("作者名解析失败: %+v", creators[0])
	}
}

func TestScanLocalAuthors_NoRoots(t *testing.T) {
	t.Parallel()
	if got := ScanLocalAuthors(nil); got != nil {
		t.Errorf("nil roots 应返回 nil, got %v", got)
	}
	if got := ScanLocalAuthors(map[string]string{}); len(got) != 0 {
		t.Errorf("空 map 应返回空, got %v", got)
	}
}

func TestListModelAuthors_EmptyEntries(t *testing.T) {
	t.Parallel()
	if got := ListModelAuthors(nil); len(got) != 0 {
		t.Errorf("nil entries 应返回空, got %v", got)
	}
}

func TestScanEntries_MMDSubDir(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "root.ysm"), []byte("x"), perm)
	sceneDir := filepath.Join(dir, "SceneModel")
	_ = os.MkdirAll(sceneDir, 0755)
	_ = os.WriteFile(filepath.Join(sceneDir, "scene.ysm"), []byte("x"), perm)
	animDir := filepath.Join(dir, "CustomAnim")
	_ = os.MkdirAll(animDir, 0755)
	_ = os.WriteFile(filepath.Join(animDir, "anim.ysm"), []byte("x"), perm)
	otherDir := filepath.Join(dir, "OtherDir")
	_ = os.MkdirAll(otherDir, 0755)
	_ = os.WriteFile(filepath.Join(otherDir, "other.ysm"), []byte("x"), perm)

	entries := ScanEntries(dir)
	testutil.Equal(t, len(entries), 4, "应扫到 4 个文件")
	for _, e := range entries {
		if e.SubDir != "" {
			t.Errorf("文件 %s SubDir 应为空（新架构不再填充）, got %q", e.Name, e.SubDir)
		}
	}
	names := map[string]bool{}
	for _, e := range entries {
		names[e.Name] = true
	}
	for _, want := range []string{"root.ysm", "scene.ysm", "anim.ysm", "other.ysm"} {
		if !names[want] {
			t.Errorf("未扫到期望文件 %s", want)
		}
	}
}

func TestScanEntries_WalkErrorTolerated(t *testing.T) {
	dir := t.TempDir()
	ok := filepath.Join(dir, "ok")
	if err := os.MkdirAll(ok, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ok, "a.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	bad := filepath.Join(dir, "broken")
	if err := os.Symlink(filepath.Join(dir, "不存在"), bad); err != nil {
		t.Skip("跳过：当前平台不支持 symlink")
	}
	entries := ScanEntries(dir)
	found := false
	for _, e := range entries {
		if e.Name == "a.ysm" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("walk error 不应中断正常文件扫描, got %+v", entries)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Path, bad+string(filepath.Separator)) || e.Path == bad {
			t.Errorf("broken 目录不应产出条目: %+v", e)
		}
	}
}
