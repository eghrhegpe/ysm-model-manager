package ysm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

type Author struct {
	Name     string `json:"name"`
	Roles    string `json:"roles,omitempty"`
	Bilibili string `json:"bilibili,omitempty"`
}

type Link struct {
	Home   string `json:"home,omitempty"`
	Donate string `json:"donate,omitempty"`
}

type AnimGroup struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Items []string `json:"items"`
}

type ConfigMenu struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Controls []string `json:"controls"`
}

type PreviewInfo struct {
	DefaultTexture string  `json:"defaultTexture,omitempty"`
	HasGUI         bool    `json:"hasGui"`
	HeightScale    float64 `json:"heightScale,omitempty"`
	WidthScale     float64 `json:"widthScale,omitempty"`
}

// YsmSummary 是前端右侧面板和 AI 搜索消费的标准摘要
type YsmSummary struct {
	Schema      string       `json:"schema"` // "ysm-summary/v1"
	Source      string       `json:"source"` // 原始文件名
	Name        string       `json:"name"`
	Tips        string       `json:"tips,omitempty"`
	License     string       `json:"license,omitempty"`
	Authors     []Author     `json:"authors,omitempty"`
	Links       Link         `json:"links,omitempty"`
	Spec        int          `json:"spec"`
	Format      string       `json:"format"` // "ysm" 或 "zip"
	Size        int64        `json:"size"`   // 文件大小 bytes
	Stats       Stats        `json:"stats"`
	AnimGroups  []AnimGroup  `json:"animGroups,omitempty"`
	ConfigMenus []ConfigMenu `json:"configMenus,omitempty"`
	Preview     PreviewInfo  `json:"preview"`
}

type Stats struct {
	Textures   int `json:"textures"`
	Models     int `json:"models"`
	Animations int `json:"animations"`
	TexWidth   int `json:"texWidth"`
	TexHeight  int `json:"texHeight"`
	// Truncated 标记 scanZipBasicStats 达到 maxScanZipEntries 封顶，
	// 返回的 Stats 不完整。调用方应据此向用户披露「统计可能不全」。
	// R29 code_review P3-2：旧实现静默截断，调用方无法区分完整 vs 截断。
	Truncated bool `json:"truncated,omitempty"`
}

// ===== 内部解析用的完整 ysm.json 结构 =====

type ysmRoot struct {
	Spec       int             `json:"spec"`
	Metadata   *ysmMetadata    `json:"metadata,omitempty"`
	Properties *ysmProperties  `json:"properties,omitempty"`
	Files      json.RawMessage `json:"files,omitempty"`
}

type ysmMetadata struct {
	Name    string      `json:"name"`
	Tips    string      `json:"tips,omitempty"`
	License *ysmLicense `json:"license,omitempty"`
	Authors []ysmAuthor `json:"authors,omitempty"`
	Link    *ysmLink    `json:"link,omitempty"`
}

type ysmLicense struct {
	Type string `json:"type"`
}

type ysmAuthor struct {
	Name    string      `json:"name"`
	Role    string      `json:"role,omitempty"`
	Avatar  string      `json:"avatar,omitempty"`
	Contact *ysmContact `json:"contact,omitempty"`
}

type ysmContact struct {
	Bilibili string `json:"bilibili,omitempty"`
}

type ysmLink struct {
	Home   string `json:"home,omitempty"`
	Donate string `json:"donate,omitempty"`
}

type ysmProperties struct {
	DefaultTexture string  `json:"default_texture,omitempty"`
	HeightScale    float64 `json:"height_scale,omitempty"`
	WidthScale     float64 `json:"width_scale,omitempty"`
	// 用 RawMessage 承载：畸形输入（数组/字符串等）不会让整个文件 Unmarshal 失败、
	// 连带 metadata.Name 等全部丢失；使用时按需解析，非法形态跳过该特性
	ExtraAnimation    json.RawMessage   `json:"extra_animation,omitempty"`
	ExtraAnimClassify []ysmAnimClassify `json:"extra_animation_classify,omitempty"`
	ExtraAnimButtons  []ysmConfigButton `json:"extra_animation_buttons,omitempty"`
}

