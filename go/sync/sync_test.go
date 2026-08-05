package sync

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"testing"

	"ysm-model-manager/go/types"
)

// ===== mock 数据 =====

// mockScanDir returns a ScanFunc that returns different data based on dir.
// repoDir -> repo entries, other -> custom entries.
func mockScanDir(repoDir string, repoEntries, customEntries []types.ModelEntry) ScanFunc {
	return func(dir string) []types.ModelEntry {
		if dir == repoDir {
			return repoEntries
		}
		return customEntries
	}
}

var repoEntries = []types.ModelEntry{
	{Name: "model_a.ysm", Path: "/repo/model_a.ysm", Hash: "hash_a", Size: 1000},
	{Name: "model_b.ysm", Path: "/repo/model_b.ysm", Hash: "hash_b", Size: 2000},
	{Name: "model_c.ysm", Path: "/repo/model_c.ysm", Hash: "hash_c", Size: 3000},
	{Name: "model_d.ysm.ban", Path: "/repo/model_d.ysm.ban", Hash: "hash_d", Size: 4000},
}

func mockListVersions(mcRoot string) []types.VersionInstance {
	return []types.VersionInstance{
		{Name: "instance1", CustomDir: "/mc/instances/instance1/custom", VersionDir: "/mc/instances/instance1"},
	}
}

// ===== 测试用例 =====

func TestGetInstanceStatus_MissingModels(t *testing.T) {
	// custom 为空 → 所有 repo 模型都是缺失
	scanFn := mockScanDir("/repo", repoEntries, nil)
	results := GetInstanceStatusWith("/mc", "/repo", scanFn, mockListVersions)
	if len(results) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(results))
	}

	ins1 := results[0]
	if len(ins1.Missing) != 3 {
		t.Errorf("expected 3 missing (all non-banned), got %d: %v", len(ins1.Missing), ins1.Missing)
	}
	if len(ins1.Extra) != 0 {
		t.Errorf("expected 0 extra, got %d", len(ins1.Extra))
	}
}

func TestGetInstanceStatus_AllSynced(t *testing.T) {
	// custom 包含所有 repo 模型
	customEntries := []types.ModelEntry{
		{Name: "model_a.ysm", Path: "/c/ins1/model_a.ysm", Hash: "hash_a"},
		{Name: "model_b.ysm", Path: "/c/ins1/model_b.ysm", Hash: "hash_b"},
		{Name: "model_c.ysm", Path: "/c/ins1/model_c.ysm", Hash: "hash_c"},
	}
	scanFn := mockScanDir("/repo", repoEntries, customEntries)
	results := GetInstanceStatusWith("/mc", "/repo", scanFn, mockListVersions)

	if len(results) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(results))
	}
	ins1 := results[0]
	if len(ins1.Missing) != 0 {
		t.Errorf("expected 0 missing, got %d: %v", len(ins1.Missing), ins1.Missing)
	}
	if len(ins1.Extra) != 0 {
		t.Errorf("expected 0 extra, got %d", len(ins1.Extra))
	}
}

func TestGetInstanceStatus_ExtraModels(t *testing.T) {
	// custom 有一个 repo 中没有的模型
	customEntries := []types.ModelEntry{
		{Name: "model_a.ysm", Path: "/c/ins1/model_a.ysm", Hash: "hash_a"},
		{Name: "extra_model.ysm", Path: "/c/ins1/extra_model.ysm", Hash: "hash_extra"},
	}
	scanFn := mockScanDir("/repo", repoEntries, customEntries)
	results := GetInstanceStatusWith("/mc", "/repo", scanFn, mockListVersions)

	ins1 := results[0]
	if len(ins1.Extra) != 1 {
		t.Errorf("expected 1 extra, got %d: %v", len(ins1.Extra), ins1.Extra)
	}
	if len(ins1.Missing) != 2 {
		t.Errorf("expected 2 missing (hash_b, hash_c), got %d: %v", len(ins1.Missing), ins1.Missing)
	}
}

