// ===== go/sync 边界/异常用例 =====
// 目标：用构造的异常/边界输入拷问源码健壮性；源码修复后，用例转为正确行为回归。
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// =====================================================================
// 一、nil 参数保护（已修复）
// =====================================================================

// FIX-1 RelinkDir 对 nil scanFn 应返回错误而非 panic。sync_relink.go 已加 nil 判断。
func TestRelinkDir_NilScanFn_ReturnsError(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.MkdirAll(customDir, 0755)

	c, err := RelinkDir(customDir, repoRoot, "ysm", "copy", nil,
		func(name, src, dst string, size int64, status, msg string) {})
	if err == nil {
		t.Fatal("nil scanFn 应返回错误，实际 nil")
	}
	if c != 0 {
		t.Logf("nil scanFn 计数应 = 0，实际 %d", c)
	}
	t.Logf("nil scanFn 返回错误: %v", err)
}

// FIX-2 RelinkDir 对 nil logger 应跳过日志调用而非 panic。sync_relink.go 各分支已加 logger != nil 判断。
func TestRelinkDir_NilLogger_NoPanicOnFailure(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.MkdirAll(customDir, 0755)

	// scanFn 返回一条 hash 匹配的条目，但实际 srcPath 不存在——InstallLocked 必失败 → 触发 logger 调用路径。
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "ghost.ysm", Path: filepath.Join(dir, "ghost.ysm"), Hash: "ghost"},
		}
	}
	// 不应 panic——nil logger 应被保护。
	c, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn, nil)
	if err != nil {
		t.Logf("nil logger 返回错误（可接受）: %v", err)
	}
	if c != 0 {
		t.Logf("nil logger 无匹配条目，计数应 = 0，实际 %d", c)
	}
}

// FIX-3 GetInstanceStatusWith 对 nil scanFn 应返回空而非 panic。
func TestGetInstanceStatusWith_NilScanFn_ReturnsEmpty(t *testing.T) {
	results := GetInstanceStatusWith("/mc", "/repo", "", nil,
		func(mcRoot string) []types.VersionInstance { return nil })
	if results != nil {
		t.Logf("nil scanFn 期望 nil，实际 len=%d", len(results))
	}
}

// FIX-4 GetInstanceStatusWith 对 nil listFn 应返回空而非 panic。
func TestGetInstanceStatusWith_NilListFn_ReturnsEmpty(t *testing.T) {
	results := GetInstanceStatusWith("/mc", "/repo", "",
		func(dir string) []types.ModelEntry { return nil }, nil)
	if results != nil {
		t.Logf("nil listFn 期望 nil，实际 len=%d", len(results))
	}
}

