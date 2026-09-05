// ===== app_workshop.go 薄壳级单测（零测试层补测）=====
// 覆盖：readJSONFile BOM/解析 / defaultWorkshopSites 默认站点契约 /
// CSV 导出格式 / CSV 导入校验（空/少行/坏行跳过）/ 工坊配置落点桥接（configDir）。
// workshopSitesPath 已桥接至用户配置根（configDir），测试经 fakePathMgr 注入临时目录隔离，
// 避免写入真实 AppData / exe 旁（ADR-046 P2）。
package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

func TestReadJSONFile_BOMTrim(t *testing.T) {
	dir := t.TempDir()

	t.Run("带 BOM 的 JSON 正常解析", func(t *testing.T) {
		p := filepath.Join(dir, "bom.json")
		// UTF-8 BOM: EF BB BF
		if err := os.WriteFile(p, []byte{0xEF, 0xBB, 0xBF, '{', '}', '\n'}, 0o644); err != nil {
			t.Fatal(err)
		}
		var v map[string]int
		if err := readJSONFile(p, &v); err != nil {
			t.Fatalf("带 BOM JSON 解析失败: %v", err)
		}
	})

	t.Run("无 BOM 正常解析", func(t *testing.T) {
		p := filepath.Join(dir, "plain.json")
		if err := os.WriteFile(p, []byte(`{"a":1}`), 0o644); err != nil {
			t.Fatal(err)
		}
		var v map[string]int
		if err := readJSONFile(p, &v); err != nil {
			t.Fatalf("普通 JSON 解析失败: %v", err)
		}
		if v["a"] != 1 {
			t.Errorf("解析值错误, got %v", v)
		}
	})

	t.Run("损坏 JSON 返回错误", func(t *testing.T) {
		p := filepath.Join(dir, "broken.json")
		if err := os.WriteFile(p, []byte("{oops"), 0o644); err != nil {
			t.Fatal(err)
		}
		var v map[string]int
		if err := readJSONFile(p, &v); err == nil {
			t.Error("损坏 JSON 应返回错误")
		}
	})

	t.Run("文件不存在返回错误", func(t *testing.T) {
		var v map[string]int
		if err := readJSONFile(filepath.Join(dir, "missing.json"), &v); err == nil {
			t.Error("不存在的文件应返回错误")
		}
	})
}

func TestDefaultWorkshopSites_Contract(t *testing.T) {
	sites := defaultWorkshopSites()
	if len(sites) < 2 {
		t.Fatalf("默认站点应 >=2, got %d", len(sites))
	}

	// 契约：每个站点 id/url/searchUrl 非空、group 合法、SearchURL 含 {{q}} 占位符
	seen := map[string]bool{}
	for _, s := range sites {
		if s.ID == "" || s.URL == "" || s.Label == "" {
			t.Errorf("站点字段缺失: %+v", s)
		}
		if seen[s.ID] {
			t.Errorf("站点 ID 重复: %s", s.ID)
		}
		seen[s.ID] = true
		if s.Group != "search" && s.Group != "repo" {
			t.Errorf("group 非法: %q", s.Group)
		}
		if !strings.Contains(s.SearchURL, "{{q}}") {
			t.Errorf("SearchURL 应含 {{q}} 占位符: %q", s.SearchURL)
		}
	}
}

// 平台数据根缺失（pathMgr=nil）时，工坊配置落点应为空串且写操作 fail-fast，
// 绝不在 CWD 留下文件（与 TestConfigDir_NoRelativeFallback / TestAvatarCacheDirEmpty_NoOp 同构）。
func TestWorkshopConfigDirEmpty_NoOp(t *testing.T) {
	orig := pathMgr
	pathMgr = nil
	defer func() { pathMgr = orig }()

	if p := workshopSitesPath(); p != "" {
		t.Errorf("平台数据根缺失时 workshopSitesPath 应为空串, got %q", p)
	}
	if p := creatorsPath(); p != "" {
		t.Errorf("平台数据根缺失时 creatorsPath 应为空串, got %q", p)
	}
	// 写应 fail-fast，不落盘到 CWD
	if err := (&App{}).SaveWorkshopSites([]types.WorkshopSite{{ID: "x"}}); err == nil {
		t.Error("configDir 为空时 SaveWorkshopSites 应失败")
	}
	if err := (&App{}).SaveWorkshopCreators(nil); err == nil {
		t.Error("configDir 为空时 SaveWorkshopCreators 应失败")
	}
	if _, statErr := os.Stat("workshop_sites.json"); !os.IsNotExist(statErr) {
		t.Error("不应在 CWD 写入 workshop_sites.json")
		os.Remove("workshop_sites.json")
	}
	if _, statErr := os.Stat("creators.json"); !os.IsNotExist(statErr) {
		t.Error("不应在 CWD 写入 creators.json")
		os.Remove("creators.json")
	}
}

