// ========== 创意工坊配置（站点 + 创作者） ==========
// 从 app.go 拆分：工坊站点和创作者的 CRUD + 导入导出
package app

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// ========== 创意工坊站点配置 ==========

// workshopConfigPath 返回工坊配置落点（用户配置根 YSM-Model-Manager/<name>）。
// 与 app_config.go 的 configPath 同构：平台数据根缺失时返回空串 fail-fast，
// 不降级为 exe 旁或相对路径（ADR-046 P2）。
func workshopConfigPath(name string) string {
	dir := configDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, name)
}

// migrateWorkshopConfig 将旧版落在 exe 相对路径的工坊配置文件迁移到用户配置目录。
// 仅当新位置不存在、且 exe 旁旧候选之一存在时执行；复制成功后才删除旧文件，
// 失败时保留旧文件不丢数据（与 migrateLegacyConfig 同构）。
func migrateWorkshopConfig(name string) {
	newPath := workshopConfigPath(name)
	if newPath == "" {
		return // 平台数据根缺失：无目标位置，跳过迁移
	}
	if _, err := os.Stat(newPath); err == nil {
		return // 已迁移，跳过
	}
	// 无条件确保目标父目录存在：全新落盘（无旧 exe 旁文件可迁移）场景下，
	// WriteFileAtomic 不会自动创建父目录，必须在此预建（与 migrateLegacyConfig 对齐）。
	if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
		log.Printf("[migrate-workshop] 配置目录创建失败: %v", err)
		return
	}
	exe, _ := os.Executable()
	candidates := []string{
		filepath.Join(filepath.Dir(exe), name),
		filepath.Join(filepath.Dir(exe), "..", name),
	}
	for _, p := range candidates {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		if err := fsutil.WriteFileAtomic(newPath, data); err != nil {
			log.Printf("[migrate-workshop] 迁移写盘失败: %v", err)
			return
		}
		_ = os.Remove(p) // 迁移成功，清理旧文件
		return
	}
}

// migrateAndLoadWorkshop 迁移旧 exe 旁配置并优先读取用户配置根中的文件；
// 用户未编辑时返回 false，由调用方回退到嵌入基线（loadBundledJSON）。
func migrateAndLoadWorkshop(name string, v interface{}) bool {
	migrateWorkshopConfig(name)
	p := workshopConfigPath(name)
	if p == "" {
		return false
	}
	return readJSONFile(p, v) == nil
}

func workshopSitesPath() string {
	migrateWorkshopConfig("workshop_sites.json")
	return workshopConfigPath("workshop_sites.json")
}

func readJSONFile(path string, v interface{}) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	data = fsutil.StripBOM(data)
	return json.Unmarshal(data, v)
}

// loadBundledJSON 从随附数据（exe 同级 / 嵌入基线）读取并解析 JSON，
// 不依赖当前工作目录，等价于 readJSONFile(loadBundledData(name))。
func loadBundledJSON(name string, v interface{}) error {
	data, err := loadBundledData(name)
	if err != nil {
		return err
	}
	data = fsutil.StripBOM(data)
	return json.Unmarshal(data, v)
}

func (a *App) DefaultWorkshopSites() []types.WorkshopSite {
	var sites []types.WorkshopSite
	if migrateAndLoadWorkshop("workshop_sites.json", &sites) {
		return sites
	}
	if err := loadBundledJSON("workshop_sites.json", &sites); err != nil {
		return defaultWorkshopSites()
	}
	return sites
}

func (a *App) SaveWorkshopSites(sites []types.WorkshopSite) error {
	data, err := json.MarshalIndent(sites, "", "  ")
	if err != nil {
		return err
	}
	return fsutil.WriteFileAtomic(workshopSitesPath(), data)
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
	migrateWorkshopConfig("creators.json")
	return workshopConfigPath("creators.json")
}

func (a *App) LoadWorkshopCreators() []types.WorkshopCreator {
	var list []types.WorkshopCreator
	if migrateAndLoadWorkshop("creators.json", &list) {
		return list
	}
	if err := loadBundledJSON("creators.json", &list); err != nil {
		return nil
	}
	return list
}

func (a *App) SaveWorkshopCreators(list []types.WorkshopCreator) error {
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return fsutil.WriteFileAtomic(creatorsPath(), data)
}

// inTypeSegments 判断 siteID 是否为 typeStr 的分号分隔精确段（R22 审核 P3-1）：
// 原裸 Contains(c.Type, siteID+";") 会把 "ba;c" 误配 siteID="a"（真子串误判），
// 与 3.4③ 词边界范式一致——多站点 Type 为 "site1;site2" 分号分隔。
func inTypeSegments(typeStr, siteID string) bool {
	for _, seg := range strings.Split(typeStr, ";") {
		if seg == siteID {
			return true
		}
	}
	return false
}

