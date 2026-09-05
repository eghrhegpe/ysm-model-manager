package types

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestAllExts(t *testing.T) {
	exts := AllExts()
	if len(exts) == 0 {
		t.Fatal("AllExts() = 空")
	}
	// .zip 应只出现一次（去重）
	count := 0
	for _, e := range exts {
		if e == ".zip" {
			count++
		}
	}
	if count != 1 {
		t.Errorf(".zip 出现 %d 次，期望 1 次（去重）", count)
	}
	// 已知扩展名存在于结果中
	known := []string{".ysm", ".vrm", ".nbt"}
	for _, ext := range known {
		found := false
		for _, e := range exts {
			if e == ext {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("AllExts() 缺少 %q", ext)
		}
	}
}

func TestIsSupportedExt(t *testing.T) {
	// 支持的扩展名
	if !IsSupportedExt(".ysm") {
		t.Error("IsSupportedExt('.ysm') = false, 期望 true")
	}
	if !IsSupportedExt(".YSM") {
		t.Error("IsSupportedExt('.YSM') = false, 期望 true（大小写不敏感）")
	}
	if !IsSupportedExt(".zip") {
		t.Error("IsSupportedExt('.zip') = false, 期望 true")
	}
	// 不支持的扩展名
	if IsSupportedExt(".xyz") {
		t.Error("IsSupportedExt('.xyz') = true, 期望 false")
	}
	if IsSupportedExt(".txt") {
		t.Error("IsSupportedExt('.txt') = true, 期望 false")
	}
}

func TestExtBelongsTo(t *testing.T) {
	ids := ExtBelongsTo(".ysm")
	if len(ids) < 1 {
		t.Errorf("ExtBelongsTo('.ysm') = %v, 至少应包含 [ysm]", ids)
	}
	found := make(map[string]bool)
	for _, id := range ids {
		found[id] = true
	}
	if !found["ysm"] {
		t.Errorf("ExtBelongsTo('.ysm') = %v, 缺少 ysm", ids)
	}
	ids = ExtBelongsTo(".zip")
	if len(ids) != 14 {
		t.Errorf("ExtBelongsTo('.zip') = %v, 期望 14 类", ids)
	}
	expectedAll := map[string]bool{
		"ysm": false, "resourcepack": false, "shaderpack": false,
		"blueprint": false, "litematic": false,
		"maid-model":   false,
		"EntityPlayer": false, "SceneModel": false,
		"CustomAnim": false, "CustomMorph": false,
		"StageAnim": false, "mmd-shader": false,
		"DefaultAnim": false, "DefaultMorph": false,
	}
	for _, id := range ids {
		if _, ok := expectedAll[id]; ok {
			expectedAll[id] = true
		}
	}
	for id, found := range expectedAll {
		if !found {
			t.Errorf("ExtBelongsTo('.zip') 缺少类型 %s，实际 %v", id, ids)
		}
	}
	if ids := ExtBelongsTo(".xyz"); len(ids) != 0 {
		t.Errorf("ExtBelongsTo('.xyz') = %v, 期望 []", ids)
	}
}

func TestSupportedExtsForType(t *testing.T) {
	// 已知类型
	exts := SupportedExtsForType("ysm")
	if len(exts) == 0 {
		t.Fatal("SupportedExtsForType('ysm') = 空")
	}
	if !slices.Contains(exts, ".ysm") {
		t.Error("SupportedExtsForType('ysm') 缺少 .ysm")
	}
	// 大小写不敏感（向后兼容）
	exts = SupportedExtsForType("YSM")
	if len(exts) == 0 {
		t.Error("SupportedExtsForType('YSM') = 空（大小写不敏感）")
	}
	// 未知类型
	if exts := SupportedExtsForType("unknown"); exts != nil {
		t.Errorf("SupportedExtsForType('unknown') = %v, 期望 nil", exts)
	}
}

func TestStorageSubDir(t *testing.T) {
	expectedIDs := []string{"ysm", "maid-model", "vrm", "resourcepack", "shaderpack", "blueprint", "litematic"}
	for _, id := range expectedIDs {
		dir := StorageSubDir(id)
		if dir == "" {
			t.Errorf("StorageSubDir(%q) = 空字符串", id)
		}
	}
	if got := StorageSubDir("resourcepack"); got != "resourcepacks" {
		t.Errorf("StorageSubDir('resourcepack') = %q, 期望 'resourcepacks'", got)
	}
	if got := StorageSubDir("ysm"); got != "ysm" {
		t.Errorf("StorageSubDir('ysm') = %q, 期望 'ysm'", got)
	}
	if got := StorageSubDir("unknown"); got != "unknown" {
		t.Errorf("StorageSubDir('unknown') = %q, 期望 'unknown'", got)
	}
}

func TestGroupOf(t *testing.T) {
	cases := []struct{ rtype, want string }{
		{"resourcepack", "minecraft"},
		{"shaderpack", "minecraft"},
		{"ysm", "minecraft-mod"},
		{"blueprint", "minecraft-mod"},
		{"litematic", "minecraft-mod"},
		{"maid-model", "minecraft-mod"},
		{"EntityPlayer", "mmd"},
	}
	for _, c := range cases {
		if got := GroupOf(c.rtype); got != c.want {
			t.Errorf("GroupOf(%q) = %q, 期望 %q", c.rtype, got, c.want)
		}
	}
	if got := GroupOf("unknown"); got != "" {
		t.Errorf("GroupOf('unknown') = %q, 期望 ''", got)
	}
}

func TestGroupStorageRoot(t *testing.T) {
	// 锚点哨兵：已知类型的存储根硬编码钉死（防 JSON 数值漂移——派生化只防结构漂移，
	// storageSubDir/group 值被改错时派生循环会自证通过，锚点兜底）
	anchors := []struct{ rtype, want string }{
		{"resourcepack", "minecraft/resourcepacks"},
		{"shaderpack", "minecraft/shaderpacks"},
		{"ysm", "minecraft-mod/ysm"},
		{"blueprint", "minecraft-mod/schematics"},
		{"litematic", "minecraft-mod/litematics"},
		{"maid-model", "minecraft-mod/maid-model"},
		{"EntityPlayer", "mmd/PMX"},
	}
	for _, c := range anchors {
		if got := GroupStorageRoot(c.rtype); got != c.want {
			t.Errorf("GroupStorageRoot(%q) = %q, 期望 %q（锚点哨兵）", c.rtype, got, c.want)
		}
	}
	// 从注册表动态派生期望值，防快照漂移（21 次推倒重来的教训）
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		group := rt.Group
		sub := rt.StorageSubDir
		if sub == "" {
			sub = rt.ID
		}
		var want string
		if group != "" {
			want = group + "/" + sub
		} else {
			want = sub
		}
		if got := GroupStorageRoot(rt.ID); got != want {
			t.Errorf("GroupStorageRoot(%q) = %q, 期望 %q（从注册表动态派生）", rt.ID, got, want)
		}
	}
	// 未知类型回退到 typeId 自身
	if got := GroupStorageRoot("unknown"); got != "unknown" {
		t.Errorf("GroupStorageRoot('unknown') = %q, 期望 'unknown'", got)
	}
	// 防快照守卫：无废弃壳层前缀
	deprecated := []string{"3d-skin/", "mmd-skin/", "{instance}", "{installDir}"}
	for _, rt := range reg.ResourceTypes {
		root := GroupStorageRoot(rt.ID)
		for _, prefix := range deprecated {
			if strings.HasPrefix(root, prefix) {
				t.Errorf("类型 %q 的 GroupStorageRoot %q 含废弃前缀 %q", rt.ID, root, prefix)
			}
		}
	}
}