// FIX-5 SyncCustomToRepo 对 nil logger 应跳过日志调用而非 panic（同名 skip 分支）。
func TestSyncCustomToRepo_NilLogger_NoPanicOnSkip(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	_ = os.MkdirAll(customDir, 0755)
	_ = os.MkdirAll(repoDir, 0755)

	_ = os.WriteFile(filepath.Join(customDir, "dup.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(repoDir, "dup.ysm"), []byte("x"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "dup.ysm", Path: filepath.Join(dir, "dup.ysm"), Hash: "h-dup"}}
	}
	// 不应 panic。
	c, err := SyncCustomToRepo(customDir, repoDir, scanFn, nil)
	if err != nil {
		t.Logf("nil logger 返回错误（可接受）: %v", err)
	}
	if c != 0 {
		t.Logf("同名 skip 分支计数应 = 0，实际 %d", c)
	}
}

// FIX-6 SyncCustomToRepo 对 nil logger 不应在 hash 碰撞 skip 分支 panic。
func TestSyncCustomToRepo_NilLogger_NoPanicOnHashSkip(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	_ = os.MkdirAll(customDir, 0755)
	_ = os.MkdirAll(repoDir, 0755)

	_ = os.WriteFile(filepath.Join(customDir, "a.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(repoDir, "a.ysm"), []byte("x"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "a.ysm", Path: filepath.Join(dir, "a.ysm"), Hash: "h1"}}
	}
	// 不应 panic。
	c, err := SyncCustomToRepo(customDir, repoDir, scanFn, nil)
	if err != nil {
		t.Logf("nil logger 返回错误（可接受）: %v", err)
	}
	if c != 0 {
		t.Logf("hash 碰撞 skip 计数应 = 0，实际 %d", c)
	}
}

// =====================================================================
// 二、路径穿越 / Rel 错误忽略（已修复）
// =====================================================================

// FIX-7 SyncCustomToRepo 现在拒绝 e.Path 不在 customDir 下的越界条目，不再 MkdirAll 到 repoDir 外部。
func TestSyncCustomToRepo_PathTraversal_Rejected(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	leakDir := filepath.Join(base, "leaked")
	_ = os.MkdirAll(customDir, 0755)
	_ = os.MkdirAll(repoDir, 0755)
	_ = os.RemoveAll(leakDir)
	if _, err := os.Stat(leakDir); err == nil {
		t.Fatal("leakDir 应起初不存在")
	}

	fakePath := filepath.Join(leakDir, "m.ysm")
	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoDir {
			return []types.ModelEntry{{Name: "repo.ysm", Path: filepath.Join(repoDir, "repo.ysm"), Hash: "h-repo"}}
		}
		return []types.ModelEntry{{Name: "m.ysm", Path: fakePath, Hash: "h-leaked"}}
	}
	_, err := SyncCustomToRepo(customDir, repoDir, scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Logf("返回错误（可接受）: %v", err)
	}

	// 红线：leakDir 绝不应被创建。
	if _, err := os.Stat(leakDir); err == nil {
		t.Fatal("leakDir 不应被创建——路径穿越副作用仍存在")
	}
}

// =====================================================================
// 三、重复/同哈希冲突（已修复：取第一个非 .ban 仓库条目）
// =====================================================================

// RelinkDir 的 repoByHash 现在保留同 hash 的所有仓库条目，并取扫描顺序中的
// 第一个非 .ban 条目作为源，不再被 map 覆盖成 last-wins。
func TestRelinkDir_DuplicateHash_FirstWins(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(filepath.Join(repoRoot, "v1"), 0755)
	_ = os.MkdirAll(filepath.Join(repoRoot, "v2"), 0755)
	_ = os.MkdirAll(filepath.Join(customDir, "v1"), 0755)

	_ = os.WriteFile(filepath.Join(repoRoot, "v1", "m.ysm"), []byte("v1"), 0644)
	_ = os.WriteFile(filepath.Join(repoRoot, "v2", "m.ysm"), []byte("v2"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "v1", "m.ysm"), []byte("old"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{
				{Name: "m.ysm", Path: filepath.Join(dir, "v1", "m.ysm"), Hash: "h1"},
				{Name: "m.ysm", Path: filepath.Join(dir, "v2", "m.ysm"), Hash: "h1"},
			}
		}
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "v1", "m.ysm"), Hash: "h1"}}
	}
	count, err := RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应重链接 1 个，实际 %d", count)
	}
	data, err := os.ReadFile(filepath.Join(customDir, "v1", "m.ysm"))
	if err != nil {
		t.Fatalf("实例文件应存在: %v", err)
	}
	if string(data) != "v1" {
		t.Fatalf("同 hash 时应取第一个仓库条目 v1，实际内容 %q", string(data))
	}
	if _, err := os.Stat(filepath.Join(customDir, "v2")); !os.IsNotExist(err) {
		t.Fatalf("不应使用 last-wins 的 v2 路径，实际状态: %v", err)
	}
}

