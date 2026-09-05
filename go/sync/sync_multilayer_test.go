// ===== 多层物理路径同步测试（2026-09 重构验证）=====
// 测试 SyncResourcesDirLevel / PushResources / PullResources 在多层目录结构下的行为：
//   - 仓库位于 maid-model/vendor/character/pack.zip 等深层嵌套时，key 为相对路径而非 basename
//   - 推送/拉取保留完整目录层级，不扁平化
//   - 同名但不同子目录的条目不冲突
package sync

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// ===== relKeyDirLevel 单元测试 =====

func TestRelKeyDirLevel_Basic(t *testing.T) {
	tests := []struct {
		name     string
		root     string
		path     string
		isDir    bool
		expected string
	}{
		{"root-level file", "/repo", "/repo/pack.zip", false, "pack"},
		{"nested file", "/repo", "/repo/vendor/pack.zip", false, "vendor/pack"},
		{"deeply nested file", "/repo", "/repo/a/b/c/pack.zip", false, "a/b/c/pack"},
		// code review P3：目录键带尾随 "/"（与兄弟同名平铺文件区分——防 map 覆盖）
		{"dir-level folder", "/repo", "/repo/EntityPlayer/ModelA", true, "entityplayer/modela/"},
		{"nested dir-level folder", "/repo", "/repo/category/sub/ModelA", true, "category/sub/modela/"},
		{"disable suffix stripped", "/repo", "/repo/pack.zip.disabled", false, "pack"},
		{"ban suffix stripped", "/repo", "/repo/pack.zip.ban", false, "pack"},
		{"json extension", "/repo", "/repo/model.ysm.json", false, "model.ysm"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := relKeyDirLevel(tt.root, tt.path, tt.isDir)
			if got != tt.expected {
				t.Errorf("relKeyDirLevel(%q, %q, %v) = %q, want %q", tt.root, tt.path, tt.isDir, got, tt.expected)
			}
		})
	}
}

func TestRelKeyDirLevel_EdgeCases(t *testing.T) {
	// 路径不在 root 下 → 返回带 ".." 的路径（filepath.Rel 行为）
	got := relKeyDirLevel("/repo", "/other/file.zip", false)
	if got == "" || !strings.HasPrefix(got, "..") {
		t.Errorf("越界路径应返回以 .. 开头的路径，got %q", got)
	}
	// 根路径自身 → 返回空（无扩展名可剥离，且 filepath.Rel 返回 "."）
	if got := relKeyDirLevel("/repo", "/repo", false); got != "" {
		t.Errorf("根路径自身应返回空，got %q", got)
	}
}

// ===== SyncResourcesDirLevel 多层路径测试 =====

func TestSyncResourcesDirLevel_MultiLayerFlatFiles(t *testing.T) {
	// 场景：仓库有深度嵌套的平铺模型文件（.ysm），实例有对应深度的副本
	// 使用 ysm 类型（detector=ysm 不检查 zip 内容，.ysm 直接放行）
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 全局：多层嵌套 .ysm 文件
	os.MkdirAll(filepath.Join(globalDir, "vendor1", "characterA"), 0755)
	os.MkdirAll(filepath.Join(globalDir, "vendor2", "characterB"), 0755)
	os.WriteFile(filepath.Join(globalDir, "vendor1", "characterA", "model_a.ysm"), []byte("packA"), 0644)
	os.WriteFile(filepath.Join(globalDir, "vendor2", "characterB", "model_b.ysm"), []byte("packB"), 0644)

	// 实例：相同路径结构的副本
	os.MkdirAll(filepath.Join(instDir, "vendor1", "characterA"), 0755)
	os.MkdirAll(filepath.Join(instDir, "vendor2", "characterB"), 0755)
	os.WriteFile(filepath.Join(instDir, "vendor1", "characterA", "model_a.ysm"), []byte("packA"), 0644)
	os.WriteFile(filepath.Join(instDir, "vendor2", "characterB", "model_b.ysm"), []byte("packB"), 0644)

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	// 全部 Synced（两边都有）
	if len(result.Missing) != 0 {
		t.Errorf("应无 Missing 条目，got %v", result.Missing)
	}
	if len(result.Extra) != 0 {
		t.Errorf("应无 Extra 条目，got %v", result.Extra)
	}
	if len(result.Synced) != 2 {
		t.Fatalf("应有 2 个 Synced 条目，got %d: %v", len(result.Synced), result.Synced)
	}

	// 验证 Synced 路径包含完整层级
	hasVendor1 := false
	hasVendor2 := false
	for _, p := range result.Synced {
		if strings.Contains(p, "vendor1") && strings.Contains(p, "characterA") {
			hasVendor1 = true
		}
		if strings.Contains(p, "vendor2") && strings.Contains(p, "characterB") {
			hasVendor2 = true
		}
	}
	if !hasVendor1 {
		t.Error("Synced 应包含 vendor1/characterA 路径")
	}
	if !hasVendor2 {
		t.Error("Synced 应包含 vendor2/characterB 路径")
	}
}

