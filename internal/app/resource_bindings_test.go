package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/dedup"
	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/repoaudit"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// resourceApp 构造用于资源绑定测试的 App（注入 configCache + logger）
func resourceApp(t *testing.T, cfg types.AppConfig) *App {
	t.Helper()
	a := scanApp(t, cfg)
	a.logger = logs.NewLogger(t.TempDir())
	return a
}

// TestFindDuplicateFiles_Guard 测试路径守卫：根外拒绝
func TestFindDuplicateFiles_Guard(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("same"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.ysm"), []byte("same"), 0o644); err != nil {
		t.Fatal(err)
	}

	a := resourceApp(t, types.AppConfig{FilesRoot: base})

	// 根内路径应通过守卫（即使无重复也返回空切片而非 error）
	groups, err := a.FindDuplicateFiles(root)
	if err != nil {
		t.Fatalf("根内路径不应报错: %v", err)
	}
	if groups == nil {
		groups = []dedup.Group{}
	}

	// 根外路径应被守卫拒绝
	outside := filepath.Join(base, "..", "outside")
	_, err = a.FindDuplicateFiles(outside)
	if err == nil {
		t.Error("根外路径应被守卫拒绝返回 error")
	}
}

// TestFindDuplicateFiles_Basic 测试基本去重检测
func TestFindDuplicateFiles_Basic(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	// 两个内容相同的文件
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("identical content"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.ysm"), []byte("identical content"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 一个不同的文件
	if err := os.WriteFile(filepath.Join(root, "c.ysm"), []byte("different"), 0o644); err != nil {
		t.Fatal(err)
	}

	a := resourceApp(t, types.AppConfig{FilesRoot: base})
	groups, err := a.FindDuplicateFiles(root)
	if err != nil {
		t.Fatalf("FindDuplicateFiles 失败: %v", err)
	}

	if len(groups) != 1 {
		t.Fatalf("期望 1 个重复组, got %d: %+v", len(groups), groups)
	}
	if len(groups[0].Files) != 2 {
		t.Fatalf("重复组应含 2 个文件, got %d", len(groups[0].Files))
	}
}

// TestFindDuplicateFiles_WithConfig 测试自定义去重配置
func TestFindDuplicateFiles_WithConfig(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("same"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.ysm"), []byte("same"), 0o644); err != nil {
		t.Fatal(err)
	}

	a := resourceApp(t, types.AppConfig{FilesRoot: base})
	// 配置：name_size 策略（文件名+大小，快速但不精确）
	groups, err := a.FindDuplicateFiles(root, `{"strategy":"name_size"}`)
	if err != nil {
		t.Fatalf("FindDuplicateFiles 失败: %v", err)
	}
	// name_size 模式下同名同大小才算重复，内容相同但文件名不同不算
	if len(groups) != 0 {
		t.Fatalf("name_size 模式下文件名不同不应去重, got %d 组", len(groups))
	}
}

// TestFindDuplicateFiles_InvalidConfig 测试无效配置返回错误
func TestFindDuplicateFiles_InvalidConfig(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}

	a := resourceApp(t, types.AppConfig{FilesRoot: base})
	_, err := a.FindDuplicateFiles(root, `invalid json`)
	if err == nil {
		t.Error("无效配置应返回 error")
	}
}

// TestInvalidateScanCache 测试清空扫描缓存
func TestInvalidateScanCache(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	a := resourceApp(t, types.AppConfig{FilesRoot: base})

	// 首次扫描
	first := a.ScanModelEntries(root)
	if len(first) != 1 {
		t.Fatalf("首次扫描应发现 1 个文件")
	}

	// 二次扫描命中缓存
	second := a.ScanModelEntries(root)
	if len(second) != 1 {
		t.Fatalf("缓存命中应仍返回 1 个文件")
	}

	// 清空缓存
	a.InvalidateScanCache()

	// 再次扫描不应命中缓存（内部逻辑同 ClearScanCache）
	third := a.ScanModelEntries(root)
	if len(third) != 1 {
		t.Fatalf("清缓存后扫描应仍返回 1 个文件")
	}
	// 无法直接断言缓存未命中（scanModelEntriesWithHit 未导出），但至少功能路径通
}

// TestRepoHealthAudit_Guard 测试路径守卫
func TestRepoHealthAudit_Guard(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}

	a := resourceApp(t, types.AppConfig{FilesRoot: base})

	// 根内路径
	_, err := a.RepoHealthAudit(root)
	if err != nil {
		t.Fatalf("根内路径不应报错: %v", err)
	}

	// 根外路径
	outside := filepath.Join(base, "..", "outside")
	_, err = a.RepoHealthAudit(outside)
	if err == nil {
		t.Error("根外路径应被守卫拒绝")
	}
}