func TestGroupLabel(t *testing.T) {
	if got := GroupLabel("minecraft"); got != "Minecraft 原版" {
		t.Errorf("GroupLabel('minecraft') = %q, 期望 'Minecraft 原版'", got)
	}
	if got := GroupLabel("mmd"); got != "MMD" {
		t.Errorf("GroupLabel('mmd') = %q, 期望 'MMD'", got)
	}
	// 未知/空分组返回空串
	if got := GroupLabel("nope"); got != "" {
		t.Errorf("GroupLabel('nope') = %q, 期望 ''", got)
	}
	if got := GroupLabel(""); got != "" {
		t.Errorf("GroupLabel('') = %q, 期望 ''", got)
	}
}

func TestGroupIcon(t *testing.T) {
	if got := GroupIcon("minecraft"); got != "⛏️" {
		t.Errorf("GroupIcon('minecraft') = %q, 期望 '⛏️'", got)
	}
	if got := GroupIcon("mmd"); got != "🎭" {
		t.Errorf("GroupIcon('mmd') = %q, 期望 '🎭'", got)
	}
	// 未知/空分组返回空串
	if got := GroupIcon("nope"); got != "" {
		t.Errorf("GroupIcon('nope') = %q, 期望 ''", got)
	}
	if got := GroupIcon(""); got != "" {
		t.Errorf("GroupIcon('') = %q, 期望 ''", got)
	}
}