func TestSyncResourcesDirLevel_MultiLayerNoCollision(t *testing.T) {
	// 场景：同名文件在不同子目录中，不应冲突（旧实现按 basename 会冲突）
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 全局：两个 vendor 下各有同名 model.ysm
	os.MkdirAll(filepath.Join(globalDir, "vendorA"), 0755)
	os.MkdirAll(filepath.Join(globalDir, "vendorB"), 0755)
	os.WriteFile(filepath.Join(globalDir, "vendorA", "model.ysm"), []byte("A"), 0644)
	os.WriteFile(filepath.Join(globalDir, "vendorB", "model.ysm"), []byte("B"), 0644)

	// 实例：只有 vendorA 有，vendorB 缺失
	os.MkdirAll(filepath.Join(instDir, "vendorA"), 0755)
	os.WriteFile(filepath.Join(instDir, "vendorA", "model.ysm"), []byte("A"), 0644)

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	// vendorB/model 应归入 Missing（实例没有）
	// vendorA/model 应归入 Synced（两边都有）
	if len(result.Missing) != 1 {
		t.Fatalf("应有 1 个 Missing（vendorB/model），got %d: %v", len(result.Missing), result.Missing)
	}
	if len(result.Synced) != 1 {
		t.Fatalf("应有 1 个 Synced（vendorA/model），got %d: %v", len(result.Synced), result.Synced)
	}

	// 验证 Missing 是 vendorB 的
	missingPath := result.Missing[0]
	if !strings.Contains(missingPath, "vendorB") {
		t.Errorf("Missing 应为 vendorB 的路径，got %s", missingPath)
	}
}

func TestSyncResourcesDirLevel_MultiLayerModelFolders(t *testing.T) {
	// 场景：YSM 模型文件夹在深层嵌套（如 category/subcategory/modelA/ysm.json）
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 全局：深度嵌套的 YSM 模型文件夹
	os.MkdirAll(filepath.Join(globalDir, "rpg", "weapons", "sword"), 0755)
	os.MkdirAll(filepath.Join(globalDir, "rpg", "armor", "helmet"), 0755)
	os.WriteFile(filepath.Join(globalDir, "rpg", "weapons", "sword", "ysm.json"), []byte("{}"), 0644)
	os.WriteFile(filepath.Join(globalDir, "rpg", "armor", "helmet", "ysm.json"), []byte("{}"), 0644)

	// 实例：只有 sword 有，helmet 缺失
	os.MkdirAll(filepath.Join(instDir, "rpg", "weapons", "sword"), 0755)
	os.WriteFile(filepath.Join(instDir, "rpg", "weapons", "sword", "ysm.json"), []byte("{}"), 0644)

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	// helmet 缺失，sword 同步
	if len(result.Missing) != 1 {
		t.Fatalf("应有 1 个 Missing（helmet），got %d: %v", len(result.Missing), result.Missing)
	}
	if len(result.Synced) != 1 {
		t.Fatalf("应有 1 个 Synced（sword），got %d: %v", len(result.Synced), result.Synced)
	}

	// 验证路径包含完整层级
	missingPath := result.Missing[0]
	if !strings.Contains(missingPath, "rpg") || !strings.Contains(missingPath, "armor") || !strings.Contains(missingPath, "helmet") {
		t.Errorf("Missing 路径应为完整层级 rpg/armor/helmet，got %s", missingPath)
	}
}

