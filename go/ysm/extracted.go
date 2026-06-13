// ===== 解压后 YSM 模型目录中的 geometry/纹理查找 =====
// 当用户点击 ysm.json（解压后的 YSM 模型目录）时，
// 需要在此目录中搜索 geometry JSON 文件和纹理文件。
package ysm

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

// FindGeometryInExtractedYSM 在解压后的 YSM 模型目录中查找 geometry 和纹理
// ysmJsonPath: ysm.json 的完整路径
// 返回: 合并后的 BedrockModel（不含纹理 base64），纹理原始字节
func FindGeometryInExtractedYSM(ysmJsonPath string) (*types.BedrockModel, [][]byte) {
	data, err := os.ReadFile(ysmJsonPath)
	if err != nil {
		return nil, nil
	}

	// 解析 ysm.json 找 model 文件名
	var ysmRoot struct {
		Spec  int `json:"spec"`
		Files map[string]struct {
			Model   json.RawMessage `json:"model"`
			Texture json.RawMessage `json:"texture"`
		} `json:"files"`
	}
	var modelNames []string
	var modelMapOrig map[string]string
	if err := json.Unmarshal(data, &ysmRoot); err == nil {
		for _, player := range ysmRoot.Files {
			if len(player.Model) == 0 {
				continue
			}
			modelRaw := string(player.Model)
			trimmed := strings.TrimSpace(modelRaw)
			if strings.HasPrefix(trimmed, `{`) {
				var mm map[string]string
				if json.Unmarshal(player.Model, &mm) == nil {
					modelMapOrig = mm
					for _, v := range mm {
						modelNames = append(modelNames, v)
					}
				}
			} else if strings.HasPrefix(trimmed, `[`) {
				var arr []string
				if json.Unmarshal(player.Model, &arr) == nil {
					modelNames = arr
				}
			} else {
				name := strings.Trim(trimmed, `"`)
				modelNames = append(modelNames, name)
			}
		}
	}

	var geoJSON *types.BedrockModel
	dir := filepath.Dir(ysmJsonPath)

	// 尝试解析 ysm.json 自身（可能包含 minecraft.geometry）
	geoJSON = geometry.ParseBedrockGeometry(data)
	if geoJSON == nil {
		// 检查 minecraft.geometry[0] 格式
		var root struct {
			Minecraft struct {
				Geometry []json.RawMessage `json:"geometry"`
			} `json:"minecraft"`
		}
		if err := json.Unmarshal(data, &root); err == nil && len(root.Minecraft.Geometry) > 0 {
			wrapped := append([]byte(`{"format_version":"1.12.0","minecraft:geometry":[`), root.Minecraft.Geometry[0]...)
			wrapped = append(wrapped, ']', '}')
			geoJSON = geometry.ParseBedrockGeometry(wrapped)
		}
	}

	// 尝试同目录或子目录 model 文件，优先选 key="main"
	if geoJSON == nil && modelMapOrig != nil {
		if mainPath, ok := modelMapOrig["main"]; ok {
			for _, sub := range []string{"", "models/", "models\\"} {
				candidate := filepath.Join(dir, sub, mainPath)
				if _, err := os.Stat(candidate); err == nil {
					geoData, readErr := os.ReadFile(candidate)
					if readErr == nil {
						geoJSON = geometry.ParseBedrockGeometry(geoData)
					}
					break
				}
			}
		}
	}
	if geoJSON == nil {
		for _, mn := range modelNames {
			for _, sub := range []string{"", "models/", "models\\"} {
				candidate := filepath.Join(dir, sub, mn)
				if _, err := os.Stat(candidate); err == nil {
					geoData, readErr := os.ReadFile(candidate)
					if readErr == nil {
						geoJSON = geometry.ParseBedrockGeometry(geoData)
					}
					break
				}
			}
			if geoJSON != nil {
				break
			}
		}
	}

	// 递归搜索子目录（排除 animations/controller/avatar）
	if geoJSON == nil {
		excludeDirs := map[string]bool{"animations": true, "controller": true, "avatar": true}
		filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil || geoJSON != nil {
				return filepath.SkipAll
			}
			if d.IsDir() {
				if excludeDirs[strings.ToLower(d.Name())] {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.EqualFold(path, ysmJsonPath) {
				return nil
			}
			if strings.HasSuffix(strings.ToLower(path), ".json") {
				geoData, readErr := os.ReadFile(path)
				if readErr == nil {
					if gj := geometry.ParseBedrockGeometry(geoData); gj != nil {
						geoJSON = gj
					}
				}
			}
			return nil
		})
	}

	// 裸 geometry 元素兜底
	if geoJSON == nil {
		wrapped := append([]byte(`{"format_version":"1.12.0","minecraft:geometry":[`), data...)
		wrapped = append(wrapped, ']', '}')
		geoJSON = geometry.ParseBedrockGeometry(wrapped)
	}

	// 搜索纹理
	var texData [][]byte
	texDir := filepath.Join(dir, "textures")
	if d, err := os.Stat(texDir); err == nil && d.IsDir() {
		entries, _ := os.ReadDir(texDir)
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			ext := strings.ToLower(filepath.Ext(e.Name()))
			if ext == ".png" || ext == ".jpg" || ext == ".tga" {
				texBytes, readErr := os.ReadFile(filepath.Join(texDir, e.Name()))
				if readErr == nil {
					texData = append(texData, texBytes)
				}
			}
		}
	}
	// 也搜索同目录纹理
	if len(texData) == 0 {
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			ext := strings.ToLower(filepath.Ext(e.Name()))
			if ext == ".png" || ext == ".jpg" {
				texBytes, readErr := os.ReadFile(filepath.Join(dir, e.Name()))
				if readErr == nil {
					texData = append(texData, texBytes)
				}
			}
		}
	}

	return geoJSON, texData
}