// 工坊配置写入应落到用户配置根（configDir），而非 exe 旁。
func TestWorkshopConfigWriteToConfigDir(t *testing.T) {
	dir := t.TempDir()
	orig := pathMgr
	pathMgr = fakePathMgr{appData: dir}
	defer func() { pathMgr = orig }()

	sites := []types.WorkshopSite{{ID: "bilibili", Label: "B站", URL: "https://bilibili.com/"}}
	if err := (&App{}).SaveWorkshopSites(sites); err != nil {
		t.Fatalf("SaveWorkshopSites 失败: %v", err)
	}
	p := filepath.Join(dir, "YSM-Model-Manager", "workshop_sites.json")
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("应写入 configDir, got %v", err)
	}
	var got []types.WorkshopSite
	if err := json.Unmarshal(data, &got); err != nil || len(got) != 1 || got[0].ID != "bilibili" {
		t.Fatalf("写入内容异常: %v / %+v", err, got)
	}
	// 不应写入 exe 旁
	exe, _ := os.Executable()
	if _, err := os.Stat(filepath.Join(filepath.Dir(exe), "workshop_sites.json")); !os.IsNotExist(err) {
		t.Error("不应写入 exe 旁 workshop_sites.json")
		os.Remove(filepath.Join(filepath.Dir(exe), "workshop_sites.json"))
	}
}

// 旧 exe 旁配置应迁移到 configDir，且旧文件被清理。
func TestWorkshopConfigMigrateFromExe(t *testing.T) {
	dir := t.TempDir()
	orig := pathMgr
	pathMgr = fakePathMgr{appData: dir}
	defer func() { pathMgr = orig }()

	exe, _ := os.Executable()
	oldPath := filepath.Join(filepath.Dir(exe), "creators.json")
	oldData := []byte(`[{"name":"legacy-author","type":"bilibili"}]`)
	if err := os.WriteFile(oldPath, oldData, 0o644); err != nil {
		t.Skipf("无法在 exe 旁写入测试文件（权限）: %v", err)
	}
	defer os.Remove(oldPath)

	list := (&App{}).LoadWorkshopCreators()
	newPath := filepath.Join(dir, "YSM-Model-Manager", "creators.json")
	if _, err := os.Stat(newPath); err != nil {
		t.Fatalf("应迁移到 configDir, got %v", err)
	}
	if len(list) != 1 || list[0].Name != "legacy-author" {
		t.Fatalf("应读到迁移后的数据, got %+v", list)
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Error("旧 exe 旁文件应被清理")
	}
}

// 全新用户无 creators.json（数据走 bundled 兜底）：备份应视为「无数据可备份」
// 返回成功，否则 Merge/Replace/Reset 首次使用全部中止（R22 审核 P2-1，
// 与 web 桥 web-community.ts 无备份步骤直接合并的行为对齐）。
func TestBackupWorkshopCreators_NoFile(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	bakPath, err := (&App{}).BackupWorkshopCreators()
	if err != nil {
		t.Fatalf("creators.json 不存在时备份应成功（无数据可备份），got %v", err)
	}
	if bakPath != "" {
		t.Errorf("无数据可备份时应返回空路径, got %q", bakPath)
	}
}