// TestGroupLabel_EachGroupOnce 验证每个组恰有一个类型携带 groupLabel/groupIcon。
// 首个类型约定：JSON 中该组第一个出现的类型应携带 groupLabel/groupIcon。
func TestGroupLabel_EachGroupOnce(t *testing.T) {
	reg := LoadRegistry()
	type groupInfo struct {
		labelCount int
		iconCount  int
	}
	groups := make(map[string]*groupInfo)
	for _, rt := range reg.ResourceTypes {
		if rt.Group == "" {
			continue
		}
		if groups[rt.Group] == nil {
			groups[rt.Group] = &groupInfo{}
		}
		if rt.GroupLabel != "" {
			groups[rt.Group].labelCount++
		}
		if rt.GroupIcon != "" {
			groups[rt.Group].iconCount++
		}
	}
	for gid, info := range groups {
		if info.labelCount != 1 {
			t.Errorf("group %q 有 %d 个 groupLabel，期望正好 1 个（首个类型携带）", gid, info.labelCount)
		}
		if info.iconCount != 1 {
			t.Errorf("group %q 有 %d 个 groupIcon，期望正好 1 个（首个类型携带）", gid, info.iconCount)
		}
	}
}

func TestSubDirMap(t *testing.T) {
	// 从注册表动态派生期望值，防快照漂移
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		if rt.InstanceDir == "" {
			continue
		}
		if got := SubDirMap(rt.ID); got != rt.InstanceDir {
			t.Errorf("SubDirMap(%q) = %q, 期望 %q（从注册表动态派生）", rt.ID, got, rt.InstanceDir)
		}
	}
	// 未知类型返回空串
	if got := SubDirMap("unknown"); got != "" {
		t.Errorf("SubDirMap('unknown') = %q, 期望 ''", got)
	}
	// 防快照守卫：无废弃壳层前缀（3d-skin 是 MMD 合法 instanceDir，不在此列）
	deprecated := []string{"mmd-skin/", "{instance}", "{installDir}"}
	for _, rt := range reg.ResourceTypes {
		if rt.InstanceDir == "" {
			continue
		}
		for _, prefix := range deprecated {
			if strings.HasPrefix(rt.InstanceDir, prefix) {
				t.Errorf("类型 %q 的 InstanceDir %q 含废弃前缀 %q", rt.ID, rt.InstanceDir, prefix)
			}
		}
	}
}

func TestSubDirAll(t *testing.T) {
	m := SubDirAll()
	// 用注册表派生而非手写快照：断言每个有 InstanceDir 的类型都出现在 map 中
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		if rt.InstanceDir == "" {
			continue
		}
		if _, ok := m[rt.ID]; !ok {
			t.Errorf("SubDirAll 缺少类型 %q（instanceDir=%q）", rt.ID, rt.InstanceDir)
		}
		// 值必须等于 rt.InstanceDir（单一事实源）
		if m[rt.ID] != rt.InstanceDir {
			t.Errorf("SubDirAll[%q] = %q, 期望 %q（与注册表 InstanceDir 不一致）",
				rt.ID, m[rt.ID], rt.InstanceDir)
		}
	}
	// 锚点哨兵：ysm 的 instanceDir 是扁平化语义下的特例（config/yes_steve_model/custom），
	// 钉死防止路径语义漂移（21 次推倒重来的老震中）
	if got := m["ysm"]; got != "config/yes_steve_model/custom" {
		t.Errorf("SubDirAll[ysm] = %q, 期望 'config/yes_steve_model/custom'（锚点哨兵）", got)
	}
}

func TestAllSubDirs(t *testing.T) {
	entries := AllSubDirs()
	entryMap := make(map[string]string)
	for _, e := range entries {
		entryMap[e.RType] = e.SubDir
	}
	// 用注册表派生：所有有 InstanceDir 的类型都必须出现
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		if rt.InstanceDir == "" {
			continue
		}
		if _, ok := entryMap[rt.ID]; !ok {
			t.Errorf("AllSubDirs 缺少类型 %q（instanceDir=%q）", rt.ID, rt.InstanceDir)
		}
		if entryMap[rt.ID] != rt.InstanceDir {
			t.Errorf("AllSubDirs[%q] = %q, 期望 %q", rt.ID, entryMap[rt.ID], rt.InstanceDir)
		}
	}
}