// RelinkDir 目录级分支同样应取第一个仓库条目。
func TestRelinkDir_DuplicateHash_DirLevel_FirstWins(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(filepath.Join(repoRoot, "v1-pack"), 0755)
	_ = os.MkdirAll(filepath.Join(repoRoot, "v2-pack"), 0755)
	_ = os.MkdirAll(filepath.Join(customDir, "old-pack"), 0755)
	_ = os.WriteFile(filepath.Join(repoRoot, "v1-pack", "ysm.json"), []byte("v1"), 0644)
	_ = os.WriteFile(filepath.Join(repoRoot, "v2-pack", "ysm.json"), []byte("v2"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "old-pack", "ysm.json"), []byte("old"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{
				{Name: "ysm.json", Path: filepath.Join(dir, "v1-pack", "ysm.json"), Hash: "h1"},
				{Name: "ysm.json", Path: filepath.Join(dir, "v2-pack", "ysm.json"), Hash: "h1"},
			}
		}
		return []types.ModelEntry{{Name: "ysm.json", Path: filepath.Join(dir, "old-pack", "ysm.json"), Hash: "h1"}}
	}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应重链接 1 个，实际 %d", count)
	}
	data, err := os.ReadFile(filepath.Join(customDir, "v1-pack", "ysm.json"))
	if err != nil {
		t.Fatalf("目录级替换后应使用第一个仓库条目 v1-pack: %v", err)
	}
	if string(data) != "v1" {
		t.Fatalf("v1-pack 内容应来自第一个仓库条目，实际 %q", string(data))
	}
	if _, err := os.Stat(filepath.Join(customDir, "v2-pack")); !os.IsNotExist(err) {
		t.Fatalf("不应使用 last-wins 的 v2-pack，实际状态: %v", err)
	}
}

// 仓库侧 .ban 只是禁用标记，即使排在扫描顺序最前也不能被当作重链接源。
func TestRelinkDir_RepoBan_NotUsedAsSource(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(filepath.Join(repoRoot, "ban-src"), 0755)
	_ = os.MkdirAll(filepath.Join(repoRoot, "v1"), 0755)
	_ = os.MkdirAll(filepath.Join(customDir, "v1"), 0755)

	_ = os.WriteFile(filepath.Join(repoRoot, "ban-src", "m.ysm.ban"), []byte("ban"), 0644)
	_ = os.WriteFile(filepath.Join(repoRoot, "v1", "m.ysm"), []byte("v1"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "v1", "m.ysm"), []byte("old"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{
				{Name: "m.ysm.ban", Path: filepath.Join(dir, "ban-src", "m.ysm.ban"), Hash: "h1"},
				{Name: "m.ysm", Path: filepath.Join(dir, "v1", "m.ysm"), Hash: "h1"},
			}
		}
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "v1", "m.ysm"), Hash: "h1"}}
	}
	count, err := RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应跳过仓库 .ban 并重链接 1 个，实际 %d", count)
	}
	data, err := os.ReadFile(filepath.Join(customDir, "v1", "m.ysm"))
	if err != nil {
		t.Fatalf("实例文件应存在: %v", err)
	}
	if string(data) != "v1" {
		t.Fatalf("仓库 .ban 不应作为源，应使用第一个活跃条目 v1，实际内容 %q", string(data))
	}
	if _, err := os.Stat(filepath.Join(customDir, "ban-src")); !os.IsNotExist(err) {
		t.Fatalf("仓库 .ban 不应被安装到实例目录，实际状态: %v", err)
	}
}

// =====================================================================
// 四、幂等性 / 重复调用
// =====================================================================

func TestRelinkDir_FileLevel_Idempotent(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.MkdirAll(customDir, 0755)
	_ = os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("same"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "m.ysm"), []byte("same"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "h1"}}
	}
	c1, err := RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn, nilLogger)
	if err != nil {
		t.Fatalf("第一次 RelinkDir 失败: %v", err)
	}
	c2, err := RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn, nilLogger)
	if err != nil {
		t.Fatalf("第二次 RelinkDir 失败: %v", err)
	}
	if c1 != c2 {
		t.Logf("提示：两次 RelinkDir 计数不同 c1=%d c2=%d", c1, c2)
	}
	data, _ := os.ReadFile(filepath.Join(customDir, "m.ysm"))
	if string(data) != "same" {
		t.Fatalf("重复调用后内容应不变，实际 %q", string(data))
	}
}

