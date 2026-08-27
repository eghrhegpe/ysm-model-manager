// ===== go/types 补测（registry_test 未覆盖分支）=====
package types

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
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

// TestIsTypeModelFile_EmptyExts 空扩展集类型应返回 false（与旧 isModelFile
// 严格语义一致；extMatch 的空集放行分支在 BuildSyncItems 不会触发——未知
// 类型早被 SubDirMap 空拦截）。
func TestIsTypeModelFile_EmptyExts(t *testing.T) {
	if IsTypeModelFile("x.xyz", "no-such-type") {
		t.Error("空扩展集类型不应放行任何文件")
	}
	if !IsTypeModelFile("m.ysm", "ysm") {
		t.Error("ysm 类型应放行 .ysm")
	}
}

// TestIsTypeModelFile_YsmJsonScopedByType ysm.json 仅对扩展集含 .json 的类型
// （ysm）放行；resourcepack/shaderpack 扩展集只有 .zip，整合包目录散落的
// ysm.json 不得作为其独立同步条目（P3 修复：整合包推送/拉取列表被 ysm.json 刷屏）。
func TestIsTypeModelFile_YsmJsonScopedByType(t *testing.T) {
	if !IsTypeModelFile("ysm.json", "ysm") {
		t.Error("ysm 类型（扩展集含 .json）应放行 ysm.json")
	}
	if !IsTypeModelFile("YSM.JSON", "ysm") {
		t.Error("ysm 类型对大小写变体 ysm.json 应放行")
	}
	if IsTypeModelFile("ysm.json", "resourcepack") {
		t.Error("resourcepack（扩展集仅 .zip）不应放行 ysm.json")
	}
	if IsTypeModelFile("ysm.json", "shaderpack") {
		t.Error("shaderpack（扩展集仅 .zip）不应放行 ysm.json")
	}
	if IsTypeModelFile("ysm.json", "EntityPlayer") {
		t.Error("EntityPlayer（扩展集无 .json）不应放行 ysm.json")
	}
	// 非 ysm.json 的其余 .json 仍一律不放行（ADR-038 D2 不变）
	if IsTypeModelFile("geometry.json", "ysm") {
		t.Error("geometry.json 不应作为 ysm 模型文件")
	}
}

func TestFindInstDir_StandardDir(t *testing.T) {
	versionDir := t.TempDir()
	standard := filepath.Join(versionDir, "resourcepacks")
	if err := os.MkdirAll(standard, 0755); err != nil {
		t.Fatal(err)
	}
	if got := FindInstDir(versionDir, "resourcepacks", "resourcepack"); got != standard {
		t.Fatalf("标准目录应直接返回: %s vs %s", got, standard)
	}
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
	if got != filepath.Join(versionDir, "resourcepacks") {
		t.Fatalf("无匹配应返回标准路径: %s", got)
	}
}

// TestFindInstDir_StandardEmptyFallback P5 修复：标准目录存在但为空/无该类型文件时，
// 应继续兜底扫描非标准目录（Sable Schematics 把蓝图放 Sable-Schematics/ 的场景——
// 标准 schematics 目录存在但空，原实现直接返回空目录导致蓝图识别不到）
func TestFindInstDir_StandardEmptyFallback(t *testing.T) {
	versionDir := t.TempDir()
	// 标准 schematics 目录存在但为空
	if err := os.MkdirAll(filepath.Join(versionDir, "schematics"), 0755); err != nil {
		t.Fatal(err)
	}
	// Sable-Schematics 目录含嵌套 .nbt（Sable 模组实际存放蓝图的位置）
	sable := filepath.Join(versionDir, "Sable-Schematics", "hello_new_generation_core")
	if err := os.MkdirAll(sable, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0644)
	got := FindInstDir(versionDir, "schematics", "blueprint")
	if got != filepath.Join(versionDir, "Sable-Schematics") {
		t.Fatalf("标准目录空时应兜底到 Sable-Schematics: %s", got)
	}
}

