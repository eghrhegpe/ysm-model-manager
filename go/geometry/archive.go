// ===== 从压缩包中提取并解析 Bedrock Geometry =====
// 支持 ZIP（YSM 标准格式）和 7z 格式
package geometry

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"sort"
	"strings"

	"ysm-model-manager/go/types"

	"github.com/bodgit/sevenzip"
)

// ExtractFirstPNGFromZip 从 ZIP 中提取第一张 PNG 图片（用于快速预览）
func ExtractFirstPNGFromZip(data []byte, size int64) []byte {
	reader, err := zip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil
	}
	for _, f := range reader.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".png") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf, _ := io.ReadAll(rc)
			rc.Close()
			if len(buf) > 0 {
				return buf
			}
		}
	}
	return nil
}

// ExtractFirstPNGFrom7z 从 7z 中提取第一张 PNG 图片（用于快速预览）
func ExtractFirstPNGFrom7z(data []byte, size int64) []byte {
	reader, err := sevenzip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil
	}
	for _, f := range reader.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".png") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf, _ := io.ReadAll(rc)
			rc.Close()
			if len(buf) > 0 {
				return buf
			}
		}
	}
	return nil
}

// ParseFromZip 从 ZIP 字节中解析 Bedrock Geometry 并提取纹理和动画
func ParseFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string) {
	reader, err := zip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil, nil, nil
	}
	var geo *types.BedrockModel
	var pngs [][]byte
	var pngNames []string
	var defaultTex string
	var animJSONs []string

	var modelOrder []string
	for _, f := range reader.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, "ysm.json") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf, _ := io.ReadAll(rc)
			rc.Close()
			var ysm struct {
				Properties struct {
					DefaultTexture string `json:"default_texture"`
				} `json:"properties"`
				Files struct {
					Player struct {
						Model []string `json:"model"`
					} `json:"files"`
				} `json:"files"`
			}
			if json.Unmarshal(buf, &ysm) == nil {
				defaultTex = ysm.Properties.DefaultTexture
				modelOrder = ysm.Files.Player.Model
			}
			break
		}
	}

	type geoEntry struct {
		name string
		data []byte
	}
	var geoFiles []geoEntry

	for _, f := range reader.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, ".json") && !f.FileInfo().IsDir() {
			if strings.Contains(low, "ysm.json") {
				continue
			}
			if strings.Contains(low, "animation") || strings.Contains(low, "controller") {
				rc, err := f.Open()
				if err != nil {
					continue
				}
				buf, _ := io.ReadAll(rc)
				rc.Close()
				if len(buf) > 10 {
					animJSONs = append(animJSONs, string(buf))
				}
				continue
			}
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf, _ := io.ReadAll(rc)
			rc.Close()
			geoFiles = append(geoFiles, geoEntry{name: f.Name, data: buf})
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !f.FileInfo().IsDir() && !strings.Contains(low, "avatar/") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			pngData, _ := io.ReadAll(rc)
			rc.Close()
			if len(pngData) > 0 {
				name := f.Name
				if idx := strings.LastIndex(name, "/"); idx >= 0 {
					name = name[idx+1:]
				}
				if idx := strings.LastIndex(name, "\\"); idx >= 0 {
					name = name[idx+1:]
				}
				name = strings.TrimSuffix(name, ".png")
				name = strings.TrimSuffix(name, ".jpg")
				pngNames = append(pngNames, name)
				pngs = append(pngs, pngData)
			}
		}
	}

	if len(modelOrder) > 0 {
		orderMap := make(map[string]int, len(modelOrder))
		for i, p := range modelOrder {
			orderMap[strings.ReplaceAll(p, "\\", "/")] = i
		}
		sort.SliceStable(geoFiles, func(i, j int) bool {
			ai, oki := orderMap[geoFiles[i].name]
			aj, okj := orderMap[geoFiles[j].name]
			if oki && okj {
				return ai < aj
			}
			return oki
		})
	}

	for _, gf := range geoFiles {
		g := ParseBedrockGeometry(gf.data)
		if g == nil || g.BoneCount == 0 {
			continue
		}
		if geo == nil {
			geo = g
		} else {
			geo.Bones = append(geo.Bones, g.Bones...)
			geo.BoneCount += g.BoneCount
			geo.CubeCount += g.CubeCount
			if g.TexWidth > geo.TexWidth {
				geo.TexWidth = g.TexWidth
			}
			if g.TexHeight > geo.TexHeight {
				geo.TexHeight = g.TexHeight
			}
		}
	}

	if defaultTex != "" && len(pngs) > 1 {
		for i, n := range pngNames {
			if n == defaultTex && i > 0 {
				pngs[0], pngs[i] = pngs[i], pngs[0]
				pngNames[0], pngNames[i] = pngNames[i], pngNames[0]
				break
			}
		}
	}
	return geo, pngs, animJSONs
}

// ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理
func ParseFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	reader, err := sevenzip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil, nil
	}
	var geo *types.BedrockModel
	var pngs [][]byte
	for _, f := range reader.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, ".json") && !strings.Contains(low, "ysm.json") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf, _ := io.ReadAll(rc)
			rc.Close()
			g := ParseBedrockGeometry(buf)
			if g == nil || g.BoneCount == 0 {
				continue
			}
			if geo == nil {
				geo = g
			} else {
				geo.Bones = append(geo.Bones, g.Bones...)
				geo.BoneCount += g.BoneCount
				geo.CubeCount += g.CubeCount
				if g.TexWidth > geo.TexWidth {
					geo.TexWidth = g.TexWidth
				}
				if g.TexHeight > geo.TexHeight {
					geo.TexHeight = g.TexHeight
				}
			}
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !f.FileInfo().IsDir() && !strings.Contains(low, "avatar/") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			pngData, _ := io.ReadAll(rc)
			rc.Close()
			if len(pngData) > 0 {
				pngs = append(pngs, pngData)
			}
		}
	}
	return geo, pngs
}