func TestGetInstanceStatus_BannedModelsSkipped(t *testing.T) {
	// custom 有 model_d（仓库中 .ban 的模型）
	customEntries := []types.ModelEntry{
		{Name: "model_a.ysm", Path: "/c/ins1/model_a.ysm", Hash: "hash_a"},
		{Name: "model_d.ysm", Path: "/c/ins1/model_d.ysm", Hash: "hash_d"},
	}
	scanFn := mockScanDir("/repo", repoEntries, customEntries)
	results := GetInstanceStatusWith("/mc", "/repo", scanFn, mockListVersions)

	ins1 := results[0]
	foundDisabled := false
	for _, d := range ins1.Disabled {
		if d == "model_d.ysm" {
			foundDisabled = true
			break
		}
	}
	if !foundDisabled {
		t.Errorf("expected model_d to be in Disabled, got disabled=%v", ins1.Disabled)
	}
	// model_d 不应出现在 missing 中
	for _, m := range ins1.Missing {
		if m == "/repo/model_d.ysm.ban" {
			t.Error("model_d.ban should not appear in Missing")
		}
	}
}

func TestGetInstanceStatus_EmptyPaths(t *testing.T) {
	results := GetInstanceStatusWith("", "/repo", mockScanDir("/repo", repoEntries, nil), mockListVersions)
	if len(results) != 0 {
		t.Errorf("expected 0 results for empty mcRoot, got %d", len(results))
	}

	results = GetInstanceStatusWith("/mc", "", mockScanDir("", repoEntries, nil), mockListVersions)
	if len(results) != 0 {
		t.Errorf("expected 0 results for empty repoDir, got %d", len(results))
	}
}

func TestGetInstanceStatus_DuplicateHash(t *testing.T) {
	// 仓库中有同 hash 的多个文件
	dupRepoEntries := []types.ModelEntry{
		{Name: "model_a_v1.ysm", Path: "/repo/model_a_v1.ysm", Hash: "hash_a"},
		{Name: "model_a_v2.ysm", Path: "/repo/model_a_v2.ysm", Hash: "hash_a"},
		{Name: "model_b.ysm", Path: "/repo/model_b.ysm", Hash: "hash_b"},
	}
	customEntries := []types.ModelEntry{
		{Name: "model_a_v1.ysm", Path: "/c/ins1/model_a_v1.ysm", Hash: "hash_a"},
	}
	scanFn := mockScanDir("/repo", dupRepoEntries, customEntries)
	results := GetInstanceStatusWith("/mc", "/repo", scanFn, mockListVersions)

	ins1 := results[0]
	// hash_a 已存在（无论有几个同 hash 的 repo 文件），hash_b missing
	if len(ins1.Missing) != 1 {
		t.Errorf("expected 1 missing (hash_b), got %d: %v", len(ins1.Missing), ins1.Missing)
	}
}

// ===== ListVersions 布局检测测试 =====

func TestListVersions_VanillaLayout(t *testing.T) {
	tmpDir := t.TempDir()
	versionsDir := filepath.Join(tmpDir, "versions")
	os.MkdirAll(filepath.Join(versionsDir, "1.20.1", "config", "yes_steve_model", "custom"), 0755)
	os.MkdirAll(filepath.Join(versionsDir, "1.19.2"), 0755)

	results := ListVersions(tmpDir)
	if len(results) != 2 {
		t.Fatalf("expected 2 instances, got %d", len(results))
	}

	if results[0].Name != "1.19.2" && results[0].Name != "1.20.1" {
		t.Errorf("unexpected instance name: %s", results[0].Name)
	}
	for _, r := range results {
		if r.Name == "1.20.1" {
			if !r.Exists {
				t.Error("1.20.1 should have custom dir")
			}
			if !strings.HasSuffix(strings.ReplaceAll(r.VersionDir, "\\", "/"), "/versions/1.20.1") {
				t.Errorf("unexpected VersionDir: %s", r.VersionDir)
			}
		}
		if r.Name == "1.19.2" {
			if r.Exists {
				t.Error("1.19.2 should NOT have custom dir")
			}
		}
	}
}

func TestListVersions_PrismLayout(t *testing.T) {
	tmpDir := t.TempDir()
	instancesDir := filepath.Join(tmpDir, "instances")
	os.MkdirAll(filepath.Join(instancesDir, "MyPack", ".minecraft", "config", "yes_steve_model", "custom"), 0755)
	os.MkdirAll(filepath.Join(instancesDir, "OldPack", ".minecraft"), 0755)

	results := ListVersions(tmpDir)
	if len(results) != 2 {
		t.Fatalf("expected 2 instances, got %d", len(results))
	}

	for _, r := range results {
		switch r.Name {
		case "MyPack":
			if !r.Exists {
				t.Error("MyPack should have custom dir")
			}
			expectedDir := strings.ReplaceAll(filepath.Join(instancesDir, "MyPack", ".minecraft"), "\\", "/")
			actualDir := strings.ReplaceAll(r.VersionDir, "\\", "/")
			if !strings.HasSuffix(actualDir, "/instances/MyPack/.minecraft") {
				t.Errorf("MyPack VersionDir: expected suffix .../instances/MyPack/.minecraft, got %q\n(expected base: %s)", r.VersionDir, expectedDir)
			}
		case "OldPack":
			if r.Exists {
				t.Error("OldPack should NOT have custom dir")
			}
		default:
			t.Errorf("unexpected instance name: %s", r.Name)
		}
	}
}