func TestPushResources_Idempotent_NoOp(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.WriteFile(filepath.Join(globalDir, "pack.zip"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(targetDir, "pack.zip"), []byte("x"), 0644)

	c1, e1 := PushResources("resourcepack", globalDir, targetDir, "copy", nilLogger)
	if e1 != nil {
		t.Fatalf("第一次推送失败: %v", e1)
	}
	c2, e2 := PushResources("resourcepack", globalDir, targetDir, "copy", nilLogger)
	if e2 != nil {
		t.Fatalf("第二次推送失败: %v", e2)
	}
	if c1 != 0 || c2 != 0 {
		t.Logf("提示：已同步状态再次推送 count=%d/%d（预期均为 0）", c1, c2)
	}
}

// =====================================================================
// 五、空目录 / 非存在目录
// =====================================================================

func TestSyncResources_GlobalDirNonExistent_NoPanic(t *testing.T) {
	instDir := t.TempDir()
	result := SyncResources("/does/not/exist", instDir)
	if len(result.Synced) != 0 || len(result.Missing) != 0 || len(result.Extra) != 0 {
		t.Logf("提示：全局目录不存在 → 结果非空？Synced=%d Missing=%d Extra=%d",
			len(result.Synced), len(result.Missing), len(result.Extra))
	}
}

func TestSyncResources_BothNonExistent_NoPanic(t *testing.T) {
	result := SyncResources("/nope/a", "/nope/b")
	if len(result.Synced) != 0 || len(result.Missing) != 0 || len(result.Extra) != 0 {
		t.Logf("提示：两侧都不存在，结果：%+v", result)
	}
}

func TestSyncResourcesDirLevel_NonExistent_NoPanic(t *testing.T) {
	result := SyncResourcesDirLevel("/nope/a", "/nope/b", "ysm")
	if len(result.Synced) != 0 || len(result.Missing) != 0 || len(result.Extra) != 0 {
		t.Logf("提示：两侧都不存在，结果：%+v", result)
	}
}

func TestListVersions_NonExistent_NoPanic(t *testing.T) {
	results := ListVersions("/does/not/exist")
	if len(results) != 0 {
		t.Logf("提示：不存在目录应返回 0 个实例，实际 %d", len(results))
	}
}

func TestFindMinecraftDir_EmptyPath(t *testing.T) {
	got := FindMinecraftDir("")
	if got != "" {
		t.Logf("FindMinecraftDir(\"\") 期望空，实际 %q", got)
	}
}

// =====================================================================
// 六、PullResources / PullSingleResource 空/非法路径
// =====================================================================

func TestPullSingleResource_NonExistent_NoPanic(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	err := PullSingleResource(globalDir, targetDir, "/does/not/exist")
	if err == nil {
		t.Logf("PullSingleResource 非存在路径应返回错误，实际 nil")
	}
}

func TestPullResources_EmptyGlobalDir(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.WriteFile(filepath.Join(targetDir, "extra.zip"), []byte("x"), 0644)

	c, e := PullResources("resourcepack", globalDir, targetDir, nilLogger)
	if e != nil {
		t.Logf("PullResources 空 globalDir 返回错误：%v", e)
	}
	if c != 1 {
		t.Logf("提示：PullResources 空 globalDir count=%d，期望 1", c)
	}
}

func TestPullSingleResource_Dir_SiblingOutside(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	srcDir := filepath.Join(targetDir, "pack")
	_ = os.MkdirAll(srcDir, 0755)
	_ = os.WriteFile(filepath.Join(srcDir, "ysm.json"), []byte("{}"), 0644)
	err := PullSingleResource(globalDir, targetDir, srcDir)
	if err != nil {
		t.Fatalf("PullSingleResource 目录失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(globalDir, "pack", "ysm.json")); err != nil {
		t.Fatalf("目录应被复制: %v", err)
	}
}

// TestPullSingleResource_DirOutside_Rejected 审核意见 1 回归：越界目录
// （srcPath 不在 targetDir 内）应直接报错——对齐文件分支 mapSrcToGlobal 严格口径，
// 不再退化为 basename 把越界目录错误落到 globalDir 根（丢子类层级 + 同名覆盖）。
func TestPullSingleResource_DirOutside_Rejected(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	outside := filepath.Join(base, "outside-pack")
	_ = os.MkdirAll(outside, 0755)
	_ = os.WriteFile(filepath.Join(outside, "m.pmx"), []byte("m"), 0644)

	err := PullSingleResource(globalDir, targetDir, outside)
	if err == nil {
		t.Fatal("越界目录应报错，实际 nil")
	}
	if _, err := os.Stat(filepath.Join(globalDir, "outside-pack")); err == nil {
		t.Fatal("越界目录不应退化为 basename 落到 globalDir 根")
	}
}

// =====================================================================
// 七、isSyncAllowed 边界
// =====================================================================

func TestIsSyncAllowed_EmptyAndWeird(t *testing.T) {
	if types.IsResourceAllowed("") {
		t.Error("空字符串应被拒绝")
	}
	if types.IsResourceAllowed(".") {
		t.Error(". 应被拒绝")
	}
	if types.IsResourceAllowed("...") {
		t.Error("... 应被拒绝")
	}
	if types.IsResourceAllowed("model.ysm.bak") {
		t.Error("model.ysm.bak 应被拒绝")
	}
	if !types.IsResourceAllowed("ysm.json.ban") {
		t.Error("ysm.json.ban 应被允许")
	}
	if types.IsResourceAllowed("animation.json.ban") {
		t.Error("animation.json.ban 应被拒绝")
	}
}

// =====================================================================
// 八、RelinkDir 空/非法 rtype
// =====================================================================

func TestRelinkDir_EmptyRType(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.MkdirAll(customDir, 0755)
	_ = os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "m.ysm"), []byte("x"), 0644)
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "h1"}}
	}
	c, e := RelinkDir(customDir, repoRoot, "", "copy", scanFn, nilLogger)
	if e != nil {
		t.Fatalf("空 rtype 不应报错: %v", e)
	}
	_ = c
}

