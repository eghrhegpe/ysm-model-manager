package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types/registry"
)

func TestZZMaidModelSync(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "maid-model")
	targetDir := filepath.Join(base, "inst", ".minecraft", "tlm_custom_pack")
	_ = os.MkdirAll(targetDir, 0755)
	pk := filepath.Join(globalDir, "my_pack", "assets", "mypack")
	_ = os.MkdirAll(filepath.Join(pk, "models", "entity"), 0755)
	_ = os.WriteFile(filepath.Join(pk, "maid_model.json"), []byte(`{"pack_name":"x","model_list":[]}`), 0644)
	_ = os.WriteFile(filepath.Join(pk, "models", "entity", "cirno.json"), []byte("{}"), 0644)
	_ = os.WriteFile(filepath.Join(pk, "textures", "entity", "cirno.png"), []byte("png"), 0644)
	count, err := PushResources("maid-model", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) { t.Logf("logger: %s | %s", name, msg) })
	t.Logf("count=%d err=%v", count, err)
	// 列出 targetDir 实际落盘
	filepath.Walk(targetDir, func(p string, info os.FileInfo, err error) error {
		if !info.IsDir() {
			rel, _ := filepath.Rel(targetDir, p)
			t.Logf("FILE: %s", rel)
		}
		return nil
	})
}

// TestNestedPatternDetection 测试嵌套模式检测功能
// 验证 NestedPatterns 配置驱动的多层路径检测
func TestNestedPatternDetection(t *testing.T) {
	base := t.TempDir()

	// 测试场景1：标准的 assets/<namespace>/maid_model.json 结构
	t.Run("standard_assets_structure", func(t *testing.T) {
		// 创建目录结构：mypack/assets/my_ns/maid_model.json
		packDir := filepath.Join(base, "test_pack")
		assetsDir := filepath.Join(packDir, "assets", "my_namespace")
		_ = os.MkdirAll(assetsDir, 0755)
		_ = os.WriteFile(filepath.Join(assetsDir, "maid_model.json"), []byte(`{"pack_name":"test"}`), 0644)

		// 顶层目录（模型根）应被识别为模型文件夹
		if !isDirTypeModelFolder(packDir, "maid-model") {
			t.Error("标准 assets 结构的模型根未被正确识别")
		}

		// assets 子目录是中间目录，不应被识别为模型文件夹
		// 只有模型根目录（包含 assets/ 的目录）才是同步单元
		assetsParent := filepath.Join(packDir, "assets")
		if isDirTypeModelFolder(assetsParent, "maid-model") {
			t.Error("assets 中间目录不应被识别为模型文件夹")
		}
	})

	// 测试场景2：含 chair_model.json 的结构
	t.Run("chair_model_structure", func(t *testing.T) {
		packDir := filepath.Join(base, "chair_pack")
		assetsDir := filepath.Join(packDir, "assets", "chair_ns")
		_ = os.MkdirAll(assetsDir, 0755)
		_ = os.WriteFile(filepath.Join(assetsDir, "chair_model.json"), []byte(`{}`), 0644)

		if !isDirTypeModelFolder(packDir, "maid-model") {
			t.Error("chair_model.json 结构未被正确识别")
		}
	})

	// 测试场景3：无效结构（无入口文件）
	t.Run("invalid_structure", func(t *testing.T) {
		packDir := filepath.Join(base, "invalid_pack")
		assetsDir := filepath.Join(packDir, "assets", "empty_ns")
		_ = os.MkdirAll(assetsDir, 0755)
		// 不写入口文件

		if isDirTypeModelFolder(packDir, "maid-model") {
			t.Error("无效结构不应被识别为模型文件夹")
		}
	})

	// 测试场景4：空 assets 目录
	t.Run("empty_assets_dir", func(t *testing.T) {
		packDir := filepath.Join(base, "empty_assets")
		assetsDir := filepath.Join(packDir, "assets")
		_ = os.MkdirAll(assetsDir, 0755)

		if isDirTypeModelFolder(packDir, "maid-model") {
			t.Error("空 assets 目录不应被识别为模型文件夹")
		}
	})
}

// TestSyncResourcesDirLevelNested 测试多层路径同步
// 验证 SyncResourcesDirLevel 能够正确处理嵌套的模型目录
func TestSyncResourcesDirLevelNested(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global_maid")
	instanceDir := filepath.Join(base, "inst_maid")

	// 创建多层嵌套目录结构
	// global_maid/my_pack/assets/ns1/maid_model.json
	// global_maid/vendor/sub/other_pack/assets/ns2/maid_model.json
	setupNestedPack := func(rootDir, relativePath string) {
		packDir := filepath.Join(rootDir, relativePath)
		assetsDir := filepath.Join(packDir, "assets", "namespace")
		_ = os.MkdirAll(assetsDir, 0755)
		_ = os.WriteFile(filepath.Join(assetsDir, "maid_model.json"),
			[]byte(`{"pack_name":"`+relativePath+`"}`), 0644)
		_ = os.WriteFile(filepath.Join(assetsDir, "model.png"),
			[]byte("fake_png_data"), 0644)
	}

	// 创建全局仓库的多层结构
	setupNestedPack(globalDir, "my_pack")
	setupNestedPack(globalDir, "vendor/sub/nested_pack")
	setupNestedPack(globalDir, "deep/level/structure/pack3")

	// 只创建部分实例目录（模拟未同步状态）
	setupNestedPack(instanceDir, "my_pack")
	// vendor/sub/nested_pack 缺失（应被识别为 missing）

	t.Run("dir_level_sync_with_nested", func(t *testing.T) {
		result := SyncResourcesDirLevel(globalDir, instanceDir, "maid-model")

		// 打印详细结果以便调试
		t.Logf("Synced (%d): %v", len(result.Synced), result.Synced)
		t.Logf("Missing (%d): %v", len(result.Missing), result.Missing)
		t.Logf("Extra (%d): %v", len(result.Extra), result.Extra)

		// 验证 synced 的数量
		if len(result.Synced) != 1 {
			t.Errorf("预期 1 个已同步，实际 %d 个: %v", len(result.Synced), result.Synced)
		}

		// 验证 missing 的数量
		if len(result.Missing) != 2 {
			t.Errorf("预期 2 个缺失，实际 %d 个: %v", len(result.Missing), result.Missing)
		}

		// 验证 missing 包含正确的相对路径
		missingPaths := make(map[string]bool)
		for _, p := range result.Missing {
			rel, _ := filepath.Rel(globalDir, p)
			relSlash := filepath.ToSlash(rel)
			t.Logf("  Missing path: %s -> %s", p, relSlash)
			missingPaths[relSlash] = true
		}
		if !missingPaths["vendor/sub/nested_pack"] {
			t.Errorf("缺失路径中未包含 vendor/sub/nested_pack，实际包含: %v", missingPaths)
		}
		if !missingPaths["deep/level/structure/pack3"] {
			t.Errorf("缺失路径中未包含 deep/level/structure/pack3，实际包含: %v", missingPaths)
		}
	})
}