// SaveWorkshopCreatorsBySite 只替换指定站点的创作者，其他站点不动
func (a *App) SaveWorkshopCreatorsBySite(siteID string, siteCreators []types.WorkshopCreator) error {
	all := a.LoadWorkshopCreators()
	// 移除该站点的旧条目（Type 分号分隔精确段匹配）
	var kept []types.WorkshopCreator
	for _, c := range all {
		if inTypeSegments(c.Type, siteID) {
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
	sites := a.DefaultWorkshopSites()
	for i, s := range sites {
		if s.ID == siteID {
			sites[i].PresetSearches = presets
			return a.SaveWorkshopSites(sites)
		}
	}
	return nil
}

// ========== GitHub 仓库配置 ==========

func (a *App) LoadGitHubRepos() []types.WorkshopCreator {
	var list []types.WorkshopCreator
	if migrateAndLoadWorkshop("workshop-github.json", &list) {
		return list
	}
	if err := loadBundledJSON("workshop-github.json", &list); err != nil {
		return nil
	}
	return list
}

func (a *App) ResetWorkshopConfigs() ([]types.WorkshopSite, error) {
	// 备份后再重置
	if _, err := a.BackupWorkshopCreators(); err != nil {
		// 备份失败原被静默忽略，重置继续可能丢用户数据
		return nil, fmt.Errorf("备份创作者数据失败，中止重置: %w", err)
	}
	sites := defaultWorkshopSites()
	data, merr := json.MarshalIndent(sites, "", "  ")
	if merr != nil {
		return nil, fmt.Errorf("序列化站点数据失败: %w", merr)
	}
	if err := fsutil.WriteFileAtomic(workshopSitesPath(), data); err != nil {
		return nil, err
	}
	if err := os.Remove(creatorsPath()); err != nil && !os.IsNotExist(err) {
		log.Printf("[workshop] 重置后清理 creators 失败: %v", err)
	}
	return sites, nil
}

func (a *App) ExportWorkshopSitesJSONFile() (string, error) {
	sites := a.DefaultWorkshopSites()
	data, err := json.MarshalIndent(sites, "", "  ")
	if err != nil {
		return "", err
	}
	path := workshopSitesPath()
	if err := fsutil.WriteFileAtomic(path, data); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) ValidateWorkshopSites() (int, error) {
	path := workshopSitesPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("未找到 JSON 文件: %w", err)
	}
	var sites []types.WorkshopSite
	if err := json.Unmarshal(data, &sites); err != nil {
		return 0, err
	}
	if len(sites) < 2 || len(sites) > 100 {
		return 0, fmt.Errorf("数据异常: %d 个站点 (期望 2-100)", len(sites))
	}
	return len(sites), a.SaveWorkshopSites(sites)
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
		// 全新用户无用户配置（数据走 bundled 兜底）：无数据可备份 ≠ 错误，
		// 否则 Merge/Replace/Reset 首次使用全部中止（R22 审核 P2-1）。
		// 与 web 桥（web-community.ts 无备份步骤直接合并）行为对齐。
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	// 原子写入（与 saveConfig/tags 对齐）——
	// 原 os.WriteFile 直写在磁盘满/IO 中断时留半截备份文件
	if err := fsutil.WriteFileAtomic(bakPath, data); err != nil {
		return "", err
	}
	return bakPath, nil
}

func (a *App) MergeWorkshopCreatorsFromJSON(jsonContent string) (int, int, error) {
	var imported []types.WorkshopCreator
	if err := json.Unmarshal([]byte(jsonContent), &imported); err != nil {
		return 0, 0, err
	}
	if len(imported) < 20 {
		return 0, 0, fmt.Errorf("导入数据异常: 仅 %d 条 (期望 >=20)", len(imported))
	}
	if _, err := a.BackupWorkshopCreators(); err != nil {
		return 0, 0, fmt.Errorf("备份创作者数据失败，中止合并: %w", err)
	}
	existing := a.LoadWorkshopCreators()
	existMap := map[string]int{}
	for i, cr := range existing {
		existMap[cr.Name] = i
	}
	added, updated := 0, 0
	for _, cr := range imported {
		if idx, ok := existMap[cr.Name]; ok {
			if cr.Desc != "" && existing[idx].Desc == "" {
				existing[idx].Desc = cr.Desc
			}
			if cr.Type != "" {
				existing[idx].Type = cr.Type
			}
			if cr.Role != "" {
				existing[idx].Role = cr.Role
			}
			updated++
		} else {
			existing = append(existing, cr)
			existMap[cr.Name] = len(existing) - 1
			added++
		}
	}
	// 最终完整性校验
	if len(existing) < 100 {
		return 0, 0, fmt.Errorf("合并后数据异常: %d 条, 已回滚", len(existing))
	}
	return added, updated, a.SaveWorkshopCreators(existing)
}

// mergeTypeSegments 把 incoming 的 type 分号段并入 target（trim / 去空 / 去重）。
// 领域语义：name 是创作者唯一身份，type 是多站点集合（分号段）——社区索引可能为
// 既有创作者新增站点，段并入防覆盖丢站；与 MergeWorkshopCreatorsFromJSON 的覆盖
// 语义刻意区分（ADR-172 §2 差异表）。与前端 community-data.ts mergeTypeSegments
// 同源，两侧镜像实现，契约测试锁定一致。
func mergeTypeSegments(target *types.WorkshopCreator, incoming string) bool {
	if incoming == "" {
		return false
	}
	segs := make([]string, 0, 4)
	for _, seg := range strings.Split(target.Type, ";") {
		seg = strings.TrimSpace(seg)
		if seg != "" {
			segs = append(segs, seg)
		}
	}
	changed := false
	for _, seg := range strings.Split(incoming, ";") {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue
		}
		dup := false
		for _, s := range segs {
			if s == seg {
				dup = true
				break
			}
		}
		if !dup {
			segs = append(segs, seg)
			changed = true
		}
	}
	if changed {
		target.Type = strings.Join(segs, ";")
	}
	return changed
}

