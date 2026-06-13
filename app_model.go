// ========== YSM 模型解析 ==========
// 从 app.go 拆分：模型文件分析、几何体解析、CLI fallback
package main

import (
	"encoding/base64"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/threejs"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
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
		geoJSON, texData = ysm.FindGeometryInExtractedYSM(modelPath)
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

func (a *App) runYSMParserOnFile(modelPath string) types.BedrockModel {
	parserPath := ysm.FindCLI()
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
	return geometry.ParseFromZip(data, size)
}

func parseBedrockFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	return geometry.ParseFrom7z(data, size)
}

func parseBedrockGeometry(data []byte) *types.BedrockModel {
	return geometry.ParseBedrockGeometry(data)
}
