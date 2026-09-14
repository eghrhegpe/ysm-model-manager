// ===== go/sync 推送/拉取单测（ADR-003 补充下沉验证）=====
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

const perm = 0o644

// 文件级分支（非 ysm/EntityPlayer）：resourcepack 支持 .zip

// setupSyncDirs 创建 (globalDir, targetDir) 测试目录。
func setupSyncDirs(t *testing.T) (globalDir, targetDir string) {
	t.Helper()
	base := t.TempDir()
	globalDir = filepath.Join(base, "global")
	targetDir = filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	for _, d := range []string{globalDir, targetDir} {
		if err := os.MkdirAll(d, 0755); err != nil {
			t.Fatal(err)
		}
	}
	return
}

func TestPushResources_CopyMode(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	if err := os.WriteFile(filepath.Join(globalDir, "pack.zip"), []byte("data"), perm); err != nil {
		t.Fatal(err)
	}

	var logs []string
	count, err := PushResources("resourcepack", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) { logs = append(logs, name) })
	testutil.NoError(t, err, "Push 失败")
	testutil.Equal(t, count, 1, "应推送 1 个")
	testutil.FileExists(t, filepath.Join(targetDir, "pack.zip"))
	testutil.Equal(t, len(logs), 0, "成功路径不应有失败日志")
}

func TestPushResources_Empty(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)

	count, err := PushResources("resourcepack", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NoError(t, err, "空推送不应报错")
	testutil.Equal(t, count, 0, "空仓库应推送 0 个")
}

