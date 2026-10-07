// summary_extract.go：YSM 摘要提取辅助函数（原 summary.go 拆分，2026-10 文件行数治理）。
// extractFileStats / extractKeys / extractDisplayValues / extractKeySet / extractControlTypes——
// 从 ysm.json 的 files/properties/animData 等原始 JSON 中提取统计与键集合。
package ysm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"ysm-model-manager/go/fsutil"
)

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
	// map 遍历序随机 → items 输出序不定（parity golden 对账 flaky，2026-09-04 实证：
	// -coverprofile 模式下偶发 got/want 数组序相反）。按键排序保证确定性输出。
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := obj[k]
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

// isYSGP 检测文件是否是 YSGP（YSM V2）二进制格式（支持带 BOM 的变体）
func isYSGP(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()
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