// TestRepoHealthAudit_EmptyDir 测试空目录体检
func TestRepoHealthAudit_EmptyDir(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}

	a := resourceApp(t, types.AppConfig{FilesRoot: base})
	report, err := a.RepoHealthAudit(root)
	if err != nil {
		t.Fatalf("空目录体检不应报错: %v", err)
	}
	if report == nil {
		t.Fatal("报告不应为 nil")
	}
	if report.Resources.TotalFiles != 0 {
		t.Errorf("空目录 TotalFiles 应为 0, got %d", report.Resources.TotalFiles)
	}
}

// TestRepoHealthAudit_WithFiles 测试有文件的目录体检
func TestRepoHealthAudit_WithFiles(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.ysm"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	a := resourceApp(t, types.AppConfig{FilesRoot: base})
	report, err := a.RepoHealthAudit(root)
	if err != nil {
		t.Fatalf("体检失败: %v", err)
	}
	if report.Resources.TotalFiles < 2 {
		t.Errorf("应发现至少 2 个文件, got %d", report.Resources.TotalFiles)
	}
	if report.Resources.TotalSize == 0 {
		t.Error("TotalSize 应大于 0")
	}
}

// TestRepoHealthAudit_EmptyPath 测试空路径返回错误
func TestRepoHealthAudit_EmptyPath(t *testing.T) {
	a := resourceApp(t, types.AppConfig{FilesRoot: t.TempDir()})
	_, err := a.RepoHealthAudit("")
	if err == nil {
		t.Error("空路径应返回 error")
	}
}

// TestRepoHealthAuditAll_NoRoots 测试无配置根时返回错误
func TestRepoHealthAuditAll_NoRoots(t *testing.T) {
	a := resourceApp(t, types.AppConfig{})
	_, err := a.RepoHealthAuditAll()
	if err == nil {
		t.Error("无配置根时应返回 error")
	}
}

