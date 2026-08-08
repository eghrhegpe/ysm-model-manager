// ========== YSM 模型解析 ==========
// 从 app.go 拆分：模型文件分析、几何体解析、CLI fallback
package app

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
		// P2 修复：解析失败不再完全静默——记录日志便于诊断。
		// 绑定签名保持单返回值（不破坏前端契约），前端 detail.ts 有 hasRealSummary 兜底 toast
		log.Printf("[ysm] ExtractYsmSummary 解析失败 %s: %v", path, err)
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
	// 路径守卫：限制在 FilesRoot 内，防止读取系统任意文件
	root := a.ysmRoot()
	if root == "" {
		return nil
	}
	clean := filepath.Clean(path)
	rel, err := filepath.Rel(root, clean)
	if err != nil || strings.HasPrefix(rel, "..") {
		return nil
	}
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
	// 多组件路径（YSMViewer 式）：.ysm（WASM 解码）/ .zip / 解压目录 ysm.json
	// 各自组件独立构建，合并 spec.models；纹理 texIdx 由解析层全局化（组件 i → i），
	// 前端 texArr 全局数组按序索引。
	ext := strings.ToLower(filepath.Ext(modelPath))
	if comps, texNames := a.collect3DComponents(modelPath, ext); len(comps) > 0 {
		spec, err := threejs.BuildMulti(comps, nil)
		if err == nil && spec != "{}" {
			// R1 契约：注入组件序纹理名（texArrOrder），前端比对 texArr 序防止贴错纹理
			if len(texNames) > 0 {
				spec = injectTexArrOrder(spec, texNames)
			}
			return spec
		}
	}
	// 单组件兜底（.7z 或多组件失败时）
	model := a.AnalyzeBedrockModel(modelPath)
	spec, err := threejs.Build(model)
	if err != nil {
		return "{}"
	}
	return spec
}

// injectTexArrOrder 在 spec JSON 中注入 texArrOrder（组件序纹理名数组，R1 契约）。
// 前端拿到后与 model.textureNames（texArr 实际序）比对，不一致即纹理错位预警。
func injectTexArrOrder(spec string, texNames []string) string {
	var m map[string]any
	if err := json.Unmarshal([]byte(spec), &m); err != nil {
		return spec
	}
	m["texArrOrder"] = texNames
	b, err := json.Marshal(m)
	if err != nil {
		return spec
	}
	return string(b)
}

// collect3DComponents 收集多组件列表（含 arm/载具等独立组件，不合并 bones）。
// 返回 (组件列表, 组件序纹理名数组)——后者仅 zip/解压目录路径有（R1 契约）；
// .ysm WASM 路径无 ysm.json texture 声明，返回 nil（前端跳过比对）。
func (a *App) collect3DComponents(modelPath, ext string) ([]types.BedrockModel, []string) {
	switch ext {
	case ".ysm":
		if data, err := os.ReadFile(modelPath); err == nil {
			return decodeYSMComponentsViaNodeJS(data)
		}
	case ".zip":
		if data, err := os.ReadFile(modelPath); err == nil {
			if comps, tn, cerr := geometry.ParseComponentsFromZip(data, int64(len(data))); cerr == nil {
				return comps, tn
			}
		}
	case ".7z":
		if data, err := os.ReadFile(modelPath); err == nil {
			if comps, tn, cerr := geometry.ParseComponentsFrom7z(data, int64(len(data))); cerr == nil {
				return comps, tn
			}
		}
	case ".json":
		// 解压目录的 ysm.json 路径
		if strings.HasSuffix(strings.ToLower(modelPath), "ysm.json") {
			return ysm.FindComponentsInExtractedYSM(modelPath)
		}
	}
	return nil, nil
}

// SaveScreenshotFile 保存 base64 PNG 到磁盘（供 JS 批量截图用）
// 路径守卫：限制在 os.TempDir()/ysm-preview 内，禁止绝对路径与路径穿越（.. 段）
func (a *App) SaveScreenshotFile(filename string, base64Data string) error {
	clean := filepath.Clean(filename)
	// 用 filepath.Base 比对：合法纯文件名 Clean 后等于自身；含目录/穿越段会被拒绝。
	// 不能用 strings.Contains(clean, "..") —— 会误杀 my..file.png 这类合法文件名
	if filepath.IsAbs(clean) || filepath.Base(clean) != clean {
		return fmt.Errorf("文件名不能包含路径")
	}
	tmpDir := filepath.Join(os.TempDir(), "ysm-preview")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		return err
	}
	dest := filepath.Join(tmpDir, clean)
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return err
	}
	return os.WriteFile(dest, data, 0644)
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
			for bi := range g.Bones {
				for ci := range g.Bones[bi].Cubes {
					g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
					g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				}
			}
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