func TestSyncResourcesDirLevel_MixedDepth(t *testing.T) {
	// 场景：部分条目在根层，部分在嵌套层，混合共存
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 全局：根层 + 嵌套层混合
	os.WriteFile(filepath.Join(globalDir, "root_model.ysm"), []byte("root"), 0644)
	os.MkdirAll(filepath.Join(globalDir, "subdir"), 0755)
	os.WriteFile(filepath.Join(globalDir, "subdir", "nested_model.ysm"), []byte("nested"), 0644)

	// 实例：只有根层有
	os.WriteFile(filepath.Join(instDir, "root_model.ysm"), []byte("root"), 0644)

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	// root_model → Synced, subdir/nested_model → Missing
	if len(result.Synced) != 1 {
		t.Errorf("应有 1 个 Synced（root_model），got %d: %v", len(result.Synced), result.Synced)
	}
	if len(result.Missing) != 1 {
		t.Fatalf("应有 1 个 Missing（subdir/nested_model），got %d: %v", len(result.Missing), result.Missing)
	}
	missingPath := result.Missing[0]
	if !strings.Contains(missingPath, "subdir") {
		t.Errorf("Missing 应包含 subdir 层级，got %s", missingPath)
	}
}

func TestSyncResourcesDirLevel_ExtraAtNestedDepth(t *testing.T) {
	// 场景：实例有嵌套层级的 Extra 文件
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 实例：有嵌套的 extra 文件
	os.MkdirAll(filepath.Join(instDir, "extra_vendor", "extra_char"), 0755)
	os.WriteFile(filepath.Join(instDir, "extra_vendor", "extra_char", "model.ysm"), []byte("extra"), 0644)
	os.WriteFile(filepath.Join(instDir, "root_extra.ysm"), []byte("root_extra"), 0644)

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	if len(result.Extra) != 2 {
		t.Fatalf("应有 2 个 Extra，got %d: %v", len(result.Extra), result.Extra)
	}

	// 验证 Extra 路径包含完整层级
	hasNested := false
	hasRoot := false
	for _, p := range result.Extra {
		if strings.Contains(p, "extra_vendor") && strings.Contains(p, "extra_char") {
			hasNested = true
		}
		if strings.Contains(p, "root_extra") {
			hasRoot = true
		}
	}
	if !hasNested {
		t.Error("Extra 应包含嵌套路径 extra_vendor/extra_char")
	}
	if !hasRoot {
		t.Error("Extra 应包含根层路径 root_extra")
	}
}

// ===== PushResources 多层路径测试 =====

func TestPushResources_MultiLayerZipPreservesHierarchy(t *testing.T) {
	// 场景：推送 maid-model/vendor/character/pack.zip → 应落位到 targetDir/vendor/character/pack.zip
	// maid-model 是目录级类型，需要 assets/<ns>/maid_model.json 标识
	base := t.TempDir()
	globalDir := filepath.Join(base, "maid-model")
	targetDir := filepath.Join(base, "inst", ".minecraft", "tlm_custom_pack")
	_ = os.MkdirAll(targetDir, 0755)

	// 仓库：多层嵌套的 maid-model 包目录，每个包内包含 assets/<ns>/maid_model.json
	os.MkdirAll(filepath.Join(globalDir, "thpatch", "cirno", "assets", "mypack"), 0755)
	os.MkdirAll(filepath.Join(globalDir, "thpatch", "reimu", "assets", "mypack"), 0755)
	os.WriteFile(filepath.Join(globalDir, "thpatch", "cirno", "assets", "mypack", "maid_model.json"), []byte("{}"), 0644)
	os.WriteFile(filepath.Join(globalDir, "thpatch", "reimu", "assets", "mypack", "maid_model.json"), []byte("{}"), 0644)

	var logs []string
	count, err := PushResources("maid-model", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) {
			logs = append(logs, name+":"+status)
		})
	if err != nil {
		t.Fatalf("PushResources 失败: %v", err)
	}
	if count != 2 {
		t.Fatalf("应推送 2 个条目，实际 %d", count)
	}

	// 验证目标目录保留了完整层级
	cirnoPath := filepath.Join(targetDir, "thpatch", "cirno", "assets", "mypack", "maid_model.json")
	reimuPath := filepath.Join(targetDir, "thpatch", "reimu", "assets", "mypack", "maid_model.json")
	if _, err := os.Stat(cirnoPath); err != nil {
		t.Errorf("cirno 未按层级落位到 %s: %v", cirnoPath, err)
	}
	if _, err := os.Stat(reimuPath); err != nil {
		t.Errorf("reimu 未按层级落位到 %s: %v", reimuPath, err)
	}
}

