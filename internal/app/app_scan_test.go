// ===== app_scan.go 薄壳级单测（零测试层补测）=====
// 覆盖：isPathInRoot 路径守卫边界 / 守卫入口（ListFileNames/CheckFileExists 根外拒绝）/
// 扫描缓存命中语义 / ListModelAuthors 作者前缀提取。避开 Wails runtime 与真实用户配置目录。
package app

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/types"
)

// scanApp 构造注入 configCache + logger 的 App（AddOpLog 依赖 logger）
func scanApp(t *testing.T, cfg types.AppConfig) *App {
	t.Helper()
	a := repoApp(t, cfg)
	a.logger = logs.NewLogger(t.TempDir())
	return a
}

func TestIsPathInRoot_Boundaries(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	// ysm 子目录：FilesRoot/ysm
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		path string
		want bool
	}{
		{"根内文件", filepath.Join(root, "a.ysm"), true},
		{"根内子目录", filepath.Join(root, "sub", "b.ysm"), true},
		{"根本身（rel==. 拒绝）", root, false},
		{"兄弟目录（.. 越权）", filepath.Join(base, "other", "c.ysm"), false},
		{"..foo 合法目录（精确段比较不误拒）", filepath.Join(root, "..foo", "d.ysm"), true},
		{"空串", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := a.isPathInRoot(c.path); got != c.want {
				t.Errorf("isPathInRoot(%q) = %v, 期望 %v", c.path, got, c.want)
			}
		})
	}
}

func TestIsPathInRoot_NoRootConfigured(t *testing.T) {
	// FilesRoot 未配置 → GetRepoRoot 返回空 → 守卫一律拒绝（不静默放行）
	a := scanApp(t, types.AppConfig{})
	if a.isPathInRoot("/anything") {
		t.Error("未配置 FilesRoot 时 isPathInRoot 应恒 false")
	}
}