// TestNestedPatternsConfig 测试嵌套模式配置
// 验证 NestedPatternsFor 函数返回正确的配置
func TestNestedPatternsConfig(t *testing.T) {
	t.Run("maid_model_patterns", func(t *testing.T) {
		patterns := registry.NestedPatternsFor("maid-model")
		if len(patterns) == 0 {
			t.Fatal("maid-model 应有嵌套模式配置")
		}

		// 验证第一个模式的配置
		pattern := patterns[0]
		if pattern.EntryDir != "assets" {
			t.Errorf("预期 EntryDir 为 assets，实际为 %s", pattern.EntryDir)
		}
		if len(pattern.EntryFiles) != 2 {
			t.Errorf("预期 2 个入口文件，实际 %d 个", len(pattern.EntryFiles))
		}
	})

	t.Run("unknown_type_patterns", func(t *testing.T) {
		patterns := registry.NestedPatternsFor("unknown-type")
		if len(patterns) != 0 {
			t.Error("未知类型不应有嵌套模式配置")
		}
	})

	t.Run("is_nested_model_dir", func(t *testing.T) {
		if !registry.IsNestedModelDir("maid-model") {
			t.Error("maid-model 应被识别为嵌套模型目录类型")
		}
		if registry.IsNestedModelDir("resourcepack") {
			t.Error("resourcepack 不应被识别为嵌套模型目录类型")
		}
	})
}

// TestDeepNestingDetection 测试深层嵌套检测
// 验证能够检测到更深层级的嵌套结构
func TestDeepNestingDetection(t *testing.T) {
	base := t.TempDir()

	// 创建 3 层嵌套结构：level1/level2/level3/assets/ns/maid_model.json
	deepDir := filepath.Join(base, "level1", "level2", "level3")
	assetsDir := filepath.Join(deepDir, "assets", "deep_ns")
	_ = os.MkdirAll(assetsDir, 0755)
	_ = os.WriteFile(filepath.Join(assetsDir, "maid_model.json"), []byte(`{}`), 0644)

	t.Run("detect_deep_nesting", func(t *testing.T) {
		if !isDirTypeModelFolder(deepDir, "maid-model") {
			t.Error("深层嵌套结构未被识别")
		}
	})

	t.Run("detect_root_of_deep_nesting", func(t *testing.T) {
		// 模型根是 level1/level2/level3（包含 assets/ 的目录），不是 level1 或 level2
		modelRoot := filepath.Join(base, "level1", "level2", "level3")
		if !isDirTypeModelFolder(modelRoot, "maid-model") {
			t.Error("深层嵌套的模型根未被识别")
		}

		// level1 是中间目录，不应被识别为模型文件夹
		rootDir := filepath.Join(base, "level1")
		if isDirTypeModelFolder(rootDir, "maid-model") {
			t.Error("深层嵌套的中间目录不应被识别为模型文件夹")
		}
	})
}

// TestPushWithNestedPaths 测试带嵌套路径的推送
// 验证 PushResources 能够正确推送多层嵌套的模型目录
func TestPushWithNestedPaths(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "tlm_custom_pack")
	_ = os.MkdirAll(targetDir, 0755)

	// 创建嵌套模型结构
	packDir := filepath.Join(globalDir, "deep", "nested", "my_pack")
	assetsDir := filepath.Join(packDir, "assets", "myns")
	_ = os.MkdirAll(assetsDir, 0755)
	_ = os.WriteFile(filepath.Join(assetsDir, "maid_model.json"),
		[]byte(`{"pack_name":"deep_pack"}`), 0644)
	_ = os.WriteFile(filepath.Join(assetsDir, "model.png"),
		[]byte("png"), 0644)

	count, err := PushResources("maid-model", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) {
			t.Logf("push log: %s | %s", name, msg)
		})

	if err != nil {
		t.Fatalf("推送失败: %v", err)
	}
	if count != 1 {
		t.Errorf("预期推送 1 个模型，实际推送 %d 个", count)
	}

	// 验证目标目录结构
	found := false
	filepath.Walk(targetDir, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			rel, _ := filepath.Rel(targetDir, p)
			if filepath.Base(rel) == "maid_model.json" {
				found = true
				t.Logf("找到入口文件: %s", rel)
			}
		}
		return nil
	})
	if !found {
		t.Error("推送后未找到 maid_model.json")
	}
}
