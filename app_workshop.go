// ========== 创意工坊配置（站点 + 创作者） ==========
// 从 app.go 拆分：工坊站点和创作者的 CRUD + 导入导出
package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/types"
)

// atomicWrite 原子写入：写 tmp → rename，防崩溃半写
func atomicWrite(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ========== 创意工坊站点配置 ==========
func workshopSitesPath() string {
	exe, _ := os.Executable()
	return findConfigFile(
		filepath.Join(filepath.Dir(exe), "workshop_sites.json"),
		filepath.Join(filepath.Dir(exe), "..", "workshop_sites.json"),
		"workshop_sites.json",
	)
}

func readJSONFile(path string, v interface{}) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	return json.Unmarshal(data, v)
}

func (a *App) LoadWorkshopSites() []types.WorkshopSite {
	var sites []types.WorkshopSite
	if err := readJSONFile(workshopSitesPath(), &sites); err != nil {
		return defaultWorkshopSites()
	}
	return sites
}

func (a *App) SaveWorkshopSites(sites []types.WorkshopSite) error {
	data, err := json.MarshalIndent(sites, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(workshopSitesPath(), data)
}

func defaultWorkshopSites() []types.WorkshopSite {
	return []types.WorkshopSite{
		{
			ID: "bilibili", Icon: "📺", Label: "B站", URL: "https://www.bilibili.com/",
			Desc: "搜索模型创作者和模型展示", Group: "search",
			SearchURL: "https://search.bilibili.com/all?keyword={{q}}",
			PresetSearches: []types.WorkshopPresetSearch{
				{Label: "免费模型", Q: "ysm模型免费分享"},
				{Label: "付费模型", Q: "ysm模型展示"},
			},
		},
		{
			ID: "afdian", Icon: "❤️", Label: "爱发电", URL: "https://afdian.com/",
			Desc: "赞助创作者平台", Group: "search",
			SearchURL: "https://afdian.com/search?q={{q}}",
			PresetSearches: []types.WorkshopPresetSearch{
				{Label: "作者搜索", Q: "碎de帆"},
				{Label: "付费模型", Q: "YSM"},
			},
		},
		{
			ID: "github", Icon: "🐙", Label: "GitHub", URL: "https://github.com/",
			Desc: "免费模型仓库（前置）", Group: "repo",
			SearchURL: "https://github.com/search?q={{q}}",
		},
	}
}

// ========== 创意工坊创作者配置 ==========
func creatorsPath() string {
	exe, _ := os.Executable()
	return findConfigFile(
		filepath.Join(filepath.Dir(exe), "creators.json"),
		filepath.Join(filepath.Dir(exe), "..", "creators.json"),
		"creators.json",
	)
}

func (a *App) LoadWorkshopCreators() []types.WorkshopCreator {
	var list []types.WorkshopCreator
	if err := readJSONFile(creatorsPath(), &list); err != nil {
		return nil
	}
	return list
}

func (a *App) SaveWorkshopCreators(list []types.WorkshopCreator) error {
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(creatorsPath(), data)
}

// SaveWorkshopCreatorsBySite 只替换指定站点的创作者，其他站点不动
func (a *App) SaveWorkshopCreatorsBySite(siteID string, siteCreators []types.WorkshopCreator) error {
	all := a.LoadWorkshopCreators()
	// 移除该站点的旧条目
	var kept []types.WorkshopCreator
	for _, c := range all {
		if c.Type == siteID || strings.Contains(c.Type, siteID+";") || strings.HasSuffix(c.Type, ";"+siteID) {
			continue
		}
		kept = append(kept, c)
	}
	// 追加新条目
	kept = append(kept, siteCreators...)
	return a.SaveWorkshopCreators(kept)
}

// SaveWorkshopPresetsBySite 只替换指定站点的搜索词，其他站点不动
func (a *App) SaveWorkshopPresetsBySite(siteID string, presets []types.WorkshopPresetSearch) error {
	sites := a.LoadWorkshopSites()
	for i, s := range sites {
		if s.ID == siteID {
			sites[i].PresetSearches = presets
			return a.SaveWorkshopSites(sites)
		}
	}
	return nil
}

// ========== GitHub 仓库配置 ==========
func workshopGitHubPath() string {
	exe, _ := os.Executable()
	return findConfigFile(
		filepath.Join(filepath.Dir(exe), "workshop_gitHub.json"),
		filepath.Join(filepath.Dir(exe), "..", "workshop_gitHub.json"),
		"workshop_gitHub.json",
	)
}

func (a *App) LoadGitHubRepos() []types.WorkshopCreator {
	var list []types.WorkshopCreator
	if err := readJSONFile(workshopGitHubPath(), &list); err != nil {
		return nil
	}
	return list
}

func (a *App) ResetWorkshopConfigs() ([]types.WorkshopSite, error) {
	sites := defaultWorkshopSites()
	data, _ := json.MarshalIndent(sites, "", "  ")
	if err := os.WriteFile(workshopSitesPath(), data, 0644); err != nil {
		return nil, err
	}
	os.Remove(creatorsPath())
	return sites, nil
}

// ========== CSV 导出/导入 ==========
func (a *App) ExportWorkshopSitesCSV() (string, error) {
	sites := a.LoadWorkshopSites()
	var buf strings.Builder
	w := csv.NewWriter(&buf)
	w.Write([]string{"id", "icon", "label", "url", "desc", "group", "searchUrl"})
	for _, s := range sites {
		w.Write([]string{s.ID, s.Icon, s.Label, s.URL, s.Desc, s.Group, s.SearchURL})
	}
	w.Flush()
	return buf.String(), w.Error()
}

func (a *App) ExportWorkshopSitesJSONFile() (string, error) {
	sites := a.LoadWorkshopSites()
	data, err := json.MarshalIndent(sites, "", "  ")
	if err != nil {
		return "", err
	}
	path := workshopSitesPath()
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) ImportWorkshopSitesJSONFile() (int, error) {
	path := workshopSitesPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("未找到 JSON 文件: %w", err)
	}
	var sites []types.WorkshopSite
	if err := json.Unmarshal(data, &sites); err != nil {
		return 0, err
	}
	return len(sites), a.SaveWorkshopSites(sites)
}