func TestListFileNames_Guard(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sub", "b.ysm"), []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	t.Run("根内子目录递归列名", func(t *testing.T) {
		got := a.ListFileNames(filepath.Join(root, "sub"))
		if len(got) != 1 || got[0] != "b.ysm" {
			t.Fatalf("ListFileNames(sub) 应列出 b.ysm, got %v", got)
		}
	})

	t.Run("仓库根本身只读放行（整仓扫描语义，与 ReadFileBytes 同口径）", func(t *testing.T) {
		// 2026-08-16 修复：ListFileNames 改 isPathInRootOrSelf——只读遍历放行根本身安全，
		// 旧 isPathInRoot 对 rel==. 拒绝（防整删语义属写操作 RemoveDir/RenameDir 职责）
		got := a.ListFileNames(root)
		if len(got) != 2 {
			t.Fatalf("ListFileNames(根) 应列出全部文件（a.ysm+b.ysm）, got %v", got)
		}
	})

	t.Run("根外拒绝返回 nil", func(t *testing.T) {
		outside := filepath.Join(filepath.Dir(base), "outside-ysm-guard")
		if got := a.ListFileNames(outside); got != nil {
			t.Errorf("根外目录应返回 nil, got %v", got)
		}
	})

	t.Run("兄弟类型根（MmdRoot）下目录放行——mmd 预览纹理清单修复回归", func(t *testing.T) {
		// 2026-08-16 修复核心场景：mmd-skin 目录在 MmdRoot 下，旧 isPathInRoot 只认 ysm 根
		// 误拒 → ListAllFilePaths 返回 nil → 前端纹理清单空（files=0）→ 模型无贴图纯黑
		mmdRoot := filepath.Join(base, "mmd")
		modelDir := filepath.Join(mmdRoot, "模型A")
		if err := os.MkdirAll(modelDir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(modelDir, "tex.png"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		a2 := scanApp(t, types.AppConfig{FilesRoot: base, MmdRoot: mmdRoot})
		got := a2.ListAllFilePaths(modelDir)
		if len(got) != 1 || filepath.Base(got[0]) != "tex.png" {
			t.Errorf("MmdRoot 下目录应列出 tex.png, got %v", got)
		}
	})
}

func TestCheckFileExists_Guard(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(root, "a.ysm")
	if err := os.WriteFile(inside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(filepath.Dir(base), "outside-secret.ysm")
	// 2026-08-16 修复：CheckFileExists 改 isPathInRootOrSelf（与 ReadFileBytes 同口径，
	// FilesRoot 整仓可读可查存在）——真正根外 = FilesRoot 之外（父目录），仍拒绝
	if err := os.WriteFile(outside, []byte("s"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	if !a.CheckFileExists(inside) {
		t.Error("根内存在的文件应返回 true")
	}
	if a.CheckFileExists(outside) {
		t.Error("根外文件应被守卫拒绝（false）")
	}
	if a.CheckFileExists(filepath.Join(root, "不存在.ysm")) {
		t.Error("不存在的文件应返回 false")
	}
}

func TestScanModelEntries_CacheHit(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	// 最小合法 .ysm 文件（扫描器按扩展名识别，不做深度解析）
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	first := a.ScanModelEntries(root)
	if len(first) != 1 {
		t.Fatalf("首次扫描应发现 1 个文件, got %d", len(first))
	}
	// 30s 内二次扫描命中缓存，结果一致
	second := a.ScanModelEntries(root)
	if len(second) != 1 {
		t.Fatalf("缓存命中扫描应仍返回 1 个文件, got %d", len(second))
	}
}

func TestScanModelEntries_SiblingTypeRootAllowed(t *testing.T) {
	// code_review 修复：扫描入口是跨类型通用绑定，守卫边界必须是全部合法根
	// （FilesRoot 公共祖先），而非仅 ysmRoot——resourcepack 等兄弟类型根相对
	// ysmRoot 是 ../，旧守卫会误拒（got 0 回归）
	base := t.TempDir()
	rpRoot := filepath.Join(base, types.GroupStorageRoot("resourcepack"))
	if err := os.MkdirAll(rpRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rpRoot, "rp.zip"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	entries := a.ScanModelEntries(rpRoot)
	if len(entries) != 1 {
		t.Fatalf("兄弟类型根（resourcepack）应可扫描 1 个文件, got %d", len(entries))
	}
	// 越权路径仍拒绝
	if got := a.ScanModelEntries(filepath.Join(base, "..", "outside")); got != nil {
		t.Errorf("根外路径应返回 nil, got %v", got)
	}
}

func TestScanModelEntriesWithLabel_Guard(t *testing.T) {
	// code_review 修复：WithLabel 是前端主扫描入口，须与 ScanModelEntries 共用守卫
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	if got := a.ScanModelEntriesWithLabel(root, "模型"); len(got) != 1 {
		t.Fatalf("根内扫描应返回 1 个文件, got %d", len(got))
	}
	if got := a.ScanModelEntriesWithLabel(filepath.Join(base, "..", "outside"), "模型"); got != nil {
		t.Errorf("根外路径应返回 nil, got %v", got)
	}
}

func TestScanModelEntriesWithHit_CacheSemantics(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 空目录：首次未命中缓存（hit=false），结果为空不报错
	entries, hit := a.scanModelEntriesWithHit(root)
	if hit {
		t.Error("首次扫描不应命中缓存")
	}
	if len(entries) != 0 {
		t.Errorf("空目录扫描应为空, got %d", len(entries))
	}
	// 二次扫描命中缓存
	_, hit2 := a.scanModelEntriesWithHit(root)
	if !hit2 {
		t.Error("二次扫描应命中 30s 缓存")
	}
	// 清缓存后再次未命中
	a.ClearScanCache()
	_, hit3 := a.scanModelEntriesWithHit(root)
	if hit3 {
		t.Error("ClearScanCache 后不应命中缓存")
	}
}

func TestListModelAuthors_PrefixExtraction(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	files := []string{
		"[作者A] 角色一.ysm",
		"[作者A] 角色二.ysm",
		"[作者B] 角色三.ysm",
		"无前缀.ysm",
	}
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(root, f), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	got := a.ListModelAuthors()
	if len(got) != 2 {
		t.Fatalf("应提取 2 个作者, got %v", got)
	}
	for _, author := range got {
		if author.Name == "作者A" && author.Count != 2 {
			t.Errorf("作者A 应计数 2, got %d", author.Count)
		}
		if author.Name == "作者B" && author.Count != 1 {
			t.Errorf("作者B 应计数 1, got %d", author.Count)
		}
	}
}

// TestIsPathInRootOrSelf_Boundaries 表驱动：多根守卫核心边界。
// isPathInRootOrSelf 是 Wails binding 层（ScanModelEntries / ScanModelEntriesWithLabel /
// GenerateRepoIndex / FindDuplicateFiles / CountDuplicateFiles）共用的路径守卫，
// 语义与 isPathInRoot 的关键差异：放行根本身（rel==.）、支持兄弟类型根（resourcepack 等）。
func TestIsPathInRootOrSelf_Boundaries(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, types.GroupStorageRoot("ysm"))
	rpRoot := filepath.Join(base, types.GroupStorageRoot("resourcepack"))
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(rpRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{
		FilesRoot:        base,
		ResourcepackRoot: rpRoot,
	})

	cases := []struct {
		name string
		path string
		want bool
	}{
		{"ysm 根内文件", filepath.Join(ysmRoot, "a.ysm"), true},
		{"ysm 根本身（rel==. 放行——整仓扫描合法）", ysmRoot, true},
		{"resourcepack 根内文件（兄弟类型根放行）", filepath.Join(rpRoot, "rp.zip"), true},
		{"resourcepack 根本身", rpRoot, true},
		{"FilesRoot 根本身", base, true},
		{".. 越权", filepath.Join(base, "..", "outside"), false},
		{"根外子目录", filepath.Join(base, "..", "other"), false},
		{"空串", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := a.isPathInRootOrSelf(c.path)
			if got != c.want {
				t.Errorf("isPathInRootOrSelf(%q) = %v, 期望 %v", c.path, got, c.want)
			}
		})
	}
}

// TestIsPathInRootOrSelf_NoRootConfigured 多根均空 → 一律拒绝
func TestIsPathInRootOrSelf_NoRootConfigured(t *testing.T) {
	a := scanApp(t, types.AppConfig{})
	if a.isPathInRootOrSelf("/anything") {
		t.Error("无配置根时 isPathInRootOrSelf 应恒 false")
	}
}

// TestIsPathInRootOrSelf_RootItselfAllowed 对比：isPathInRoot 拒绝根本身，
// isPathInRootOrSelf 放行根本身（这是两函数语义差异的核心，直接影响整仓扫描合法与否）
func TestIsPathInRootOrSelf_RootItselfAllowed(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	if !a.isPathInRootOrSelf(root) {
		t.Error("isPathInRootOrSelf 应放行根本身（整仓扫描）")
	}
	if a.isPathInRoot(root) {
		t.Error("isPathInRoot 应拒绝根本身（防整删）")
	}
}

// ===== inferFolderType（ADR-092 子类型落位根基）=====
// 文件夹整组导入按内容推断 rtype，扁平化后 MMD 文件直接推断到具体子类型。

func TestInferFolderType_MMD(t *testing.T) {
	files := []types.ImportFileItem{
		{RelPath: "model.pmx", Base64: "cG14"},
		{RelPath: "anims/walk.vmd", Base64: "dm1k"},
		{RelPath: "textures/model.png", Base64: "cG5n"},
	}
	// 扁平化后，.pmx 扩展名会映射到多个 MMD 子类型
	// 取第一个匹配的类型
	got := inferFolderType(files)
	if got == "mmd-skin" {
		t.Errorf("inferFolderType(MMD) 仍返回壳类型 'mmd-skin'，应该返回具体子类型")
	}
	// 验证返回值是有效的资源类型
	if types.RegistryType(got) == nil {
		t.Errorf("inferFolderType(MMD) 返回无效类型: %q", got)
	}
}

func TestInferFolderType_Ysm(t *testing.T) {
	files := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: "e30="},
		{RelPath: "models/entity.json", Base64: "e30="},
		{RelPath: "textures/tex.png", Base64: "cG5n"},
	}
	if got := inferFolderType(files); got != "ysm" {
		t.Errorf("inferFolderType(YSM) = %q, 期望 'ysm'", got)
	}
}

func TestInferFolderType_FallbackYsm(t *testing.T) {
	// 无主文件 / 未知扩展名 → 回退 ysm（向后兼容）
	if got := inferFolderType([]types.ImportFileItem{{RelPath: "notes.txt", Base64: ""}}); got != "ysm" {
		t.Errorf("inferFolderType(unknown) = %q, 期望 'ysm'", got)
	}
	if got := inferFolderType(nil); got != "ysm" {
		t.Errorf("inferFolderType(empty) = %q, 期望 'ysm'", got)
	}
}

// ===== resolveInstDirTarget（ADR-095：打开资源存储目录而非模组扫描目录）=====
// 覆盖矩阵：vanilla / Prism 布局 × ysm（installDir 含 {instance} 前缀）/ resourcepack
// （installDir 为 mcRoot 全局目录）；全部目录不存在 / 未知类型 → 回退 instDir。
func TestResolveInstDirTarget_VanillaYsm(t *testing.T) {
	// vanilla 布局：ysm instanceDir = config/yes_steve_model/custom（固定偏移，与版本隔离无关）
	mcRoot := t.TempDir()
	instDir := filepath.Join(mcRoot, "versions", "1.20.1-Fabric")
	ysmDir := filepath.Join(instDir, "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(ysmDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "ysm"); got != ysmDir {
		t.Errorf("vanilla+ysm = %q, 期望 %q", got, ysmDir)
	}
}

func TestResolveInstDirTarget_VanillaResourcepack(t *testing.T) {
	// resourcepack 现在有 instanceDir，直接返回 instDir/resourcepacks
	mcRoot := t.TempDir()
	instDir := filepath.Join(mcRoot, "versions", "1.20.1-Fabric")
	rpDir := filepath.Join(instDir, "resourcepacks")
	if err := os.MkdirAll(rpDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "resourcepack"); got != rpDir {
		t.Errorf("vanilla+resourcepack = %q, 期望 %q", got, rpDir)
	}
}

func TestResolveInstDirTarget_PrismYsm(t *testing.T) {
	// Prism 布局：instDir = 整合包 .minecraft 根，ysm instanceDir = config/yes_steve_model/custom
	base := t.TempDir()
	instDir := filepath.Join(base, ".minecraft")
	ysmDir := filepath.Join(instDir, "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(ysmDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "ysm"); got != ysmDir {
		t.Errorf("Prism+ysm = %q, 期望 %q", got, ysmDir)
	}
}

func TestResolveInstDirTarget_PrismResourcepack(t *testing.T) {
	// Prism + resourcepack：instDir 即整合包根，存储目录 = instDir/resourcepacks
	base := t.TempDir()
	instDir := filepath.Join(base, ".minecraft")
	rpDir := filepath.Join(instDir, "resourcepacks")
	if err := os.MkdirAll(rpDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "resourcepack"); got != rpDir {
		t.Errorf("Prism+resourcepack = %q, 期望 %q", got, rpDir)
	}
}

func TestResolveInstDirTarget_NoneExistsFallback(t *testing.T) {
	// ysm 有 instanceDir，直接返回 instDir/config/yes_steve_model/custom（不检查目录是否存在）
	instDir := filepath.Join(t.TempDir(), "empty-inst")
	expected := filepath.Join(instDir, "config", "yes_steve_model", "custom")
	if got := resolveInstDirTarget(instDir, "ysm"); got != expected {
		t.Errorf("ysm instanceDir 不检查存在性 = %q, 期望 %q", got, expected)
	}
}

func TestResolveInstDirTarget_UnknownType(t *testing.T) {
	// 未知类型（无 InstallDir 配置）→ 原样返回 instDir（保持原行为）
	instDir := filepath.Join(t.TempDir(), "unknown-inst")
	if got := resolveInstDirTarget(instDir, "no-such-type"); got != instDir {
		t.Errorf("未知类型 = %q, 期望 %q", got, instDir)
	}
}

func TestResolveInstDirTarget_YsmConfigTree(t *testing.T) {
	// ysm 有 instanceDir，直接返回 instDir/config/yes_steve_model/custom
	instDir := t.TempDir()
	customDir := filepath.Join(instDir, "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(customDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "ysm"); got != customDir {
		t.Errorf("ysm instanceDir 优先 = %q, 期望 %q", got, customDir)
	}
}

func TestResolveInstDirTarget_YsmConfigTreeCustom(t *testing.T) {
	// ysm instanceDir 优先，直接返回 instDir/config/yes_steve_model/custom
	// 即使同时存在 installDir 指定的 ysm 目录，也使用 instanceDir
	instDir := t.TempDir()
	// 创建 custom 目录（实际存放路径）
	custom := filepath.Join(instDir, "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(custom, 0o755); err != nil {
		t.Fatal(err)
	}
	// 同时创建 ysm 目录（installDir 指定的路径），验证不影响结果
	ysmDir := filepath.Join(instDir, "ysm")
	os.MkdirAll(ysmDir, 0o755)
	if got := resolveInstDirTarget(instDir, "ysm"); got != custom {
		t.Errorf("ysm instanceDir 优先于 installDir = %q, 期望 %q", got, custom)
	}
}

func TestResolveInstDirTarget_MaidModelStandard(t *testing.T) {
	// maid-model 的 instanceDir 是 tlm_custom_pack
	// 简化后的逻辑直接返回 instanceDir 拼接路径
	if types.RegistryType("maid-model") == nil {
		t.Skip("注册表暂无 maid-model 条目，跳过")
	}
	instDir := t.TempDir()
	packDir := filepath.Join(instDir, "tlm_custom_pack")
	if err := os.MkdirAll(packDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "maid-model"); got != packDir {
		t.Errorf("maid-model instanceDir 命中 = %q, 期望 %q", got, packDir)
	}
}

// TestResolveInstDirTarget_MmdSubtype_3dSkinPrefix 防回归：ADR-094 位置路由要求
// MMD 子类型实例目录必须带 3d-skin/ 前缀（游戏实际生成 6 个子目录）。
// 游戏真实生成的目录（D:\PCL2\...\[实例]\3d-skin\ 下）：
//
//	SceneModel / EntityPlayer / CustomMorph / CustomAnim / DefaultMorph / DefaultAnim
//
// 这几个类型的 instanceDir 必须是 "3d-skin/<子名>"，漏写一级（只写 "3d-skin"）
// 会导致右键打开文件夹差一级、打开到错误父目录。
// 注：StageAnim / mmd-shader 游戏未实际生成独立子目录，保持 "3d-skin" 父目录兜底（打开到父级仍可定位）。
func TestResolveInstDirTarget_MmdSubtype_3dSkinPrefix(t *testing.T) {
	// 游戏实际生成的 6 个子目录类型：instanceDir 必须精确为 "3d-skin/<子名>"
	mustHaveSubdir := map[string]string{
		"SceneModel":   "3d-skin/SceneModel",
		"EntityPlayer": "3d-skin/EntityPlayer",
		"CustomMorph":  "3d-skin/CustomMorph",
		"CustomAnim":   "3d-skin/CustomAnim",
		"DefaultMorph": "3d-skin/DefaultMorph",
		"DefaultAnim":  "3d-skin/DefaultAnim",
	}
	for id, wantDir := range mustHaveSubdir {
		rt := types.RegistryType(id)
		if rt == nil {
			t.Fatalf("注册表缺失 %s 条目（测试前提被破坏）", id)
		}
		if rt.InstanceDir != wantDir {
			t.Errorf("%s instanceDir = %q, 期望 %q（游戏实际生成 3d-skin/%s 子目录）", id, rt.InstanceDir, wantDir, id)
		}
		instDir := t.TempDir()
		want := filepath.Join(instDir, wantDir)
		if got := resolveInstDirTarget(instDir, id); got != want {
			t.Errorf("%s 拼接 = %q, 期望 %q", id, got, want)
		}
	}
	// 游戏未生成独立子目录的类型：instanceDir 允许为 "3d-skin" 父目录（兜底不报错）
	for _, id := range []string{"StageAnim", "mmd-shader"} {
		rt := types.RegistryType(id)
		if rt == nil {
			t.Skipf("注册表暂无 %s 条目，跳过", id)
		}
		if rt.InstanceDir != "3d-skin" && !strings.HasPrefix(rt.InstanceDir, "3d-skin/") {
			t.Errorf("%s instanceDir = %q, 期望为 3d-skin 或 3d-skin/ 前缀（位置路由）", id, rt.InstanceDir)
		}
	}
}

// ===== SearchModels 并发优化测试 =====

// geoJSON 创建可解析的 Bedrock 几何 JSON
func geoJSON(name string, bones int) string {
	boneObjs := make([]string, bones)
	for i := range bones {
		boneObjs[i] = fmt.Sprintf(
			`{"name":"%s_%d","pivot":[0,0,0],"cubes":[{"origin":[-4,0,-4],"size":[8,8,8]}]}`,
			name, i,
		)
	}
	return fmt.Sprintf(
		`{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"%s","texture_width":64,"texture_height":64},"bones":[%s]}]}`,
		name, strings.Join(boneObjs, ","),
	)
}

// writeYsmModelFixture 在 dir 下创建一个独立的 ysm.json + 几何文件结构
// 每个模型用独立子目录，确保 ScanModelEntries 能发现多个 ysm.json
func writeYsmModelFixture(t *testing.T, dir, modelName string, bones int) string {
	t.Helper()
	modelDir := filepath.Join(dir, modelName)
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	geoName := modelName + ".geo.json"
	ysmJSON := fmt.Sprintf(`{"files":{"player":{"model":{"main":"%s"}}}}`, geoName)
	if err := os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(ysmJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, geoName), []byte(geoJSON(modelName, bones)), 0o644); err != nil {
		t.Fatal(err)
	}
	return modelDir
}

