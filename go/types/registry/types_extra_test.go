// ===== registry 补测（registry_test 未覆盖分支）=====
package registry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/internal/testutil"
)

// TestNormalizeResourceName_EdgeCases ADR-064 收敛函数补测：
// 双后缀（.ban.disabled）剥序、大小写、无后缀。
func TestNormalizeResourceName_EdgeCases(t *testing.T) {
	cases := []struct{ in, want string }{
		{"model.ysm", "model.ysm"},
		{"MODEL.YSM", "model.ysm"},
		{"model.ysm.ban", "model.ysm"},
		{"model.ysm.disabled", "model.ysm"},
		{"model.ban.disabled", "model"}, // 先剥 .disabled 再剥 .ban，双后缀均剥（与旧实现一致）
		{"model.ysm.disabled.ban", "model.ysm.disabled"},
		{"", ""},
	}
	for _, c := range cases {
		if got := NormalizeResourceName(c.in); got != c.want {
			t.Errorf("NormalizeResourceName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestIsResourceAllowed_JsonCase 钉住 .json 特判统一走 IsYsmEntryJSON：
// 大小写不敏感 + 前导空格 TrimSpace（与原 isSyncAllowed 手写 base=="ysm.json" 差异，
// 审核 A 指出，已统一到 IsYsmEntryJSON 口径）。
func TestIsResourceAllowed_JsonCase(t *testing.T) {
	if !IsResourceAllowed("YSM.JSON") {
		t.Error("YSM.JSON 应放行（大小写不敏感）")
	}
	if !IsResourceAllowed("ysm.json") {
		t.Error("ysm.json 应放行")
	}
	if IsResourceAllowed("anim.json") {
		t.Error("anim.json 不应放行")
	}
	if IsResourceAllowed("") {
		t.Error("空串不应放行")
	}
}

// TestIsTypeModelFile_* 行为护栏已随函数下沉至 go/packs/model_file_test.go
// （ADR-144：IsTypeModelFile 的 zipentry 分支需开容器，随识别大脑移入 packs）。

func TestFindInstDir_StandardDir(t *testing.T) {
	versionDir := t.TempDir()
	standard := filepath.Join(versionDir, "resourcepacks")
	testutil.NoError(t, os.MkdirAll(standard, 0755))
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	testutil.Equal(t, got, standard, "标准目录应直接返回")
}

// TestShouldHashExt_PinnedList 钉住 ShouldHashExt 的哈希扩展名清单：
// ShouldHashExt 已注册表驱动（resource_types.json 的 hashable 字段，ysm/
// blueprint/litematic 标 true），本测试钉住其行为结果，防注册表
// 扩展名调整时哈希口径意外漂移（大文件跳过哈希是性能决策）。
func TestShouldHashExt_PinnedList(t *testing.T) {
	hashable := []string{".ysm", ".zip", ".7z", ".json", ".nbt", ".schematic", ".litematic"}
	nonHashable := []string{".mmd", ".pmx", ".pmd", ".vrc", ".png", ".txt", ".ban"}
	for _, ext := range hashable {
		if !ShouldHashExt(ext) {
			t.Errorf("ShouldHashExt(%s) = false, want true（清单漂移？）", ext)
		}
	}
	for _, ext := range nonHashable {
		if ShouldHashExt(ext) {
			t.Errorf("ShouldHashExt(%s) = true, want false", ext)
		}
	}
	// 大小写不敏感
	if !ShouldHashExt(".YSM") {
		t.Error("ShouldHashExt(.YSM) = false, want true（大小写不敏感）")
	}
}

func TestFindInstDir_NoMatch(t *testing.T) {
	versionDir := t.TempDir()
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	testutil.Equal(t, got, filepath.Join(versionDir, "resourcepacks"), "无匹配应返回标准路径: %s", got)
}

// TestFindInstDir_StandardEmptyFallback P5 修复：标准目录存在但为空/无该类型文件时，
// 应继续兜底扫描非标准目录（Sable Schematics 把蓝图放 Sable-Schematics/ 的场景——
// 标准 schematics 目录存在但空，原实现直接返回空目录导致蓝图识别不到）
func TestFindInstDir_StandardEmptyFallback(t *testing.T) {
	versionDir := t.TempDir()
	// 标准 schematics 目录存在但为空
	testutil.NoError(t, os.MkdirAll(filepath.Join(versionDir, "schematics"), 0755))
	// Sable-Schematics 目录含嵌套 .nbt（Sable 模组实际存放蓝图的位置）
	sable := filepath.Join(versionDir, "Sable-Schematics", "hello_new_generation_core")
	testutil.NoError(t, os.MkdirAll(sable, 0755))
	_ = os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0644)
	got := FindInstDir(versionDir, "schematics", "blueprint")
	testutil.Equal(t, got, filepath.Join(versionDir, "Sable-Schematics"), "标准目录空时应兜底到 Sable-Schematics: %s", got)
}

// TestFindInstDir_StandardNonEmptyStays 标准目录包含该类型文件 → 仍返回标准目录（标准优先，行为不变）
func TestFindInstDir_StandardNonEmptyStays(t *testing.T) {
	versionDir := t.TempDir()
	std := filepath.Join(versionDir, "schematics")
	testutil.NoError(t, os.MkdirAll(std, 0755))
	_ = os.WriteFile(filepath.Join(std, "top.nbt"), []byte("nbt"), 0644)
	got := FindInstDir(versionDir, "schematics", "blueprint")
	testutil.Equal(t, got, std, "标准目录含 .nbt 应返回标准目录")
}

// ====== IsYsmEntryJSON（ADR-038 D2 白名单）======

func TestIsYsmEntryJSON(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"ysm.json", true},
		{"YSM.JSON", true},
		{"Ysm.Json", true},
		{" ysm.json ", true}, // TrimSpace
		{"main.json", false},
		{"arm.json", false},
		{"slashblade.animation.json", false},
		{"zh_cn.json", false},
		{"en_us.json", false},
		{"ysm.json.bak", false},
		{"", false},
	}
	for _, c := range cases {
		if got := IsYsmEntryJSON(c.name); got != c.want {
			t.Errorf("IsYsmEntryJSON(%q) = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestFormatRange_UnmarshalJSON(t *testing.T) {
	cases := []struct {
		in       string
		min, max int
	}{
		{`15`, 15, 15},     // 单 int
		{`[15]`, 15, 15},   // 单元素数组
		{`[1, 15]`, 1, 15}, // 双元素数组
		{`{"min_inclusive": 3, "max_inclusive": 5}`, 3, 5}, // 对象格式
	}
	for _, c := range cases {
		var fr FormatRange
		testutil.NoError(t, json.Unmarshal([]byte(c.in), &fr), "解析 %s 失败", c.in)
		testutil.Equal(t, fr.Min, c.min, "解析 %s 得 Min=%d，期望 %d", c.in, fr.Min, c.min)
		testutil.Equal(t, fr.Max, c.max, "解析 %s 得 Max=%d，期望 %d", c.in, fr.Max, c.max)
	}
	// 无效格式 → 报错
	var fr FormatRange
	err := json.Unmarshal([]byte(`"invalid"`), &fr)
	testutil.NotNil(t, err, "无效格式应报错")
}

// ====== FormatRange 未覆盖分支 ======

// TestFormatRange_EmptyArray 空数组长度不足应报错（len 0 走 else 分支）
func TestFormatRange_EmptyArray(t *testing.T) {
	var fr FormatRange
	err := json.Unmarshal([]byte(`[]`), &fr)
	testutil.NotNil(t, err, "空数组应报错，实际 nil")
}

// TestFormatRange_Null null 走单 int 分支成功（置零值），返回 0/0——钉住现有行为
func TestFormatRange_Null(t *testing.T) {
	var fr FormatRange
	testutil.NoError(t, json.Unmarshal([]byte(`null`), &fr), "null 不应报错")
	if fr.Min != 0 || fr.Max != 0 {
		t.Errorf("null 解析为 %d/%d, 期望 0/0", fr.Min, fr.Max)
	}
}

// TestFormatRange_ObjectMissingFields 对象缺 min_inclusive/max_inclusive 字段 → 零值 0/0
func TestFormatRange_ObjectMissingFields(t *testing.T) {
	var fr FormatRange
	testutil.NoError(t, json.Unmarshal([]byte(`{}`), &fr), "{} 不应报错")
	if fr.Min != 0 || fr.Max != 0 {
		t.Errorf("{} 解析为 %d/%d, 期望 0/0", fr.Min, fr.Max)
	}
}

// ====== descString 未覆盖分支 ======

// TestDescString_ObjectEmptyText 对象缺 text 或 text 为空 → 空字符串
func TestDescString_ObjectEmptyText(t *testing.T) {
	if got := descString(json.RawMessage(`{"color":"red"}`)); got != "" {
		t.Errorf("对象无 text 字段应返回空, 得到 %q", got)
	}
	if got := descString(json.RawMessage(`{"text":""}`)); got != "" {
		t.Errorf("空 text 应返回空, 得到 %q", got)
	}
}

// TestDescString_ArrayEmptyComponents 数组组件无 text 时跳过，仅拼接非空 text/extra.text
func TestDescString_ArrayEmptyComponents(t *testing.T) {
	got := descString(json.RawMessage(`[{"color":"red"},{"text":"B"},{"extra":[{"text":"C"}]}]`))
	if got != "BC" {
		t.Errorf("数组应跳过无 text 组件并拼接 extra, 得到 %q", got)
	}
	if got := descString(json.RawMessage(`[]`)); got != "" {
		t.Errorf("空数组应返回空, 得到 %q", got)
	}
}

// ====== FindInstDir 未覆盖分支 ======

// TestFindInstDir_StandardIsFile 标准路径存在但是文件（非目录）→ 走兜底扫描，无匹配返回标准路径
func TestFindInstDir_StandardIsFile(t *testing.T) {
	versionDir := t.TempDir()
	standard := filepath.Join(versionDir, "resourcepacks")
	testutil.NoError(t, os.WriteFile(standard, []byte("x"), 0644))
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	testutil.Equal(t, got, standard, "标准路径为文件时应兜底后返回标准路径")
}

// TestFindInstDir_UnknownType 未知类型无扩展名信息 → 直接返回标准路径
func TestFindInstDir_UnknownType(t *testing.T) {
	versionDir := t.TempDir()
	got := FindInstDir(versionDir, "resourcepacks", "nonexistent-type")
	testutil.Equal(t, got, filepath.Join(versionDir, "resourcepacks"), "未知类型应返回标准路径: %s", got)
}

// ====== FindInstDir .json 弱证据收紧（ADR-095）======

// TestFindInstDir_YsmJsonOnlyNotHit ysm 的 .json 不作独立命中证据：
// standard（config/yes_steve_model/custom）下只有非 ysm.json 的配置文件 → 不命中，
// 兜底扫描命中真正含 .ysm 的目录（config 树不再因配置文件被误判为模型目录）。
// 注：2026-08-23 收敛后 ysm scanInstance=false，不再兜底，本测试由
// TestFindInstDir_Ysm_NoFallback 取代（断言返回标准路径而非误扫 modelpacks）。

// TestFindInstDir_YsmJsonFlagHit ysm.json 标志文件可独立命中（解压型模型目录
// 无 .ysm 主文件，靠 ysm.json + models/ 识别）。
func TestFindInstDir_YsmJsonFlagHit(t *testing.T) {
	versionDir := t.TempDir()
	custom := filepath.Join(versionDir, "config", "yes_steve_model", "custom")
	testutil.NoError(t, os.MkdirAll(filepath.Join(custom, "models"), 0o755))
	_ = os.WriteFile(filepath.Join(custom, "ysm.json"), []byte("{}"), 0o644)
	got := FindInstDir(versionDir, "config/yes_steve_model/custom", "ysm")
	testutil.Equal(t, got, custom, "ysm.json 标志应命中 standard")
}

// TestFindInstDir_YsmConfigRootJsonOnly config 树根目录只含普通 .json 配置
// （无 ysm.json / .ysm）时，兜底扫描不得把 config 根当作命中目录。
func TestFindInstDir_YsmConfigRootJsonOnly(t *testing.T) {
	versionDir := t.TempDir()
	// config/yes_steve_model 下只有选项配置文件，standard（custom）不存在
	ysmCfg := filepath.Join(versionDir, "config", "yes_steve_model")
	testutil.NoError(t, os.MkdirAll(ysmCfg, 0o755))
	_ = os.WriteFile(filepath.Join(ysmCfg, "options.json"), []byte("{}"), 0o644)
	standard := filepath.Join(versionDir, "config", "yes_steve_model", "custom")
	got := FindInstDir(versionDir, "config/yes_steve_model/custom", "ysm")
	testutil.Equal(t, got, standard, "json 弱证据不应命中 config 树，应返回 standard")
}

// ====== FindInstDir 容器扩展名弱证据收紧（ADR-104 续：.zip/.7z 剔除）======

// TestFindInstDir_BlueprintZipOnlyNotHit 蓝图（blueprint）的 .zip 不作为
// 独立命中证据：整合包根下散落的 .zip（如模组安装包/资源包 zip）会被兜底扫描
// 误判为蓝图目录。扩展集含非容器主证据（.nbt/.schematic）时剔除 .zip。
func TestFindInstDir_BlueprintZipOnlyNotHit(t *testing.T) {
	versionDir := t.TempDir()
	// 含 .zip 的非标准目录（模拟整合包根下散落的 zip 安装包）
	zipDir := filepath.Join(versionDir, "loose-zips")
	testutil.NoError(t, os.MkdirAll(zipDir, 0o755))
	_ = os.WriteFile(filepath.Join(zipDir, "modpack.zip"), []byte("zip"), 0o644)
	standard := filepath.Join(versionDir, "schematics")
	got := FindInstDir(versionDir, "schematics", "blueprint")
	testutil.Equal(t, got, standard, "蓝图 .zip 弱证据不应命中 loose-zips，应返回 standard")
}

// TestFindInstDir_BlueprintZipPlusNbtHit 蓝图目录同时含 .zip 与 .nbt 仍命中
// （非容器主证据 .nbt 独立可命中；.zip 剔除不影响含主文件的目录）。
func TestFindInstDir_BlueprintZipPlusNbtHit(t *testing.T) {
	versionDir := t.TempDir()
	sable := filepath.Join(versionDir, "Sable-Schematics", "hello_new_generation_core")
	testutil.NoError(t, os.MkdirAll(sable, 0o755))
	_ = os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0o644)
	_ = os.WriteFile(filepath.Join(sable, "pack.zip"), []byte("zip"), 0o644)
	got := FindInstDir(versionDir, "schematics", "blueprint")
	testutil.Equal(t, got, filepath.Join(versionDir, "Sable-Schematics"), "含 .nbt 的蓝图目录应兜底命中: %s", got)
}

// TestFindInstDir_LitematicZipOnlyNotHit 投影（litematic）同理：仅 .zip 不命中
func TestFindInstDir_LitematicZipOnlyNotHit(t *testing.T) {
	versionDir := t.TempDir()
	zipDir := filepath.Join(versionDir, "loose-zips")
	testutil.NoError(t, os.MkdirAll(zipDir, 0o755))
	_ = os.WriteFile(filepath.Join(zipDir, "backup.zip"), []byte("zip"), 0o644)
	standard := filepath.Join(versionDir, "schematics")
	got := FindInstDir(versionDir, "schematics", "litematic")
	testutil.Equal(t, got, standard, "litematic .zip 弱证据不应命中，应返回 standard")
}

// TestFindInstDir_ResourcepackStandardEmptyNoFallback 标准 resourcepacks 目录存在但空
// 时，纯容器类型（resourcepack）不得兜底扫描——容器证据无法区分其他目录里的 .zip，
// 兜底会误命中 mods/缓存目录，导致侧边栏把整合包无关压缩包报成 extra（用户场景：
// 整合包 resourcepacks 为空却扫出 30 个可拉取文件）。对照 StandardEmptyFallback
// （blueprint 非容器类型仍需兜底 Sable-Schematics）。
func TestFindInstDir_ResourcepackStandardEmptyNoFallback(t *testing.T) {
	versionDir := t.TempDir()
	// 标准 resourcepacks 存在但为空
	testutil.NoError(t, os.MkdirAll(filepath.Join(versionDir, "resourcepacks"), 0o755))
	// 其他目录含 .zip（如 mods 里的压缩包/缓存）——修复前兜底会误命中这里
	other := filepath.Join(versionDir, "downloads")
	testutil.NoError(t, os.MkdirAll(other, 0o755))
	_ = os.WriteFile(filepath.Join(other, "mod-pack.zip"), []byte("zip"), 0o644)
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	want := filepath.Join(versionDir, "resourcepacks")
	testutil.Equal(t, got, want, "标准 resourcepacks 存在时应返回标准目录（不兜底误命中）")
}

// ====== 2026-08-23 收敛：不为文件操作设置兜底目录 ======
// 核心纪律：FindInstDir 的消费者是同步 / 哈希 / 回收站清理等破坏性文件操作入口，
// 兜底扫描越界命中错误目录（如 MMD 子类型缺失时扫到 config 树里混放的 .pmx）会让
// 下游对错误目录做删改，安全性归零。因此默认关闭兜底，仅 ScanInstance==true 的类型
// （目前仅 blueprint）开启。以下测试全部采用**负向断言**：竞争者目录含合法扩展名，
// 但绝不应被返回——这是此前测试套件缺失的覆盖（旧测试只验「命中谁」不验「绝不命中谁」）。

// TestFindInstDir_MmdSubtype_NoFalseConfigHit 复现用户 PCL2 场景：
// 标准 3d-skin/SceneModel 不存在，但 config/yes_steve_model/custom 里混放了 .pmx
// （玩家把 MMD 模型塞进 ysm 目录）。MMD 子类型 scanInstance=false → 不得兜底扫到 config，
// 必须返回标准路径（SyncResources 后续对空目录返回空结果，而非误删 config 树）。
func TestFindInstDir_MmdSubtype_NoFalseConfigHit(t *testing.T) {
	versionDir := t.TempDir()
	// 3d-skin 根存在但无 SceneModel 子目录（玩家没放场景模型）
	testutil.NoError(t, os.MkdirAll(filepath.Join(versionDir, "3d-skin"), 0o755))
	// config 树里混放 .pmx（MMD 模型被塞进 ysm custom 目录）——旧实现会误命中这里
	cfgCustom := filepath.Join(versionDir, "config", "yes_steve_model", "custom")
	testutil.NoError(t, os.MkdirAll(cfgCustom, 0o755))
	_ = os.WriteFile(filepath.Join(cfgCustom, "some_model.pmx"), []byte("x"), 0o644)
	want := filepath.Join(versionDir, "3d-skin", "SceneModel")
	got := FindInstDir(versionDir, "3d-skin/SceneModel", "SceneModel")
	testutil.Equal(t, got, want, "MMD 子类型不得兜底误命中 config 树")
}

// TestFindInstDir_Ysm_NoFallback ysm 标准目录（config/yes_steve_model/custom）不存在时，
// 即使 versionDir 下其他目录含合法 .ysm，也不得兜底返回——ysm scanInstance=false。
func TestFindInstDir_Ysm_NoFallback(t *testing.T) {
	versionDir := t.TempDir()
	// 非标准位置含 .ysm（旧兜底会扫到这里）
	modelDir := filepath.Join(versionDir, "modelpacks")
	testutil.NoError(t, os.MkdirAll(modelDir, 0o755))
	_ = os.WriteFile(filepath.Join(modelDir, "hero.ysm"), []byte("ysm"), 0o644)
	want := filepath.Join(versionDir, "config", "yes_steve_model", "custom")
	got := FindInstDir(versionDir, "config/yes_steve_model/custom", "ysm")
	testutil.Equal(t, got, want, "ysm 不得兜底到非标准目录")
}

// TestIsTypeModelFile_ZipEntry_*（writeZip + 5 个 zipentry 内含校验测试）已随
// IsTypeModelFile 下沉至 go/packs/model_file_test.go（ADR-144）。

// TestFindInstDir_Blueprint_FallbackKept 唯一合法兜底用例：blueprint scanInstance=true，
// 标准 schematics 为空时仍兜底到 Sable-Schematics/（保留 ADR-104 前真实模组布局兼容）。
func TestFindInstDir_Blueprint_FallbackKept(t *testing.T) {
	versionDir := t.TempDir()
	testutil.NoError(t, os.MkdirAll(filepath.Join(versionDir, "schematics"), 0o755))
	sable := filepath.Join(versionDir, "Sable-Schematics", "hello_new_generation_core")
	testutil.NoError(t, os.MkdirAll(sable, 0o755))
	_ = os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0o644)
	want := filepath.Join(versionDir, "Sable-Schematics")
	got := FindInstDir(versionDir, "schematics", "blueprint")
	testutil.Equal(t, got, want, "blueprint 应保留兜底到 Sable-Schematics")
}

// TestFindInstDir_Resourcepack_NoFallback 纯容器类型 resourcepack scanInstance=false：
// 即使其他目录含 .zip，标准 resourcepacks 缺失时不得兜底返回——改造原 ResourcepackZipKept
// （旧测试断言兜底命中 other，与新纪律冲突，改为断言返回标准路径）。
func TestFindInstDir_Resourcepack_NoFallback(t *testing.T) {
	versionDir := t.TempDir()
	other := filepath.Join(versionDir, "custompacks")
	testutil.NoError(t, os.MkdirAll(other, 0o755))
	_ = os.WriteFile(filepath.Join(other, "pack.zip"), []byte("zip"), 0o644)
	want := filepath.Join(versionDir, "resourcepacks")
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	testutil.Equal(t, got, want, "resourcepack 不得兜底，应返回标准路径")
}

// TestFindInstDir_Blueprint_UnrelatedNbtSiblingNotHit 收紧用例：标准 schematics 存在但空，
// 兄弟目录 unrelated-structures 含 .nbt 时不得被兜底命中——避免其他资源的 nbt 混入蓝图同步。
func TestFindInstDir_Blueprint_UnrelatedNbtSiblingNotHit(t *testing.T) {
	versionDir := t.TempDir()
	testutil.NoError(t, os.MkdirAll(filepath.Join(versionDir, "schematics"), 0o755))
	unrelated := filepath.Join(versionDir, "unrelated-structures")
	testutil.NoError(t, os.MkdirAll(unrelated, 0o755))
	_ = os.WriteFile(filepath.Join(unrelated, "structure.nbt"), []byte("nbt"), 0o644)
	want := filepath.Join(versionDir, "schematics")
	got := FindInstDir(versionDir, "schematics", "blueprint")
	testutil.Equal(t, got, want, "blueprint 不得兜底到无关 nbt 目录")
}

// TestFindInstDir_Blueprint_SableSchematicsCaseInsensitive 兜底白名单大小写不敏感。
func TestFindInstDir_Blueprint_SableSchematicsCaseInsensitive(t *testing.T) {
	versionDir := t.TempDir()
	testutil.NoError(t, os.MkdirAll(filepath.Join(versionDir, "schematics"), 0o755))
	sable := filepath.Join(versionDir, "sable-schematics", "core")
	testutil.NoError(t, os.MkdirAll(sable, 0o755))
	_ = os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0o644)
	want := filepath.Join(versionDir, "sable-schematics")
	got := FindInstDir(versionDir, "schematics", "blueprint")
	testutil.Equal(t, got, want, "Sable-Schematics 大小写变体应兜底命中")
}

// ====== 兜底扫描内部路径（拆解前的现状钉桩）======

// TestFindInstDir_VersionDirMissing_ReadDirError versionDir 整目录不存在 ⇒
// 兜底扫描的 os.ReadDir 报错，必须落回标准路径（不 panic、不返回空串）。
func TestFindInstDir_VersionDirMissing_ReadDirError(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-version-dir")
	want := filepath.Join(missing, "schematics")
	got := FindInstDir(missing, "schematics", "blueprint")
	testutil.Equal(t, got, want, "versionDir 不存在应返回标准路径")
}

// TestFindInstDir_FallbackSkipsNonDirEntries versionDir 一级条目含普通文件时，
// 兜底循环必须跳过非目录条目（对文件做 WalkDir/索引会报错并刷日志），继续命中
// fallbackDir 声明的目录。文件名 "0-stray.txt" 排序在 "Sable-Schematics" 之前
// （os.ReadDir 按名排序），确保非目录分支先行触发。
func TestFindInstDir_FallbackSkipsNonDirEntries(t *testing.T) {
	versionDir := t.TempDir()
	testutil.NoError(t, os.WriteFile(filepath.Join(versionDir, "0-stray.txt"), []byte("x"), 0o644))
	sable := filepath.Join(versionDir, "Sable-Schematics", "core")
	testutil.NoError(t, os.MkdirAll(sable, 0o755))
	_ = os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0o644)
	want := filepath.Join(versionDir, "Sable-Schematics")
	got := FindInstDir(versionDir, "schematics", "blueprint")
	testutil.Equal(t, got, want, "兜底应跳过非目录条目并命中 Sable-Schematics")
}

