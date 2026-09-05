// ===== go/packs detector 分支补测（覆盖率 41.1% → 提升）=====
package packs

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

func TestDetectResourceType_McmetaDetector(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "resourcepack", Extensions: []string{".zip"}, Detector: "mcmeta",
				ZipEntries: []types.ZipEntryMatch{{Name: "pack.mcmeta", Match: "exact"}}},
		},
	}
	// 含 pack.mcmeta → 识别
	zipPath := testutil.WriteZipFile(t, "pack.zip", map[string]string{"pack.mcmeta": `{"pack":{"pack_format":15}}`})
	if got := DetectResourceType(zipPath, reg); got != "resourcepack" {
		t.Fatalf("mcmeta detector 应识别 resourcepack: %s", got)
	}
	// 无 pack.mcmeta → 标 container（容器无指纹）
	zipPath2 := testutil.WriteZipFile(t, "pack.zip", map[string]string{"other.txt": "x"})
	if got := DetectResourceType(zipPath2, reg); got != "container" {
		t.Fatalf("无 mcmeta 应标 container: %s", got)
	}
	// 扩展名不匹配 → 标 other（非容器无声明者）
	if got := DetectResourceType(filepath.Join(t.TempDir(), "x.txt"), reg); got != "other" {
		t.Fatalf("扩展名不匹配应标 other: %s", got)
	}
}

func TestDetectResourceType_ShaderDetector(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "shaderpack", Extensions: []string{".zip"}, Detector: "shader",
				ZipEntries: []types.ZipEntryMatch{{Name: "shaders/", Match: "prefix"}}},
		},
	}
	// 含 shaders/ 条目 → 识别
	zipPath := testutil.WriteZipFile(t, "pack.zip", map[string]string{"shaders/foo.fsh": "x"})
	if got := DetectResourceType(zipPath, reg); got != "shaderpack" {
		t.Fatalf("shader detector 应识别 shaderpack: %s", got)
	}
	// 无 shaders → 标 container（容器无指纹）
	zipPath2 := testutil.WriteZipFile(t, "pack.zip", map[string]string{"pack.mcmeta": "x"})
	if got := DetectResourceType(zipPath2, reg); got != "container" {
		t.Fatalf("无 shaders 应标 container: %s", got)
	}
}

// ===== zipentry detector 补测（ADR-067 S2：zip 化资源内容指纹识别）=====

// zipentryReg 构造 zipentry 场景注册表。顺序即优先级（ADR-067 S3）：
// ysm 的根标记（ysm.json/models/）最具体，须排最前——同时含 ysm.json 与 model.pmx
// 的 .zip 应判 ysm（更具体者优先），而非 mmd。
func zipentryReg() *types.ResourceTypeRegistry {
	return &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "ysm", Extensions: []string{".ysm", ".zip", ".7z", ".json"}, Detector: "ysm",
				ZipEntries: []types.ZipEntryMatch{{Name: "ysm.json", Match: "suffix"}, {Name: "models/", Match: "prefix"}}},
			{ID: "EntityPlayer", Extensions: []string{".pmx", ".pmd", ".zip"}, Detector: "zipentry",
				ZipEntries: []types.ZipEntryMatch{{Name: ".pmx", Match: "suffix"}, {Name: ".pmd", Match: "suffix"}}},
			{ID: "vrm", Extensions: []string{".vrm", ".zip"}, Detector: "zipentry",
				ZipEntries: []types.ZipEntryMatch{{Name: ".vrm", Match: "suffix"}}},
			{ID: "blueprint", Extensions: []string{".nbt", ".schematic", ".zip"}, Detector: "zipentry",
				ZipEntries: []types.ZipEntryMatch{{Name: ".nbt", Match: "suffix"}, {Name: ".schematic", Match: "suffix"}}},
			{ID: "litematic", Extensions: []string{".litematic", ".zip"}, Detector: "zipentry",
				ZipEntries: []types.ZipEntryMatch{{Name: ".litematic", Match: "suffix"}}},
		},
	}
}