// TestSearchModels_ModelMatchesFilters: 纯函数过滤逻辑测试
func TestSearchModels_ModelMatchesFilters(t *testing.T) {
	cases := []struct {
		name      string
		model     types.BedrockModel
		minBones  int
		maxBones  int
		minCubes  int
		maxCubes  int
		minTex    int
		maxTex    int
		wantMatch bool
	}{
		{"零骨骼不匹配", types.BedrockModel{BoneCount: 0}, 0, 0, 0, 0, 0, 0, false},
		{"正常匹配", types.BedrockModel{BoneCount: 5, CubeCount: 10, TexWidth: 64, TexHeight: 64}, 0, 0, 0, 0, 0, 0, true},
		{"骨骼数不足", types.BedrockModel{BoneCount: 3}, 5, 0, 0, 0, 0, 0, false},
		{"骨骼数超限", types.BedrockModel{BoneCount: 10}, 0, 5, 0, 0, 0, 0, false},
		{"立方体数不足", types.BedrockModel{BoneCount: 5, CubeCount: 2}, 0, 0, 5, 0, 0, 0, false},
		{"立方体数超限", types.BedrockModel{BoneCount: 5, CubeCount: 20}, 0, 0, 0, 10, 0, 0, false},
		{"纹理宽度不足", types.BedrockModel{BoneCount: 5, TexWidth: 32, TexHeight: 64}, 0, 0, 0, 0, 64, 0, false},
		{"纹理高度不足", types.BedrockModel{BoneCount: 5, TexWidth: 64, TexHeight: 32}, 0, 0, 0, 0, 64, 0, false},
		{"纹理宽度超限", types.BedrockModel{BoneCount: 5, TexWidth: 128}, 0, 0, 0, 0, 0, 64, false},
		{"纹理高度超限", types.BedrockModel{BoneCount: 5, TexHeight: 128}, 0, 0, 0, 0, 0, 64, false},
		{"全部条件满足", types.BedrockModel{BoneCount: 10, CubeCount: 50, TexWidth: 128, TexHeight: 128}, 5, 20, 10, 100, 64, 256, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := modelMatchesFilters(c.model, c.minBones, c.maxBones, c.minCubes, c.maxCubes, c.minTex, c.maxTex)
			if got != c.wantMatch {
				t.Errorf("modelMatchesFilters = %v, 期望 %v", got, c.wantMatch)
			}
		})
	}
}

