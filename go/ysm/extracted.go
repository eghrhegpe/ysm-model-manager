// ===== 解压后 YSM 模型目录中的 geometry/纹理查找 =====
// 当用户点击 ysm.json（解压后的 YSM 模型目录）时，
// 需要在此目录中搜索 geometry JSON 文件和纹理文件。
package ysm

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

// isArmModelName 判断模型文件是否为第一人称手臂模型（arm.json / arm.geo.json）。
// 该类文件是游戏第一人称视角的手臂几何，与 main.json 的手臂重叠，
// 合并会渲染出两对手臂，加载时须排除。
func isArmModelName(name string) bool {
	base := strings.ToLower(name)
	if idx := strings.LastIndexAny(base, "/\\"); idx >= 0 {
		base = base[idx+1:]
	}
	base = strings.TrimSuffix(base, ".json")
	return base == "arm" || base == "arm.geo"
}

// FindGeometryInExtractedYSM 在解压后的 YSM 模型目录中查找 geometry 和纹理
// ysmJsonPath: ysm.json 的完整路径
// 返回: 合并后的 BedrockModel（不含纹理 base64），纹理原始字节
func FindGeometryInExtractedYSM(ysmJsonPath string) (*types.BedrockModel, [][]byte) {
	data, err := os.ReadFile(ysmJsonPath)
	if err != nil {
		return nil, nil
	}

	// 解析 ysm.json 找 model 文件名 + 纹理顺序
	var ysmRoot struct {
		Spec  int             `json:"spec"`
		Files json.RawMessage `json:"files"`
	}
	var modelNames []string
	var modelMapOrig map[string]string
	var texOrderNames []string // ysm.json 规定的纹理顺序（文件名）
	if err := json.Unmarshal(data, &ysmRoot); err == nil {
		var filesObj map[string]json.RawMessage
		if json.Unmarshal(ysmRoot.Files, &filesObj) == nil {
			for key, val := range filesObj {
				if key != "player" {
					continue
				}
				var player struct {
					Model   json.RawMessage `json:"model"`
					Texture json.RawMessage `json:"texture"`
				}
				if err := json.Unmarshal(val, &player); err != nil {
					log.Printf("[ysm] 解析 player 失败: %v", err)
					continue
				}
				// 解析 model
				if len(player.Model) > 0 {
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
				// 解析 texture 顺序
				if len(player.Texture) > 0 {
					texRaw := string(player.Texture)
					if strings.HasPrefix(strings.TrimSpace(texRaw), `[`) {
						var arr []json.RawMessage
						if json.Unmarshal(player.Texture, &arr) == nil {
							for _, item := range arr {
								s := strings.TrimSpace(string(item))
								if strings.HasPrefix(s, `{`) {
									var obj struct {
										Uv string `json:"uv"`
									}
									if json.Unmarshal(item, &obj) == nil && obj.Uv != "" {
										tn := obj.Uv
										if idx := strings.LastIndex(tn, "/"); idx >= 0 {
											tn = tn[idx+1:]
										}
										if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
											tn = tn[idx+1:]
										}
										texOrderNames = append(texOrderNames, strings.ToLower(tn))
									}
								} else {
									var sval string
									if json.Unmarshal(item, &sval) == nil && sval != "" {
										tn := sval
										if idx := strings.LastIndex(tn, "/"); idx >= 0 {
											tn = tn[idx+1:]
										}
										texOrderNames = append(texOrderNames, strings.ToLower(tn))
									}
								}
							}
						}
					}
				}
			}
		}
	}

	var geoJSON *types.BedrockModel
	dir := filepath.Dir(ysmJsonPath)

	// 加载全部模型文件（main 排首位 texIdx=0），但排除第一人称手臂模型 arm.json：
	// arm 是游戏第一人称视角的手臂几何，与 main.json 的手臂（第三人称全身已含）重叠，
	// 合并会渲染出两对手臂（双手臂问题）。
	var orderedNames []string
	if modelMapOrig != nil {
		if mainPath, ok := modelMapOrig["main"]; ok {
			orderedNames = append(orderedNames, mainPath)
		}
		// 排序非 main 键，确保遍历顺序确定性（ADR-039 P3：map 遍历随机 → texSlot 漂移）
		var otherKeys []string
		for k := range modelMapOrig {
			if k != "main" && !isArmModelName(modelMapOrig[k]) {
				otherKeys = append(otherKeys, k)
			}
		}
		sort.Strings(otherKeys)
		for _, k := range otherKeys {
			orderedNames = append(orderedNames, modelMapOrig[k])
		}
	} else {
		for _, n := range modelNames {
			if !isArmModelName(n) {
				orderedNames = append(orderedNames, n)
			}
		}
	}
	maxTexIdx := len(texOrderNames) - 1
	if maxTexIdx < 0 {
		maxTexIdx = 0
	}
	for i, mn := range orderedNames {
		for _, sub := range []string{"", "models/", "models\\"} {
			candidate := filepath.Join(dir, sub, mn)
			// P2 修复：路径穿越防护——确保拼接后的 candidate 仍在 ysm.json 所在目录内
			candidate = filepath.Clean(candidate)
			cleanDir := filepath.Clean(dir)
			if !strings.HasPrefix(candidate, cleanDir+string(filepath.Separator)) && candidate != cleanDir {
				log.Printf("[ysm] 拒绝路径越界模型文件: %q (期望在 %q 内)", candidate, cleanDir)
				continue
			}
			if _, err := os.Stat(candidate); err == nil {
				ti := i
				if ti > maxTexIdx {
					ti = maxTexIdx
				}
				log.Printf("[ysm] 加载模型文件 %q (texIdx=%d)", candidate, ti)
				geoData, readErr := os.ReadFile(candidate)
				if readErr == nil {
					gj := geometry.ParseBedrockGeometry(geoData)
					if gj != nil {
						for bi := range gj.Bones {
							for ci := range gj.Bones[bi].Cubes {
								gj.Bones[bi].Cubes[ci].TexSlot = ti
								gj.Bones[bi].Cubes[ci].CubeTexW = gj.TexWidth
								gj.Bones[bi].Cubes[ci].CubeTexH = gj.TexHeight
							}
						}
						if geoJSON == nil {
							geoJSON = gj
						} else {
							geoJSON.Bones = append(geoJSON.Bones, gj.Bones...)
							geoJSON.BoneCount += gj.BoneCount
							geoJSON.CubeCount += gj.CubeCount
						}
					}
				}
				break
			}
		}
	}

	// 兜底：尝试解析 ysm.json 自身（可能包含 minecraft.geometry）
	if geoJSON == nil {
		geoJSON = geometry.ParseBedrockGeometry(data)
	}
	if geoJSON == nil {
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

	// 递归搜索子目录（排除 animations/controller/avatar），限制深度 10 层
	if geoJSON == nil {
		excludeDirs := map[string]bool{"animations": true, "controller": true, "avatar": true}
		filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				log.Printf("[ysm] WalkDir 错误 (忽略): %v", err)
				return nil
			}
			if geoJSON != nil {
				return filepath.SkipAll
			}
			if d.IsDir() {
				if excludeDirs[strings.ToLower(d.Name())] {
					return filepath.SkipDir
				}
				// 用 filepath.Rel 计算深度，避免闭包变量递减问题
				rel, relErr := filepath.Rel(dir, path)
				if relErr == nil && strings.Count(rel, string(filepath.Separator)) > 10 {
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
						for bi := range gj.Bones {
							for ci := range gj.Bones[bi].Cubes {
								gj.Bones[bi].Cubes[ci].CubeTexW = gj.TexWidth
								gj.Bones[bi].Cubes[ci].CubeTexH = gj.TexHeight
							}
						}
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

	// 搜索纹理（递归遍历 textures/ 下所有子目录）
	var texData [][]byte
	texDir := filepath.Join(dir, "textures")
	var texFiles []struct {
		path string
		name string
	}
	if d, err := os.Stat(texDir); err == nil && d.IsDir() {
		filepath.WalkDir(texDir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if ext == ".png" || ext == ".jpg" || ext == ".tga" {
				texFiles = append(texFiles, struct {
					path string
					name string
				}{path, strings.ToLower(d.Name())})
			}
			return nil
		})
	}
	// 也搜索同目录纹理
	if len(texFiles) == 0 {
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			ext := strings.ToLower(filepath.Ext(e.Name()))
			if ext == ".png" || ext == ".jpg" {
				texFiles = append(texFiles, struct {
					path string
					name string
				}{filepath.Join(dir, e.Name()), strings.ToLower(e.Name())})
			}
		}
	}
	// 按 ysm.json 纹理顺序排序
	if len(texOrderNames) > 0 {
		orderMap := make(map[string]int, len(texOrderNames))
		for i, n := range texOrderNames {
			orderMap[n] = i
		}
		sort.SliceStable(texFiles, func(i, j int) bool {
			oi, hasI := orderMap[texFiles[i].name]
			oj, hasJ := orderMap[texFiles[j].name]
			if hasI && hasJ {
				return oi < oj
			}
			return hasI
		})
	}
	// 读取纹理数据
	for _, tf := range texFiles {
		texBytes, readErr := os.ReadFile(tf.path)
		if readErr == nil && len(texBytes) > 0 {
			texData = append(texData, texBytes)
		}
	}

	return geoJSON, texData
}

// isDir 判断路径是否为目录
func isDir(path string) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.IsDir()
}