func TestPushResources_MultiLayerYsmFilePreservesHierarchy(t *testing.T) {
	// 场景：推送 ysm 平铺文件 vendor/char/model.ysm → 应落位到 targetDir/vendor/char/model.ysm
	// ysm 类型接受 .ysm 文件无需内容检查，适合验证层级保留
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	targetDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	_ = os.MkdirAll(targetDir, 0755)

	os.MkdirAll(filepath.Join(globalDir, "vendor", "char1"), 0755)
	os.MkdirAll(filepath.Join(globalDir, "vendor", "char2"), 0755)
	os.WriteFile(filepath.Join(globalDir, "vendor", "char1", "model.ysm"), []byte("1"), 0644)
	os.WriteFile(filepath.Join(globalDir, "vendor", "char2", "model.ysm"), []byte("2"), 0644)

	count, err := PushResources("ysm", globalDir, targetDir, "copy", nil)
	if err != nil {
		t.Fatalf("PushResources 失败: %v", err)
	}
	if count != 2 {
		t.Fatalf("应推送 2 个条目，实际 %d", count)
	}

	// 验证目标目录保留了完整层级
	char1Path := filepath.Join(targetDir, "vendor", "char1", "model.ysm")
	char2Path := filepath.Join(targetDir, "vendor", "char2", "model.ysm")
	if _, err := os.Stat(char1Path); err != nil {
		t.Errorf("char1 未按层级落位到 %s: %v", char1Path, err)
	}
	if _, err := os.Stat(char2Path); err != nil {
		t.Errorf("char2 未按层级落位到 %s: %v", char2Path, err)
	}
}

func TestPushResources_MultiLayerModelFolderPreservesHierarchy(t *testing.T) {
	// 场景：推送 YSM 模型文件夹 rpg/weapons/sword/ → 应落位到 targetDir/rpg/weapons/sword/
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	targetDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	_ = os.MkdirAll(targetDir, 0755)

	os.MkdirAll(filepath.Join(globalDir, "rpg", "weapons", "sword"), 0755)
	os.WriteFile(filepath.Join(globalDir, "rpg", "weapons", "sword", "ysm.json"), []byte("{}"), 0644)
	os.WriteFile(filepath.Join(globalDir, "rpg", "weapons", "sword", "tex.png"), []byte("png"), 0644)

	count, err := PushResources("ysm", globalDir, targetDir, "copy", nil)
	if err != nil {
		t.Fatalf("PushResources 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应推送 1 个文件夹，实际 %d", count)
	}

	// 验证目标目录保留了完整层级
	swordPath := filepath.Join(targetDir, "rpg", "weapons", "sword", "ysm.json")
	if _, err := os.Stat(swordPath); err != nil {
		t.Errorf("sword 未按层级落位到 %s: %v", swordPath, err)
	}
}

func TestPushResources_PartialPush(t *testing.T) {
	// 场景：仓库有多层条目，但部分已存在，只推送 missing 的
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	targetDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	_ = os.MkdirAll(targetDir, 0755)

	// 仓库：3 个嵌套的 .ysm 文件
	os.MkdirAll(filepath.Join(globalDir, "vendorA", "char1"), 0755)
	os.MkdirAll(filepath.Join(globalDir, "vendorA", "char2"), 0755)
	os.MkdirAll(filepath.Join(globalDir, "vendorB", "char3"), 0755)
	os.WriteFile(filepath.Join(globalDir, "vendorA", "char1", "model.ysm"), []byte("1"), 0644)
	os.WriteFile(filepath.Join(globalDir, "vendorA", "char2", "model.ysm"), []byte("2"), 0644)
	os.WriteFile(filepath.Join(globalDir, "vendorB", "char3", "model.ysm"), []byte("3"), 0644)

	// 实例：vendorA/char1 已存在（同内容）
	os.MkdirAll(filepath.Join(targetDir, "vendorA", "char1"), 0755)
	os.WriteFile(filepath.Join(targetDir, "vendorA", "char1", "model.ysm"), []byte("1"), 0644)

	count, err := PushResources("ysm", globalDir, targetDir, "copy", nil)
	if err != nil {
		t.Fatalf("PushResources 失败: %v", err)
	}
	if count != 2 {
		t.Fatalf("应推送 2 个 missing 条目，实际 %d", count)
	}

	// vendorA/char2 和 vendorB/char3 应被推送
	if _, err := os.Stat(filepath.Join(targetDir, "vendorA", "char2", "model.ysm")); err != nil {
		t.Errorf("vendorA/char2 未推送: %v", err)
	}
	if _, err := os.Stat(filepath.Join(targetDir, "vendorB", "char3", "model.ysm")); err != nil {
		t.Errorf("vendorB/char3 未推送: %v", err)
	}
}