// TestSearchModels_SequentialPath: 候选 <= 2 走顺序路径
func TestSearchModels_SequentialPath(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "small", 3)
	writeYsmModelFixture(t, ysmRoot, "tiny", 1)

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) < 2 {
		t.Fatalf("至少应有 2 个结果，got %d", len(results))
	}
	for _, r := range results {
		if r.BoneCount == 0 {
			t.Errorf("结果 %s 应有非零骨骼数", r.Name)
		}
	}
}

// TestSearchModels_ConcurrentPath: 候选 > 2 走并发路径
func TestSearchModels_ConcurrentPath(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	const n = 8
	for i := range n {
		writeYsmModelFixture(t, ysmRoot, fmt.Sprintf("model_%d", i), i+1)
	}

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) != n {
		t.Fatalf("期望 %d 个结果，got %d", n, len(results))
	}
}

// TestSearchModels_KeywordFilter: 关键词预过滤有效
func TestSearchModels_KeywordFilter(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "warrior", 5)
	writeYsmModelFixture(t, ysmRoot, "mage", 3)
	writeYsmModelFixture(t, ysmRoot, "rogue", 4)

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 搜索 "warrior" → 只匹配 warrior
	results := a.SearchModels(base, "warrior", 0, 0, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("搜索 warrior 期望 1 个结果，got %d", len(results))
	}

	// 搜索不存在的关键词 → 空结果
	results = a.SearchModels(base, "nonexistent", 0, 0, 0, 0, 0, 0)
	if len(results) != 0 {
		t.Fatalf("搜索 nonexistent 期望 0 个结果，got %d", len(results))
	}
}