type ysmAnimClassify struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	ExtraAnimation json.RawMessage `json:"extra_animation,omitempty"` // 取 keys
}

type ysmConfigButton struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	ConfigForms json.RawMessage `json:"config_forms,omitempty"`
}

// ===== 摘要提取入口 =====
//
// 重构（第一刀）：原 240 行 ExtractYsmSummary 按职责拆为 1 主 + 6 子函数。
// 公共维度（metadata / properties 提取）两分支（裸 JSON / ZIP）合入 populateMetadata /
// populateProperties，消除逐字段重复抄作业；Name 兜底并入公共函数，两分支统一以
// 「裸 JSON 分支更宽容行为」为准（护栏 #3）；ZIP 专属的 Open+超限守卫、降级扫描、
// TexSize 扫分别抽子函数，主流程变为纯三段分发（YSGP / JSON / ZIP 有无 ysm.json）。

// populateMetadata 从 root.Metadata 提取 Name/Tips/License/Authors/Links 写入 summary。
// Name 空值统一回退到 fallbackName（去扩展名的文件名）。Tips 截断由调用方在 ZIP 分支
// 后补做（裸 JSON 分支无截断，保持历史更宽容行为；调用方显式处理避免公共函数内隐式分叉）。
// 本函数与 root.Properties 提取的 populateProperties 配对，供裸 JSON / ZIP 两路径共用。
func populateMetadata(root *ysmRoot, summary *YsmSummary, fallbackName string) {
	if root == nil || root.Metadata == nil {
		summary.Name = fallbackName
		return
	}
	md := root.Metadata
	summary.Name = md.Name
	summary.Tips = md.Tips
	if md.License != nil {
		summary.License = md.License.Type
	}
	for _, a := range md.Authors {
		author := Author{Name: a.Name, Roles: a.Role}
		if a.Contact != nil {
			author.Bilibili = a.Contact.Bilibili
		}
		summary.Authors = append(summary.Authors, author)
	}
	if md.Link != nil {
		summary.Links = Link{Home: md.Link.Home, Donate: md.Link.Donate}
	}
	if summary.Name == "" {
		summary.Name = fallbackName
	}
}

// populateProperties 从 root.Properties 提取 PreviewInfo（DefaultTexture/HeightScale/
// WidthScale）并调用 appendAnimGroupsAndConfigs 填充 AnimGroups/ConfigMenus。
// 内部判空；主流程裸 JSON / ZIP 两分支均可无条件调用，不再重复 if != nil。
func populateProperties(root *ysmRoot, summary *YsmSummary) {
	if root == nil || root.Properties == nil {
		return
	}
	summary.Preview = PreviewInfo{
		DefaultTexture: root.Properties.DefaultTexture,
		HeightScale:    root.Properties.HeightScale,
		WidthScale:     root.Properties.WidthScale,
	}
	appendAnimGroupsAndConfigs(root, summary)
}

// zipEntriesReader 抽象 ZIP reader 的 Entries()，避免 scanZipBasicStats /
// extractTexSizeFromZipGeo 依赖 container.ZipReader 具体类型。
type zipEntriesReader = interface{ Entries() []container.Entry }

// findYsmEntryInZip 在 ZIP entries 中按 basename 查找 ysm.json / model.json 条目。
// 找不到时返回 nil。
func findYsmEntryInZip(r zipEntriesReader) container.Entry {
	for _, f := range r.Entries() {
		name := strings.ToLower(filepath.Base(f.Name()))
		if types.IsYsmEntryJSON(name) || name == "model.json" {
			return f
		}
	}
	return nil
}