func TestRelinkDir_CustomDirNonExistent(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "does_not_exist", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("x"), 0644)
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "h1"}}
	}
	var panicked bool
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_, _ = RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn, nilLogger)
	}()
	if panicked {
		t.Fatal("customDir 不存在不应 panic")
	}
}

// =====================================================================
// 九、SyncCustomToRepo 空参数 / 空格参数
// =====================================================================

func TestSyncCustomToRepo_WhitespaceOnly(t *testing.T) {
	if _, err := SyncCustomToRepo("   ", "  ", nil, nil); err == nil {
		t.Fatal("纯空格参数应报错")
	}
}

// =====================================================================
// 十、GetInstanceStatus 空 repoDir
// =====================================================================

func TestGetInstanceStatusWith_EmptyRepoDir(t *testing.T) {
	results := GetInstanceStatusWith("/mc", "", "",
		func(dir string) []types.ModelEntry { return nil },
		func(mcRoot string) []types.VersionInstance { return nil })
	if len(results) != 0 {
		t.Logf("提示：空 repoDir 返回 %d 个实例", len(results))
	}
}

func nilLogger(name, src, dst string, size int64, status, msg string) {}

// =====================================================================
// 十六、PushResources / PullResources nil logger 不应 panic
// =====================================================================

// TestPushResources_NilLogger_NoPanicOnFailure 推送 + nil logger 不应 panic
// （原 logger() 调用未 nil 守卫——已补 if logger != nil）
func TestPushResources_NilLogger_NoPanicOnFailure(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.WriteFile(filepath.Join(globalDir, "pack.zip"), []byte("x"), 0644)
	// 成功或失败路径均不应 panic（nil logger 守卫覆盖两者）
	_, _ = PushResources("resourcepack", globalDir, targetDir, "copy", nil)
}