// TestSearchModels_BoneFilter: 骨骼数过滤有效
func TestSearchModels_BoneFilter(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "low", 2)
	writeYsmModelFixture(t, ysmRoot, "high", 10)

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 最少骨骼 5 → 只匹配 high
	results := a.SearchModels(base, "", 5, 0, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("期望 1 个结果，got %d", len(results))
	}

	// 最多骨骼 3 → 只匹配 low
	results = a.SearchModels(base, "", 0, 3, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("期望 1 个结果，got %d", len(results))
	}
}

// TestSearchModels_ConcurrentConsistency: 并发路径全量搜索有效
func TestSearchModels_ConcurrentConsistency(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	const n = 10
	for i := range n {
		writeYsmModelFixture(t, ysmRoot, fmt.Sprintf("model_%d", i), i+1)
	}

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) != n {
		t.Fatalf("期望 %d 个结果，got %d", n, len(results))
	}

	for _, r := range results {
		if r.BoneCount == 0 {
			t.Errorf("结果 %s 骨骼数为 0", r.Name)
		}
	}
}

// TestSearchModels_EmptyRepo: 空仓库返回 nil
func TestSearchModels_EmptyRepo(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if results != nil {
		t.Fatalf("空仓库应返回 nil, got %v", results)
	}
}

// TestSearchModels_Boundary2Sequential: 恰好 2 个候选 → 走顺序路径
func TestSearchModels_Boundary2Sequential(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "a", 1)
	writeYsmModelFixture(t, ysmRoot, "b", 2)

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) != 2 {
		t.Fatalf("恰好 2 个模型应走顺序路径，got %d", len(results))
	}
}

// TestSearchModels_Boundary3Concurrent: 恰好 3 个候选 → 走并发路径
func TestSearchModels_Boundary3Concurrent(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "a", 1)
	writeYsmModelFixture(t, ysmRoot, "b", 2)
	writeYsmModelFixture(t, ysmRoot, "c", 3)

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) != 3 {
		t.Fatalf("恰好 3 个模型应走并发路径，got %d", len(results))
	}
}