// MergeCommunityCreatorsFromJSON 把社区索引（增量）并入本地 creators 并单次原子写回。
// ADR-172：社区增量合并下沉 Go——替代前端 tryAutoMergeCommunity / site edit 同步
// 按钮的 TS 派生写回链（siteMap 分组 / kept 过滤 / dedupeCreators），解除 AGENTS.md
// 「Go 派生结果只读」红线债务（锐评复核 2026-09-03 判定，见 ADR-172 §1）。
//
// 语义与 MergeWorkshopCreatorsFromJSON（手动全量导入，drag.ts 消费）刻意区分：
//   - type 冲突：分号段并入（不丢站点），非覆盖；
//   - 无 ≥20/≥100 条数硬校验：合并纯增不改（无删改分支），小库用户可正常合并；
//   - 备份同构（BackupWorkshopCreators，用户拍板保留）。
//
// 一次 Load 最新全量（不依赖前端可能 stale 的会话副本）→ 逐条并入 → 单次
// SaveWorkshopCreators（fsutil.WriteFileAtomic）：无「逐站循环调 BySite N 次」的
// 跨调用部分提交窗口。
func (a *App) MergeCommunityCreatorsFromJSON(communityJSON string) (int, int, error) {
	var imported []types.WorkshopCreator
	if err := json.Unmarshal([]byte(communityJSON), &imported); err != nil {
		return 0, 0, err
	}
	// 逐字段净化：name 必须非空字符串，非法元素过滤（防 __proto__ 注入 / 畸形数据
	// 污染；与 web 桥 web-community.ts 逐字段校验同源）
	cleaned := imported[:0]
	for _, cr := range imported {
		if cr.Name != "" {
			cleaned = append(cleaned, cr)
		}
	}
	imported = cleaned
	if len(imported) == 0 {
		return 0, 0, fmt.Errorf("社区数据为空（净化后 0 条有效创作者）")
	}
	existing := a.LoadWorkshopCreators()
	if existing == nil {
		existing = []types.WorkshopCreator{}
	}
	existMap := make(map[string]int, len(existing))
	for i, cr := range existing {
		existMap[cr.Name] = i
	}
	added, updated := 0, 0
	for _, cr := range imported {
		idx, ok := existMap[cr.Name]
		if !ok {
			existing = append(existing, cr)
			existMap[cr.Name] = len(existing) - 1
			added++
			continue
		}
		changed := false
		if cr.Desc != "" && existing[idx].Desc == "" {
			existing[idx].Desc = cr.Desc
			changed = true
		}
		if mergeTypeSegments(&existing[idx], cr.Type) {
			changed = true
		}
		if cr.Role != "" && existing[idx].Role == "" {
			existing[idx].Role = cr.Role
			changed = true
		}
		if changed {
			updated++
		}
	}
	// 幂等短路：并入无任何变更（本地已含社区全部条目）→ 不备份不写盘。
	// 前端 6h 缓存命中后仍会转发社区索引（fetch 省了、merge 判断不下沉），
	// 依赖本短路避免每次进工坊页都产生 .bak 与无谓原子写（ADR-172 §2）。
	if added == 0 && updated == 0 {
		return 0, 0, nil
	}
	if _, err := a.BackupWorkshopCreators(); err != nil {
		return 0, 0, fmt.Errorf("备份创作者数据失败，中止合并: %w", err)
	}
	return added, updated, a.SaveWorkshopCreators(existing)
}
