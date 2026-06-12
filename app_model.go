// ========== YSM 模型解析 ==========
// 从 app.go 拆分：模型文件分析、几何体解析、CLI fallback
package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"ysm-model-manager/go/threejs"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"

	"github.com/bodgit/sevenzip"
)

func (a *App) AnalyzeYSMModel(path string) ysm.YSMModelMeta {
	return ysm.AnalyzeYSMModel(path)
}

func (a *App) ExtractYsmSummary(path string) ysm.YsmSummary {
	summary, err := ysm.ExtractYsmSummary(path)
	if err != nil {
		summary = ysm.YsmSummary{
			Schema: "ysm-summary/v1",
			Source: filepath.Base(path),
		}
	}
	return summary
}

func (a *App) ExtractYSMHeader(path string) ysm.YSMHeader {
	return ysm.AnalyzeYSMHeader(path)
}

func (a *App) ExtractYSMHeaderFromBase64(base64Data string) ysm.YSMHeader {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return ysm.YSMHeader{}
	}
	return ysm.AnalyzeYSMHeaderFromBytes(data)
}

func (a *App) SavePreviewTempFile(base64Data string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", err
	}
	tmpDir := filepath.Join(os.TempDir(), "ysm-preview")
	os.MkdirAll(tmpDir, 0755)
	tmpFile, err := os.CreateTemp(tmpDir, "preview-*.ysm")
	if err != nil {
		return "", err
	}
	defer tmpFile.Close()
	_, err = tmpFile.Write(data)
	if err != nil {
		return "", err
	}
	return tmpFile.Name(), nil
}

func (a *App) ReadFileBytes(path string) []byte {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return data
}

