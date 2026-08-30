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
	results := GetInstanceStatusWith("/mc", "/repo", "", scanFn, mockListVersions)
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
	if ins1.Synced != 0 {
		t.Errorf("expected Synced=0 (custom 为空，无命中仓库哈希), got %d", ins1.Synced)
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
	results := GetInstanceStatusWith("/mc", "/repo", "", scanFn, mockListVersions)

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
	if ins1.Synced != 3 {
		t.Errorf("expected Synced=3 (a/b/c 均命中仓库哈希), got %d", ins1.Synced)
	}
}

func TestGetInstanceStatus_ExtraModels(t *testing.T) {
	// custom 有一个 repo 中没有的模型
	customEntries := []types.ModelEntry{
		{Name: "model_a.ysm", Path: "/c/ins1/model_a.ysm", Hash: "hash_a"},
		{Name: "extra_model.ysm", Path: "/c/ins1/extra_model.ysm", Hash: "hash_extra"},
	}
	scanFn := mockScanDir("/repo", repoEntries, customEntries)
	results := GetInstanceStatusWith("/mc", "/repo", "", scanFn, mockListVersions)

	ins1 := results[0]
	if len(ins1.Extra) != 1 {
		t.Errorf("expected 1 extra, got %d: %v", len(ins1.Extra), ins1.Extra)
	}
	if len(ins1.Missing) != 2 {
		t.Errorf("expected 2 missing (hash_b, hash_c), got %d: %v", len(ins1.Missing), ins1.Missing)
	}
	if ins1.Synced != 1 {
		t.Errorf("expected Synced=1 (仅 hash_a 命中仓库), got %d", ins1.Synced)
	}
}

func TestGetInstanceStatus_BannedModelsSkipped(t *testing.T) {
	// custom 有 model_d（仓库中 .ban 的模型）
	customEntries := []types.ModelEntry{
		{Name: "model_a.ysm", Path: "/c/ins1/model_a.ysm", Hash: "hash_a"},
		{Name: "model_d.ysm", Path: "/c/ins1/model_d.ysm", Hash: "hash_d"},
	}
	scanFn := mockScanDir("/repo", repoEntries, customEntries)
	results := GetInstanceStatusWith("/mc", "/repo", "", scanFn, mockListVersions)

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
	// 命中仓库哈希仅 hash_a（hash_d 对应仓库 .ban，不计入 synced）
	if ins1.Synced != 1 {
		t.Errorf("expected Synced=1 (仅 hash_a 命中活跃仓库), got %d", ins1.Synced)
	}
}