// extractYsmRootFromZip 从 ZIP 内的 ysm.json 条目读取并解析为 ysmRoot。
// 保留手写 LimitReader+1（未接入 fsutil.ReadLimitedEntry）：调用方需区分「读取失败」
// 与「超限」两种错误消息，fsutil 版对两者统一返回 nil（ADR-044 策略 A 例外说明）。
func extractYsmRootFromZip(f container.Entry) (*ysmRoot, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("读取 ysm.json 失败: %w", err)
	}
	defer rc.Close()

	const maxYsmJSON = types.MaxReadLimit
	data, err := io.ReadAll(io.LimitReader(rc, maxYsmJSON+1))
	if err != nil {
		return nil, fmt.Errorf("读取 ysm.json 失败: %w", err)
	}
	if len(data) > maxYsmJSON {
		return nil, fmt.Errorf("ysm.json 超过 %dMB 上限，已拒绝解析", maxYsmJSON>>20)
	}

	var root ysmRoot
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, fmt.Errorf("解析 ysm.json 失败: %w", err)
	}
	return &root, nil
}

// scanZipBasicStats 无 ysm.json 的 ZIP 降级扫描：按文件后缀 + JSON 内容特征
// 统计 Models（含 minecraft:geometry 的 JSON）/ Animations（路径含 animation/
// controller 且不是几何的）/ Textures（图片后缀）。
// maxScanZipEntries scanZipBasicStats 的条目数封顶（R29 P3-1）。
// 恶意 ZIP 塞入数万个微小 .json 条目可造成显著 CPU/IO 耗时。
// 2000 条对正常 YSM 包绰绰有余（典型包 <300 条），超限即停止。
const maxScanZipEntries = 2000

func scanZipBasicStats(r zipEntriesReader) Stats {
	const maxGeoJSON = 5 << 20
	var modelCount, texCount, animCount int
	scanned := 0
	truncated := false
	for _, f := range r.Entries() {
		// R29 code_review P3-2：先跳过 dir，scanned 仅计文件条目，
		// 避免大量 dir 条目耗尽配额
		if f.IsDir() {
			continue
		}
		scanned++
		if scanned > maxScanZipEntries {
			log.Printf("[ysm] scanZipBasicStats 达到条目数封顶 %d, 后续条目跳过", maxScanZipEntries)
			truncated = true
			break
		}
		low := strings.ToLower(f.Name())
		if strings.HasSuffix(low, ".json") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf := fsutil.ReadLimitedEntry(rc, int64(maxGeoJSON))
			if buf == nil {
				continue
			}
			if len(buf) > 0 && (bytes.Contains(buf, []byte(`"minecraft:geometry"`)) || bytes.Contains(buf, []byte(`"minecraft:geometry":`))) {
				modelCount++
				continue
			}
			if strings.Contains(low, "animation") || strings.Contains(low, "controller") {
				animCount++
			}
		}
		if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") || strings.HasSuffix(low, ".jpeg") {
			texCount++
		}
	}
	return Stats{Models: modelCount, Textures: texCount, Animations: animCount, Truncated: truncated}
}

// extractTexSizeFromZipGeo 在 ZIP 内按 geoPaths（来自 extractFileStats 的声明
// 模型相对路径）匹配条目、读取 JSON 并提取 TexWidth/TexHeight（首条命中即停）。
func extractTexSizeFromZipGeo(r zipEntriesReader, geoPaths []string) (int, int) {
	const maxTexGeo = types.MaxReadLimit
	for _, geoPath := range geoPaths {
		for _, f := range r.Entries() {
			if !strings.HasSuffix(strings.ToLower(f.Name()), strings.ToLower(geoPath)) {
				continue
			}
			rc, err := f.Open()
			if err != nil {
				continue
			}
			data := fsutil.ReadLimitedEntry(rc, int64(maxTexGeo))
			if data == nil {
				continue
			}
			if w, h := extractTexSizeFromGeometry(data); w > 0 && h > 0 {
				return w, h
			}
			break
		}
	}
	return 0, 0
}