func (a *App) AnalyzeBedrockModel(modelPath string) types.BedrockModel {
	ext := strings.ToLower(filepath.Ext(modelPath))
	if ext == ".ysm" {
		return a.runYSMParserOnFile(modelPath)
	}
	data, err := os.ReadFile(modelPath)
	if err != nil {
		return types.BedrockModel{}
	}
	var geoJSON *types.BedrockModel
	var texData [][]byte
	var animJSONs []string

	if ext == ".zip" {
		geoJSON, texData, animJSONs = parseBedrockFromZip(data, int64(len(data)))
	} else if ext == ".7z" {
		geoJSON, texData = parseBedrockFrom7z(data, int64(len(data)))
	} else if ext == ".json" {
		// 裸 ysm.json（解压后的 YSM 模型），解析 ysm.json 元数据 + 寻找同目录 geometry
		// 先解析 ysm.json 找 model 文件名
		var ysmRoot struct {
			Spec int `json:"spec"`
			Files map[string]struct {
				Model   json.RawMessage `json:"model"`
				Texture json.RawMessage `json:"texture"`
			} `json:"files"`
		}
		var modelNames []string
		var modelMapOrig map[string]string // 保留原始 map 以便优先选 main
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

		// 尝试解析 ysm.json 自身（可能包含 minecraft.geometry）
		geoJSON = parseBedrockGeometry(data)
		if geoJSON == nil {
			// 检查 minecraft.geometry[0] 格式（部分 ysm.json 内联 geometry）
			var root struct {
				Minecraft struct {
					Geometry []json.RawMessage `json:"geometry"`
				} `json:"minecraft"`
			}
			if err := json.Unmarshal(data, &root); err == nil && len(root.Minecraft.Geometry) > 0 {
				wrapped := append([]byte(`{"format_version":"1.12.0","minecraft:geometry":[`), root.Minecraft.Geometry[0]...)
				wrapped = append(wrapped, ']', '}')
				geoJSON = parseBedrockGeometry(wrapped)
			}
		}

		// 尝试同目录或子目录 model 文件（解压 YSM 的 models/main.json）
		// 优先使用 ysm.json 指定的 model 文件，如果有多选优先选 "main"
		if geoJSON == nil {
			dir := filepath.Dir(modelPath)
			// 优先用 map key="main" 的文件
			if modelMapOrig != nil {
				if mainPath, ok := modelMapOrig["main"]; ok {
					for _, sub := range []string{"", "models/", "models\\"} {
						candidate := filepath.Join(dir, sub, mainPath)
						if _, err := os.Stat(candidate); err == nil {
							geoData, readErr := os.ReadFile(candidate)
							if readErr == nil {
								geoJSON = parseBedrockGeometry(geoData)
							}
							break
						}
					}
				}
			}
			// 没找到 main，或 main 不含 geometry，遍历所有指定 model 文件
			if geoJSON == nil {
				for _, mn := range modelNames {
					for _, sub := range []string{"", "models/", "models\\"} {
						candidate := filepath.Join(dir, sub, mn)
						if _, err := os.Stat(candidate); err == nil {
							geoData, readErr := os.ReadFile(candidate)
							if readErr == nil {
								geoJSON = parseBedrockGeometry(geoData)
							}
							break
						}
					}
					if geoJSON != nil {
						break
					}
				}
			}
		}

		// 递归搜索子目录中的 geometry JSON（排除 animations/ controller/ avatar/）
		if geoJSON == nil {
			dir := filepath.Dir(modelPath)
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
				// 跳过 ysm.json 自身
				if strings.EqualFold(path, modelPath) {
					return nil
				}
				if strings.HasSuffix(strings.ToLower(path), ".json") {
					geoData, readErr := os.ReadFile(path)
					if readErr == nil {
						gj := parseBedrockGeometry(geoData)
						if gj != nil {
							geoJSON = gj
						}
					}
				}
				return nil
			})
		}

		// 最后尝试裸 geometry 元素
		if geoJSON == nil {
			wrapped := append([]byte(`{"format_version":"1.12.0","minecraft:geometry":[`), data...)
			wrapped = append(wrapped, ']', '}')
			geoJSON = parseBedrockGeometry(wrapped)
		}

		// 解压后的 YSM 模型：搜索 textures/ 子目录获取纹理
		if len(texData) == 0 {
			dir := filepath.Dir(modelPath)
			texDir := filepath.Join(dir, "textures")
			if d, err := os.Stat(texDir); err == nil && d.IsDir() {
				entries, _ := os.ReadDir(texDir)
				for _, e := range entries {
					if e.IsDir() {
						continue
					}
					ext := strings.ToLower(filepath.Ext(e.Name()))
					if ext == ".png" || ext == ".jpg" || ext == ".tga" {
						texPath := filepath.Join(texDir, e.Name())
						texBytes, readErr := os.ReadFile(texPath)
						if readErr == nil {
							texData = append(texData, texBytes)
						}
					}
				}
			}
			// 也搜索同目录纹理
			entries, _ := os.ReadDir(dir)
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				ext := strings.ToLower(filepath.Ext(e.Name()))
				if ext == ".png" || ext == ".jpg" {
					texPath := filepath.Join(dir, e.Name())
					texBytes, readErr := os.ReadFile(texPath)
					if readErr == nil {
						texData = append(texData, texBytes)
					}
				}
			}
		}
	}

	if geoJSON == nil && (ext == ".zip" || ext == ".7z") {
		g := a.runYSMParserOnFile(modelPath)
		geoJSON = &g
	}
	if geoJSON == nil {
		return types.BedrockModel{}
	}

	var textures []string
	for _, td := range texData {
		if len(td) > 0 {
			textures = append(textures, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(td))
		}
	}
	if len(textures) > 0 {
		geoJSON.Texture = textures[0]
		geoJSON.Textures = textures
	}
	if len(animJSONs) > 0 {
		geoJSON.Animations = animJSONs
	}
	return *geoJSON
}

func (a *App) GetModel3DSpec(modelPath string) string {
	model := a.AnalyzeBedrockModel(modelPath)
	spec, err := threejs.Build(model)
	if err != nil {
		return "{}"
	}
	return spec
}

