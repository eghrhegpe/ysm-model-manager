package sync

import (
	"os"
	"path/filepath"
	"strings"
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
	// 创建临时标准 .minecraft/versions/ 结构
	tmpDir := t.TempDir()
	// 无 instances/ 目录 → 应走 vanilla 逻辑
	versionsDir := filepath.Join(tmpDir, "versions")
	os.MkdirAll(filepath.Join(versionsDir, "1.20.1", "config", "yes_steve_model", "custom"), 0755)
	os.MkdirAll(filepath.Join(versionsDir, "1.19.2"), 0755) // 无 YSM custom

	results := ListVersions(tmpDir)
	if len(results) != 2 {
		t.Fatalf("expected 2 instances, got %d", len(results))
	}

	// 1.20.1 有 custom 目录
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
	// 创建临时 PrismLauncher 结构: {root}/instances/{name}/.minecraft/
	tmpDir := t.TempDir()
	instancesDir := filepath.Join(tmpDir, "instances")
	os.MkdirAll(filepath.Join(instancesDir, "MyPack", ".minecraft", "config", "yes_steve_model", "custom"), 0755)
	os.MkdirAll(filepath.Join(instancesDir, "OldPack", ".minecraft"), 0755) // 无 YSM custom

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
	// 用户直接选择了 instances 目录（而非 PrismLauncher 根目录）
	tmpDir := t.TempDir()
	// 直接创建 instances 目录结构，把 mcRoot 设为 instances 目录
	os.MkdirAll(filepath.Join(tmpDir, "MyPack", ".minecraft", "config", "yes_steve_model", "custom"), 0755)
	os.MkdirAll(filepath.Join(tmpDir, "OldPack", ".minecraft"), 0755)

	// mcRoot 就是 instances 目录自身
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