// FindComponentsInExtractedYSM 多组件解析（YSMViewer 式）：解压目录内每个模型文件独立组件，
// **不合并 bones、不排除 arm**（arm/载具为独立组件）；main 优先排序 + 补扫 models/ 目录
// （projectiles/vehicles 等 player.model 未列出的 geometry 也作为组件）；
// TexSlot = 全局组件序（对齐 WASM 路径 decodeYSMComponentsViaNodeJS）。
// 供 GetModel3DSpec → threejs.BuildMulti 生成多组件 spec。
// 注：ysm.json player.model 解析逻辑与 FindGeometryInExtractedYSM 同源；
// v1 内联复制避免大重构，后续可抽公共解析函数。
func FindComponentsInExtractedYSM(ysmJsonPath string) []types.BedrockModel {
	data, err := os.ReadFile(ysmJsonPath)
	if err != nil {
		return nil
	}

	// 解析 ysm.json 找 model 文件名（player.model）
	var ysmRoot struct {
		Spec  int             `json:"spec"`
		Files json.RawMessage `json:"files"`
	}
	var modelNames []string
	var modelMapOrig map[string]string
	if err := json.Unmarshal(data, &ysmRoot); err == nil {
		var filesObj map[string]json.RawMessage
		if json.Unmarshal(ysmRoot.Files, &filesObj) == nil {
			for key, val := range filesObj {
				if key != "player" {
					continue
				}
				var player struct {
					Model json.RawMessage `json:"model"`
				}
				if err := json.Unmarshal(val, &player); err != nil {
					log.Printf("[ysm] 解析 player 失败: %v", err)
					continue
				}
				if len(player.Model) > 0 {
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
						modelNames = append(modelNames, strings.Trim(trimmed, `"`))
					}
				}
			}
		}
	}

	dir := filepath.Dir(ysmJsonPath)
	// 组件顺序：main 优先 + 其余键排序（含 arm/载具，不排除；多组件下 arm 为独立组件）
	var orderedNames []string
	if modelMapOrig != nil {
		if mainPath, ok := modelMapOrig["main"]; ok {
			orderedNames = append(orderedNames, mainPath)
		}
		var otherKeys []string
		for k := range modelMapOrig {
			if k != "main" {
				otherKeys = append(otherKeys, k)
			}
		}
		sort.Strings(otherKeys)
		for _, k := range otherKeys {
			orderedNames = append(orderedNames, modelMapOrig[k])
		}
	} else {
		orderedNames = modelNames
		// 数组/字符串形声明也要 main 优先（对齐 map 分支与 zip/WASM 路径，
		// 否则 arm 声明在前时 TexSlot=组件序会让 arm 占 0、main 纹理错位，P2）：
		// 稳定排序保持非 main 组件相对声明顺序。
		sort.SliceStable(orderedNames, func(i, j int) bool {
			mi := geometry.IsMainModelName(orderedNames[i])
			mj := geometry.IsMainModelName(orderedNames[j])
			return mi && !mj
		})
	}

	// 补扫 models/ 目录：player.model 未列出的 geometry（projectiles/vehicles 等
	// 游戏实体组件如 arrow/boat/foxcar）也作为独立组件收集，与 WASM 解码路径对齐
	// （decodeYSMComponentsViaNodeJS 收 models/ 全部）；按文件名排序（确定性）
	seen := make(map[string]bool, len(orderedNames))
	for _, n := range orderedNames {
		seen[strings.ToLower(filepath.Base(n))] = true
	}
	if modelsDir := filepath.Join(dir, "models"); isDir(modelsDir) {
		var extra []string
		if entries, err := os.ReadDir(modelsDir); err == nil {
			for _, e := range entries {
				if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
					continue
				}
				if seen[strings.ToLower(e.Name())] {
					continue
				}
				extra = append(extra, filepath.Join("models", e.Name()))
			}
			sort.Strings(extra)
			orderedNames = append(orderedNames, extra...)
		}
	}

	var comps []types.BedrockModel
	for i, mn := range orderedNames {
		for _, sub := range []string{"", "models/", "models\\"} {
			candidate := filepath.Join(dir, sub, mn)
			// 路径穿越防护：确保 candidate 仍在 ysm.json 所在目录内
			candidate = filepath.Clean(candidate)
			cleanDir := filepath.Clean(dir)
			if !strings.HasPrefix(candidate, cleanDir+string(filepath.Separator)) && candidate != cleanDir {
				log.Printf("[ysm] 拒绝路径越界模型文件: %q (期望在 %q 内)", candidate, cleanDir)
				continue
			}
			if _, err := os.Stat(candidate); err == nil {
				geoData, readErr := os.ReadFile(candidate)
				if readErr == nil {
					gj := geometry.ParseBedrockGeometry(geoData)
					if gj != nil {
						// TexSlot = 全局组件序（前端 texArr 含全部组件纹理：
						// texOrderNames 优先 + 其余按名，与补扫排序一致）
						for bi := range gj.Bones {
							for ci := range gj.Bones[bi].Cubes {
								gj.Bones[bi].Cubes[ci].TexSlot = i
								gj.Bones[bi].Cubes[ci].CubeTexW = gj.TexWidth
								gj.Bones[bi].Cubes[ci].CubeTexH = gj.TexHeight
							}
						}
						comps = append(comps, *gj)
					}
				}
				break
			}
		}
	}
	return comps
}