func TestGetInstanceStatus_EmptyPaths(t *testing.T) {
	results := GetInstanceStatusWith("", "/repo", "", mockScanDir("/repo", repoEntries, nil), mockListVersions)
	if len(results) != 0 {
		t.Errorf("expected 0 results for empty mcRoot, got %d", len(results))
	}

	results = GetInstanceStatusWith("/mc", "", "", mockScanDir("", repoEntries, nil), mockListVersions)
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
	results := GetInstanceStatusWith("/mc", "/repo", "", scanFn, mockListVersions)

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
	globalDir := t.TempDir()
	instDir := t.TempDir()
	global := []types.ModelEntry{
		{Name: "a.ysm", Path: filepath.Join(globalDir, "a.ysm"), Hash: "hash_a"},
		{Name: "b.ysm", Path: filepath.Join(globalDir, "b.ysm"), Hash: "hash_b"},
	}
	instEntries := []types.ModelEntry{
		{Name: "a.ysm", Path: filepath.Join(instDir, "a.ysm"), Hash: "hash_a"},
		{Name: "c.ysm", Path: filepath.Join(instDir, "c.ysm"), Hash: "hash_c"},
	}

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
	if len(r.Missing) != 1 || r.Missing[0] != filepath.Join(globalDir, "b.ysm") {
		t.Errorf("expected Missing=[b.ysm], got %v", r.Missing)
	}
	if len(r.Extra) != 1 || r.Extra[0] != filepath.Join(instDir, "c.ysm") {
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

// TestCompareGlobalInstanceHashes_NoHashMatchesByNameSize 修复回归：MMD（.pmx/.pmd）
// 不计算 SHA256，旧哈希比对对无哈希条目全部跳过 → 侧栏 MMD 恒 0。
// 现按「文件名 + 大小」匹配，无哈希也能得到正确 synced/missing/extra。
func TestCompareGlobalInstanceHashes_NoHashMatchesByNameSize(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	global := []types.ModelEntry{
		{Name: "model_a.pmx", Path: filepath.Join(globalDir, "model_a.pmx"), Size: 1000, Hash: ""},
		{Name: "model_b.pmx", Path: filepath.Join(globalDir, "model_b.pmx"), Size: 2000, Hash: ""},
		{Name: "model_c.pmx", Path: filepath.Join(globalDir, "model_c.pmx"), Size: 3000, Hash: ""},
	}
	instEntries := []types.ModelEntry{
		{Name: "model_a.pmx", Path: filepath.Join(instDir, "model_a.pmx"), Size: 1000, Hash: ""},
		{Name: "model_b.pmx", Path: filepath.Join(instDir, "model_b.pmx"), Size: 2500, Hash: ""}, // 大小不同 → missing
		{Name: "extra.pmx", Path: filepath.Join(instDir, "extra.pmx"), Size: 500, Hash: ""},
	}
	scanFn := func(dir string) []types.ModelEntry {
		if dir == globalDir {
			return global
		}
		return instEntries
	}
	listFn := func(mcRoot string) []types.VersionInstance {
		return []types.VersionInstance{{Name: "ins", VersionDir: instDir}}
	}

	results := CompareGlobalInstanceHashes("mcRoot", globalDir, ".", "EntityPlayer", scanFn, listFn, nil)
	if len(results) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(results))
	}
	r := results[0]
	if r.Synced != 1 {
		t.Errorf("expected Synced=1 (model_a 同名同大小), got %d", r.Synced)
	}
	if len(r.Missing) != 2 || r.Missing[0] != filepath.Join(globalDir, "model_b.pmx") || r.Missing[1] != filepath.Join(globalDir, "model_c.pmx") {
		t.Errorf("expected Missing=[model_b.pmx(尺寸变), model_c.pmx], got %v", r.Missing)
	}
	if len(r.Extra) != 1 || r.Extra[0] != filepath.Join(instDir, "extra.pmx") {
		t.Errorf("expected Extra=[extra.pmx], got %v", r.Extra)
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

	result := SyncResources(globalDir, instDir, "")

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

	result := SyncResources(globalDir, instDir, "")

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

// TestSyncResources_FileLevelDepthGuard 文件级深度守卫（P3-4 补测）：
// rtype 为文件级（!IsDirLevelSync）时 SyncResources 仅收集顶层文件，
// 嵌套子目录内文件跳过；dir-level 类型（ysm）与空 rtype 保持全树递归。
// 背景：Sable Schematics 生成 .nbt 于嵌套子目录，顶层语义下相对路径以 ".." 开头
// 误判越界 → 拉取报「不在目标目录内」（sync.go:280-282 注释）。
// TestSyncResources_RelPathCompare ADR-064 阶段二：文件级对比升级为相对路径——
// 全树递归 + rel key 区分嵌套文件（原"只扫顶层"深度守卫取消），嵌套文件
// 参与同步（仅单侧时归 Missing/Extra），同名不同目录不再互相覆盖。
func TestSyncResources_RelPathCompare(t *testing.T) {
	setup := func(t *testing.T) (string, string) {
		globalDir := t.TempDir()
		instDir := t.TempDir()
		// 顶层文件（两侧同 size → Synced）
		os.WriteFile(filepath.Join(globalDir, "top.nbt"), []byte("top"), 0644)
		os.WriteFile(filepath.Join(instDir, "top.nbt"), []byte("top"), 0644)
		// 嵌套子目录文件（仅 global 侧 → 相对路径对比下归 Missing）
		os.MkdirAll(filepath.Join(globalDir, "sub"), 0755)
		os.WriteFile(filepath.Join(globalDir, "sub", "nested.nbt"), []byte("nested"), 0644)
		return globalDir, instDir
	}
	hasName := func(list []string, name string) bool {
		for _, p := range list {
			if filepath.Base(p) == name {
				return true
			}
		}
		return false
	}

	t.Run("file-level 嵌套文件按相对路径收集", func(t *testing.T) {
		globalDir, instDir := setup(t)
		result := SyncResources(globalDir, instDir, "resourcepack")
		if !hasName(result.Missing, "nested.nbt") {
			t.Errorf("相对路径对比应收集嵌套文件 nested.nbt 到 Missing: %v", result.Missing)
		}
		if !hasName(result.Synced, "top.nbt") {
			t.Errorf("顶层同 size 文件应 Synced: %v", result.Synced)
		}
	})

	t.Run("dir-level 全树递归", func(t *testing.T) {
		globalDir, instDir := setup(t)
		result := SyncResources(globalDir, instDir, "blueprint")
		if !hasName(result.Missing, "nested.nbt") {
			t.Errorf("dir-level 同步应收集嵌套文件 nested.nbt 到 Missing: %v", result.Missing)
		}
	})

	t.Run("空 rtype 保持全递归基线", func(t *testing.T) {
		globalDir, instDir := setup(t)
		result := SyncResources(globalDir, instDir, "")
		if !hasName(result.Missing, "nested.nbt") {
			t.Errorf("空 rtype 应保持全递归（nested.nbt 归 Missing）: %v", result.Missing)
		}
	})

	t.Run("同名不同目录不冲突", func(t *testing.T) {
		globalDir := t.TempDir()
		instDir := t.TempDir()
		// 两侧各有两个同名不同目录的 .nbt——rel 对比下各自匹配（Synced），
		// 文件名对比会把同名目录互相覆盖（map 去重）导致 Synced 缺失
		for _, side := range []struct{ root, dir string }{
			{globalDir, "a"}, {globalDir, "b"}, {instDir, "a"}, {instDir, "b"},
		} {
			os.MkdirAll(filepath.Join(side.root, side.dir), 0755)
			os.WriteFile(filepath.Join(side.root, side.dir, "x.nbt"), []byte("x"), 0644)
		}
		result := SyncResources(globalDir, instDir, "resourcepack")
		// 4 个文件全部 Synced（两侧 a/x.nbt 与 b/x.nbt 各自成对）
		if len(result.Synced) != 2 {
			t.Errorf("同名不同目录应各自 Synced（2 条），实际 %d: %v", len(result.Synced), result.Synced)
		}
		if len(result.Missing) != 0 || len(result.Extra) != 0 {
			t.Errorf("两侧对称时不应有 Missing/Extra: %v / %v", result.Missing, result.Extra)
		}
	})
}

// TestRelKey_EdgeCases ADR-064 审核补测：relKey 边界——嵌套 .ban 剥离、
// 越界路径返回空、跨平台分隔符归一。
func TestRelKey_EdgeCases(t *testing.T) {
	root := filepath.Join("C:", "repo")
	// 嵌套 .ban 只剥尾部
	if got := relKey(root, filepath.Join(root, "sub", "model.nbt.ban")); got != "sub/model.nbt" {
		t.Errorf("嵌套 .ban 应剥尾部得 sub/model.nbt, got %q", got)
	}
	// 目录名含 .ban 不剥（与旧 syncNameKey 对 basename 的语义一致）
	if got := relKey(root, filepath.Join(root, "a.ban", "x.nbt")); got != "a.ban/x.nbt" {
		t.Errorf("目录名含 .ban 不应剥, got %q", got)
	}
	// root 之外路径（filepath.Rel 返回 ..）→ 返回空
	if got := relKey(root, filepath.Join("D:", "other", "x.nbt")); got != "" {
		t.Errorf("root 之外路径应返回空, got %q", got)
	}
	// 顶层文件
	if got := relKey(root, filepath.Join(root, "top.nbt")); got != "top.nbt" {
		t.Errorf("顶层文件 rel 应为 top.nbt, got %q", got)
	}
}

// TestSyncResources_PackFolderOnlyForPackType P5 修复：pack.mcmeta 文件夹收集
// 仅对资源包类型（detector=mcmeta）生效——蓝图仓库（blueprint）里误放的
// 资源包文件夹不应被当成蓝图同步单元（否则 UI 显示"推送"但目录里没有 .nbt）。
func TestSyncResources_PackFolderOnlyForPackType(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()
	// 含 pack.mcmeta 的资源包文件夹
	pack := filepath.Join(globalDir, "my-pack")
	if err := os.MkdirAll(pack, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(pack, "pack.mcmeta"), []byte("{}"), 0644)
	hasPack := func(list []string) bool {
		for _, p := range list {
			if filepath.Base(p) == "my-pack" {
				return true
			}
		}
		return false
	}

	// blueprint：不收集资源包文件夹
	bp := SyncResources(globalDir, instDir, "blueprint")
	for _, list := range [][]string{bp.Synced, bp.Missing, bp.Extra} {
		if hasPack(list) {
			t.Errorf("blueprint 不应收集资源包文件夹 my-pack: %v", list)
		}
	}
	// ysm（dir-level）：同样不收集
	ysm := SyncResources(globalDir, instDir, "ysm")
	for _, list := range [][]string{ysm.Synced, ysm.Missing, ysm.Extra} {
		if hasPack(list) {
			t.Errorf("ysm 不应收集资源包文件夹 my-pack: %v", list)
		}
	}
	// resourcepack：应收集（Missing）
	rp := SyncResources(globalDir, instDir, "resourcepack")
	if !hasPack(rp.Missing) {
		t.Errorf("resourcepack 应收集资源包文件夹 my-pack 到 Missing: %v", rp)
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
	if _, err := os.Stat(filepath.Join(customDir, "model_a.ysm.disabled")); os.IsNotExist(err) {
		t.Error("model_a 应已被禁（.disabled）")
	}
	if _, err := os.Stat(filepath.Join(customDir, "model_b.ysm")); os.IsNotExist(err) {
		t.Error("model_b 应已被启用（去掉禁用后缀）")
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
	if !isFileLocked(syscall.Errno(33)) {
		t.Error("Errno(33) 应判定为锁定（Windows ERROR_LOCK_VIOLATION）")
	}
	if isFileLocked(fmt.Errorf("accessibility check failed")) {
		t.Error("含 access 子串的无关错误不应判定为锁定（errno 优先口径）")
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

// ===== DiffFolderContents =====

// TestHasRecycleSegment 逐段判定：.recycle 子树跳过，文件名含 .recycle 的正常模型不误伤
func TestHasRecycleSegment(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{`C:\mc\.minecraft\models\my.ysm`, false},
		{`C:\mc\.minecraft\models\.recycle\my.ysm`, true},
		{`C:\mc\.minecraft\.Recycle\sub\a.pmx`, true}, // 大小写不敏感 + 子树
		{`C:\mc\.minecraft\models\my.recycle.backup.ysm`, false},
		{`C:\mc\.minecraft\.recycle`, true},
	}
	for _, c := range cases {
		if got := hasRecycleSegment(c.path); got != c.want {
			t.Errorf("hasRecycleSegment(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}

// TestDiffFolderContents_Basic 测试基本的文件夹内容级 diff
func TestDiffFolderContents_Basic(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 创建全局文件夹：包含 3 个 .ysm 文件
	globalFolder := filepath.Join(globalDir, "test_pack")
	os.MkdirAll(globalFolder, 0755)
	os.WriteFile(filepath.Join(globalFolder, "model_a.ysm"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(globalFolder, "model_b.ysm"), []byte("b"), 0644)
	os.WriteFile(filepath.Join(globalFolder, "model_c.ysm"), []byte("c"), 0644)

	// 创建实例文件夹：包含 2 个 .ysm 文件（缺失 model_c，多出 model_d）
	instFolder := filepath.Join(instDir, "test_pack")
	os.MkdirAll(instFolder, 0755)
	os.WriteFile(filepath.Join(instFolder, "model_a.ysm"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(instFolder, "model_b.ysm"), []byte("b"), 0644)
	os.WriteFile(filepath.Join(instFolder, "model_d.ysm"), []byte("d"), 0644)

	diffs := DiffFolderContents(globalFolder, instFolder, "ysm")

	// 应返回 4 个条目：2 synced (a, b), 1 missing (c), 1 optional (d)
	if len(diffs) != 4 {
		t.Fatalf("预期 4 个差异条目，实际 %d: %v", len(diffs), diffs)
	}

	// 检查各条目的状态
	for _, d := range diffs {
		switch d.RelPath {
		case "model_a.ysm", "model_b.ysm":
			if d.Status != types.SyncStatusSynced {
				t.Errorf("%s 应为 synced，实际 %s", d.RelPath, d.Status)
			}
		case "model_c.ysm":
			if d.Status != types.SyncStatusMissing {
				t.Errorf("%s 应为 missing，实际 %s", d.RelPath, d.Status)
			}
		case "model_d.ysm":
			if d.Status != types.SyncStatusOptional {
				t.Errorf("%s 应为 optional，实际 %s", d.RelPath, d.Status)
			}
		default:
			t.Errorf("意外的条目: %s", d.RelPath)
		}
	}

	t.Logf("Diff results:")
	for _, d := range diffs {
		t.Logf("  %s: %s (size=%d)", d.RelPath, d.Status, d.Size)
	}
}

// TestDiffFolderContents_EmptyFolders 测试空文件夹的 diff
func TestDiffFolderContents_EmptyFolders(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 两个空文件夹
	globalFolder := filepath.Join(globalDir, "empty_pack")
	instFolder := filepath.Join(instDir, "empty_pack")
	os.MkdirAll(globalFolder, 0755)
	os.MkdirAll(instFolder, 0755)

	diffs := DiffFolderContents(globalFolder, instFolder, "ysm")
	if len(diffs) != 0 {
		t.Errorf("空文件夹应返回 0 条差异，实际 %d: %v", len(diffs), diffs)
	}
}

// TestDiffFolderContents_NoModelFiles 测试不含模型文件的文件夹
func TestDiffFolderContents_NoModelFiles(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	globalFolder := filepath.Join(globalDir, "non_model")
	instFolder := filepath.Join(instDir, "non_model")
	os.MkdirAll(globalFolder, 0755)
	os.MkdirAll(instFolder, 0755)

	// 写入非模型文件（.txt）
	os.WriteFile(filepath.Join(globalFolder, "readme.txt"), []byte("hello"), 0644)
	os.WriteFile(filepath.Join(instFolder, "readme.txt"), []byte("hello"), 0644)

	diffs := DiffFolderContents(globalFolder, instFolder, "ysm")
	if len(diffs) != 0 {
		t.Errorf("不含模型文件的文件夹应返回 0 条差异，实际 %d: %v", len(diffs), diffs)
	}
}

// TestDiffFolderContents_NestedFiles 测试嵌套文件的 diff
func TestDiffFolderContents_NestedFiles(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 创建嵌套结构：subdir/model.ysm
	globalFolder := filepath.Join(globalDir, "nested_pack")
	os.MkdirAll(filepath.Join(globalFolder, "subdir"), 0755)
	os.WriteFile(filepath.Join(globalFolder, "subdir", "nested_model.ysm"), []byte("nested"), 0644)

	// 实例侧没有这个嵌套文件
	instFolder := filepath.Join(instDir, "nested_pack")
	os.MkdirAll(instFolder, 0755)

	diffs := DiffFolderContents(globalFolder, instFolder, "ysm")

	if len(diffs) != 1 {
		t.Fatalf("预期 1 个差异条目，实际 %d: %v", len(diffs), diffs)
	}

	expectedRel := "subdir/nested_model.ysm"
	if diffs[0].RelPath != expectedRel {
		t.Errorf("预期相对路径 %s，实际 %s", expectedRel, diffs[0].RelPath)
	}
	if diffs[0].Status != types.SyncStatusMissing {
		t.Errorf("应为 missing，实际 %s", diffs[0].Status)
	}
}

// TestDiffFolderContents_EmptyPath 测试空路径的边界情况
func TestDiffFolderContents_EmptyPath(t *testing.T) {
	diffs := DiffFolderContents("", "", "ysm")
	if len(diffs) != 0 {
		t.Errorf("空路径应返回 0 条差异，实际 %d: %v", len(diffs), diffs)
	}
}

// TestDiffFolderContents_RecycleDir 测试回收站目录被跳过
func TestDiffFolderContents_RecycleDir(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	globalFolder := filepath.Join(globalDir, "pack_with_recycle")
	os.MkdirAll(globalFolder, 0755)
	// 活跃模型
	os.WriteFile(filepath.Join(globalFolder, "active.ysm"), []byte("active"), 0644)
	// 回收站内的模型（应被跳过）
	recycleDir := filepath.Join(globalFolder, ".recycle")
	os.MkdirAll(recycleDir, 0755)
	os.WriteFile(filepath.Join(recycleDir, "trashed.ysm"), []byte("trashed"), 0644)

	instFolder := filepath.Join(instDir, "pack_with_recycle")
	os.MkdirAll(instFolder, 0755)

	diffs := DiffFolderContents(globalFolder, instFolder, "ysm")

	// 应只包含 active.ysm，不包含 .recycle/trashed.ysm
	if len(diffs) != 1 {
		t.Fatalf("应只有 1 条活跃模型差异，实际 %d: %v", len(diffs), diffs)
	}
	if diffs[0].RelPath != "active.ysm" {
		t.Errorf("应只有 active.ysm，实际 %s", diffs[0].RelPath)
	}
}