func TestListVersions_PrismLayout_DirectInstances(t *testing.T) {
	tmpDir := t.TempDir()
	os.MkdirAll(filepath.Join(tmpDir, "MyPack", ".minecraft", "config", "yes_steve_model", "custom"), 0755)
	os.MkdirAll(filepath.Join(tmpDir, "OldPack", ".minecraft"), 0755)

	results := ListVersions(tmpDir)
	if len(results) != 2 {
		t.Fatalf("expected 2 instances (direct instances dir), got %d", len(results))
	}

	for _, r := range results {
		switch r.Name {
		case "MyPack":
			if !r.Exists {
				t.Error("MyPack should have custom dir")
			}
			actualDir := strings.ReplaceAll(r.VersionDir, "\\", "/")
			if !strings.HasSuffix(actualDir, "/MyPack/.minecraft") {
				t.Errorf("MyPack VersionDir: expected suffix .../MyPack/.minecraft, got %q", r.VersionDir)
			}
		case "OldPack":
			if r.Exists {
				t.Error("OldPack should NOT have custom dir")
			}
		default:
			t.Errorf("unexpected instance name: %s", r.Name)
		}
	}
}

func TestListVersions_EmptyDir(t *testing.T) {
	tmpDir := t.TempDir()
	results := ListVersions(tmpDir)
	if len(results) != 0 {
		t.Errorf("expected 0 instances for empty dir, got %d", len(results))
	}
}

func TestCompareGlobalInstanceHashes(t *testing.T) {
	global := []types.ModelEntry{
		{Name: "a.ysm", Path: "/global/a.ysm", Hash: "hash_a"},
		{Name: "b.ysm", Path: "/global/b.ysm", Hash: "hash_b"},
	}
	instEntries := []types.ModelEntry{
		{Name: "a.ysm", Path: "/inst/a.ysm", Hash: "hash_a"},
		{Name: "c.ysm", Path: "/inst/c.ysm", Hash: "hash_c"},
	}
	// Use temp dir pattern like existing mockScanDir
	globalDir := t.TempDir()
	instDir := t.TempDir()

	scanFn := func(dir string) []types.ModelEntry {
		if dir == globalDir {
			return global
		}
		return instEntries
	}
	listFn := func(mcRoot string) []types.VersionInstance {
		return []types.VersionInstance{
			{Name: "test", VersionDir: instDir},
		}
	}

	results := CompareGlobalInstanceHashes("mcRoot", globalDir, ".", "resourcepack",
		scanFn, listFn, nil)
	if len(results) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(results))
	}
	r := results[0]
	if len(r.Missing) != 1 || r.Missing[0] != "/global/b.ysm" {
		t.Errorf("expected Missing=[b.ysm], got %v", r.Missing)
	}
	if len(r.Extra) != 1 || r.Extra[0] != "/inst/c.ysm" {
		t.Errorf("expected Extra=[c.ysm], got %v", r.Extra)
	}
	if r.Synced != 1 {
		t.Errorf("expected Synced=1, got %d", r.Synced)
	}
}

func TestCompareGlobalInstanceHashes_Empty(t *testing.T) {
	results := CompareGlobalInstanceHashes("", "/global", "subdir", "resourcepack", nil, nil, nil)
	if len(results) != 0 {
		t.Errorf("expected 0 for empty mcRoot, got %d", len(results))
	}
}