func TestSupportedExtsForTypeUnknown(t *testing.T) {
	// 未知类型返回 nil
	if got := SupportedExtsForType("non-existent-type"); got != nil {
		t.Errorf("SupportedExtsForType('non-existent-type') = %v, 期望 nil", got)
	}
}

// P3 补测：损坏外部 JSON 必须回退嵌入基线（不缓存空注册表、不 panic）——
// 无测试钉住：原实现解析失败缓存空注册表，
// 进程生命周期内所有扩展名查询静默失效；回退解码用全新零值变量防混合注册表
func TestLoadRegistry_CorruptFallbackToEmbedded(t *testing.T) {
	// 损坏 JSON 写临时文件
	dir := t.TempDir()
	bad := filepath.Join(dir, "resource_types.json")
	if err := os.WriteFile(bad, []byte("{ 这不是合法 JSON !!"), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(bad)
	defer SetRegistryPath("") // 恢复默认，避免污染其他测试

	reg := LoadRegistry()
	if reg == nil {
		t.Fatal("损坏 JSON 应回退嵌入基线而非返回 nil")
	}
	// 嵌入基线含 ysm 类型 → 扩展名查询应可用（不回退成空表）
	if !IsSupportedExt(".ysm") {
		t.Error("损坏 JSON 回退嵌入基线后 .ysm 应仍被支持（不能缓存空注册表）")
	}
	if got := StorageSubDir("ysm"); got == "" {
		t.Error("损坏 JSON 回退嵌入基线后 ysm StorageSubDir 应非空")
	}
}

// ============================================================================
// 防快照守卫：禁止 instanceDir / storageSubDir 包含已废弃的壳层前缀
//
// 历史教训：21 次路径语义反复横跳，每次都是"注册表一改 → 测试快照必挂"。
// 本守卫确保：
//  1. 没有任何 instanceDir 以废弃前缀开头（mmd-skin/、{instance}、{installDir}）
//     注：3d-skin 是 MMD 类型的合法 instanceDir（ADR-094 资源树根），不作为废弃前缀
//  2. 没有任何 storageSubDir 以废弃前缀开头
//
// 只要有人再抄旧快照，此守卫直接红，让"改注册表必挂"成为历史。
// ============================================================================

// deprecatedInstanceDirPrefixes 已废弃的壳层前缀，扁平化架构下不应出现
var deprecatedInstanceDirPrefixes = []string{
	"mmd-skin/",
	"{instance}",
	"{installDir}",
}

// TestNoDeprecatedInstanceDirPrefixes 防快照守卫：instanceDir 不含废弃前缀
func TestNoDeprecatedInstanceDirPrefixes(t *testing.T) {
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		for _, prefix := range deprecatedInstanceDirPrefixes {
			if strings.HasPrefix(rt.InstanceDir, prefix) {
				t.Errorf("类型 %q 的 instanceDir %q 含废弃前缀 %q，应移除壳层",
					rt.ID, rt.InstanceDir, prefix)
			}
		}
	}
}

// TestNoDeprecatedStorageSubDirPrefixes 防快照守卫：storageSubDir 不含废弃前缀
func TestNoDeprecatedStorageSubDirPrefixes(t *testing.T) {
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		for _, prefix := range deprecatedInstanceDirPrefixes {
			if strings.HasPrefix(rt.StorageSubDir, prefix) {
				t.Errorf("类型 %q 的 storageSubDir %q 含废弃前缀 %q，应移除壳层",
					rt.ID, rt.StorageSubDir, prefix)
			}
		}
	}
}

// TestInstanceDirMatchesStorageSubDir 防快照守卫：扁平化后 instanceDir 与 storageSubDir 语义一致
// 已知例外（设计合理，非壳层残留）：
//   - ysm: instanceDir=config/yes_steve_model/custom（版本隔离无关的固定偏移）
//   - maid-model: instanceDir=tlm_custom_pack（车万女仆使用 TLM 标准目录名）
//   - litematic: instanceDir=schematics（投影复用蓝图目录）
//   - vrm: instanceDir=3d-skin（MC-MMD 资源树根），storageSubDir=VRM
//   - MMD 各类型: instanceDir=3d-skin（ADR-094 MC-MMD 资源树根），storageSubDir 各不同
func TestInstanceDirMatchesStorageSubDir(t *testing.T) {
	reg := LoadRegistry()
	knownExceptions := map[string]bool{
		"ysm":        true,
		"maid-model": true,
		"litematic":  true,
		"vrm":        true,
		// MMD 类型：instanceDir 统一为 3d-skin（MC-MMD 资源树根），storageSubDir 按用途分
		"EntityPlayer": true,
		"SceneModel":   true,
		"CustomAnim":   true,
		"CustomMorph":  true,
		"StageAnim":    true,
		"mmd-shader":   true,
		"DefaultAnim":  true,
		"DefaultMorph": true,
		// fbx: instanceDir=CustomAnim（整合包内对齐 MC-MMD 动画目录），storageSubDir=FBX（存储组织目录，与 CustomAnim 类型同名冲突故独立）
		"fbx": true,
	}
	for _, rt := range reg.ResourceTypes {
		if knownExceptions[rt.ID] {
			continue
		}
		if rt.InstanceDir != rt.StorageSubDir {
			t.Errorf("类型 %q: instanceDir=%q ≠ storageSubDir=%q，扁平化后应一致（非已知例外）",
				rt.ID, rt.InstanceDir, rt.StorageSubDir)
		}
	}
}

