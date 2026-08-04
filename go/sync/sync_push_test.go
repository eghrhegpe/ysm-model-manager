// ===== go/sync 推送/拉取单测（ADR-003 补充下沉验证）=====
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// 文件级分支（非 ysm/mmd-skin）：resourcepack 支持 .zip

func TestPushResources_CopyMode(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	// installer.Install 要求目标目录在 .minecraft 内（安全校验）
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(globalDir, "pack.zip"), []byte("data"), 0644)

	var logs []string
	count, err := PushResources("resourcepack", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) { logs = append(logs, name) })
	if err != nil {
		t.Fatalf("Push 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应推送 1 个，实际 %d", count)
	}
	if _, err := os.Stat(filepath.Join(targetDir, "pack.zip")); err != nil {
		t.Fatalf("目标文件应存在: %v", err)
	}
	if len(logs) != 0 {
		t.Fatalf("成功路径不应有失败日志: %v", logs)
	}
}

func TestPushResources_Empty(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)

	count, err := PushResources("resourcepack", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("空推送不应报错: %v", err)
	}
	if count != 0 {
		t.Fatalf("空仓库应推送 0 个，实际 %d", count)
	}
}

func TestPullResources(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(targetDir, "extra.zip"), []byte("data"), 0644)

	count, err := PullResources("resourcepack", globalDir, targetDir,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("Pull 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应拉取 1 个，实际 %d", count)
	}
	if _, err := os.Stat(filepath.Join(globalDir, "extra.zip")); err != nil {
		t.Fatalf("全局文件应存在: %v", err)
	}
}

func TestPullSingleResource_File(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(targetDir, "extra.zip")
	_ = os.WriteFile(src, []byte("x"), 0644)
	if err := PullSingleResource(globalDir, targetDir, src); err != nil {
		t.Fatalf("PullSingle 失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(globalDir, "extra.zip")); err != nil {
		t.Fatalf("全局文件应存在: %v", err)
	}
}

func TestPullSingleResource_Dir(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	srcDir := filepath.Join(targetDir, "pack")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(srcDir, "a.txt"), []byte("x"), 0644)
	if err := PullSingleResource(globalDir, targetDir, srcDir); err != nil {
		t.Fatalf("文件夹拉取失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(globalDir, "pack", "a.txt")); err != nil {
		t.Fatalf("全局文件夹应存在: %v", err)
	}
}

func TestPushSingleResource_File(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(globalDir, "pack.zip")
	_ = os.WriteFile(src, []byte("x"), 0644)
	if err := PushSingleResource(src, customDir, globalDir, "copy", "resourcepack"); err != nil {
		t.Fatalf("PushSingle 失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(customDir, "pack.zip")); err != nil {
		t.Fatalf("目标文件应存在: %v", err)
	}
}

func TestSyncCustomToRepo(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(repoDir, 0755); err != nil {
		t.Fatal(err)
	}
	// 新文件：应复制
	_ = os.WriteFile(filepath.Join(customDir, "new.ysm"), []byte("new"), 0644)
	// 同名文件（同哈希）：应跳过
	_ = os.WriteFile(filepath.Join(customDir, "dup.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(repoDir, "dup.ysm"), []byte("x"), 0644)

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
	if err != nil {
		t.Fatalf("SyncCustomToRepo 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应复制 1 个（new.ysm），实际 %d", count)
	}
	if _, err := os.Stat(filepath.Join(repoDir, "new.ysm")); err != nil {
		t.Fatalf("new.ysm 应复制到仓库: %v", err)
	}
	// dup.ysm 保留仓库原文件（跳过）
	data, _ := os.ReadFile(filepath.Join(repoDir, "dup.ysm"))
	if string(data) != "x" {
		t.Fatalf("dup.ysm 不应被覆盖: %q", string(data))
	}
}

func TestSyncCustomToRepo_Empty(t *testing.T) {
	if _, err := SyncCustomToRepo("", "repo", nil, nil); err == nil {
		t.Fatal("空参数应报错")
	}
}