// TestSyncResources_SizeMismatch 同名文件大小不同（内容已变化）应归入 Missing 待推送更新
func TestSyncResources_SizeMismatch(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 同名异 size → 内容已变化，应待推送（Missing）
	os.WriteFile(filepath.Join(globalDir, "pack.zip"), bytes.Repeat([]byte("a"), 100), 0644)
	os.WriteFile(filepath.Join(instDir, "pack.zip"), bytes.Repeat([]byte("b"), 50), 0644)
	// 同名同 size → Synced
	os.WriteFile(filepath.Join(globalDir, "same.zip"), bytes.Repeat([]byte("x"), 30), 0644)
	os.WriteFile(filepath.Join(instDir, "same.zip"), bytes.Repeat([]byte("y"), 30), 0644)
	// 实例独有 → Extra
	os.WriteFile(filepath.Join(instDir, "only-instance.zip"), []byte("z"), 10)

	result := SyncResources(globalDir, instDir)

	found := func(list []string, name string) bool {
		for _, p := range list {
			if filepath.Base(p) == name {
				return true
			}
		}
		return false
	}

	if !found(result.Missing, "pack.zip") {
		t.Errorf("size 变化的同名文件应归入 Missing, got Missing=%v", result.Missing)
	}
	if !found(result.Synced, "same.zip") {
		t.Errorf("同 size 同名文件应 Synced, got Synced=%v", result.Synced)
	}
	if !found(result.Extra, "only-instance.zip") {
		t.Errorf("实例独有文件应 Extra, got Extra=%v", result.Extra)
	}
}

// TestSyncResources_IgnoresRecycleDir 仓库 .recycle 内模型不应视为仓库活跃模型
// （2026-08-05 回归：同步管理器把回收站模型识别为 missing 并可推送）
func TestSyncResources_IgnoresRecycleDir(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 仓库活跃模型
	os.WriteFile(filepath.Join(globalDir, "active.ysm"), []byte("active"), 0644)
	// 仓库回收站内的模型（历史遗留，不应参与同步）
	recycleDir := filepath.Join(globalDir, ".recycle")
	os.MkdirAll(filepath.Join(recycleDir, "模型文件夹"), 0755)
	os.WriteFile(filepath.Join(recycleDir, "trashed.ysm"), []byte("trashed"), 0644)
	os.WriteFile(filepath.Join(recycleDir, "模型文件夹", "ysm.json"), []byte("{}"), 0644)
	// 整合包目录（无任何模型）
	_ = os.MkdirAll(instDir, 0755)

	result := SyncResources(globalDir, instDir)

	found := func(list []string, name string) bool {
		for _, p := range list {
			if filepath.Base(p) == name {
				return true
			}
		}
		return false
	}
	if !found(result.Missing, "active.ysm") {
		t.Errorf("仓库活跃模型应 Missing, got Missing=%v", result.Missing)
	}
	if found(result.Missing, "trashed.ysm") {
		t.Errorf(".recycle 内模型不应出现在 Missing: %v", result.Missing)
	}
	for _, p := range result.Missing {
		if strings.Contains(filepath.ToSlash(p), ".recycle/") {
			t.Errorf("Missing 中出现 .recycle 路径: %s", p)
		}
	}
}

// ===== SyncToggleStatus =====

func TestSyncToggleStatus_EnableDisable(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	os.MkdirAll(repoDir, 0755)
	os.MkdirAll(customDir, 0755)

	// repo: model_a 已 ban, model_b 正常
	os.WriteFile(filepath.Join(repoDir, "model_a.ysm.ban"), []byte("aaa"), 0644)
	os.WriteFile(filepath.Join(repoDir, "model_b.ysm"), []byte("bbb"), 0644)
	// custom: model_a 正常（应与 repo 同步 → 禁用）, model_b 已 ban（应与 repo 同步 → 启用）
	os.WriteFile(filepath.Join(customDir, "model_a.ysm"), []byte("aaa"), 0644)
	os.WriteFile(filepath.Join(customDir, "model_b.ysm.ban"), []byte("bbb"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "model_a.ysm.ban", Path: filepath.Join(repoDir, "model_a.ysm.ban"), Hash: "hash_a"},
			{Name: "model_b.ysm", Path: filepath.Join(repoDir, "model_b.ysm"), Hash: "hash_b"},
		}
	}

	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("SyncToggleStatus 失败: %v", err)
	}
	if disable != 1 {
		t.Errorf("应禁用 1 个（model_a），实际 %d", disable)
	}
	if enable != 1 {
		t.Errorf("应启用 1 个（model_b），实际 %d", enable)
	}
	// 验证文件状态
	if _, err := os.Stat(filepath.Join(customDir, "model_a.ysm.ban")); os.IsNotExist(err) {
		t.Error("model_a 应已被禁（.ban）")
	}
	if _, err := os.Stat(filepath.Join(customDir, "model_b.ysm")); os.IsNotExist(err) {
		t.Error("model_b 应已被启用（去掉 .ban）")
	}
}

