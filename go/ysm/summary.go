// summary.go：YSM 摘要提取入口与类型定义（原 summary.go 拆分，2026-10 文件行数治理）。
// 2026-10 拆分：原 714 行按职责分为 summary.go（本文件：类型 + ExtractYsmSummary 主入口）/
// summary_anim.go（动画组构建）/ summary_extract.go（文件统计与键提取辅助函数）。
package ysm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types/registry"
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
	// 旧实现静默截断，调用方无法区分完整 vs 截断。
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
		if registry.IsYsmEntryJSON(name) || name == "model.json" {
			return f
		}
	}
	return nil
}

// extractYsmRootFromZip 从 ZIP 内的 ysm.json 条目读取并解析为 ysmRoot。
// 走 fsutil.ReadLimitedEntry（ADR-044 策略 A 统一口径）：limit+1 探测截断，超限/读错返回 nil。
func extractYsmRootFromZip(f container.Entry) (*ysmRoot, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("读取 ysm.json 失败: %w", err)
	}
	// ReadLimitedEntry 内部 Close rc，无需 defer
	data := fsutil.ReadLimitedEntry(rc, registry.MaxReadLimit)
	if data == nil {
		return nil, fmt.Errorf("ysm.json 超过 %dMB 上限或读取失败", registry.MaxReadLimit>>20)
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
// maxScanZipEntries scanZipBasicStats 的条目数封顶。
// 恶意 ZIP 塞入数万个微小 .json 条目可造成显著 CPU/IO 耗时。
// 2000 条对正常 YSM 包绰绰有余（典型包 <300 条），超限即停止。
const maxScanZipEntries = 2000

func scanZipBasicStats(r zipEntriesReader) Stats {
	const maxGeoJSON = 5 << 20
	var modelCount, texCount, animCount int
	scanned := 0
	truncated := false
	for _, f := range r.Entries() {
		// 先跳过 dir，scanned 仅计文件条目，
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
		if registry.IsTextureExt(filepath.Ext(low)) {
			texCount++
		}
	}
	return Stats{Models: modelCount, Textures: texCount, Animations: animCount, Truncated: truncated}
}

// extractTexSizeFromZipGeo 在 ZIP 内按 geoPaths（来自 extractFileStats 的声明
// 模型相对路径）匹配条目、读取 JSON 并提取 TexWidth/TexHeight（首条命中即停）。
func extractTexSizeFromZipGeo(r zipEntriesReader, geoPaths []string) (int, int) {
	const maxTexGeo = registry.MaxReadLimit
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
			if w, h := extractTexSizeFromGeometryBytes(data); w > 0 && h > 0 {
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
		// 一步 ReadLimitedEntry 替代 Stat+ReadFile 两步（TOCTOU：Stat 与 ReadFile 之间文件可能被替换为超大文件）
		// 与同函数 ZIP 分支口径对齐；超限/读错返回 nil，此处转为错误文案
		f, err := os.Open(path)
		if err != nil {
			return summary, fmt.Errorf("无法打开 ysm.json: %w", err)
		}
		// 立即登记关闭：ReadLimitedEntry 只读不负责关句柄，本分支全部返回路径
		// （超限错误 / 解析错误 / 成功）都必须释放——os.File 双关无害（runtime 兜底）
		defer func() { _ = f.Close() }()
		data := fsutil.ReadLimitedEntry(f, registry.MaxReadLimit)
		if data == nil {
			return summary, fmt.Errorf("ysm.json 超过 %dMB 上限或读取失败", registry.MaxReadLimit/(1<<20))
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
	defer func() { _ = r.Close() }()

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
	summary.Tips = fsutil.TruncateLimit(summary.Tips, 200) // ZIP 分支 Tips 限 200（裸 JSON 分支不截）
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