func (a *App) ImportWorkshopSitesCSV(csvContent string) error {
	r := csv.NewReader(strings.NewReader(csvContent))
	rows, err := r.ReadAll()
	if err != nil {
		return err
	}
	if len(rows) < 2 {
		return fmt.Errorf("CSV 为空或只有表头")
	}
	var sites []types.WorkshopSite
	for _, row := range rows[1:] {
		if len(row) < 6 {
			continue
		}
		s := types.WorkshopSite{
			ID: row[0], Icon: row[1], Label: row[2], URL: row[3],
			Desc: row[4], Group: row[5],
		}
		if len(row) > 6 {
			s.SearchURL = row[6]
		}
		sites = append(sites, s)
	}
	return a.SaveWorkshopSites(sites)
}

func (a *App) ExportWorkshopCreatorsJSONFile() (string, error) {
	if err := a.SaveWorkshopCreators(a.LoadWorkshopCreators()); err != nil {
		return "", err
	}
	return creatorsPath(), nil
}

func (a *App) BackupWorkshopCreators() (string, error) {
	path := creatorsPath()
	bakPath := path + "." + time.Now().Format("20060102-150405") + ".bak"
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(bakPath, data, 0644); err != nil {
		return "", err
	}
	return bakPath, nil
}

func (a *App) MergeWorkshopCreatorsFromJSON(jsonContent string) (int, int, error) {
	var imported []types.WorkshopCreator
	if err := json.Unmarshal([]byte(jsonContent), &imported); err != nil {
		return 0, 0, err
	}
	a.BackupWorkshopCreators()
	existing := a.LoadWorkshopCreators()
	existMap := map[string]int{}
	for i, cr := range existing {
		existMap[cr.Name] = i
	}
	added, updated := 0, 0
	for _, cr := range imported {
		if idx, ok := existMap[cr.Name]; ok {
			existing[idx].Desc = cr.Desc
			if cr.Type != "" {
				existing[idx].Type = cr.Type
			}
			updated++
		} else {
			existing = append(existing, cr)
			existMap[cr.Name] = len(existing) - 1
			added++
		}
	}
	return added, updated, a.SaveWorkshopCreators(existing)
}

func (a *App) ReplaceWorkshopCreatorsFromJSON(jsonContent string) (int, error) {
	a.BackupWorkshopCreators()
	var imported []types.WorkshopCreator
	if err := json.Unmarshal([]byte(jsonContent), &imported); err != nil {
		return 0, err
	}
	return len(imported), a.SaveWorkshopCreators(imported)
}