func TestSyncToggleStatus_NoMatch(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	os.MkdirAll(repoDir, 0755)
	os.MkdirAll(customDir, 0755)

	// repo 有文件，custom 没有匹配的 → 不动
	os.WriteFile(filepath.Join(repoDir, "m.ysm"), []byte("r"), 0644)
	os.WriteFile(filepath.Join(customDir, "other.ysm"), []byte("o"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "m.ysm", Path: filepath.Join(repoDir, "m.ysm"), Hash: "hash_m"},
		}
	}

	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("SyncToggleStatus 失败: %v", err)
	}
	if disable != 0 || enable != 0 {
		t.Errorf("无匹配文件应不动，实际 disable=%d enable=%d", disable, enable)
	}
}

func TestSyncToggleStatus_EmptyRepo(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "empty-repo")
	customDir := filepath.Join(base, "custom")
	os.MkdirAll(repoDir, 0755)
	os.MkdirAll(customDir, 0755)

	scanFn := func(dir string) []types.ModelEntry { return nil }
	_, _, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err == nil {
		t.Fatal("空仓库应报错「未找到模型文件」")
	}
}

// ===== SyncResourcesDirLevel =====

func TestSyncResourcesDirLevel_SyncedMissingExtra(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// global: 文件夹 A（含 .ysm → 算文件夹级条目）, 平铺 B.ysm, 独有 C.ysm
	os.MkdirAll(filepath.Join(globalDir, "folderA"), 0755)
	os.WriteFile(filepath.Join(globalDir, "folderA", "m.ysm"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(globalDir, "B.ysm"), []byte("b"), 0644)
	os.WriteFile(filepath.Join(globalDir, "C.ysm"), []byte("c"), 0644)
	// instance: 文件夹 A（同 global → Synced）, 平铺 B.ysm（同 global → Synced）, 独有 D.ysm
	os.MkdirAll(filepath.Join(instDir, "folderA"), 0755)
	os.WriteFile(filepath.Join(instDir, "folderA", "m.ysm"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(instDir, "B.ysm"), []byte("b"), 0644)
	os.WriteFile(filepath.Join(instDir, "D.ysm"), []byte("d"), 0644)

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	found := func(list []string, name string) bool {
		for _, p := range list {
			if filepath.Base(p) == name {
				return true
			}
		}
		return false
	}

	// C.ysm global 独有 → Missing
	if !found(result.Missing, "C.ysm") {
		t.Errorf("C.ysm 应归入 Missing, got Missing=%v", result.Missing)
	}
	// folderA 和 B.ysm 两边都有 → Synced
	if !found(result.Synced, "folderA") {
		t.Errorf("folderA 应归入 Synced, got Synced=%v", result.Synced)
	}
	if !found(result.Synced, "B.ysm") {
		t.Errorf("B.ysm 应归入 Synced（或 B）, got Synced=%v", result.Synced)
	}
	// D.ysm instance 独有 → Extra
	if !found(result.Extra, "D.ysm") {
		t.Errorf("D.ysm 应归入 Extra, got Extra=%v", result.Extra)
	}

	// 排序检查
	if !sort.StringsAreSorted(result.Synced) {
		t.Error("Synced 应已排序")
	}
	if !sort.StringsAreSorted(result.Missing) {
		t.Error("Missing 应已排序")
	}
	if !sort.StringsAreSorted(result.Extra) {
		t.Error("Extra 应已排序")
	}
}

func TestSyncResourcesDirLevel_AllExtra(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	os.WriteFile(filepath.Join(instDir, "E.ysm"), []byte("e"), 0644)
	os.WriteFile(filepath.Join(instDir, "F.ysm"), []byte("f"), 0644)

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")
	if len(result.Missing) != 0 {
		t.Errorf("global 为空不应有 Missing, got %v", result.Missing)
	}
	if len(result.Extra) != 2 {
		t.Errorf("应识别 2 个 Extra, got %d: %v", len(result.Extra), result.Extra)
	}
}

// TestIsFileLocked errno 判定优先，文本匹配兜底，无关错误与 nil 不应误判
func TestIsFileLocked(t *testing.T) {
	if !isFileLocked(syscall.Errno(32)) {
		t.Error("Errno(32) 应判定为锁定（Windows ERROR_SHARING_VIOLATION）")
	}
	if !isFileLocked(fmt.Errorf("sharing violation")) {
		t.Error("文本匹配兜底应识别 sharing violation")
	}
	if !isFileLocked(fmt.Errorf("Access is denied")) {
		t.Error("文本匹配兜底应识别 access 错误")
	}
	if isFileLocked(fmt.Errorf("no such file")) {
		t.Error("无关错误不应判定为锁定")
	}
	if isFileLocked(nil) {
		t.Error("nil 不应判定为锁定")
	}
}
