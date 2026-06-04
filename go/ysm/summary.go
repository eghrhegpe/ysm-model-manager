package ysm

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ===== 对外暴露的摘要结构 =====

type Author struct {
	Name    string `json:"name"`
	Roles   string `json:"roles,omitempty"`
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
	HasGUI        bool    `json:"hasGui"`
	HeightScale   float64 `json:"heightScale,omitempty"`
	WidthScale    float64 `json:"widthScale,omitempty"`
}

// YsmSummary 是前端右侧面板和 AI 搜索消费的标准摘要
type YsmSummary struct {
	Schema     string       `json:"schema"`     // "ysm-summary/v1"
	Source     string       `json:"source"`     // 原始文件名
	Name       string       `json:"name"`
	Tips       string       `json:"tips,omitempty"`
	License    string       `json:"license,omitempty"`
	Authors    []Author     `json:"authors,omitempty"`
	Links      Link         `json:"links,omitempty"`
	Spec       int          `json:"spec"`
	Format     string       `json:"format"`      // "ysm" 或 "zip"
	Size       int64        `json:"size"`        // 文件大小 bytes
	Stats      Stats        `json:"stats"`
	AnimGroups []AnimGroup  `json:"animGroups,omitempty"`
	ConfigMenus []ConfigMenu `json:"configMenus,omitempty"`
	Preview    PreviewInfo  `json:"preview"`
}

type Stats struct {
	Textures  int `json:"textures"`
	Models    int `json:"models"`
	Animations int `json:"animations"`
}

// ===== 内部解析用的完整 ysm.json 结构 =====

type ysmRoot struct {
	Spec       int              `json:"spec"`
	Metadata   *ysmMetadata     `json:"metadata,omitempty"`
	Properties *ysmProperties   `json:"properties,omitempty"`
	Files      json.RawMessage  `json:"files,omitempty"`
}

type ysmMetadata struct {
	Name    string         `json:"name"`
	Tips    string         `json:"tips,omitempty"`
	License *ysmLicense    `json:"license,omitempty"`
	Authors []ysmAuthor    `json:"authors,omitempty"`
	Link    *ysmLink       `json:"link,omitempty"`
}

type ysmLicense struct {
	Type string `json:"type"`
}

type ysmAuthor struct {
	Name    string        `json:"name"`
	Role    string        `json:"role,omitempty"`
	Contact *ysmContact   `json:"contact,omitempty"`
}

type ysmContact struct {
	Bilibili string `json:"bilibili,omitempty"`
}

type ysmLink struct {
	Home   string `json:"home,omitempty"`
	Donate string `json:"donate,omitempty"`
}

