// ===== app_workshop.go 薄壳级单测（零测试层补测）=====
// 覆盖：readJSONFile BOM/解析 / defaultWorkshopSites 默认站点契约 /
// CSV 导出格式 / CSV 导入校验（空/少行/坏行跳过）/ 工坊配置落点桥接（configDir）。
// workshopSitesPath 已桥接至用户配置根（configDir），测试经 fakePathMgr 注入临时目录隔离，
// 避免写入真实 AppData / exe 旁（ADR-046 P2）。
package app

import (
	"encoding/json"
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

func TestExportWorkshopSitesCSV_Format(t *testing.T) {
	a := repoApp(t, types.AppConfig{})
	csvStr, err := a.ExportWorkshopSitesCSV()
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(csvStr), "\n")
	// 表头 + N 行站点
	if len(lines) < 3 {
		t.Fatalf("CSV 应含表头+至少2行, got %d 行", len(lines))
	}
	header := strings.Split(lines[0], ",")
	wantHeader := []string{"id", "icon", "label", "url", "desc", "group", "searchUrl"}
	if len(header) != len(wantHeader) {
		t.Fatalf("CSV 表头列数不符: got %v", header)
	}
	for i, h := range wantHeader {
		if header[i] != h {
			t.Errorf("表头第 %d 列 = %q, 期望 %q", i, header[i], h)
		}
	}
}

func TestImportWorkshopSitesCSV_Validation(t *testing.T) {
	// 隔离落点：注入临时配置根，避免写入真实 AppData（workshopSitesPath 现走 configDir）
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})

	t.Run("空内容报错", func(t *testing.T) {
		if err := a.ImportWorkshopSitesCSV(""); err == nil {
			t.Error("空 CSV 应报错")
		}
	})

	t.Run("只有表头报错", func(t *testing.T) {
		if err := a.ImportWorkshopSitesCSV("id,icon,label,url,desc,group,searchUrl\n"); err == nil {
			t.Error("只有表头的 CSV 应报错")
		}
	})

	t.Run("全有效行导入成功", func(t *testing.T) {
		// 字段数须与表头一致（csv.ReadAll 对不一致行直接报错，非跳过）
		content := "id,icon,label,url,desc,group,searchUrl\n" +
			"bilibili,📺,B站,https://bilibili.com/,desc,search,https://search?q={{q}}\n" +
			"github,🐙,GitHub,https://github.com/,desc,repo,\n"
		// SaveWorkshopSites 会写 workshopSitesPath()（exe 相对）——测试环境 exe 目录可写
		if err := a.ImportWorkshopSitesCSV(content); err != nil {
			t.Fatalf("合法 CSV 导入失败: %v", err)
		}
	})
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

func TestDefaultWorkshopSitesRemovesLegacyYSMHubEntry(t *testing.T) {
	dir := t.TempDir()
	orig := pathMgr
	pathMgr = fakePathMgr{appData: dir}
	defer func() { pathMgr = orig }()

	configDirPath := filepath.Join(dir, "YSM-Model-Manager")
	if err := os.MkdirAll(configDirPath, 0o755); err != nil {
		t.Fatal(err)
	}
	data := []byte(`[{"id":"ysmhub","label":"YSM Hub","url":"https://ysmhub.top/"},{"id":"bilibili","label":"B站","url":"https://bilibili.com/"}]`)
	if err := os.WriteFile(filepath.Join(configDirPath, "workshop_sites.json"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	sites := (&App{}).DefaultWorkshopSites()
	for _, site := range sites {
		if site.ID == "ysmhub" {
			t.Fatal("legacy ysmhub entry should not appear in creator channel")
		}
	}
	if len(sites) != 1 || sites[0].ID != "bilibili" {
		t.Fatalf("unexpected filtered workshop sites: %+v", sites)
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