func TestPullResources(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	if err := os.WriteFile(filepath.Join(targetDir, "extra.zip"), []byte("data"), perm); err != nil {
		t.Fatal(err)
	}

	count, err := PullResources("resourcepack", globalDir, targetDir,
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NoError(t, err, "Pull 失败")
	testutil.Equal(t, count, 1, "应拉取 1 个")
	testutil.FileExists(t, filepath.Join(globalDir, "extra.zip"))
}

func TestPullSingleResource_File(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	src := filepath.Join(targetDir, "extra.zip")
	if err := os.WriteFile(src, []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	testutil.NoError(t, PullSingleResource(globalDir, targetDir, src), "PullSingle 失败")
	testutil.FileExists(t, filepath.Join(globalDir, "extra.zip"))
}

func TestPullSingleResource_Dir(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	srcDir := filepath.Join(targetDir, "pack")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "a.txt"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	testutil.NoError(t, PullSingleResource(globalDir, targetDir, srcDir), "文件夹拉取失败")
	testutil.FileExists(t, filepath.Join(globalDir, "pack", "a.txt"))
}

func TestPushSingleResource_File(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	src := filepath.Join(globalDir, "pack.zip")
	if err := os.WriteFile(src, []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	testutil.NoError(t, PushSingleResource(src, targetDir, globalDir, "copy", "resourcepack"), "PushSingle 失败")
	testutil.FileExists(t, filepath.Join(targetDir, "pack.zip"))
}

func TestSyncCustomToRepo(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(repoDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(customDir, "new.ysm"), []byte("new"), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(customDir, "dup.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repoDir, "dup.ysm"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}

	scanFn := func(dir string) []types.ModelEntry {
		files, _ := os.ReadDir(dir)
		var entries []types.ModelEntry
		for _, f := range files {
			if f.IsDir() {
				continue
			}
			entries = append(entries, types.ModelEntry{
				Name: f.Name(),
				Path: filepath.Join(dir, f.Name()),
				Hash: "h-" + f.Name(),
			})
		}
		return entries
	}
	count, err := SyncCustomToRepo(customDir, repoDir, scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NoError(t, err, "SyncCustomToRepo 失败")
	testutil.Equal(t, count, 1, "应复制 1 个（new.ysm）")
	testutil.FileExists(t, filepath.Join(repoDir, "new.ysm"))
	data, _ := os.ReadFile(filepath.Join(repoDir, "dup.ysm"))
	testutil.Equal(t, string(data), "x", "dup.ysm 不应被覆盖")
}

func TestSyncCustomToRepo_Empty(t *testing.T) {
	t.Parallel()
	if _, err := SyncCustomToRepo("", "repo", nil, nil); err == nil {
		t.Fatal("空参数应报错")
	}
}

// TestSyncCustomToRepo_HoldsInstallLock 钉住 SyncCustomToRepo 的锁口径：
// 与 Push/Pull/Relink 五兄弟一致，须整段持 InstallLock（ADR-056）。
// 探测法：注入 scanFn 在持锁段内执行，回调里 IsLocked()——锁被任何 goroutine 持有
// 时 IsLocked() 返回 true（通过）；未持锁则 IsLocked() 返回 false（违规，须标记失败）。
// IsLocked() 精确探测「锁是否被持有」，不依赖 TryLock 的空闲探测语义。
// 注意：本测试不使用 t.Parallel()，避免其他并行测试恰巧持有锁导致误判。
func TestSyncCustomToRepo_HoldsInstallLock(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	for _, d := range []string{customDir, repoDir} {
		if err := os.MkdirAll(d, 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(customDir, "new.ysm"), []byte("new"), perm); err != nil {
		t.Fatal(err)
	}

	lockViolated := false
	scanFn := func(dir string) []types.ModelEntry {
		// 探测锁是否被持有：IsLocked() 返回 true 说明锁被任何 goroutine 持有（正确）
		if lt, ok := installer.InstallLocker.(*installer.LockTracker); ok {
			if lt.IsLocked() {
				// 锁被持有 → 持锁段正确 ✓
			} else {
				lockViolated = true // 锁未被持有 → 违规 ✗
			}
		}
		files, _ := os.ReadDir(dir)
		var entries []types.ModelEntry
		for _, f := range files {
			if f.IsDir() {
				continue
			}
			entries = append(entries, types.ModelEntry{
				Name: f.Name(),
				Path: filepath.Join(dir, f.Name()),
				Hash: "h-" + f.Name(),
			})
		}
		return entries
	}

	count, err := SyncCustomToRepo(customDir, repoDir, scanFn, nil)
	testutil.NoError(t, err, "SyncCustomToRepo 失败")
	testutil.Equal(t, count, 1, "应复制 1 个（new.ysm）")
	testutil.FileExists(t, filepath.Join(repoDir, "new.ysm"))
	if lockViolated {
		t.Fatal("SyncCustomToRepo 未整段持 InstallLock（scanFn 执行期间 IsLocked() 返回 false）")
	}
}

// ===== PushResources 文件夹级分支（YSM/MMD 类型走 SyncResourcesDirLevel）=====

func TestPushResources_FolderLevelYSM(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	_ = os.MkdirAll(filepath.Join(globalDir, "modelpack"), 0755)
	if err := os.WriteFile(filepath.Join(globalDir, "modelpack", "ysm.json"), []byte("{}"), perm); err != nil {
		t.Fatal(err)
	}

	var logs []string
	count, err := PushResources("ysm", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) { logs = append(logs, name+":"+status) })
	testutil.NoError(t, err, "Push 文件夹级失败")
	testutil.Equal(t, count, 1, "应推送 1 个文件夹")
	testutil.FileExists(t, filepath.Join(targetDir, "modelpack", "ysm.json"))
}

func TestPushResources_FolderLevelMMD(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	_ = os.MkdirAll(filepath.Join(globalDir, "mmdmodel"), 0755)
	if err := os.WriteFile(filepath.Join(globalDir, "mmdmodel", "char.pmx"), []byte("pmx"), perm); err != nil {
		t.Fatal(err)
	}

	count, err := PushResources("EntityPlayer", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NoError(t, err, "Push MMD 失败")
	testutil.Equal(t, count, 1, "应推送 1 个 MMD 文件夹")
}

func TestPushResources_AllSyncedNoOp(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	if err := os.WriteFile(filepath.Join(globalDir, "pack.zip"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(targetDir, "pack.zip"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}

	count, err := PushResources("resourcepack", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NoError(t, err, "全同步不应报错")
	testutil.Equal(t, count, 0, "全同步应推送 0 个")
}

// ===== PullResources 文件夹级分支（YSM/MMD）=====

func TestPullResources_FolderLevelDir(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	_ = os.MkdirAll(filepath.Join(targetDir, "extra-pack"), 0755)
	if err := os.WriteFile(filepath.Join(targetDir, "extra-pack", "m.ysm"), []byte("e"), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(targetDir, "flat.ysm"), []byte("f"), perm); err != nil {
		t.Fatal(err)
	}

	count, err := PullResources("ysm", globalDir, targetDir,
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NoError(t, err, "Pull 文件夹级失败")
	testutil.Equal(t, count, 2, "应拉取 2 个（文件夹+平铺）")
	testutil.FileExists(t, filepath.Join(globalDir, "extra-pack", "m.ysm"))
	testutil.FileExists(t, filepath.Join(globalDir, "flat.ysm"))
}

func TestPullResources_NoExtra(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	if err := os.WriteFile(filepath.Join(globalDir, "same.zip"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(targetDir, "same.zip"), []byte("x"), perm); err != nil {
		t.Fatal(err)
	}

	count, err := PullResources("resourcepack", globalDir, targetDir,
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NoError(t, err, "无 extra 不应报错")
	testutil.Equal(t, count, 0, "应拉取 0 个")
}

func TestPullResources_MMDFolderLevel(t *testing.T) {
	t.Parallel()
	globalDir, targetDir := setupSyncDirs(t)
	_ = os.MkdirAll(filepath.Join(targetDir, "mmd-pack"), 0755)
	if err := os.WriteFile(filepath.Join(targetDir, "mmd-pack", "m.pmx"), []byte("m"), perm); err != nil {
		t.Fatal(err)
	}

	count, err := PullResources("EntityPlayer", globalDir, targetDir,
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NoError(t, err, "Pull MMD 失败")
	testutil.Equal(t, count, 1, "应拉取 1 个 MMD 文件夹")
}