// ============================================================================
// mod 依赖声明（ADR-110：mod 下沉注册表，消除 Go 硬编码）
// ============================================================================

// TestModRequirementInRegistry 断言注册表含 mod 字段（jarKeywords / modId）
func TestModRequirementInRegistry(t *testing.T) {
	reg := LoadRegistry()

	// 锚点哨兵：已知类型的 mod 依赖硬编码钉死
	anchors := []struct {
		id          string
		jarKeywords []string
		modID       string
	}{
		{"ysm", []string{"yes_steve_model", "ysm-"}, ""},
		{"EntityPlayer", []string{"mmdskin", "mmd-skin"}, ""},
		{"maid-model", nil, "touhou_little_maid"},
		{"blueprint", nil, "create"},
		{"litematic", nil, "litematica"},
	}
	for _, a := range anchors {
		rt := reg.FindByID(a.id)
		if rt == nil {
			t.Fatalf("类型 %q 不存在", a.id)
		}
		if rt.Mod == nil {
			t.Errorf("类型 %q 缺少 mod 字段", a.id)
			continue
		}
		if len(a.jarKeywords) > 0 {
			if len(rt.Mod.JarKeywords) != len(a.jarKeywords) {
				t.Errorf("类型 %q jarKeywords 长度 %d，期望 %d", a.id, len(rt.Mod.JarKeywords), len(a.jarKeywords))
			}
			for i, kw := range a.jarKeywords {
				if i < len(rt.Mod.JarKeywords) && rt.Mod.JarKeywords[i] != kw {
					t.Errorf("类型 %q jarKeywords[%d] = %q，期望 %q", a.id, i, rt.Mod.JarKeywords[i], kw)
				}
			}
		}
		if a.modID != "" && rt.Mod.ModID != a.modID {
			t.Errorf("类型 %q modId = %q，期望 %q", a.id, rt.Mod.ModID, a.modID)
		}
	}
}

// TestModKeywordsFor 断言 ModKeywordsFor 从注册表查询（含组级回退）
func TestModKeywordsFor(t *testing.T) {
	// ysm：自身声明
	kws := ModKeywordsFor("ysm")
	if len(kws) == 0 {
		t.Fatal("ysm 应有 jarKeywords")
	}
	// EntityPlayer：自身声明
	kws = ModKeywordsFor("EntityPlayer")
	if len(kws) == 0 {
		t.Fatal("EntityPlayer 应有 jarKeywords")
	}
	// SceneModel：自身无声明，回退到 mmd 组
	kws = ModKeywordsFor("SceneModel")
	if len(kws) == 0 {
		t.Fatal("SceneModel 应回退到 mmd 组的 jarKeywords")
	}
	// resourcepack：无 mod 依赖，返回 nil
	kws = ModKeywordsFor("resourcepack")
	if kws != nil {
		t.Errorf("resourcepack 不应有 mod 依赖，got %v", kws)
	}
}

// TestModMetaFor 断言 ModMetaFor 从注册表查询内容检测型
func TestModMetaFor(t *testing.T) {
	modID, displayName := ModMetaFor("maid-model")
	if modID != "touhou_little_maid" {
		t.Errorf("maid-model modId = %q，期望 touhou_little_maid", modID)
	}
	if displayName != "Touhou Little Maid" {
		t.Errorf("maid-model displayName = %q，期望 Touhou Little Maid", displayName)
	}
	// ysm：非内容检测型
	modID, _ = ModMetaFor("ysm")
	if modID != "" {
		t.Errorf("ysm 不应有 modId，got %q", modID)
	}
}