// fallbackNameFromSource 从 summary.Source（带扩展名的原始文件名）去扩展名得
// Name 兜底值，供 populateMetadata 使用。
func fallbackNameFromSource(source string) string {
	return strings.TrimSuffix(source, filepath.Ext(source))
}

// ExtractYsmSummary 从 .ysm / .zip 文件中提取摘要。
// 重构后主流程只负责三路入口分发 + 组合各子函数结果，各阶段提取逻辑分散到
// populateMetadata / populateProperties / findYsmEntryInZip / extractYsmRootFromZip
// / scanZipBasicStats / extractTexSizeFromZipGeo，便于独立单测与复用。
func ExtractYsmSummary(path string) (YsmSummary, error) {
	summary := YsmSummary{
		Schema: "ysm-summary/v1",
		Source: filepath.Base(path),
		Format: "ysm",
	}
	if fi, err := os.Stat(path); err == nil {
		summary.Size = fi.Size()
	}
	fallbackName := fallbackNameFromSource(summary.Source)

	// YSGP（YSM V2）加密二进制 — 无法直接读取内容，仅填 Name / Spec
	if isYSGP(path) {
		summary.Name = fallbackName
		summary.Spec = 2
		return summary, nil
	}

	// 分支 1：裸 ysm.json（解压后的 YSM 模型文件）
	if strings.HasSuffix(strings.ToLower(path), ".json") {
		if fi, err := os.Stat(path); err == nil && fi.Size() > types.MaxReadLimit {
			return summary, fmt.Errorf("ysm.json 超过 %dMB 上限，已拒绝解析", types.MaxReadLimit/(1<<20))
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return summary, fmt.Errorf("无法读取 JSON: %w", err)
		}
		summary.Format = "ysm"
		var root ysmRoot
		if err := json.Unmarshal(data, &root); err != nil {
			return summary, fmt.Errorf("ysm.json 解析失败: %w", err)
		}
		summary.Spec = root.Spec
		populateMetadata(&root, &summary, fallbackName)
		populateProperties(&root, &summary)
		summary.Stats, _ = extractFileStats(root.Files)
		return summary, nil
	}

	// 分支 2：ZIP
	r, err := container.OpenZipPath(path)
	if err != nil {
		return summary, fmt.Errorf("无法打开文件: %w", err)
	}
	defer r.Close()

	ysmFile := findYsmEntryInZip(r)
	if ysmFile == nil {
		// 2a：无 ysm.json → 降级扫描（仅填 Name + 基本统计）
		summary.Format = "zip"
		populateMetadata(nil, &summary, fallbackName)
		summary.Stats = scanZipBasicStats(r)
		return summary, nil
	}

	// 2b：有 ysm.json → 解析 + 完整填充
	root, err := extractYsmRootFromZip(ysmFile)
	if err != nil {
		return summary, err
	}
	summary.Spec = root.Spec
	populateMetadata(root, &summary, fallbackName)
	summary.Tips = truncate(summary.Tips, 200) // ZIP 分支 Tips 限 200（裸 JSON 分支不截）
	populateProperties(root, &summary)
	stats, geoPaths := extractFileStats(root.Files)
	if root.Properties != nil {
		stats.TexWidth, stats.TexHeight = extractTexSizeFromZipGeo(r, geoPaths)
	}
	summary.Stats = stats
	return summary, nil
}