// TestFindInstDir_StandardNonEmptyStays 标准目录包含该类型文件 → 仍返回标准目录（标准优先，行为不变）
func TestFindInstDir_StandardNonEmptyStays(t *testing.T) {
	versionDir := t.TempDir()
	std := filepath.Join(versionDir, "schematics")
	if err := os.MkdirAll(std, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(std, "top.nbt"), []byte("nbt"), 0644)
	got := FindInstDir(versionDir, "schematics", "blueprint")
	if got != std {
		t.Fatalf("标准目录含 .nbt 应返回标准目录: %s vs %s", got, std)
	}
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

func TestAppError_Error(t *testing.T) {
	e := AppError{Code: ErrorCode("X"), Operation: "导入", SourcePath: "/s", Reason: "失败", Suggestion: "重试"}
	msg := e.Error()
	for _, part := range []string{"失败", "导入", "/s", "重试"} {
		if !strings.Contains(msg, part) {
			t.Fatalf("Error() 缺少 %q: %s", part, msg)
		}
	}
	// 空路径不拼接源路径/目标路径段
	e2 := AppError{Code: ErrorCode("Y"), Reason: "r", Operation: "o", Suggestion: "s"}
	got := e2.Error()
	if strings.Contains(got, "源路径") || strings.Contains(got, "目标路径") {
		t.Fatalf("空路径不应拼接: %s", got)
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
		if err := json.Unmarshal([]byte(c.in), &fr); err != nil {
			t.Fatalf("解析 %s 失败: %v", c.in, err)
		}
		if fr.Min != c.min || fr.Max != c.max {
			t.Fatalf("解析 %s 得 %d/%d，期望 %d/%d", c.in, fr.Min, fr.Max, c.min, c.max)
		}
	}
	// 无效格式 → 报错
	var fr FormatRange
	if err := json.Unmarshal([]byte(`"invalid"`), &fr); err == nil {
		t.Fatal("无效格式应报错")
	}
}

// ====== FormatRange 未覆盖分支 ======

// TestFormatRange_EmptyArray 空数组长度不足应报错（len 0 走 else 分支）
func TestFormatRange_EmptyArray(t *testing.T) {
	var fr FormatRange
	if err := json.Unmarshal([]byte(`[]`), &fr); err == nil {
		t.Fatal("空数组应报错，实际 nil")
	}
}

// TestFormatRange_Null null 走单 int 分支成功（置零值），返回 0/0——钉住现有行为
func TestFormatRange_Null(t *testing.T) {
	var fr FormatRange
	if err := json.Unmarshal([]byte(`null`), &fr); err != nil {
		t.Fatalf("null 不应报错: %v", err)
	}
	if fr.Min != 0 || fr.Max != 0 {
		t.Errorf("null 解析为 %d/%d, 期望 0/0", fr.Min, fr.Max)
	}
}

// TestFormatRange_ObjectMissingFields 对象缺 min_inclusive/max_inclusive 字段 → 零值 0/0
func TestFormatRange_ObjectMissingFields(t *testing.T) {
	var fr FormatRange
	if err := json.Unmarshal([]byte(`{}`), &fr); err != nil {
		t.Fatalf("{} 不应报错: %v", err)
	}
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
	if err := os.WriteFile(standard, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	if got != standard {
		t.Fatalf("标准路径为文件时应兜底后返回标准路径: %s vs %s", got, standard)
	}
}

// TestFindInstDir_UnknownType 未知类型无扩展名信息 → 直接返回标准路径
func TestFindInstDir_UnknownType(t *testing.T) {
	versionDir := t.TempDir()
	got := FindInstDir(versionDir, "resourcepacks", "nonexistent-type")
	if got != filepath.Join(versionDir, "resourcepacks") {
		t.Fatalf("未知类型应返回标准路径: %s", got)
	}
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
	if err := os.MkdirAll(filepath.Join(custom, "models"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(custom, "ysm.json"), []byte("{}"), 0o644)
	got := FindInstDir(versionDir, "config/yes_steve_model/custom", "ysm")
	if got != custom {
		t.Fatalf("ysm.json 标志应命中 standard: %s vs %s", got, custom)
	}
}

// TestFindInstDir_YsmConfigRootJsonOnly config 树根目录只含普通 .json 配置
// （无 ysm.json / .ysm）时，兜底扫描不得把 config 根当作命中目录。
func TestFindInstDir_YsmConfigRootJsonOnly(t *testing.T) {
	versionDir := t.TempDir()
	// config/yes_steve_model 下只有选项配置文件，standard（custom）不存在
	ysmCfg := filepath.Join(versionDir, "config", "yes_steve_model")
	if err := os.MkdirAll(ysmCfg, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(ysmCfg, "options.json"), []byte("{}"), 0o644)
	standard := filepath.Join(versionDir, "config", "yes_steve_model", "custom")
	got := FindInstDir(versionDir, "config/yes_steve_model/custom", "ysm")
	if got != standard {
		t.Fatalf("json 弱证据不应命中 config 树，应返回 standard: %s vs %s", got, standard)
	}
}

// ====== FindInstDir 容器扩展名弱证据收紧（ADR-104 续：.zip/.7z 剔除）======

// TestFindInstDir_BlueprintZipOnlyNotHit 蓝图（blueprint）的 .zip 不作为
// 独立命中证据：整合包根下散落的 .zip（如模组安装包/资源包 zip）会被兜底扫描
// 误判为蓝图目录。扩展集含非容器主证据（.nbt/.schematic）时剔除 .zip。
func TestFindInstDir_BlueprintZipOnlyNotHit(t *testing.T) {
	versionDir := t.TempDir()
	// 含 .zip 的非标准目录（模拟整合包根下散落的 zip 安装包）
	zipDir := filepath.Join(versionDir, "loose-zips")
	if err := os.MkdirAll(zipDir, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(zipDir, "modpack.zip"), []byte("zip"), 0o644)
	standard := filepath.Join(versionDir, "schematics")
	got := FindInstDir(versionDir, "schematics", "blueprint")
	if got != standard {
		t.Fatalf("蓝图 .zip 弱证据不应命中 loose-zips，应返回 standard: %s vs %s", got, standard)
	}
}

// TestFindInstDir_BlueprintZipPlusNbtHit 蓝图目录同时含 .zip 与 .nbt 仍命中
// （非容器主证据 .nbt 独立可命中；.zip 剔除不影响含主文件的目录）。
func TestFindInstDir_BlueprintZipPlusNbtHit(t *testing.T) {
	versionDir := t.TempDir()
	sable := filepath.Join(versionDir, "Sable-Schematics", "hello_new_generation_core")
	if err := os.MkdirAll(sable, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0o644)
	_ = os.WriteFile(filepath.Join(sable, "pack.zip"), []byte("zip"), 0o644)
	got := FindInstDir(versionDir, "schematics", "blueprint")
	if got != filepath.Join(versionDir, "Sable-Schematics") {
		t.Fatalf("含 .nbt 的蓝图目录应兜底命中: %s", got)
	}
}

// TestFindInstDir_LitematicZipOnlyNotHit 投影（litematic）同理：仅 .zip 不命中
func TestFindInstDir_LitematicZipOnlyNotHit(t *testing.T) {
	versionDir := t.TempDir()
	zipDir := filepath.Join(versionDir, "loose-zips")
	if err := os.MkdirAll(zipDir, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(zipDir, "backup.zip"), []byte("zip"), 0o644)
	standard := filepath.Join(versionDir, "schematics")
	got := FindInstDir(versionDir, "schematics", "litematic")
	if got != standard {
		t.Fatalf("litematic .zip 弱证据不应命中，应返回 standard: %s vs %s", got, standard)
	}
}

// TestFindInstDir_ResourcepackStandardEmptyNoFallback 标准 resourcepacks 目录存在但空
// 时，纯容器类型（resourcepack）不得兜底扫描——容器证据无法区分其他目录里的 .zip，
// 兜底会误命中 mods/缓存目录，导致侧边栏把整合包无关压缩包报成 extra（用户场景：
// 整合包 resourcepacks 为空却扫出 30 个可拉取文件）。对照 StandardEmptyFallback
// （blueprint 非容器类型仍需兜底 Sable-Schematics）。
func TestFindInstDir_ResourcepackStandardEmptyNoFallback(t *testing.T) {
	versionDir := t.TempDir()
	// 标准 resourcepacks 存在但为空
	if err := os.MkdirAll(filepath.Join(versionDir, "resourcepacks"), 0o755); err != nil {
		t.Fatal(err)
	}
	// 其他目录含 .zip（如 mods 里的压缩包/缓存）——修复前兜底会误命中这里
	other := filepath.Join(versionDir, "downloads")
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(other, "mod-pack.zip"), []byte("zip"), 0o644)
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	want := filepath.Join(versionDir, "resourcepacks")
	if got != want {
		t.Fatalf("标准 resourcepacks 存在时应返回标准目录（不兜底误命中）: %s vs %s", got, want)
	}
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
	if err := os.MkdirAll(filepath.Join(versionDir, "3d-skin"), 0o755); err != nil {
		t.Fatal(err)
	}
	// config 树里混放 .pmx（MMD 模型被塞进 ysm custom 目录）——旧实现会误命中这里
	cfgCustom := filepath.Join(versionDir, "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(cfgCustom, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(cfgCustom, "some_model.pmx"), []byte("x"), 0o644)
	want := filepath.Join(versionDir, "3d-skin", "SceneModel")
	got := FindInstDir(versionDir, "3d-skin/SceneModel", "SceneModel")
	if got != want {
		t.Fatalf("MMD 子类型不得兜底误命中 config 树: got=%s, 期望标准路径 %s", got, want)
	}
}

// TestFindInstDir_Ysm_NoFallback ysm 标准目录（config/yes_steve_model/custom）不存在时，
// 即使 versionDir 下其他目录含合法 .ysm，也不得兜底返回——ysm scanInstance=false。
func TestFindInstDir_Ysm_NoFallback(t *testing.T) {
	versionDir := t.TempDir()
	// 非标准位置含 .ysm（旧兜底会扫到这里）
	modelDir := filepath.Join(versionDir, "modelpacks")
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(modelDir, "hero.ysm"), []byte("ysm"), 0o644)
	want := filepath.Join(versionDir, "config", "yes_steve_model", "custom")
	got := FindInstDir(versionDir, "config/yes_steve_model/custom", "ysm")
	if got != want {
		t.Fatalf("ysm 不得兜底到非标准目录: got=%s, 期望标准路径 %s", got, want)
	}
}

// ===== IsTypeModelFile 对 zipentry 类型 .zip 内含校验（ADR 收敛：同步链路
// 不得把纯打包物/坏包当模型搬运）=====

// writeZip 造一个含指定条目的 zip 文件，返回路径。
func writeZip(t *testing.T, entries map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "model.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

// TestIsTypeModelFile_ZipEntry_VmdInsideIsModel 内含 .vmd 的 zip 应识别为
// DefaultAnim 模型（保住合法用例：内装 vmd 动画的压缩包）。
func TestIsTypeModelFile_ZipEntry_VmdInsideIsModel(t *testing.T) {
	zipPath := writeZip(t, map[string]string{"motion.vmd": "vmd", "readme.txt": "x"})
	if !IsTypeModelFile(zipPath, "DefaultAnim") {
		t.Fatalf("内含 .vmd 的 zip 应识别为 DefaultAnim 模型: %s", zipPath)
	}
}

// TestIsTypeModelFile_ZipEntry_NoMatchNotModel 内不含 .vmd 的 zip（纯打包物）
// 不得识别为 DefaultAnim 模型——否则同步推送/拉取会把它当顶层模型搬运。
func TestIsTypeModelFile_ZipEntry_NoMatchNotModel(t *testing.T) {
	zipPath := writeZip(t, map[string]string{"data.bin": "x", "readme.txt": "y"})
	if IsTypeModelFile(zipPath, "DefaultAnim") {
		t.Fatalf("内不含 .vmd 的 zip 不得识别为 DefaultAnim 模型: %s", zipPath)
	}
}

// TestIsTypeModelFile_ZipEntry_BadZipNotModel 损坏 zip（非合法 zip 结构）不得
// 识别为模型——坏包在同步列表里亮起推送按钮正是本次故障来源。
func TestIsTypeModelFile_ZipEntry_BadZipNotModel(t *testing.T) {
	bad := filepath.Join(t.TempDir(), "broken.zip")
	if err := os.WriteFile(bad, []byte("this is not a zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	if IsTypeModelFile(bad, "DefaultAnim") {
		t.Fatalf("损坏 zip 不得识别为 DefaultAnim 模型: %s", bad)
	}
}

// TestIsTypeModelFile_ZipEntry_NonZipEntryTypeUnaffected resourcepack（detector
// != zipentry）仍按扩展名直判 .zip 为资源包实体——本改动不影响非 zipentry 类型。
func TestIsTypeModelFile_ZipEntry_NonZipEntryTypeUnaffected(t *testing.T) {
	p := filepath.Join(t.TempDir(), "pack.zip")
	if err := os.WriteFile(p, []byte("zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !IsTypeModelFile(p, "resourcepack") {
		t.Fatalf("resourcepack 的 .zip 仍应直判为资源包（detector != zipentry 不受影响）")
	}
}

// TestIsTypeModelFile_ZipEntry_BareNameFails code review P1（conf 0.85→确认）：
// 生产调用方曾传裸文件名（instance/sync_dirlevel/sync_relink）——zip 分支
// zip.OpenReader(裸名) 相对 CWD 失败 → 返回 false——锁契约：zipentry 类型必须
// 传完整路径才能开 zip 内含校验（调用方已全部改传完整路径）。
func TestIsTypeModelFile_ZipEntry_BareNameFails(t *testing.T) {
	if IsTypeModelFile("motion.zip", "DefaultAnim") {
		t.Fatalf("裸文件名不应被识别为模型（zip 分支需完整路径开文件）: motion.zip")
	}
}

// TestFindInstDir_Blueprint_FallbackKept 唯一合法兜底用例：blueprint scanInstance=true，
// 标准 schematics 为空时仍兜底到 Sable-Schematics/（保留 ADR-104 前真实模组布局兼容）。
func TestFindInstDir_Blueprint_FallbackKept(t *testing.T) {
	versionDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(versionDir, "schematics"), 0o755); err != nil {
		t.Fatal(err)
	}
	sable := filepath.Join(versionDir, "Sable-Schematics", "hello_new_generation_core")
	if err := os.MkdirAll(sable, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0o644)
	want := filepath.Join(versionDir, "Sable-Schematics")
	got := FindInstDir(versionDir, "schematics", "blueprint")
	if got != want {
		t.Fatalf("blueprint 应保留兜底到 Sable-Schematics: got=%s, 期望 %s", got, want)
	}
}

// TestFindInstDir_Resourcepack_NoFallback 纯容器类型 resourcepack scanInstance=false：
// 即使其他目录含 .zip，标准 resourcepacks 缺失时不得兜底返回——改造原 ResourcepackZipKept
// （旧测试断言兜底命中 other，与新纪律冲突，改为断言返回标准路径）。
func TestFindInstDir_Resourcepack_NoFallback(t *testing.T) {
	versionDir := t.TempDir()
	other := filepath.Join(versionDir, "custompacks")
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(other, "pack.zip"), []byte("zip"), 0o644)
	want := filepath.Join(versionDir, "resourcepacks")
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	if got != want {
		t.Fatalf("resourcepack 不得兜底，应返回标准路径: got=%s, 期望 %s", got, want)
	}
}

// TestFindInstDir_Blueprint_UnrelatedNbtSiblingNotHit 收紧用例：标准 schematics 存在但空，
// 兄弟目录 unrelated-structures 含 .nbt 时不得被兜底命中——避免其他资源的 nbt 混入蓝图同步。
func TestFindInstDir_Blueprint_UnrelatedNbtSiblingNotHit(t *testing.T) {
	versionDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(versionDir, "schematics"), 0o755); err != nil {
		t.Fatal(err)
	}
	unrelated := filepath.Join(versionDir, "unrelated-structures")
	if err := os.MkdirAll(unrelated, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(unrelated, "structure.nbt"), []byte("nbt"), 0o644)
	want := filepath.Join(versionDir, "schematics")
	got := FindInstDir(versionDir, "schematics", "blueprint")
	if got != want {
		t.Fatalf("blueprint 不得兜底到无关 nbt 目录: got=%s, 期望标准 %s", got, want)
	}
}

// TestFindInstDir_Blueprint_SableSchematicsCaseInsensitive 兜底白名单大小写不敏感。
func TestFindInstDir_Blueprint_SableSchematicsCaseInsensitive(t *testing.T) {
	versionDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(versionDir, "schematics"), 0o755); err != nil {
		t.Fatal(err)
	}
	sable := filepath.Join(versionDir, "sable-schematics", "core")
	if err := os.MkdirAll(sable, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0o644)
	want := filepath.Join(versionDir, "sable-schematics")
	got := FindInstDir(versionDir, "schematics", "blueprint")
	if got != want {
		t.Fatalf("Sable-Schematics 大小写变体应兜底命中: got=%s, 期望 %s", got, want)
	}
}