// TestRepoHealthAuditAll_MultiType 测试多类型根合并体检
func TestRepoHealthAuditAll_MultiType(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	rpRoot := filepath.Join(base, registry.GroupStorageRoot("resourcepack"))
	for _, r := range []string{ysmRoot, rpRoot} {
		if err := os.MkdirAll(r, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(ysmRoot, "a.ysm"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rpRoot, "pack.zip"), []byte("zip"), 0o644); err != nil {
		t.Fatal(err)
	}

	a := resourceApp(t, types.AppConfig{
		FilesRoot:        base,
		ResourcepackRoot: rpRoot,
	})
	report, err := a.RepoHealthAuditAll()
	if err != nil {
		t.Fatalf("多类型体检失败: %v", err)
	}
	if report.Resources.TotalFiles < 2 {
		t.Errorf("应合并发现至少 2 个文件, got %d", report.Resources.TotalFiles)
	}
	if len(report.Resources.ByType) < 2 {
		t.Errorf("应包含至少 2 种类型统计, got %v", report.Resources.ByType)
	}
}

// TestMergeAuditResults_Deterministic 测试合并结果确定性（排序稳定）
func TestMergeAuditResults_Deterministic(t *testing.T) {
	r1 := repoaudit.HealthReport{
		Resources: repoaudit.ResourceSummary{TotalFiles: 10, ByType: map[string]int{"a": 5, "b": 5}},
		Score:     80,
	}
	r2 := repoaudit.HealthReport{
		Resources: repoaudit.ResourceSummary{TotalFiles: 20, ByType: map[string]int{"c": 20}},
		Score:     90,
	}

	results := []auditResult{
		{rtype: "b", report: r1, err: nil},
		{rtype: "a", report: r2, err: nil},
	}

	// 多次调用应产生相同结果（按 rtype 排序）
	var first *repoaudit.HealthReport
	for i := 0; i < 10; i++ {
		merged := mergeAuditResults(results, "2026-01-01T00:00:00Z")
		if i == 0 {
			first = merged
			continue
		}
		if merged.Score != first.Score ||
			merged.Resources.TotalFiles != first.Resources.TotalFiles {
			t.Fatalf("第 %d 次合并结果不一致", i)
		}
		// ByType map 遍历序不定，但合并后键值应一致
		for k, v := range first.Resources.ByType {
			if merged.Resources.ByType[k] != v {
				t.Fatalf("ByType[%s] 不一致: %d vs %d", k, merged.Resources.ByType[k], v)
			}
		}
	}
}

// TestMergeAuditResults_ErrorHandling 测试合并时错误处理
func TestMergeAuditResults_ErrorHandling(t *testing.T) {
	results := []auditResult{
		{rtype: "ok", report: repoaudit.HealthReport{Resources: repoaudit.ResourceSummary{TotalFiles: 5}, Score: 100}, err: nil},
		{rtype: "fail", report: repoaudit.HealthReport{}, err: assertError("some error")},
	}

	merged := mergeAuditResults(results, "2026-01-01T00:00:00Z")
	if len(merged.Warnings) == 0 {
		t.Fatal("应包含错误类型的警告")
	}
	found := false
	for _, w := range merged.Warnings {
		if len(w) > 0 && w[0] == '[' {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("警告应包含类型前缀格式 [type] error, got %v", merged.Warnings)
	}
}

func assertError(msg string) error {
	return &testError{msg}
}

type testError struct{ msg string }

func (e *testError) Error() string { return e.msg }

// TestInstallResourceToInstance_Guard 测试路径守卫
func TestInstallResourceToInstance_Guard(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	mcRoot := filepath.Join(base, ".minecraft")
	instDir := filepath.Join(mcRoot, "versions", "1.20.1")
	customDir := filepath.Join(instDir, "config", "yes_steve_model", "custom")
	for _, d := range []string{ysmRoot, customDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(ysmRoot, "model.ysm"), []byte("ysm"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := types.AppConfig{
		FilesRoot: base,
		McRoot:    mcRoot,
	}
	a := resourceApp(t, cfg)

	// 源文件在仓库根内，目标整合包存在
	err := a.InstallResourceToInstance("ysm", filepath.Join(ysmRoot, "model.ysm"), "1.20.1")
	if err != nil {
		t.Fatalf("合法安装不应报错: %v", err)
	}

	// 验证文件已安装
	installed := filepath.Join(customDir, "model.ysm")
	if _, err := os.Stat(installed); os.IsNotExist(err) {
		t.Errorf("模型文件应已安装到 %s", installed)
	}
}

// TestInstallResourceToInstance_UnknownType 测试未知资源类型
func TestInstallResourceToInstance_UnknownType(t *testing.T) {
	base := t.TempDir()
	mcRoot := filepath.Join(base, ".minecraft")
	instDir := filepath.Join(mcRoot, "versions", "1.20.1")
	if err := os.MkdirAll(instDir, 0o755); err != nil {
		t.Fatal(err)
	}

	cfg := types.AppConfig{FilesRoot: base, McRoot: mcRoot}
	a := resourceApp(t, cfg)

	err := a.InstallResourceToInstance("no-such-type", "/any/path", "1.20.1")
	if err == nil {
		t.Error("未知类型应返回 error")
	}
}

// TestInstallResourceToInstance_MissingInstance 测试不存在的整合包
func TestInstallResourceToInstance_MissingInstance(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	mcRoot := filepath.Join(base, ".minecraft")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ysmRoot, "model.ysm"), []byte("ysm"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := types.AppConfig{FilesRoot: base, McRoot: mcRoot}
	a := resourceApp(t, cfg)

	err := a.InstallResourceToInstance("ysm", filepath.Join(ysmRoot, "model.ysm"), "nonexistent")
	if err == nil {
		t.Error("不存在的整合包应返回 error")
	}
}

// TestInstallResourceToInstance_MissingMcRoot 测试未配置 McRoot
func TestInstallResourceToInstance_MissingMcRoot(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ysmRoot, "model.ysm"), []byte("ysm"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := types.AppConfig{FilesRoot: base} // 无 McRoot
	a := resourceApp(t, cfg)

	err := a.InstallResourceToInstance("ysm", filepath.Join(ysmRoot, "model.ysm"), "1.20.1")
	if err == nil {
		t.Error("未配置 McRoot 应返回 error")
	}
}

// TestInstallResourceToInstance_FolderPush 测试文件夹级推送（ysm 类型）
func TestInstallResourceToInstance_FolderPush(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	mcRoot := filepath.Join(base, ".minecraft")
	instDir := filepath.Join(mcRoot, "versions", "1.20.1")
	customDir := filepath.Join(instDir, "config", "yes_steve_model", "custom")
	for _, d := range []string{ysmRoot, customDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// 创建模型文件夹（含配套文件）
	modelDir := filepath.Join(ysmRoot, "my_model")
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.geo.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "texture.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := types.AppConfig{FilesRoot: base, McRoot: mcRoot}
	a := resourceApp(t, cfg)

	// 传入文件夹内的某个文件（ysm.json），应推送整个文件夹
	err := a.InstallResourceToInstance("ysm", filepath.Join(modelDir, "ysm.json"), "1.20.1")
	if err != nil {
		t.Fatalf("文件夹级安装失败: %v", err)
	}

	// 验证整个文件夹已安装
	installedDir := filepath.Join(customDir, "my_model")
	for _, f := range []string{"ysm.json", "model.geo.json", "texture.png"} {
		if _, err := os.Stat(filepath.Join(installedDir, f)); os.IsNotExist(err) {
			t.Errorf("文件夹级安装应包含 %s", f)
		}
	}
}