// appendAnimGroupsAndConfigs 从 ysmRoot.Properties 提取「其他动画」动画分组与
// 「模型配置/自定义表情」配置菜单，写入 summary。
// 供 .zip 分支与裸 ysm.json（解压目录）分支共用，消除两者在面板渲染上的格式不对称。
func appendAnimGroupsAndConfigs(root *ysmRoot, summary *YsmSummary) {
	if root.Properties == nil {
		return
	}

	// 动画分组（extra_animation_classify）
	for _, g := range root.Properties.ExtraAnimClassify {
		name := g.Name
		// 如果 name 为空，从 properties.extra_animation 中按 #id 查找名称
		if name == "" && len(root.Properties.ExtraAnimation) > 0 {
			var eaMap map[string]interface{}
			if json.Unmarshal(root.Properties.ExtraAnimation, &eaMap) == nil {
				if v, ok := eaMap["#"+g.ID]; ok {
					if s, ok2 := v.(string); ok2 {
						name = s
					}
				}
			}
		}
		// 用 extra_animation 的 value（中文名）替换 raw id
		var displayItems []string
		if len(g.ExtraAnimation) > 0 {
			displayItems = extractDisplayValues(g.ExtraAnimation)
		}
		if len(displayItems) == 0 {
			// 全是内部引用（#开头）时跳过整个组
			continue
		}
		summary.AnimGroups = append(summary.AnimGroups, AnimGroup{
			ID:    g.ID,
			Name:  name,
			Items: displayItems,
		})
	}

	// 兜底：extra_animation 中未被分类的直接动画（非 # 开头的值）
	if len(root.Properties.ExtraAnimation) > 0 {
		var eaMap map[string]interface{}
		_ = json.Unmarshal(root.Properties.ExtraAnimation, &eaMap) // 非法形态 → nil map，range 零次迭代安全跳过
		classifiedItems := make(map[string]bool)
		for _, g := range root.Properties.ExtraAnimClassify {
			if len(g.ExtraAnimation) > 0 {
				for k := range extractKeySet(g.ExtraAnimation) {
					classifiedItems[k] = true
				}
			}
		}
		var looseAnims []string
		for k, v := range eaMap {
			if s, ok := v.(string); ok && s != "" && !strings.HasPrefix(s, "#") {
				if strings.HasPrefix(k, "#") {
					continue // 组名跳过
				}
				if !classifiedItems[k] {
					looseAnims = append(looseAnims, s)
				}
			}
		}
		if len(looseAnims) > 0 {
			summary.AnimGroups = append(summary.AnimGroups, AnimGroup{
				ID:    "_loose",
				Name:  "其他动画",
				Items: looseAnims,
			})
		}
	}

	// 配置菜单（extra_animation_buttons → 模型配置/自定义表情）
	for _, b := range root.Properties.ExtraAnimButtons {
		types := extractControlTypes(b.ConfigForms)
		summary.ConfigMenus = append(summary.ConfigMenus, ConfigMenu{
			ID:       b.ID,
			Name:     b.Name,
			Controls: types,
		})
	}
}

// ===== 辅助函数 =====

// 解析 bedrock geometry JSON 的纹理尺寸
func extractTexSizeFromGeometry(data []byte) (w, h int) {
	var raw struct {
		Geometry []struct {
			Description struct {
				TextureWidth  float64 `json:"texture_width"`
				TextureHeight float64 `json:"texture_height"`
			} `json:"description"`
		} `json:"minecraft:geometry"`
	}
	if err := json.Unmarshal(data, &raw); err != nil || len(raw.Geometry) == 0 {
		return 0, 0
	}
	return clampTexDim(raw.Geometry[0].Description.TextureWidth), clampTexDim(raw.Geometry[0].Description.TextureHeight)
}