// ===== PullResources 多层路径测试 =====

func TestPullResources_MultiLayerPreservesHierarchy(t *testing.T) {
	// 场景：拉取实例侧嵌套目录的 extra → 应落位到 globalDir 的对应子目录
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)

	// 实例：嵌套 extra 文件
	os.MkdirAll(filepath.Join(targetDir, "community", "author1"), 0755)
	os.WriteFile(filepath.Join(targetDir, "community", "author1", "model.ysm"), []byte("extra"), 0644)

	count, err := PullResources("ysm", globalDir, targetDir, nil)
	if err != nil {
		t.Fatalf("PullResources 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应拉取 1 个条目，实际 %d", count)
	}

	// 验证拉取到 globalDir 的完整层级
	pulledPath := filepath.Join(globalDir, "community", "author1", "model.ysm")
	if _, err := os.Stat(pulledPath); err != nil {
		t.Errorf("extra 未按层级拉取到 %s: %v", pulledPath, err)
	}
}

func TestPullResources_MultiLayerMixed(t *testing.T) {
	// 场景：实例侧既有根层 extra 也有嵌套 extra
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)

	os.WriteFile(filepath.Join(targetDir, "root_extra.ysm"), []byte("root"), 0644)
	os.MkdirAll(filepath.Join(targetDir, "nested", "deep"), 0755)
	os.WriteFile(filepath.Join(targetDir, "nested", "deep", "deep_extra.ysm"), []byte("deep"), 0644)

	count, err := PullResources("ysm", globalDir, targetDir, nil)
	if err != nil {
		t.Fatalf("PullResources 失败: %v", err)
	}
	if count != 2 {
		t.Fatalf("应拉取 2 个条目，实际 %d", count)
	}

	// 验证根层和嵌套层都正确拉取
	if _, err := os.Stat(filepath.Join(globalDir, "root_extra.ysm")); err != nil {
		t.Errorf("root_extra 未拉取: %v", err)
	}
	if _, err := os.Stat(filepath.Join(globalDir, "nested", "deep", "deep_extra.ysm")); err != nil {
		t.Errorf("deep_extra 未按层级拉取: %v", err)
	}
}

// ===== GetInstanceStatus 多层路径测试（relKey 回退）=====

func TestGetInstanceStatus_MultiLayerRelKey(t *testing.T) {
	// 场景：非哈希类型（如 relKey 回退）的多层路径同步状态
	// 使用空 rtype 让 GetInstanceStatus 走旧路径，用 relKey 对比
	repoDir := t.TempDir()
	instDir := t.TempDir()

	// 仓库：多层嵌套
	os.MkdirAll(filepath.Join(repoDir, "subdir", "modelA"), 0755)
	os.WriteFile(filepath.Join(repoDir, "subdir", "modelA", "pack.zip"), []byte("A"), 0644)
	os.WriteFile(filepath.Join(repoDir, "root.zip"), []byte("R"), 0644)

	// 实例：subdir/modelA 同步，root.zip 缺失
	os.MkdirAll(filepath.Join(instDir, "subdir", "modelA"), 0755)
	os.WriteFile(filepath.Join(instDir, "subdir", "modelA", "pack.zip"), []byte("A"), 0644)

	// 自定义 scanFn 模拟无哈希场景（返回空哈希）
	scanFn := func(dir string) []types.ModelEntry {
		var entries []types.ModelEntry
		filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			rel, _ := filepath.Rel(dir, p)
			entries = append(entries, types.ModelEntry{
				Name: info.Name(),
				Path: p,
				Size: info.Size(),
				Hash: "", // 空哈希 → 走 relKey 回退
			})
			_ = rel
			return nil
		})
		sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
		return entries
	}
	listFn := func(mcRoot string) []types.VersionInstance {
		return []types.VersionInstance{
			{Name: "test", CustomDir: instDir, VersionDir: instDir},
		}
	}

	results := GetInstanceStatusWith("mcRoot", repoDir, "", scanFn, listFn)
	if len(results) != 1 {
		t.Fatalf("应有 1 个实例，got %d", len(results))
	}
	ins := results[0]

	// root.zip 应归入 Missing（仓库有但实例没有）
	if len(ins.Missing) != 1 {
		t.Fatalf("应有 1 个 Missing（root.zip），got %d: %v", len(ins.Missing), ins.Missing)
	}
	missingPath := ins.Missing[0]
	if !strings.HasSuffix(missingPath, "root.zip") {
		t.Errorf("Missing 应为 root.zip，got %s", missingPath)
	}
}