// TestSearchModels_CombinedFilter: 关键词+骨骼数+纹理组合过滤
func TestSearchModels_CombinedFilter(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "warrior_heavy", 15)
	writeYsmModelFixture(t, ysmRoot, "warrior_light", 3)
	writeYsmModelFixture(t, ysmRoot, "mage_heavy", 12)
	writeYsmModelFixture(t, ysmRoot, "rogue_light", 4)

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 组合：关键词 "warrior" + 最少骨骼 5 → 只匹配 warrior_heavy
	results := a.SearchModels(base, "warrior", 5, 0, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("warrior+骨骼>=5 应只匹配 1 个，got %d", len(results))
	}
	if !strings.Contains(results[0].Path, "warrior_heavy") {
		t.Errorf("期望 warrior_heavy, got path %s", results[0].Path)
	}

	// 组合：关键词 "warrior" + 最多骨骼 5 → 只匹配 warrior_light
	results = a.SearchModels(base, "warrior", 0, 5, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("warrior+骨骼<=5 应只匹配 1 个，got %d", len(results))
	}

	// 搜索 "mage" → 只匹配 mage_heavy
	results = a.SearchModels(base, "mage", 0, 0, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("搜索 mage 应只匹配 1 个，got %d", len(results))
	}
	if !strings.Contains(results[0].Path, "mage_heavy") {
		t.Errorf("期望 mage_heavy, got path %s", results[0].Path)
	}
}

// TestSearchModels_ResultOrder: 并发结果完整性验证
func TestSearchModels_ResultOrder(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	names := []string{"alpha", "beta", "gamma", "delta", "epsilon"}
	for _, name := range names {
		writeYsmModelFixture(t, ysmRoot, name, 2)
	}

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) != len(names) {
		t.Fatalf("期望 %d 个结果，got %d", len(names), len(results))
	}

	// 验证所有模型都被找到（通过 Path 包含目录名）
	for _, name := range names {
		found := false
		for _, r := range results {
			if strings.Contains(r.Path, name) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("模型 %s 未在结果中找到", name)
		}
	}
}