// 裸文件（非容器）：zipentry 按扩展名直判（isContainer=false 分支）
func TestDetectResourceType_ZipEntry_BareFile(t *testing.T) {
	reg := zipentryReg()
	for _, tc := range []struct {
		path string
		want string
	}{
		{"model.pmx", "EntityPlayer"},
		{"model.pmd", "EntityPlayer"},
		{"avatar.vrm", "vrm"},
		{"build.nbt", "blueprint"},
		{"build.schematic", "blueprint"},
		{"proj.litematic", "litematic"},
		{"model.xyz", "other"}, // 未知扩展名 → other（无声明者）
	} {
		if got := DetectResourceType(tc.path, reg); got != tc.want {
			t.Errorf("DetectResourceType(%s) = %q, 期望 %q", tc.path, got, tc.want)
		}
	}
}

// 容器 .zip：按 zipEntries 内容指纹识别（ADR-067 S2 核心分支）
func TestDetectResourceType_ZipEntry_ZipFingerprint(t *testing.T) {
	reg := zipentryReg()
	for _, tc := range []struct {
		name string
		zip  map[string]string
		want string
	}{
		// 注意：.pmx 不能放 models/ 目录下——models/ 前缀是 ysm 特有根标记，
		// 会先命中 ysm（S3 更具体者优先），此处模拟普通 zip 包裹（非 ysm 结构）
		{"含 .pmx → EntityPlayer", map[string]string{"mmd/steve.pmx": "x"}, "EntityPlayer"},
		{"含 .pmd → EntityPlayer", map[string]string{"rig/char.pmd": "x"}, "EntityPlayer"},
		{"含 .vrm → vrm", map[string]string{"avatar.vrm": "x"}, "vrm"},
		{"含 .nbt → blueprint", map[string]string{"build/floor.nbt": "x"}, "blueprint"},
		{"含 .schematic → blueprint", map[string]string{"house.schematic": "x"}, "blueprint"},
		{"含 .litematic → litematic", map[string]string{"base.litematic": "x"}, "litematic"},
		{"条目名大小写不敏感（MatchZipEntry 小写归一）", map[string]string{"MODEL.PMX": "x"}, "EntityPlayer"},
	} {
		zipPath := testutil.WriteZipFile(t, "pkg.zip", tc.zip)
		if got := DetectResourceType(zipPath, reg); got != tc.want {
			t.Errorf("%s: DetectResourceType = %q, 期望 %q", tc.name, got, tc.want)
		}
	}
}

// 冲突优先级：注册表顺序即优先级（ADR-067 S3）——同时含 ysm.json 与 model.pmx 判 ysm
func TestDetectResourceType_ZipEntry_Priority(t *testing.T) {
	reg := zipentryReg()
	zipPath := testutil.WriteZipFile(t, "pkg.zip", map[string]string{
		"ysm.json":  `{"format_version":"1.12.0"}`,
		"model.pmx": "x",
	})
	if got := DetectResourceType(zipPath, reg); got != "EntityPlayer" {
		t.Fatalf("同时含 ysm.json+model.pmx 应判 EntityPlayer（同 Priority 按 ID 字典序），实际 %q", got)
	}
}

// 无匹配：空 zip / 无关条目 zip → 不识别（返回 ""）
func TestDetectResourceType_ZipEntry_NoMatch(t *testing.T) {
	reg := zipentryReg()
	empty := testutil.WriteZipFile(t, "empty.zip", map[string]string{})
	if got := DetectResourceType(empty, reg); got != "container" {
		t.Fatalf("空 zip 应标 container（容器无指纹）: %q", got)
	}
	noMatch := testutil.WriteZipFile(t, "pkg.zip", map[string]string{"readme.txt": "hello"})
	if got := DetectResourceType(noMatch, reg); got != "container" {
		t.Fatalf("无关条目 zip 应标 container: %q", got)
	}
}

// .7z 内容指纹已接入（ADR-068 后 container.Open7zPath 可枚举 7z 条目）：坏/伪造 .7z
// 打开失败 → zipentry 指纹不命中 → 返回空（识别不出就是识别不出，ADR-082 续——
// 不再靠 ysm 扩展名兜底假装模型）。合法 .7z 含匹配条目时走内容指纹（正向构造需
// 7-Zip CLI 预生成 fixture，见 go/packs/testdata/pack.7z 与 mcmeta_adr082_test.go）。
func TestDetectResourceType_ZipEntry_SevenZipNoFallback(t *testing.T) {
	reg := zipentryReg()
	dir := t.TempDir()
	sevenPath := filepath.Join(dir, "pkg.7z")
	if err := os.WriteFile(sevenPath, []byte("not really 7z"), 0644); err != nil {
		t.Fatal(err)
	}
	if got := DetectResourceType(sevenPath, reg); got != "container" {
		t.Fatalf("坏 .7z 应标 container（容器无指纹），实际 %q", got)
	}
}

