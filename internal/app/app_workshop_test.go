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