// ===== 端到端：Push + Pull 循环 =====

func TestPushPull_MultiLayerRoundTrip(t *testing.T) {
	// 场景：仓库多层路径（.ysm 平铺文件）→ 推送到实例 → 删除仓库 → 从实例拉回 → 验证层级不变
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	targetDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	_ = os.MkdirAll(targetDir, 0755)

	// 仓库：多层嵌套 .ysm 文件
	os.MkdirAll(filepath.Join(globalDir, "vendor", "character"), 0755)
	os.WriteFile(filepath.Join(globalDir, "vendor", "character", "model.ysm"), []byte("content"), 0644)

	// Push
	count, err := PushResources("ysm", globalDir, targetDir, "copy", nil)
	if err != nil {
		t.Fatalf("Push 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("Push 应推送 1 个，实际 %d", count)
	}

	// 验证推送后层级正确
	if _, err := os.Stat(filepath.Join(targetDir, "vendor", "character", "model.ysm")); err != nil {
		t.Fatalf("Push 后文件未落位到正确层级: %v", err)
	}

	// 从仓库删除该文件（模拟拉取场景）
	os.RemoveAll(filepath.Join(globalDir, "vendor"))

	// Pull 回来
	count, err = PullResources("ysm", globalDir, targetDir, nil)
	if err != nil {
		t.Fatalf("Pull 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("Pull 应拉取 1 个，实际 %d", count)
	}

	// 验证拉取后层级不变
	if _, err := os.Stat(filepath.Join(globalDir, "vendor", "character", "model.ysm")); err != nil {
		t.Errorf("Pull 后文件未按层级恢复: %v", err)
	}
}

// ===== 与现有行为的兼容性测试 =====

func TestSyncResourcesDirLevel_RootLevelItemsStillWork(t *testing.T) {
	// 场景：根层条目（无嵌套）仍正常工作，与旧行为一致
	globalDir := t.TempDir()
	instDir := t.TempDir()

	os.MkdirAll(filepath.Join(globalDir, "ModelA"), 0755)
	os.WriteFile(filepath.Join(globalDir, "ModelA", "ysm.json"), []byte("{}"), 0644)
	os.WriteFile(filepath.Join(globalDir, "FlatB.ysm"), []byte("B"), 0644)

	os.MkdirAll(filepath.Join(instDir, "ModelA"), 0755)
	os.WriteFile(filepath.Join(instDir, "ModelA", "ysm.json"), []byte("{}"), 0644)

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	// FlatB.ysm → Missing
	if len(result.Missing) != 1 {
		t.Fatalf("应有 1 个 Missing（FlatB），got %d: %v", len(result.Missing), result.Missing)
	}
	if !strings.HasSuffix(result.Missing[0], "FlatB.ysm") {
		t.Errorf("Missing 应为 FlatB.ysm，got %s", result.Missing[0])
	}
	// ModelA → Synced
	if len(result.Synced) != 1 {
		t.Fatalf("应有 1 个 Synced（ModelA），got %d: %v", len(result.Synced), result.Synced)
	}
}

func TestSyncResourcesDirLevel_EmptyDirSkipped(t *testing.T) {
	// 空目录不应产生任何条目
	globalDir := t.TempDir()
	instDir := t.TempDir()

	os.MkdirAll(filepath.Join(globalDir, "empty"), 0755)
	os.MkdirAll(filepath.Join(instDir, "empty"), 0755)

	result := SyncResourcesDirLevel(globalDir, instDir, "maid-model")
	if len(result.Synced)+len(result.Missing)+len(result.Extra) != 0 {
		t.Errorf("空目录不应有同步条目，got Synced=%d Missing=%d Extra=%d",
			len(result.Synced), len(result.Missing), len(result.Extra))
	}
}

// ===== InstallDirRel 驱动的目录级推送到位测试 =====

// TestSyncResourcesDirLevel_RelPathKeys_NoCollision: 不同子目录下的同名目录不应碰撞丢失
// 场景：cat1/pack 与 cat2/pack 都是独立模型 → 都应出现在 Missing 中
func TestSyncResourcesDirLevel_RelPathKeys_NoCollision(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	// 创建两个同名但不同子目录的模型文件夹
	for _, cat := range []string{"cat1", "cat2"} {
		packDir := filepath.Join(globalDir, cat, "pack")
		os.MkdirAll(packDir, 0755)
		os.WriteFile(filepath.Join(packDir, "model.ysm"), []byte("{}"), 0644)
	}

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	if len(result.Missing) != 2 {
		t.Fatalf("应有 2 个 Missing（cat1/pack + cat2/pack），got %d: %v", len(result.Missing), result.Missing)
	}
	if len(result.Synced) != 0 {
		t.Errorf("应有 0 个 Synced，got %d", len(result.Synced))
	}
}

// TestSyncResourcesDirLevel_NestedMirror_Synced: 两边镜像时 Synced 应保留相对路径
func TestSyncResourcesDirLevel_NestedMirror_Synced(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()

	for _, dir := range []string{"东方", "西方"} {
		modelDir := filepath.Join(globalDir, dir, "角色A")
		os.MkdirAll(modelDir, 0755)
		os.WriteFile(filepath.Join(modelDir, "char.pmx"), []byte("pmx"), 0644)

		instModelDir := filepath.Join(instDir, dir, "角色A")
		os.MkdirAll(instModelDir, 0755)
		os.WriteFile(filepath.Join(instModelDir, "char.pmx"), []byte("pmx"), 0644)
	}

	result := SyncResourcesDirLevel(globalDir, instDir, "EntityPlayer")

	if len(result.Synced) != 2 {
		t.Fatalf("应有 2 个 Synced，got %d: %v", len(result.Synced), result.Synced)
	}
	if len(result.Missing) != 0 {
		t.Errorf("应有 0 个 Missing，got %d", len(result.Missing))
	}
	// Synced 条目应包含相对路径层级
	for _, s := range result.Synced {
		rel, _ := filepath.Rel(globalDir, s)
		if !strings.Contains(rel, string(filepath.Separator)) {
			t.Errorf("Synced 应包含多级路径，got rel=%s", rel)
		}
	}
}

// TestPushResources_DirLevel_PreservesHierarchy: 目录级推送应保留多层物理路径
// 场景：globalDir/东方/角色A/{char.pmx, tex/toon.png} → targetDir/东方/角色A/char.pmx
// 验证 InstallDirRel 正确驱动层级保留
func TestPushResources_DirLevel_PreservesHierarchy(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "3d-skin", "EntityPlayer")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)

	// 创建嵌套模型目录
	modelDir := filepath.Join(globalDir, "东方", "角色A")
	os.MkdirAll(filepath.Join(modelDir, "tex"), 0755)
	os.WriteFile(filepath.Join(modelDir, "char.pmx"), []byte("pmx-model"), 0644)
	os.WriteFile(filepath.Join(modelDir, "tex", "toon.png"), []byte("png-tex"), 0644)

	count, err := PushResources("EntityPlayer", globalDir, targetDir, "copy", nil)
	if err != nil {
		t.Fatalf("PushResources 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应推送 1 个文件夹，实际 %d", count)
	}

	// 验证层级保留：targetDir/东方/角色A/char.pmx 存在（非 targetDir/char.pmx 扁平）
	expectedPmx := filepath.Join(targetDir, "东方", "角色A", "char.pmx")
	data, err := os.ReadFile(expectedPmx)
	if err != nil {
		t.Fatalf("多层路径推送失败：%v", err)
	}
	if string(data) != "pmx-model" {
		t.Errorf("内容不正确: %s", data)
	}

	// 验证嵌套子目录也被保留
	expectedPng := filepath.Join(targetDir, "东方", "角色A", "tex", "toon.png")
	if _, err := os.Stat(expectedPng); os.IsNotExist(err) {
		t.Fatalf("嵌套子目录 tex/toon.png 未保留在多层路径下")
	}

	// 二次推送应为 0（幂等验证——relKey 匹配已存在）
	count2, err2 := PushResources("EntityPlayer", globalDir, targetDir, "copy", nil)
	if err2 != nil {
		t.Fatalf("二次推送失败: %v", err2)
	}
	if count2 != 0 {
		t.Fatalf("二次推送应为 0（已同步），实际 %d", count2)
	}
}