// 全新用户拖拽导入创作者 JSON 应成功（P2-1 修复验证）：
// MergeWorkshopCreatorsFromJSON 前置备份在无用户配置时不再中止。
// 注：Merge 尾部「合并后 >=100 条」完整性下限依赖 bundled 基线（生产内联
// >=100 条）；测试环境无 bundled，故导入 100 条直接过闸。
func TestMergeWorkshopCreatorsFromJSON_FreshUser(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	imported := make([]types.WorkshopCreator, 100)
	for i := range imported {
		imported[i] = types.WorkshopCreator{Name: fmt.Sprintf("creator-%d", i), Type: "bilibili"}
	}
	data, err := json.Marshal(imported)
	if err != nil {
		t.Fatal(err)
	}
	added, updated, err := a.MergeWorkshopCreatorsFromJSON(string(data))
	if err != nil {
		t.Fatalf("全新用户首次 Merge 不应失败（P2-1），got %v", err)
	}
	if added+updated != 100 {
		t.Fatalf("100 条导入应全部计入 added/updated, got added=%d updated=%d", added, updated)
	}
	// 合并后已落盘（可读回）
	if got := len(a.LoadWorkshopCreators()); got < 100 {
		t.Fatalf("合并后应可读回 >=100 条, got %d", got)
	}
}

// Type 分号分隔精确段匹配（R22 审核 P3-1）：siteID="a" 不得误删 Type="ba" /
// "ba;c" 的创作者（原裸 Contains(c.Type, "a;") 真子串误判），但 "a" / "a;b" /
// "b;a" 应被精确段匹配移除。
func TestSaveWorkshopCreatorsBySite_TypeSegmentMatch(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	seed := []types.WorkshopCreator{
		{Name: "ba-only", Type: "ba"}, // 防误删对象（原缺陷会误删）
		{Name: "ba-c", Type: "ba;c"},  // 防误删对象（原缺陷会误删）
		{Name: "a-only", Type: "a"},   // 应移除
		{Name: "a-b", Type: "a;b"},    // 应移除
		{Name: "b-a", Type: "b;a"},    // 应移除
	}
	if err := a.SaveWorkshopCreators(seed); err != nil {
		t.Fatal(err)
	}
	if err := a.SaveWorkshopCreatorsBySite("a", []types.WorkshopCreator{{Name: "a-new", Type: "a"}}); err != nil {
		t.Fatal(err)
	}
	got := a.LoadWorkshopCreators()
	names := map[string]bool{}
	for _, c := range got {
		names[c.Name] = true
	}
	for _, survive := range []string{"ba-only", "ba-c"} {
		if !names[survive] {
			t.Errorf("%q（Type 不含精确段 \"a\"）不应被 siteID=\"a\" 误删", survive)
		}
	}
	for _, removed := range []string{"a-only", "a-b", "b-a"} {
		if names[removed] {
			t.Errorf("Type 含精确段 \"a\" 的 %q 应被移除", removed)
		}
	}
	if !names["a-new"] {
		t.Error("新站点创作者应写入")
	}
}

// ADR-172：社区索引增量并入——type 分号段并入（非覆盖，不丢站点）+ desc 空补 +
// 新增计数 + 单次落盘。种子含 A(type bilibili)/A2(type bilibili;ba)/B，
// 社区含 A(type 增 afdian, desc 补)/A2(type 已含不重复)/C(新增)。
func TestMergeCommunityCreatorsFromJSON_SegmentMerge(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	seed := []types.WorkshopCreator{
		{Name: "A", Type: "bilibili"},
		{Name: "A2", Type: "bilibili;ba"},
		{Name: "B", Type: "afdian"},
	}
	if err := a.SaveWorkshopCreators(seed); err != nil {
		t.Fatal(err)
	}
	community := []types.WorkshopCreator{
		{Name: "A", Type: "bilibili;afdian", Desc: "社区补充描述"},
		{Name: "A2", Type: "bilibili;ba;afdian"},
		{Name: "C", Type: "github", Desc: "新创作者"},
	}
	data, err := json.Marshal(community)
	if err != nil {
		t.Fatal(err)
	}
	added, updated, err := a.MergeCommunityCreatorsFromJSON(string(data))
	if err != nil {
		t.Fatalf("社区合并不应失败, got %v", err)
	}
	if added != 1 || updated != 2 {
		t.Fatalf("期望 added=1 updated=2, got added=%d updated=%d", added, updated)
	}
	got := a.LoadWorkshopCreators()
	byName := map[string]types.WorkshopCreator{}
	for _, c := range got {
		byName[c.Name] = c
	}
	if len(got) != 4 {
		t.Fatalf("合并后应有 4 条（A/A2/B/C 无重复）, got %d", len(got))
	}
	// A：type 段并入 afdian（覆盖会丢本地段，此处验证并入不丢）
	aCreator, ok := byName["A"]
	if !ok {
		t.Fatal("A 应保留")
	}
	if aCreator.Type != "bilibili;afdian" && aCreator.Type != "afdian;bilibili" {
		t.Errorf("A.type 应含 bilibili+afdian 两段且不重复, got %q", aCreator.Type)
	}
	if aCreator.Desc != "社区补充描述" {
		t.Errorf("A.desc 空时应被社区 desc 补充, got %q", aCreator.Desc)
	}
	// A2：段并入幂等——afdian 段新增, bilibili/ba 段不重复
	a2Creator := byName["A2"]
	for _, seg := range []string{"bilibili", "ba", "afdian"} {
		if !inTypeSegments(a2Creator.Type, seg) {
			t.Errorf("A2.type %q 应含段 %q", a2Creator.Type, seg)
		}
	}
	// B：社区未提及，原样保留
	if b, ok := byName["B"]; !ok || b.Type != "afdian" {
		t.Errorf("B 应原样保留, got %+v ok=%v", b, ok)
	}
	// C：新增
	if c, ok := byName["C"]; !ok || c.Type != "github" {
		t.Errorf("C 应新增, got %+v ok=%v", c, ok)
	}
}