// ===== 路径消歧测试 =====
// MMD 子类型共享扩展名（EntityPlayer/SceneModel 都 .pmx/.pmd；
// CustomAnim/StageAnim/DefaultAnim 都 .vmd；CustomMorph/DefaultMorph 都 .vpd）。
// 路径消歧：当父目录名匹配类型 InstanceDir 时，优先命中该类型。
func TestDetectResourceType_PathDisambiguation_MMD(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "EntityPlayer", Extensions: []string{".pmx", ".pmd", ".zip"}, Detector: "zipentry",
				InstanceDir: "EntityPlayer",
				ZipEntries:  []types.ZipEntryMatch{{Name: ".pmx", Match: "suffix"}, {Name: ".pmd", Match: "suffix"}}},
			{ID: "SceneModel", Extensions: []string{".pmx", ".pmd", ".zip"}, Detector: "zipentry",
				InstanceDir: "SceneModel",
				ZipEntries:  []types.ZipEntryMatch{{Name: ".pmx", Match: "suffix"}, {Name: ".pmd", Match: "suffix"}}},
			{ID: "CustomAnim", Extensions: []string{".vmd", ".zip"}, Detector: "zipentry",
				InstanceDir: "CustomAnim",
				ZipEntries:  []types.ZipEntryMatch{{Name: ".vmd", Match: "suffix"}}},
			{ID: "CustomMorph", Extensions: []string{".vpd", ".zip"}, Detector: "zipentry",
				InstanceDir: "CustomMorph",
				ZipEntries:  []types.ZipEntryMatch{{Name: ".vpd", Match: "suffix"}}},
			{ID: "StageAnim", Extensions: []string{".vmd", ".zip"}, Detector: "zipentry",
				InstanceDir: "StageAnim",
				ZipEntries:  []types.ZipEntryMatch{{Name: ".vmd", Match: "suffix"}}},
		},
	}

	for _, tc := range []struct {
		path string
		want string
	}{
		// EntityPlayer 目录下的 .pmx → 命中 EntityPlayer
		{`D:\repo\mmd\EntityPlayer\角色.pmx`, "EntityPlayer"},
		// SceneModel 目录下的 .pmx → 命中 SceneModel（不再被 EntityPlayer 抢走）
		{`D:\repo\mmd\SceneModel\场景.pmx`, "SceneModel"},
		// SceneModel 目录下的 .pmd → 命中 SceneModel
		{`D:\repo\mmd\SceneModel\舞台.pmd`, "SceneModel"},
		// CustomAnim 目录下的 .vmd → 命中 CustomAnim
		{`D:\repo\mmd\CustomAnim\dance.vmd`, "CustomAnim"},
		// StageAnim 目录下的 .vmd → 命中 StageAnim
		{`D:\repo\mmd\StageAnim\stage.vmd`, "StageAnim"},
		// CustomMorph 目录下的 .vpd → 命中 CustomMorph
		{`D:\repo\mmd\CustomMorph\blink.vpd`, "CustomMorph"},
		// 多层嵌套：InstanceDir 作为路径末尾
		{`D:\repo\mmd\SceneModel\sub\子场景.pmx`, "SceneModel"},
	} {
		if got := DetectResourceType(tc.path, reg); got != tc.want {
			t.Errorf("路径消歧: DetectResourceType(%s) = %q, 期望 %q", tc.path, got, tc.want)
		}
	}
}