func findYSMParser() string {
	if exe, err := os.Executable(); err == nil {
		if p := filepath.Join(filepath.Dir(exe), "YSMParser.exe"); fileExists(p) {
			return p
		}
	}
	if wd, err := os.Getwd(); err == nil {
		if p := filepath.Join(wd, "YSMParser.exe"); fileExists(p) {
			return p
		}
	}
	if p, err := exec.LookPath("YSMParser.exe"); err == nil {
		return p
	}
	if p, err := exec.LookPath("YSMParser"); err == nil {
		return p
	}
	return ""
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func (a *App) runYSMParserOnFile(modelPath string) types.BedrockModel {
	parserPath := findYSMParser()
	if parserPath == "" {
		if data, err := os.ReadFile(modelPath); err == nil {
			if m := decodeYSMViaNodeJS(data); m != nil {
				return *m
			}
		}
		return types.BedrockModel{}
	}

	tmpDir, err := os.MkdirTemp("", "ysm-parser-*")
	if err != nil {
		return types.BedrockModel{}
	}
	defer os.RemoveAll(tmpDir)

	inDir := filepath.Join(tmpDir, "input")
	outDir := filepath.Join(tmpDir, "output")
	os.MkdirAll(inDir, 0755)
	os.MkdirAll(outDir, 0755)

	ysmCopy := filepath.Join(inDir, filepath.Base(modelPath))
	if err := copyFile(modelPath, ysmCopy); err != nil {
		return types.BedrockModel{}
	}

	cmd := exec.Command(parserPath, "-i", inDir, "-o", outDir)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Run(); err != nil {
		return types.BedrockModel{}
	}

	var merged *types.BedrockModel
	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(strings.ToLower(p), ".json") {
			return nil
		}
		if strings.HasSuffix(p, "ysm.json") {
			return nil
		}
		data, rErr := os.ReadFile(p)
		if rErr != nil {
			return nil
		}
		if g := parseBedrockGeometry(data); g != nil {
			if merged == nil {
				merged = g
			} else {
				merged.Bones = append(merged.Bones, g.Bones...)
				merged.BoneCount += g.BoneCount
				merged.CubeCount += g.CubeCount
				if g.TexWidth > merged.TexWidth {
					merged.TexWidth = g.TexWidth
				}
				if g.TexHeight > merged.TexHeight {
					merged.TexHeight = g.TexHeight
				}
			}
		}
		return nil
	})
	if merged == nil {
		return types.BedrockModel{}
	}

	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || merged.Texture != "" {
			return nil
		}
		low := strings.ToLower(p)
		if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
			if data, rErr := os.ReadFile(p); rErr == nil && len(data) > 0 {
				mime := "image/png"
				if strings.HasSuffix(low, ".jpg") {
					mime = "image/jpeg"
				}
				merged.Texture = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
			}
		}
		return nil
	})
	return *merged
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func parseBedrockFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string) {
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
			data, _ := io.ReadAll(rc)
			rc.Close()
			if len(data) > 0 {
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
				pngs = append(pngs, data)
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
		g := parseBedrockGeometry(gf.data)
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

func parseBedrockFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
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
			g := parseBedrockGeometry(buf)
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
			data, _ := io.ReadAll(rc)
			rc.Close()
			if len(data) > 0 {
				pngs = append(pngs, data)
			}
		}
	}
	return geo, pngs
}

func parseBedrockGeometry(data []byte) *types.BedrockModel {
	var raw struct {
		FormatVersion string `json:"format_version"`
		Geometry      []struct {
			Description struct {
				Identifier    string  `json:"identifier"`
				TextureWidth  float64 `json:"texture_width"`
				TextureHeight float64 `json:"texture_height"`
			} `json:"description"`
			Bones []struct {
				Name     string          `json:"name"`
				Parent   string          `json:"parent,omitempty"`
				Pivot    [3]float64      `json:"pivot"`
				Rotation json.RawMessage `json:"rotation,omitempty"`
				Cubes    []struct {
					Origin   [3]float64      `json:"origin"`
					Size     [3]float64      `json:"size"`
					Pivot    [3]float64      `json:"pivot,omitempty"`
					UV       json.RawMessage `json:"uv,omitempty"`
					Rotation json.RawMessage `json:"rotation,omitempty"`
				} `json:"cubes"`
			} `json:"bones"`
		} `json:"minecraft:geometry"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}
	if len(raw.Geometry) == 0 {
		return nil
	}
	g := raw.Geometry[0]
	model := &types.BedrockModel{
		Format:    raw.FormatVersion,
		TexWidth:  int(g.Description.TextureWidth),
		TexHeight: int(g.Description.TextureHeight),
	}
	var cubeTotal int
	for _, b := range g.Bones {
		cubes := make([]types.Cube2D, 0, len(b.Cubes))
		for _, c := range b.Cubes {
			var uv [2]float64
			var faceUV string
			var rot [3]float64
			if len(c.UV) > 0 {
				uvStr := string(c.UV)
				if len(uvStr) > 0 && uvStr[0] == '{' {
					faceUV = uvStr
				} else {
					json.Unmarshal(c.UV, &uv)
				}
			}
			if len(c.Rotation) > 0 {
				json.Unmarshal(c.Rotation, &rot)
			}
			cubes = append(cubes, types.Cube2D{
				Origin: c.Origin, Size: c.Size, Pivot: c.Pivot,
				UV: uv, FaceUV: faceUV, Rotation: rot,
			})
		}
		var boneRot [3]float64
		if len(b.Rotation) > 0 {
			json.Unmarshal(b.Rotation, &boneRot)
		}
		model.Bones = append(model.Bones, types.Bone2D{
			Name: b.Name, Parent: b.Parent, Pivot: b.Pivot,
			Rotation: boneRot, Cubes: cubes,
		})
		cubeTotal += len(cubes)
	}
	model.BoneCount = len(g.Bones)
	model.CubeCount = cubeTotal
	return model
}