// 幂等：同社区索引再并一次 → added=0 updated=0，落盘不膨胀。
func TestMergeCommunityCreatorsFromJSON_Idempotent(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	seed := []types.WorkshopCreator{{Name: "A", Type: "bilibili"}}
	if err := a.SaveWorkshopCreators(seed); err != nil {
		t.Fatal(err)
	}
	community := []types.WorkshopCreator{{Name: "A", Type: "bilibili;afdian"}, {Name: "B", Type: "github"}}
	data, _ := json.Marshal(community)
	if _, _, err := a.MergeCommunityCreatorsFromJSON(string(data)); err != nil {
		t.Fatal(err)
	}
	// 第二次并入同样社区：A 段已含、B 已存在 → 零变更
	added, updated, err := a.MergeCommunityCreatorsFromJSON(string(data))
	if err != nil {
		t.Fatal(err)
	}
	if added != 0 || updated != 0 {
		t.Fatalf("幂等并入应 added=0 updated=0, got added=%d updated=%d", added, updated)
	}
	if got := len(a.LoadWorkshopCreators()); got != 2 {
		t.Fatalf("幂等并入后仍应 2 条, got %d", got)
	}
}

// 净化：name 为空/非法的社区条目被过滤；全非法 → 报错不落盘。
func TestMergeCommunityCreatorsFromJSON_EmptyInput(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	if _, _, err := a.MergeCommunityCreatorsFromJSON("[]"); err == nil {
		t.Error("空数组应报错")
	}
	if _, _, err := a.MergeCommunityCreatorsFromJSON(`[{"name":"","type":"x"}]`); err == nil {
		t.Error("全非法条目（name 空）应报错")
	}
	if _, _, err := a.MergeCommunityCreatorsFromJSON(`not-json`); err == nil {
		t.Error("非法 JSON 应报错")
	}
	// 混合：1 条合法 + 1 条非法 → 合法者并入
	if _, _, err := a.MergeCommunityCreatorsFromJSON(`[{"name":"","type":"x"},{"name":"OK","type":"bilibili"}]`); err != nil {
		t.Fatalf("含合法条目的混合输入不应失败, got %v", err)
	}
	got := a.LoadWorkshopCreators()
	if len(got) != 1 || got[0].Name != "OK" {
		t.Errorf("仅合法条目应并入, got %+v", got)
	}
}

// 全新用户（无用户配置 creators.json，bundled 兜底路径）：社区合并不应中止。
func TestMergeCommunityCreatorsFromJSON_FreshUser(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	community := []types.WorkshopCreator{{Name: "A", Type: "bilibili"}, {Name: "B", Type: "afdian"}}
	data, _ := json.Marshal(community)
	added, updated, err := a.MergeCommunityCreatorsFromJSON(string(data))
	if err != nil {
		t.Fatalf("全新用户社区合并不应失败, got %v", err)
	}
	if added != 2 || updated != 0 {
		t.Fatalf("期望 added=2 updated=0, got added=%d updated=%d", added, updated)
	}
	if got := len(a.LoadWorkshopCreators()); got != 2 {
		t.Fatalf("全新用户并入后应 2 条, got %d", got)
	}
}