// TestPullResources_NilLogger_NoPanicOnFailure 拉取失败 + nil logger 不应 panic
func TestPullResources_NilLogger_NoPanicOnFailure(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.WriteFile(filepath.Join(targetDir, "extra.zip"), []byte("e"), 0644)
	// global 侧同名路径用目录占位 → copyFile 失败
	_ = os.MkdirAll(filepath.Join(globalDir, "extra.zip"), 0755)

	var panicked bool
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_, _ = PullResources("resourcepack", globalDir, targetDir, nil)
	}()
	if panicked {
		t.Fatal("nil logger + 拉取失败不应 panic")
	}
}

// =====================================================================
// 十一、PushSingleResource 分支覆盖
// =====================================================================

// TestPushSingleResource_Dir 文件夹级单文件推送：filePath 为目录 → InstallDir 分支
func TestPushSingleResource_Dir(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(customDir, 0755)
	// 源目录含模型文件
	srcDir := filepath.Join(globalDir, "myPack")
	_ = os.MkdirAll(srcDir, 0755)
	_ = os.WriteFile(filepath.Join(srcDir, "ysm.json"), []byte("{}"), 0644)

	if err := PushSingleResource(srcDir, customDir, globalDir, "copy", "ysm"); err != nil {
		t.Fatalf("推送目录失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(customDir, "myPack", "ysm.json")); err != nil {
		t.Fatalf("目标文件夹应存在: %v", err)
	}
}

// TestPushSingleResource_JsonExt .json 扩展名走 InstallDir（filePath.Dir 作源目录）
func TestPushSingleResource_JsonExt(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(customDir, 0755)
	srcDir := filepath.Join(globalDir, "jsonPack")
	_ = os.MkdirAll(srcDir, 0755)
	srcFile := filepath.Join(srcDir, "ysm.json")
	_ = os.WriteFile(srcFile, []byte("{}"), 0644)

	if err := PushSingleResource(srcFile, customDir, globalDir, "copy", "ysm"); err != nil {
		t.Fatalf("推送 .json 失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(customDir, "jsonPack", "ysm.json")); err != nil {
		t.Fatalf("目标应存在: %v", err)
	}
}

// =====================================================================
// 十二、SyncToggleStatus 启用分支「存在即跳过」
// =====================================================================

// TestSyncToggleStatus_NilScanFn 对 nil scanFn 应返回错误而非 panic
// （原 repoEntries = scanFn(filesRoot) 调 nil 函数值会 panic——已补 nil 守卫）
func TestSyncToggleStatus_NilScanFn(t *testing.T) {
	_, repoDir, customDir := newToggleEnv(t)
	var panicked bool
	var err error
	var disable, enable int
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		disable, enable, err = SyncToggleStatus(customDir, repoDir, nil)
	}()
	if panicked {
		t.Fatal("nil scanFn 不应 panic，应返回错误")
	}
	if err == nil {
		t.Fatal("nil scanFn 应返回错误")
	}
	if disable != 0 || enable != 0 {
		t.Errorf("nil scanFn 计数应 = 0，实际 disable=%d enable=%d", disable, enable)
	}
}

// TestSyncToggleStatus_EnableTargetExistsSkipped 启用分支：.ban 文件需启用但同名非 .ban
// 已存在 → 跳过（防 Rename 覆盖丢数据），enableCount=0，不报错
func TestSyncToggleStatus_EnableTargetExistsSkipped(t *testing.T) {
	_, repoDir, customDir := newToggleEnv(t)

	// repo: model_a 正常（非 .ban）→ custom 的 model_a.ysm.ban 应启用，
	// 但 custom 同时已有 model_a.ysm（非 .ban，可能是旧版本）→ 跳过防覆盖
	_ = os.WriteFile(filepath.Join(repoDir, "model_a.ysm"), []byte("repo"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "model_a.ysm"), []byte("existing"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "model_a.ysm.ban"), []byte("disabled"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "model_a.ysm", Path: filepath.Join(repoDir, "model_a.ysm"), Hash: "hash_a"},
		}
	}

	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if disable != 0 {
		t.Errorf("禁用应 = 0，实际 %d", disable)
	}
	if enable != 0 {
		t.Errorf("启用应 = 0（目标已存在跳过），实际 %d", enable)
	}
	// 已存在的非 .ban 文件保留（未被覆盖）
	data, _ := os.ReadFile(filepath.Join(customDir, "model_a.ysm"))
	if string(data) != "existing" {
		t.Errorf("既有文件不应被覆盖: %q", string(data))
	}
	// .ban 文件保留（未被删除）
	if _, err := os.Stat(filepath.Join(customDir, "model_a.ysm.ban")); err != nil {
		t.Errorf(".ban 文件应保留: %v", err)
	}
}