// 无路径消歧时的兜底：InstanceDir 不匹配时回退扩展名遍历
func TestDetectResourceType_PathDisambiguation_NoMatch(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "EntityPlayer", Extensions: []string{".pmx"}, Detector: "zipentry",
				InstanceDir: "EntityPlayer",
				ZipEntries:  []types.ZipEntryMatch{{Name: ".pmx", Match: "suffix"}}},
			{ID: "SceneModel", Extensions: []string{".pmx"}, Detector: "zipentry",
				InstanceDir: "SceneModel",
				ZipEntries:  []types.ZipEntryMatch{{Name: ".pmx", Match: "suffix"}}},
		},
	}

	// 父目录名不匹配任何 InstanceDir → 回退扩展名兜底（注册表首个匹配）
	if got := DetectResourceType(`D:\repo\other\model.pmx`, reg); got == "" {
		t.Error("无 InstanceDir 匹配时应回退扩展名兜底，不应返回空")
	}

	// InstanceDir 为空的类型（不参与路径消歧）→ 回退扩展名兜底
	reg2 := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "no-path", Extensions: []string{".dat"}, Detector: "extension"},
		},
	}
	if got := DetectResourceType(`data.dat`, reg2); got != "no-path" {
		t.Errorf("InstanceDir 为空时应走扩展名兜底，实际 %q", got)
	}
}

// 跨组隔离：路径消歧只在扩展名匹配时生效，防止跨组误判
func TestDetectResourceType_PathDisambiguation_CrossGroup(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "EntityPlayer", Extensions: []string{".pmx"}, Detector: "zipentry",
				InstanceDir: "EntityPlayer",
				ZipEntries:  []types.ZipEntryMatch{{Name: ".pmx", Match: "suffix"}}},
			// resourcepack 的 InstanceDir 可能也叫 "EntityPlayer"，但扩展名不匹配 → 不应被路径消歧误命中
			{ID: "resourcepack", Extensions: []string{".zip"}, Detector: "mcmeta",
				InstanceDir: "EntityPlayer"},
		},
	}

	// .pmx 在 EntityPlayer 目录 → 应命中 EntityPlayer（不是 resourcepack，因为扩展名不匹配）
	if got := DetectResourceType(`D:\repo\mmd\EntityPlayer\role.pmx`, reg); got != "EntityPlayer" {
		t.Errorf(".pmx 在 EntityPlayer 目录应命中 EntityPlayer，实际 %q", got)
	}
}

// TestDetectResourceType_PathDisambiguation_DeepPriority 子类型化场景：
// 深层目录（DefaultMorph）必须优先于外层目录（EntityPlayer）命中——
// 共享扩展名（.zip/.vpd）last-wins 会把 mmd/PMX/DefaultMorph 下文件误归 EntityPlayer。
// 深度优先修复后，DefaultMorph/DefaultAnim 等子类型目录能正确打赢外层 PMX/EntityPlayer。
func TestDetectResourceType_PathDisambiguation_DeepPriority(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			// 外层类型 EntityPlayer，仓库目录 PMX，共享扩展名 .zip / .dat
			{ID: "EntityPlayer", Extensions: []string{".zip", ".dat"}, Detector: "extension",
				StorageSubDir: "PMX"},
			// 子类型 DefaultMorph，嵌套在 EntityPlayer/PMX 下，共享 .zip / .dat
			{ID: "DefaultMorph", Extensions: []string{".zip", ".dat"}, Detector: "extension",
				StorageSubDir: "DefaultMorph"},
			// 子类型 DefaultAnim，同样嵌套
			{ID: "DefaultAnim", Extensions: []string{".zip", ".dat"}, Detector: "extension",
				StorageSubDir: "DefaultAnim"},
		},
	}

	for _, tc := range []struct {
		path string
		want string
	}{
		// 子类型目录下的文件 → 命中子类型（深层优先，而非外层 EntityPlayer）
		{`D:\repo\mmd\PMX\DefaultMorph\blink.dat`, "DefaultMorph"},
		{`D:\repo\mmd\PMX\DefaultAnim\wave.dat`, "DefaultAnim"},
		{`D:\repo\mmd\PMX\DefaultMorph\model.zip`, "DefaultMorph"},
		// 外层目录下的文件 → 命中外层 EntityPlayer
		{`D:\repo\mmd\PMX\role.zip`, "EntityPlayer"},
		{`D:\repo\mmd\PMX\role.dat`, "EntityPlayer"},
		// 更深嵌套（子目录内子类型）→ 仍命中子类型（DefaultMorph 在 DefaultAnim 上层）
		{`D:\repo\mmd\PMX\DefaultAnim\sub\anim.dat`, "DefaultAnim"},
	} {
		if got := DetectResourceType(tc.path, reg); got != tc.want {
			t.Errorf("深度优先: DetectResourceType(%s) = %q, 期望 %q", tc.path, got, tc.want)
		}
	}
}