type ysmProperties struct {
	DefaultTexture       string                 `json:"default_texture,omitempty"`
	HeightScale          float64                `json:"height_scale,omitempty"`
	WidthScale           float64                `json:"width_scale,omitempty"`
	ExtraAnimation       map[string]interface{} `json:"extra_animation,omitempty"`
	ExtraAnimClassify    []ysmAnimClassify      `json:"extra_animation_classify,omitempty"`
	ExtraAnimButtons     []ysmConfigButton      `json:"extra_animation_buttons,omitempty"`
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

// ExtractYsmSummary 从 .ysm / .zip 文件中提取摘要
func ExtractYsmSummary(path string) (YsmSummary, error) {
	summary := YsmSummary{
		Schema: "ysm-summary/v1",
		Source: filepath.Base(path),
		Format: "ysm",
	}

	// 文件大小
	fi, err := os.Stat(path)
	if err == nil {
		summary.Size = fi.Size()
	}

	// 打开 ZIP
	r, err := zip.OpenReader(path)
	if err != nil {
		return summary, fmt.Errorf("无法打开文件: %v", err)
	}
	defer r.Close()

	// 查找 ysm.json
	var ysmFile *zip.File
	for _, f := range r.File {
		name := strings.ToLower(filepath.Base(f.Name))
		if name == "ysm.json" || name == "model.json" {
			ysmFile = f
			break
		}
	}
	if ysmFile == nil {
		return summary, fmt.Errorf("未找到 ysm.json/model.json")
	}

	// 读取并解析
	rc, err := ysmFile.Open()
	if err != nil {
		return summary, fmt.Errorf("读取 ysm.json 失败: %v", err)
	}
	defer rc.Close()

	data, err := io.ReadAll(rc)
	if err != nil {
		return summary, fmt.Errorf("读取 ysm.json 失败: %v", err)
	}

	var root ysmRoot
	if err := json.Unmarshal(data, &root); err != nil {
		return summary, fmt.Errorf("解析 ysm.json 失败: %v", err)
	}

	summary.Spec = root.Spec

	// metadata
	if root.Metadata != nil {
		summary.Name = root.Metadata.Name
		summary.Tips = truncate(root.Metadata.Tips, 200)
		if root.Metadata.License != nil {
			summary.License = root.Metadata.License.Type
		}
		for _, a := range root.Metadata.Authors {
			author := Author{
				Name:  a.Name,
				Roles: a.Role,
			}
			if a.Contact != nil {
				author.Bilibili = a.Contact.Bilibili
			}
			summary.Authors = append(summary.Authors, author)
		}
		if root.Metadata.Link != nil {
			summary.Links = Link{
				Home:   root.Metadata.Link.Home,
				Donate: root.Metadata.Link.Donate,
			}
		}
	}

	// 从 files 字段统计贴图和动画
	if root.Files != nil {
		stats := extractFileStats(root.Files)
		summary.Stats = stats
	}

	// properties → 动画分组 + 配置菜单
	if root.Properties != nil {
		summary.Preview = PreviewInfo{
			DefaultTexture: root.Properties.DefaultTexture,
			HeightScale:    root.Properties.HeightScale,
			WidthScale:     root.Properties.WidthScale,
		}

		for _, g := range root.Properties.ExtraAnimClassify {
			keys := extractKeys(g.ExtraAnimation)
			name := g.Name
			// 如果 name 为空，从 properties.extra_animation 中按 #id 查找名称
			if name == "" && root.Properties.ExtraAnimation != nil {
				if v, ok := root.Properties.ExtraAnimation["#"+g.ID]; ok {
					if s, ok2 := v.(string); ok2 {
						name = s
					}
				}
			}
			summary.AnimGroups = append(summary.AnimGroups, AnimGroup{
				ID:    g.ID,
				Name:  name,
				Items: keys,
			})
		}

		for _, b := range root.Properties.ExtraAnimButtons {
			types := extractControlTypes(b.ConfigForms)
			summary.ConfigMenus = append(summary.ConfigMenus, ConfigMenu{
				ID:       b.ID,
				Name:     b.Name,
				Controls: types,
			})
		}
	}

	return summary, nil
}

// ===== 辅助函数 =====

// 从 files.player 统计纹理、模型主体、动画数量
func extractFileStats(filesRaw json.RawMessage) Stats {
	var stats Stats

	// files 可能形如: { "player": { "texture": [...], "animation": {...}, "model": [...] } }
	var files map[string]json.RawMessage
	if err := json.Unmarshal(filesRaw, &files); err != nil {
		return stats
	}

	playerRaw, ok := files["player"]
	if !ok {
		return stats
	}

	var player map[string]json.RawMessage
	if err := json.Unmarshal(playerRaw, &player); err != nil {
		return stats
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

	// model
	if modelRaw, ok := player["model"]; ok {
		var arr []json.RawMessage
		if err := json.Unmarshal(modelRaw, &arr); err == nil {
			stats.Models = len(arr)
		} else {
			var obj map[string]json.RawMessage
			if err := json.Unmarshal(modelRaw, &obj); err == nil {
				stats.Models = len(obj)
			}
		}
	}

	return stats
}

// 从 extra_animation 对象中提取键名列表
func extractKeys(raw json.RawMessage) []string {
	if raw == nil || len(raw) == 0 {
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

// 从 config_forms 提取控件类型摘要
func extractControlTypes(raw json.RawMessage) []string {
	if raw == nil || len(raw) == 0 {
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

// 截断字符串
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