// 从 files.player 统计纹理、模型主体、动画数量，并收集几何体文件路径
func extractFileStats(filesRaw json.RawMessage) (Stats, []string) {
	var stats Stats
	var geoFiles []string

	// files 可能形如: { "player": { "texture": [...], "animation": {...}, "model": [...] } }
	var files map[string]json.RawMessage
	if err := json.Unmarshal(filesRaw, &files); err != nil {
		return stats, nil
	}

	playerRaw, ok := files["player"]
	if !ok {
		return stats, nil
	}

	var player map[string]json.RawMessage
	if err := json.Unmarshal(playerRaw, &player); err != nil {
		return stats, nil
	}

	// textures
	if texRaw, ok := player["texture"]; ok {
		var arr []json.RawMessage
		if err := json.Unmarshal(texRaw, &arr); err == nil {
			stats.Textures = len(arr)
		}
	}

	// animation (对象或数组)
	if animRaw, ok := player["animation"]; ok {
		var arr []json.RawMessage
		if err := json.Unmarshal(animRaw, &arr); err == nil {
			stats.Animations = len(arr)
		} else {
			var obj map[string]json.RawMessage
			if err := json.Unmarshal(animRaw, &obj); err == nil {
				stats.Animations = len(obj)
			}
		}
	}

	// model — 同时收集路径
	if modelRaw, ok := player["model"]; ok {
		var models []struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(modelRaw, &models); err == nil {
			stats.Models = len(models)
			for _, m := range models {
				if m.Path != "" {
					geoFiles = append(geoFiles, m.Path)
				}
			}
		} else {
			var obj map[string]json.RawMessage
			if err := json.Unmarshal(modelRaw, &obj); err == nil {
				stats.Models = len(obj)
			} else {
				// 字符串数组 / 单字符串形态（与 extracted.go 支持面一致）
				var strs []string
				if err := json.Unmarshal(modelRaw, &strs); err == nil {
					stats.Models = len(strs)
					geoFiles = append(geoFiles, strs...)
				} else {
					var single string
					if err := json.Unmarshal(modelRaw, &single); err == nil && single != "" {
						stats.Models = 1
						geoFiles = append(geoFiles, single)
					}
				}
			}
		}
	}

	return stats, geoFiles
}

// 从 extra_animation 对象中提取键名列表
func extractKeys(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	// 可能是对象
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err == nil {
		keys := make([]string, 0, len(obj))
		for k := range obj {
			keys = append(keys, k)
		}
		return keys
	}
	// 可能是数组
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err == nil {
		keys := make([]string, len(arr))
		for i := range arr {
			keys[i] = fmt.Sprintf("动画 %d", i+1)
		}
		return keys
	}
	return nil
}

// 从 extra_animation map 提取中文显示名
// extra_animation 的 value 可能是一个对象或字符串
func extractDisplayValues(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil
	}
	var result []string
	for _, v := range obj {
		// 尝试直接解析为字符串
		var s string
		if err := json.Unmarshal(v, &s); err == nil && s != "" {
			if strings.HasPrefix(s, "#") {
				continue // # 开头的是内部引用，跳过
			}
			result = append(result, s)
		}
	}
	return result
}

func extractKeySet(raw json.RawMessage) map[string]bool {
	if len(raw) == 0 {
		return nil
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil
	}
	set := make(map[string]bool, len(obj))
	for k := range obj {
		set[k] = true
	}
	return set
}

// 从 config_forms 提取控件类型摘要
func extractControlTypes(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var forms []json.RawMessage
	if err := json.Unmarshal(raw, &forms); err != nil {
		return nil
	}
	types := make([]string, 0, len(forms))
	for _, f := range forms {
		var m map[string]json.RawMessage
		if err := json.Unmarshal(f, &m); err != nil {
			continue
		}
		t := string(m["type"])
		// 去掉引号
		t = strings.Trim(t, "\"")
		if t == "" {
			t = "unknown"
		}
		types = append(types, t)
	}
	return types
}

// 截断字符串（按 rune 计，避免中文字符被字节截断产生乱码）
func truncate(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "..."
}

// isYSGP 检测文件是否是 YSGP（YSM V2）二进制格式（支持带 BOM 的变体）
func isYSGP(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	var buf [7]byte
	n, err := io.ReadFull(f, buf[:])
	if err != nil && n < 4 {
		return false
	}
	data := buf[:n]
	// 跳过 UTF-8 BOM
	offset := 0
	if bytes.HasPrefix(data, fsutil.UTF8BOM) {
		offset = 3
	}
	return n >= offset+4 && string(data[offset:offset+4]) == ysgpMagic
}