// TestSearchModels_DeterministicOrder_SameName: 同名不同路径的模型并发搜索 50 次，
// 输出顺序必须逐次一致（名称主键 + 原始索引兜底 + SliceStable）。
// 回归 ADR-119 确定性契约：消除 goroutine 完成序随机 + sort.Slice 非稳定导致的「同输入不同输出」。
func TestSearchModels_DeterministicOrder_SameName(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	// 两个不同父目录下各放一个同名子目录 fixture → ScanModelEntries 扫出两条同名不同路径条目。
	// 声明序：dirA/mymodel 先于 dirB/mymodel（WalkDir 字典序：aaa < bbb）。
	dirs := []string{"aaa_pack", "bbb_pack"}
	for _, d := range dirs {
		packDir := filepath.Join(ysmRoot, d, "mymodel")
		if err := os.MkdirAll(packDir, 0o755); err != nil {
			t.Fatal(err)
		}
		geoName := "mymodel.geo.json"
		ysmContent := fmt.Sprintf(`{"files":{"player":{"model":{"main":"%s"}}}}`, geoName)
		if err := os.WriteFile(filepath.Join(packDir, "ysm.json"), []byte(ysmContent), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(packDir, geoName), []byte(geoJSON("mymodel", 3)), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// 再加几个不同名的模型凑成 > 2 候选，强制走并发路径。
	for _, name := range []string{"zzz_other", "aaa_first"} {
		writeYsmModelFixture(t, ysmRoot, name, 2)
	}

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	const runs = 50
	var first []types.SearchResult
	for i := range runs {
		got := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
		if i == 0 {
			first = got
			continue
		}
		if len(got) != len(first) {
			t.Fatalf("run %d: 结果数 %d 与首次 %d 不一致", i, len(got), len(first))
		}
		for j := range got {
			if got[j].Name != first[j].Name || got[j].Path != first[j].Path {
				t.Fatalf("run %d: 结果顺序漂移\n首次: %+v\n本次: %+v",
					i, first, got)
			}
		}
	}

	// 同名 mymodel 两条按声明序（aaa_pack 先于 bbb_pack）稳定排列。
	var mymodelPaths []string
	for _, r := range first {
		if r.Name == "mymodel" {
			mymodelPaths = append(mymodelPaths, r.Path)
		}
	}
	if len(mymodelPaths) != 2 {
		t.Fatalf("期望 2 条同名 mymodel，got %d", len(mymodelPaths))
	}
	if !strings.Contains(mymodelPaths[0], "aaa_pack") || !strings.Contains(mymodelPaths[1], "bbb_pack") {
		t.Fatalf("同名模型未按声明序排列: %v", mymodelPaths)
	}
}

// TestSearchModels_ZeroBoneFilter: 零骨骼模型被过滤
func TestSearchModels_ZeroBoneFilter(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	modelDir := filepath.Join(ysmRoot, "empty_model")
	os.MkdirAll(modelDir, 0o755)
	ysmJSON := `{"files":{"player":{"model":{"main":"empty.geo.json"}}}}`
	os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(ysmJSON), 0o644)
	emptyGeo := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"empty","texture_width":64,"texture_height":64},"bones":[]}]}`
	os.WriteFile(filepath.Join(modelDir, "empty.geo.json"), []byte(emptyGeo), 0o644)

	writeYsmModelFixture(t, ysmRoot, "valid_model", 5)

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	// 空骨骼模型应被过滤（BoneCount=0，modelMatchesFilters 返回 false）
	if len(results) != 1 {
		t.Fatalf("空骨骼模型应被过滤，仅 1 个有效结果，got %d", len(results))
	}
	if !strings.Contains(results[0].Path, "valid_model") {
		t.Errorf("唯一有效结果应为 valid_model, got path %s", results[0].Path)
	}
}

// ===== ScanModelEntriesFiltered 容器指纹校验（档 A 回归守卫）=====
// 容器扩展名（.zip/.7z）的类型归属不可靠扩展名判定：扫描某类型 tab 时，
// 目录内任何 .zip 都会被该类型的 extensions 白名单命中（如 EntityPlayer 的 [.pmx,.pmd,.vrm,.zip]），
// 但 zip 内部可能是 resourcepack / ysm / 无关内容。必须用 DetectResourceType 打开
// 容器核验内部 ZipEntries 指纹，类型不匹配 rtype 的容器必须丢弃。

// writeZip 用标准库造一个含指定条目的真实 zip 文件（不依赖 testutil，规避 internal 可见性）
func writeZip(t *testing.T, path string, entries ...string) {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range entries {
		if _, err := zw.Create(name); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestScanModelEntriesFiltered_ContainerFingerprint(t *testing.T) {
	// 中性目录名：不得命中任何类型的 instanceDir/storageSubDir（隔离 Phase 1 路径消歧变量）
	base := t.TempDir()
	dir := filepath.Join(base, "scan_filter_dir")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	// 1) 内部含 .vrm 的 zip → DetectResourceType 命中 EntityPlayer（zipEntries 含 .vrm）
	//    → 扫 EntityPlayer tab 应收
	writeZip(t, filepath.Join(dir, "vrm_real.zip"), "model.vrm", "textures/tex.png")
	// 2) 内部含 pack.mcmeta 的 zip → 命中 resourcepack → 扫 EntityPlayer tab 应丢弃
	writeZip(t, filepath.Join(dir, "rp_pack.zip"), "pack.mcmeta")
	// 3) 非容器 .vrm 文件 → 扩展名直接命中 → 应收（验证非容器分支不受影响）
	if err := os.WriteFile(filepath.Join(dir, "scene.vrm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 4) 内部无关的 zip（readme 条目）→ 无类型指纹 → 扫 EntityPlayer tab 应丢弃
	writeZip(t, filepath.Join(dir, "notes.zip"), "readme.txt")

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	got := a.ScanModelEntriesFiltered(dir, "EntityPlayer", "", "角色模型")

	// 期望仅 vrm_real.zip + scene.vrm 两条；rp_pack.zip / notes.zip 因内部非 EntityPlayer 被丢弃
	if len(got) != 2 {
		t.Fatalf("EntityPlayer tab 应仅收 2 条（内部 vrm 的 zip + 非容器 .vrm），实际 %d 条: %+v", len(got), got)
	}
	names := make(map[string]bool)
	for _, e := range got {
		names[filepath.Base(e.Path)] = true
		if e.Type != "EntityPlayer" {
			t.Errorf("条目 %s 的 Type 应为 EntityPlayer, 实际 %q", e.Path, e.Type)
		}
	}
	if !names["vrm_real.zip"] || !names["scene.vrm"] {
		t.Errorf("应收 vrm_real.zip 与 scene.vrm, 实际 %v", names)
	}
	if names["rp_pack.zip"] || names["notes.zip"] {
		t.Errorf("内部非 EntityPlayer 的容器不应被收, 实际 %v", names)
	}
}

func TestScanModelEntriesFiltered_ContainerMatchesOwnType(t *testing.T) {
	// 反向守卫：扫 resourcepack tab 时，内部含 pack.mcmeta 的 zip 应被收，
	// 内部含 .vrm 的 zip 应被丢弃——证实容器指纹是按「扫的类型」而非「任意类型」过滤。
	base := t.TempDir()
	dir := filepath.Join(base, "scan_filter_dir2")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeZip(t, filepath.Join(dir, "rp_pack.zip"), "pack.mcmeta")
	writeZip(t, filepath.Join(dir, "vrm_real.zip"), "model.vrm")

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	got := a.ScanModelEntriesFiltered(dir, "resourcepack", "", "资源包")

	if len(got) != 1 {
		t.Fatalf("resourcepack tab 应仅收 1 条（rp_pack.zip），实际 %d 条: %+v", len(got), got)
	}
	if filepath.Base(got[0].Path) != "rp_pack.zip" {
		t.Errorf("resourcepack tab 应收 rp_pack.zip, 实际 %s", got[0].Path)
	}
}

func TestScanModelEntriesFiltered_DisabledRetained(t *testing.T) {
	// 回归（2026-08-24）：文件级 .disabled 被 ToggleEnable 改名 xxx.zip.disabled 后，
	// ScanModelEntriesFiltered 的扩展名白名单过滤不得把它丢弃——否则仓库树看不到
	// 禁用文件、无法再启用。病灶：过滤用 filepath.Ext(e.Path) 对 .disabled 返回
	// ".disabled" 不在白名单；修复用 scanner 已恢复禁用后缀的 e.Ext + 禁用态容器
	// 跳过指纹核验（DetectResourceType 对 .disabled 路径判不出容器类型）。
	base := t.TempDir()
	dir := filepath.Join(base, "scan_filter_dir3")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeZip(t, filepath.Join(dir, "active.zip"), "pack.mcmeta")
	// 禁用态容器：内部仍 pack.mcmeta（resourcepack 指纹），但文件名带 .disabled
	writeZip(t, filepath.Join(dir, "disabled.zip.disabled"), "pack.mcmeta")

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	got := a.ScanModelEntriesFiltered(dir, "resourcepack", "", "资源包")

	if len(got) != 2 {
		t.Fatalf("resourcepack tab 应收 2 条（active.zip + disabled.zip.disabled），实际 %d 条: %+v", len(got), got)
	}
	names := make(map[string]bool)
	for _, e := range got {
		names[filepath.Base(e.Path)] = true
		if e.Ext != ".zip" {
			t.Errorf("条目 %s 的 Ext 应为 .zip（禁用后缀已恢复），实际 %q", e.Path, e.Ext)
		}
	}
	if !names["active.zip"] || !names["disabled.zip.disabled"] {
		t.Errorf("应收 active.zip 与 disabled.zip.disabled, 实际 %v", names)
	}
}

func TestScanModelEntriesFiltered_BannedFieldFilled(t *testing.T) {
	// 回归（code review #2）：禁用态随扫描一次性下发（ModelEntry.Banned），
	// 替代前端逐文件 IsFileBanned 桥调用（2000 模型 = 2000 次 IPC 的 N+1）。
	// 覆盖文件级（xxx.disabled）与目录级（.disabled 目录内文件）两种判定。
	base := t.TempDir()
	dir := filepath.Join(base, "scan_filter_dir_banned")
	bannedDir := filepath.Join(dir, "banned-group.disabled")
	if err := os.MkdirAll(bannedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ok.ysm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "off.ysm.disabled"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bannedDir, "ingroup.ysm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	got := a.ScanModelEntriesFiltered(dir, "ysm", "", "YSM模型")
	// 注：目录级 .disabled 整组在扫描阶段即被 scanner 排除，不进入结果——
	// Banned 字段覆盖的是「进入结果但带禁用后缀」的文件级判定。
	if len(got) != 2 {
		t.Fatalf("应收 2 条（目录级禁用组已在扫描阶段排除），实际 %d 条: %+v", len(got), got)
	}
	for _, e := range got {
		name := filepath.Base(e.Path)
		want := name != "ok.ysm"
		if e.Banned != want {
			t.Errorf("条目 %s 的 Banned 应为 %v，实际 %v", name, want, e.Banned)
		}
	}
}

func TestScanModelEntriesFiltered_DisabledContainerNoCrossTabLeak(t *testing.T) {
	// 回归（c08c62bc P3）：禁用容器（xxx.zip.disabled）此前跳过指纹核验，
	// 内部 pack.mcmeta（resourcepack 指纹）的容器被泄漏进 EntityPlayer 等
	// 所有含 .zip 的 tab 标 Type=rtype。修复后 DetectResourceType/container.Open
	// 剥离禁用后缀核验真实类型：resourcepack tab 应收，EntityPlayer tab 应丢弃。
	base := t.TempDir()
	dir := filepath.Join(base, "scan_filter_dir4")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeZip(t, filepath.Join(dir, "disabled.zip.disabled"), "pack.mcmeta")

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 自身类型 tab：应保留（指纹 resourcepack == rtype）
	own := a.ScanModelEntriesFiltered(dir, "resourcepack", "", "资源包")
	if len(own) != 1 || filepath.Base(own[0].Path) != "disabled.zip.disabled" {
		t.Fatalf("resourcepack tab 应收禁用容器 disabled.zip.disabled，实际 %+v", own)
	}

	// 无关类型 tab：应丢弃（指纹 resourcepack != EntityPlayer）
	other := a.ScanModelEntriesFiltered(dir, "EntityPlayer", "", "角色模型")
	if len(other) != 0 {
		t.Fatalf("EntityPlayer tab 不应泄漏禁用容器，实际 %+v", other)
	}
}

// ===== runConcurrentAnalyze（searchModelsConcurrent / SearchAllModels Phase 2 收敛 helper）=====
// 并发分析 count 个候选项 + 确定性排序。analyze(i) 返回 nil 表示该项不满足过滤被跳过。
// 排序口径：名称主键 + 原始索引兜底（消除并发完成序导致的「同输入不同输出」，ADR-119）。

func TestRunConcurrentAnalyze_Basic(t *testing.T) {
	got := runConcurrentAnalyze(4, func(i int) *types.SearchResult {
		return &types.SearchResult{Name: fmt.Sprintf("m%d", i), Path: fmt.Sprintf("/p/%d", i)}
	})
	if len(got) != 4 {
		t.Fatalf("期望 4 个结果, got %d", len(got))
	}
	for i, r := range got {
		if want := fmt.Sprintf("m%d", i); r.Name != want {
			t.Errorf("index %d: Name = %s, 期望 %s", i, r.Name, want)
		}
	}
}

func TestRunConcurrentAnalyze_FilterSkip(t *testing.T) {
	// analyze 返回 nil 表示该项不满足过滤 → 从结果剔除
	got := runConcurrentAnalyze(5, func(i int) *types.SearchResult {
		if i == 0 || i == 2 {
			return nil
		}
		return &types.SearchResult{Name: fmt.Sprintf("m%d", i), Path: "/p"}
	})
	if len(got) != 3 {
		t.Fatalf("期望跳过 2 项后剩 3 项, got %d", len(got))
	}
}

func TestRunConcurrentAnalyze_AllFilteredEmpty(t *testing.T) {
	if got := runConcurrentAnalyze(3, func(i int) *types.SearchResult { return nil }); len(got) != 0 {
		t.Fatalf("全过滤应返回空, got %d", len(got))
	}
}

func TestRunConcurrentAnalyze_ZeroCount(t *testing.T) {
	if got := runConcurrentAnalyze(0, func(i int) *types.SearchResult { return &types.SearchResult{} }); len(got) != 0 {
		t.Fatalf("count=0 应返回空, got %d", len(got))
	}
}

func TestRunConcurrentAnalyze_SameNameIndexTieBreak(t *testing.T) {
	// 同名不同原始 index → 按 index 升序兜底（确定性契约）
	names := []string{"z", "a", "b", "a"} // 声明序 index 0..3
	got := runConcurrentAnalyze(len(names), func(i int) *types.SearchResult {
		return &types.SearchResult{Name: names[i], Path: fmt.Sprintf("/p/%d", i)}
	})
	// 期望 Name 主键升序，同名按 index 兜底：a/p1, a/p3, b/p2, z/p0
	wantPaths := []string{"/p/1", "/p/3", "/p/2", "/p/0"}
	if len(got) != len(wantPaths) {
		t.Fatalf("期望 %d 项, got %d", len(wantPaths), len(got))
	}
	for i, w := range wantPaths {
		if got[i].Path != w {
			t.Errorf("index %d: Path = %s, 期望 %s", i, got[i].Path, w)
		}
	}
}