// TestFindInstDir_FallbackNoDirFilterSkipsStandard fallbackDir 为空 ⇒ 兜底不限定目录名
// （真实注册表无此形态：守卫 6 强制 scanInstance=true 必须声明 fallbackDir），
// 故用临时注册表注入该形态，钉住两点：标准目录自身在兜底循环中被跳过（不重复扫描），
// 且无名限定时兄弟目录仍可命中。
func TestFindInstDir_FallbackNoDirFilterSkipsStandard(t *testing.T) {
	writeTempRegistry(t, `{"resourceTypes": [
		{"id": "synthscan", "name": "合成兜底型", "group": "g",
		 "instanceDir": "a-standard", "scanInstance": true, "extensions": [".nbt"]}
	]}`)
	defer SetRegistryPath("")

	versionDir := t.TempDir()
	// 标准目录（空）名排序在前 ⇒ 先被遍历到，命中「跳过标准目录」分支
	testutil.NoError(t, os.MkdirAll(filepath.Join(versionDir, "a-standard"), 0o755))
	other := filepath.Join(versionDir, "zz-other")
	testutil.NoError(t, os.MkdirAll(other, 0o755))
	_ = os.WriteFile(filepath.Join(other, "s.nbt"), []byte("nbt"), 0o644)

	got := FindInstDir(versionDir, "a-standard", "synthscan")
	testutil.Equal(t, got, other, "fallbackDir 为空应不限定目录名、跳过标准目录并命中兄弟目录")
}