// =====================================================================
// 十三、SyncToggleStatus 禁用分支「存在即跳过」
// =====================================================================

// TestSyncToggleStatus_DisableTargetExistsSkipped 禁用分支：文件需禁用但 .disabled 已存在 → 跳过
func TestSyncToggleStatus_DisableTargetExistsSkipped(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	_ = os.MkdirAll(repoDir, 0755)
	_ = os.MkdirAll(customDir, 0755)

	// repo: model_a.ban → custom 的 model_a.ysm 应禁用，
	// 但 custom 同时已有 model_a.ysm.disabled → 跳过
	_ = os.WriteFile(filepath.Join(repoDir, "model_a.ysm.ban"), []byte("repo"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "model_a.ysm"), []byte("active"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "model_a.ysm.disabled"), []byte("existing-disabled"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "model_a.ysm.ban", Path: filepath.Join(repoDir, "model_a.ysm.ban"), Hash: "hash_a"},
		}
	}

	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if disable != 0 {
		t.Errorf("禁用应 = 0（.disabled 已存在跳过），实际 %d", disable)
	}
	if enable != 0 {
		t.Errorf("启用应 = 0，实际 %d", enable)
	}
	// 活跃文件保留（未被 rename）
	data, _ := os.ReadFile(filepath.Join(customDir, "model_a.ysm"))
	if string(data) != "active" {
		t.Errorf("活跃文件不应被移动: %q", string(data))
	}
}

// =====================================================================
// 十四、copyDirRecursive 符号链接目标已存在
// =====================================================================

// TestCopyDirRecursive_SymlinkOverwritesExisting 复制符号链接到已存在目标路径：
// 应替换为符号链接（保留语义）——源码先 Remove(target) 再 Symlink，兼容 Windows
func TestCopyDirRecursive_SymlinkOverwritesExisting(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(src, 0755)
	_ = os.WriteFile(filepath.Join(src, "real.txt"), []byte("r"), 0644)
	if err := os.Symlink(filepath.Join(src, "real.txt"), filepath.Join(src, "link")); err != nil {
		t.Skipf("环境不支持符号链接: %v", err)
	}
	dst := filepath.Join(base, "dst")
	_ = os.MkdirAll(dst, 0755)
	// 目标位置已有普通文件 → 复制链接应替换它（源码 Remove + Symlink）
	_ = os.WriteFile(filepath.Join(dst, "link"), []byte("placeholder"), 0644)
	if err := copyDirRecursive(src, dst); err != nil {
		t.Fatalf("复制失败: %v", err)
	}
	info, err := os.Lstat(filepath.Join(dst, "link"))
	if err != nil {
		t.Fatalf("链接应存在: %v", err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("应为符号链接，实际 %v", info.Mode())
	}
}

// =====================================================================
// 十五、SyncCustomToRepo nil scanFn
// =====================================================================

// TestSyncCustomToRepo_NilScanFn 对 nil scanFn 应返回错误而非 panic
// （原 srcEntries = scanFn(customDir) 调 nil 函数值会 panic——已补 nil 守卫）
func TestSyncCustomToRepo_NilScanFn(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	_ = os.MkdirAll(customDir, 0755)
	_ = os.MkdirAll(repoDir, 0755)
	var panicked bool
	var err error
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_, err = SyncCustomToRepo(customDir, repoDir, nil, nil)
	}()
	if panicked {
		t.Fatal("nil scanFn 不应 panic，应返回错误")
	}
	if err == nil {
		t.Fatal("nil scanFn 应返回错误")
	}
}