// 全新用户拖拽导入站点 JSON：全部新增（added=N），落盘可读回。
func TestMergeWorkshopSitesFromJSON_FreshUser(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	imported := []types.WorkshopSite{
		{ID: "bilibili", Label: "B站", URL: "https://www.bilibili.com/"},
		{ID: "afdian", Label: "爱发电", URL: "https://afdian.com/"},
	}
	data, _ := json.Marshal(imported)
	added, updated, err := a.MergeWorkshopSitesFromJSON(string(data))
	if err != nil {
		t.Fatalf("全新用户首次 Merge 不应失败, got %v", err)
	}
	// 基准 = bundled 默认站（bilibili/afdian/github）：导入的两个默认站 id 命中
	// 同值/同 id → updated（DeepEqual 判定变更），github 保留——默认站不被抹掉
	//（code_review 31d30fb7 #1：空基准会让首次部分导入静默删除未出现的默认站）
	if added != 0 || updated != 2 {
		t.Fatalf("期望 added=0 updated=2（命中默认站）, got added=%d updated=%d", added, updated)
	}
	// 落盘验证：读回 workshop_sites.json（无独立 LoadWorkshopSites，直接读文件）
	p := workshopSitesPath()
	var got []types.WorkshopSite
	if err := readJSONFile(p, &got); err != nil {
		t.Fatalf("合并后读回失败: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("落盘应 3 条（默认站全保留）, got %d", len(got))
	}
	githubFound := false
	for _, s := range got {
		if s.ID == "github" {
			githubFound = true
		}
	}
	if !githubFound {
		t.Fatal("默认站 github 应保留（未被部分导入抹掉）")
	}
}

// TestMergeWorkshopSitesFromJSON_FreshUser_CustomSite 全新用户导入不含默认站的自定义站：
// 默认站保留 + 自定义站追加（added=1），落盘 4 条。
func TestMergeWorkshopSitesFromJSON_FreshUser_CustomSite(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	imported := []types.WorkshopSite{
		{ID: "my-custom", Label: "自建站", URL: "https://custom.test"},
	}
	data, _ := json.Marshal(imported)
	added, updated, err := a.MergeWorkshopSitesFromJSON(string(data))
	if err != nil {
		t.Fatalf("Merge 不应失败, got %v", err)
	}
	if added != 1 || updated != 0 {
		t.Fatalf("期望 added=1 updated=0, got added=%d updated=%d", added, updated)
	}
	p := workshopSitesPath()
	var got []types.WorkshopSite
	if err := readJSONFile(p, &got); err != nil {
		t.Fatalf("合并后读回失败: %v", err)
	}
	if len(got) != 4 {
		t.Fatalf("落盘应 4 条（3 默认 + 1 自定义）, got %d", len(got))
	}
}

// TestMergeWorkshopSitesFromJSON_SingleSiteRejected 单站拖入（合并结果 1 条 < 2 合法域）
// 必须拒绝且不写盘（对齐 ValidateWorkshopSites 2-100 边界，code_review 31d30fb7 #2）。
func TestMergeWorkshopSitesFromJSON_SingleSiteRejected(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	// 预置一个「自定义站点文件」（模拟已有单站配置），文件存在 → 基准 = 该文件
	seed := []types.WorkshopSite{{ID: "solo", Label: "独站", URL: "https://solo.test"}}
	if err := a.SaveWorkshopSites(seed); err != nil {
		t.Fatal(err)
	}
	// 再拖入同 id 新值：合并后仍 1 条 → 越界拒绝，文件不得被写坏
	incoming := []types.WorkshopSite{{ID: "solo", Label: "独站改", URL: "https://solo2.test"}}
	data, _ := json.Marshal(incoming)
	if _, _, err := a.MergeWorkshopSitesFromJSON(string(data)); err == nil {
		t.Fatal("单站合并结果应被拒绝（<2 合法域下限）")
	}
	// 文件不应被覆盖成非法态之外的意外内容（此处保持原 seed）
	var got []types.WorkshopSite
	if err := readJSONFile(workshopSitesPath(), &got); err != nil {
		t.Fatalf("读回失败: %v", err)
	}
	if len(got) != 1 || got[0].Label != "独站" {
		t.Fatalf("拒绝后文件应保持原状, got %+v", got)
	}
}

// TestMergeWorkshopSitesFromJSON_OverLimitRejected 超 100 站拖入（合并结果 > 100）
// 必须拒绝且不写盘（code_review 31d30fb7 #3）。
func TestMergeWorkshopSitesFromJSON_OverLimitRejected(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	// 预置 99 站，再拖入 2 个新站 → 合并 101 > 100 上限
	seed := make([]types.WorkshopSite, 0, 99)
	for i := 0; i < 99; i++ {
		seed = append(seed, types.WorkshopSite{ID: fmt.Sprintf("seed-%02d", i), Label: "s", URL: "https://s.test"})
	}
	if err := a.SaveWorkshopSites(seed); err != nil {
		t.Fatal(err)
	}
	incoming := []types.WorkshopSite{
		{ID: "extra-1", Label: "x1", URL: "https://x1.test"},
		{ID: "extra-2", Label: "x2", URL: "https://x2.test"},
	}
	data, _ := json.Marshal(incoming)
	if _, _, err := a.MergeWorkshopSitesFromJSON(string(data)); err == nil {
		t.Fatal("101 站合并结果应被拒绝（>100 上限）")
	}
	// 文件保持 99 站原状
	var got []types.WorkshopSite
	if err := readJSONFile(workshopSitesPath(), &got); err != nil {
		t.Fatalf("读回失败: %v", err)
	}
	if len(got) != 99 {
		t.Fatalf("拒绝后文件应保持 99 条, got %d", len(got))
	}
}

// TestMergeWorkshopSitesFromJSON_IdempotentNoWrite 幂等短路：同内容重复拖入
// （同 id 同值）→ 不备份不写盘（changed=false 早退，对齐 ADR-172 §2 社区合并）。
func TestMergeWorkshopSitesFromJSON_IdempotentNoWrite(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	seed := []types.WorkshopSite{{ID: "s1", Label: "站点1", URL: "https://s1.test"}}
	if err := a.SaveWorkshopSites(seed); err != nil {
		t.Fatal(err)
	}
	// 首次拖入扩展：s2 追加 → added=1 写盘
	incoming := []types.WorkshopSite{{ID: "s2", Label: "站点2", URL: "https://s2.test"}}
	data, _ := json.Marshal(incoming)
	if _, _, err := a.MergeWorkshopSitesFromJSON(string(data)); err != nil {
		t.Fatalf("首次合并不应失败: %v", err)
	}
	// 幂等重拖同一内容：s1 已存在同值、无新增 → changed=false → 不写盘不报错
	if _, _, err := a.MergeWorkshopSitesFromJSON(string(data)); err != nil {
		t.Fatalf("幂等重拖不应失败: %v", err)
	}
	var got []types.WorkshopSite
	if err := readJSONFile(workshopSitesPath(), &got); err != nil {
		t.Fatalf("读回失败: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("幂等重拖后文件应保持 2 条, got %d", len(got))
	}
}

// 已存在站点时导入：同 id 整条覆盖（updated），新 id 追加（added）。
func TestMergeWorkshopSitesFromJSON_OverwriteAndAdd(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	seed := []types.WorkshopSite{{ID: "s1", Label: "旧名", URL: "https://old.test"}}
	if err := a.SaveWorkshopSites(seed); err != nil {
		t.Fatal(err)
	}
	incoming := []types.WorkshopSite{
		{ID: "s1", Label: "新名", URL: "https://new.test"}, // 命中 → 覆盖
		{ID: "s2", Label: "新站", URL: "https://s2.test"},  // 未命中 → 追加
	}
	data, _ := json.Marshal(incoming)
	added, updated, err := a.MergeWorkshopSitesFromJSON(string(data))
	if err != nil {
		t.Fatalf("Merge 不应失败, got %v", err)
	}
	if added != 1 || updated != 1 {
		t.Fatalf("期望 added=1 updated=1, got added=%d updated=%d", added, updated)
	}
	p := workshopSitesPath()
	var got []types.WorkshopSite
	if err := readJSONFile(p, &got); err != nil {
		t.Fatalf("读回失败: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("落盘应 2 条, got %d", len(got))
	}
	// 覆盖生效：s1 是导入的新值（非旧 seed）
	found := false
	for _, s := range got {
		if s.ID == "s1" {
			found = true
			if s.Label != "新名" || s.URL != "https://new.test" {
				t.Fatalf("s1 应被导入值覆盖, got %+v", s)
			}
		}
	}
	if !found {
		t.Fatal("落盘缺 s1")
	}
}

// 非法输入报错：非 JSON / 全空 id（净化后 0 条）。
func TestMergeWorkshopSitesFromJSON_Invalid(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	if _, _, err := a.MergeWorkshopSitesFromJSON("not-json"); err == nil {
		t.Error("非 JSON 应报错")
	}
	if _, _, err := a.MergeWorkshopSitesFromJSON(`[{"label":"无 id"}]`); err == nil {
		t.Error("全空 id（净化后 0 条）应报错")
	}
}

// 现有用户配置损坏 → 中止（不静默置空覆盖用户数据）。
func TestMergeWorkshopSitesFromJSON_CorruptExistingAborts(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	// 写一个损坏的 workshop_sites.json
	p := workshopSitesPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("{oops"), 0o644); err != nil {
		t.Fatal(err)
	}
	imported := []types.WorkshopSite{{ID: "s1", Label: "新站", URL: "https://s1.test"}}
	data, _ := json.Marshal(imported)
	if _, _, err := a.MergeWorkshopSitesFromJSON(string(data)); err == nil {
		t.Error("现有配置损坏应中止合并（不得覆盖）")
	}
	// 损坏文件原样保留
	got, _ := os.ReadFile(p)
	if string(got) != "{oops" {
		t.Errorf("损坏配置应原样保留, got %q", string(got))
	}
}

// 社区站点合并：仅增不覆盖（id 未命中追加 / 命中跳过本地自定义）。
func TestMergeCommunitySitesFromJSON_AddOnly(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	// 用户已有自定义站点 s1（Label 用户改过）
	if err := a.SaveWorkshopSites([]types.WorkshopSite{{ID: "s1", Label: "用户自定义", URL: "https://custom"}}); err != nil {
		t.Fatal(err)
	}
	// 社区索引含 s1（本地已有 → 跳过）+ s2/s3（新增）
	community := []types.WorkshopSite{
		{ID: "s1", Label: "社区覆盖名", URL: "https://community"}, // 不应覆盖
		{ID: "s2", Label: "社区新站", URL: "https://s2"},
		{ID: "s3", Label: "社区新站3", URL: "https://s3"},
	}
	data, _ := json.Marshal(community)
	added, err := a.MergeCommunitySitesFromJSON(string(data))
	if err != nil {
		t.Fatalf("社区合并不应失败, got %v", err)
	}
	if added != 2 {
		t.Fatalf("期望 added=2（s2/s3），s1 命中跳过, got %d", added)
	}
	// 落盘验证：s1 保留用户自定义值（未被社区覆盖）
	p := workshopSitesPath()
	var got []types.WorkshopSite
	if err := readJSONFile(p, &got); err != nil {
		t.Fatalf("读回失败: %v", err)
	}
	for _, s := range got {
		if s.ID == "s1" && s.Label != "用户自定义" {
			t.Fatalf("s1 不应被社区覆盖, got %+v", s)
		}
	}
}

// 社区索引与本地全同（幂等）→ added=0，不写盘（无 .bak/无变化）。
func TestMergeCommunitySitesFromJSON_Idempotent(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	if err := a.SaveWorkshopSites([]types.WorkshopSite{{ID: "s1", Label: "站", URL: "https://s1"}}); err != nil {
		t.Fatal(err)
	}
	community := []types.WorkshopSite{{ID: "s1", Label: "站", URL: "https://s1"}}
	data, _ := json.Marshal(community)
	added, err := a.MergeCommunitySitesFromJSON(string(data))
	if err != nil {
		t.Fatalf("幂等合并不应失败, got %v", err)
	}
	if added != 0 {
		t.Fatalf("全同应 added=0（幂等短路）, got %d", added)
	}
}

// 非法输入报错：非 JSON / 全空 id。
func TestMergeCommunitySitesFromJSON_Invalid(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	if _, err := a.MergeCommunitySitesFromJSON("not-json"); err == nil {
		t.Error("非 JSON 应报错")
	}
	if _, err := a.MergeCommunitySitesFromJSON(`[{"label":"无 id"}]`); err == nil {
		t.Error("全空 id（净化后 0 条）应报错")
	}
}