// TestPushResources_FolderLevelMMD_Compatibility: 验证原有 FolderLevelMMD 行为不受影响
// （rel 为空 → InstallDirRel 回退到 InstallDir basename 语义）
func TestPushResources_FolderLevelMMD_Compatibility(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)

	os.MkdirAll(filepath.Join(globalDir, "mmdmodel"), 0755)
	os.WriteFile(filepath.Join(globalDir, "mmdmodel", "char.pmx"), []byte("pmx"), 0644)

	count, err := PushResources("EntityPlayer", globalDir, targetDir, "copy", nil)
	if err != nil {
		t.Fatalf("Push MMD 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应推送 1 个 MMD 文件夹，实际 %d", count)
	}

	// 根层级：rel="mmdmodel" → InstallDirRel(targetDir, "mmdmodel") = targetDir/mmdmodel
	// 等价于旧 InstallDir 行为
	dst := filepath.Join(targetDir, "mmdmodel", "char.pmx")
	if _, err := os.Stat(dst); os.IsNotExist(err) {
		t.Fatalf("根层级模型文件夹应按原语义落位: %v", err)
	}
}

// TestSyncResourcesDirLevel_FlatFileNotAbove_SubfolderKept 验证「容器目录混入直接平铺模型文件」
// 的层级不被吞掉。场景（用户真实数据）：
//
//	嵌套1/
//	├── [kyln默寒寒冰]【机械动力】动力臂.ysm   ← 直接平铺 .ysm，令 isDirTypeModelFolder(嵌套1)=true
//	├── 01_taisho_maid/ysm.json              ← 子模型夹
//	└── 嵌套2/02_new_year/ysm.json           ← 更深子模型夹
//
// 若 isDirTypeModelFolder(嵌套1) 命中后整体 SkipDir 收编，子模型夹层级会被吞——前端只能看到
// 摊平的子文件行（01_taisho_maid/ysm.json 等），违背「仓库怎么来，整合包就怎么来」。
// 正解：目录同时含子模型文件夹时是「容器」而非「叶子模型夹」，应下钻保留各子夹层级。
func TestSyncResourcesDirLevel_FlatFileNotAbove_SubfolderKept(t *testing.T) {
	if !registry.IsDirLevelSync("ysm") {
		t.Skip("ysm 非 dirLevel 类型，跳过")
	}
	globalDir := t.TempDir()
	instDir := t.TempDir()

	container := filepath.Join(globalDir, "嵌套1")
	_ = os.MkdirAll(filepath.Join(container, "01_taisho_maid"), 0755)
	_ = os.MkdirAll(filepath.Join(container, "嵌套2", "02_new_year"), 0755)
	// 直接平铺 .ysm（令容器目录被 isDirTypeModelFolder 判定为真）
	_ = os.WriteFile(filepath.Join(container, "[kyln默寒寒冰]【机械动力】动力臂.ysm"), []byte("y"), 0644)
	// 子模型夹入口
	_ = os.WriteFile(filepath.Join(container, "01_taisho_maid", "ysm.json"), []byte("{}"), 0644)
	_ = os.WriteFile(filepath.Join(container, "嵌套2", "02_new_year", "ysm.json"), []byte("{}"), 0644)

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	// 平铺 .ysm 应作为一个条目（容器内的平铺文件）
	foundFlat := false
	for _, p := range result.Missing {
		if strings.Contains(p, "动力臂") {
			foundFlat = true
		}
	}
	if !foundFlat {
		t.Errorf("容器内直接平铺 .ysm 应作为独立条目，got Missing=%v", result.Missing)
	}
	// 子模型夹层级必须保留：01_taisho_maid 与嵌套2/02_new_year 都是独立条目
	foundSub := false
	foundDeep := false
	for _, p := range result.Missing {
		if strings.Contains(p, "01_taisho_maid") && !strings.Contains(p, "动力臂") {
			foundSub = true
		}
		if strings.Contains(p, "嵌套2") && strings.Contains(p, "02_new_year") {
			foundDeep = true
		}
	}
	if !foundSub {
		t.Errorf("子模型夹 01_taisho_maid 应保留为独立条目（未被摊平吞掉），got Missing=%v", result.Missing)
	}
	if !foundDeep {
		t.Errorf("深层子模型夹 嵌套2/02_new_year 应保留为独立条目，got Missing=%v", result.Missing)
	}
}
