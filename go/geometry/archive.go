// ===== 从压缩包中提取并解析 Bedrock Geometry =====
// 支持 ZIP（YSM 标准格式）和 7z 格式
package geometry

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"log"
	"sort"
	"strings"

	"ysm-model-manager/go/types"

	"github.com/bodgit/sevenzip"
)

// maxExtractSize 单个文件最大读取大小（ZIP/7z 内文件），防止 ZIP 炸弹
const maxExtractSize = 50 << 20 // 50MB

// readLimitedEntry 读取 zip/7z 单条目：limit+1 探测截断（ADR-033 修复）——
// 原 `io.ReadAll(io.LimitReader(rc, maxExtractSize))` 截断后 err==nil 静默，
// 超 50MB 的 PNG/geometry 会被截断后继续使用（损坏数据装盘）。
// 读取错误或超限返回 nil，调用方跳过该条目。
func readLimitedEntry(rc io.ReadCloser) []byte {
	defer rc.Close()
	buf, err := io.ReadAll(io.LimitReader(rc, int64(maxExtractSize)+1))
	if err != nil || len(buf) > maxExtractSize {
		return nil
	}
	return buf
}

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
			buf := readLimitedEntry(rc)
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
			buf := readLimitedEntry(rc)
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
	var animJSONs []string

	var modelOrder []string
	var texOrder []string
	for _, f := range reader.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, "ysm.json") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf := readLimitedEntry(rc)
			var ysm struct {
				Properties struct {
					DefaultTexture string `json:"default_texture"`
				} `json:"properties"`
				Files struct {
					Player struct {
						Model   json.RawMessage `json:"model"`
						Texture json.RawMessage `json:"texture"`
					} `json:"player"`
				} `json:"files"`
			}
			if err := json.Unmarshal(buf, &ysm); err != nil {
				log.Printf("[geometry] 解析 ysm.json 失败: %v", err)
			} else {
				// 解析 texture 顺序
				if len(ysm.Files.Player.Texture) > 0 {
					texRaw := string(ysm.Files.Player.Texture)
					if strings.HasPrefix(strings.TrimSpace(texRaw), `[`) {
						var arr []json.RawMessage
						if json.Unmarshal(ysm.Files.Player.Texture, &arr) == nil {
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
										texOrder = append(texOrder, strings.ToLower(tn))
									}
								} else {
									var sval string
									if json.Unmarshal(item, &sval) == nil && sval != "" {
										tn := sval
										if idx := strings.LastIndex(tn, "/"); idx >= 0 {
											tn = tn[idx+1:]
										}
										texOrder = append(texOrder, strings.ToLower(tn))
									}
								}
							}
						}
					}
				}
				// 解析 model 字段（支持 4 种格式）
				raw := strings.TrimSpace(string(ysm.Files.Player.Model))
				if len(raw) > 0 {
					if raw[0] == '[' {
						var arr []json.RawMessage
						if json.Unmarshal(ysm.Files.Player.Model, &arr) == nil {
							for _, item := range arr {
								s := strings.TrimSpace(string(item))
								if len(s) > 0 && s[0] == '{' {
									var obj struct {
										Path string `json:"path"`
										Name string `json:"name"`
									}
									if json.Unmarshal(item, &obj) == nil {
										n := obj.Path
										if n == "" {
											n = obj.Name
										}
										if n != "" {
											modelOrder = append(modelOrder, n)
										}
									}
								} else {
									var sval string
									if json.Unmarshal(item, &sval) == nil && sval != "" {
										modelOrder = append(modelOrder, sval)
									}
								}
							}
						}
					} else if raw[0] == '{' {
						var mm map[string]string
						if json.Unmarshal(ysm.Files.Player.Model, &mm) == nil {
							// map 遍历顺序随机，按 key 排序保证 modelOrder 稳定（texSlot 绑定一致）
							keys := make([]string, 0, len(mm))
							for k := range mm {
								keys = append(keys, k)
							}
							sort.Strings(keys)
							for _, k := range keys {
								modelOrder = append(modelOrder, mm[k])
							}
						}
					} else {
						var sval string
						if json.Unmarshal(ysm.Files.Player.Model, &sval) == nil && sval != "" {
							modelOrder = append(modelOrder, sval)
						}
					}
				}
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
				buf, _ := io.ReadAll(io.LimitReader(rc, maxExtractSize))
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
			buf := readLimitedEntry(rc)
			geoFiles = append(geoFiles, geoEntry{name: f.Name, data: buf})
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !f.FileInfo().IsDir() && !strings.Contains(low, "avatar/") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			pngData := readLimitedEntry(rc)
			if len(pngData) > 4096 { // 过滤 <4KB 的头像/预览图
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

	// 建立模型文件→纹理索引映射
	texIdxMap := make(map[string]int)
	texCount := len(texOrder)
	if texCount == 0 {
		texCount = len(modelOrder)
	}
	if len(modelOrder) > 0 {
		for i, p := range modelOrder {
			p = strings.ReplaceAll(p, "\\", "/")
			if idx := strings.LastIndex(p, "/"); idx >= 0 {
				p = p[idx+1:]
			}
			ti := i
			if ti >= texCount {
				ti = texCount - 1
			}
			texIdxMap[strings.TrimSuffix(p, ".json")] = ti
		}
	}

	for _, gf := range geoFiles {
		g := ParseBedrockGeometry(gf.data)
		if g == nil || g.BoneCount == 0 {
			continue
		}
		// 每个 cube 记住来源文件 tex 维度
		for bi := range g.Bones {
			for ci := range g.Bones[bi].Cubes {
				g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
				g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
			}
		}
		// 按模型文件位置设置 cube 纹理索引
		geoName := gf.name
		if idx := strings.LastIndex(geoName, "/"); idx >= 0 {
			geoName = geoName[idx+1:]
		}
		geoName = strings.TrimSuffix(strings.TrimSuffix(geoName, ".json"), ".geo.json")
		ti, hasTex := texIdxMap[geoName]
		if hasTex {
			for bi := range g.Bones {
				for ci := range g.Bones[bi].Cubes {
					g.Bones[bi].Cubes[ci].TexSlot = ti
				}
			}
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

	if len(texOrder) > 0 {
		// P2 修复：orderMap 的 key 必须与查询 key 同口径——
		// texOrder 条目是「小写 basename 含扩展名」（如 tex1.png），而查询 key 是
		// `strings.ToLower(pngNames[i])`（pngNames 已 TrimSuffix 去扩展名，如 tex1），
		// 原实现 key 永不命中 → 「纹理按声明顺序排序」形同死代码，TexSlot 绑定错位。
		orderMap := make(map[string]int, len(texOrder))
		for i, n := range texOrder {
			bn := strings.TrimSuffix(n, ".png")
			bn = strings.TrimSuffix(bn, ".jpg")
			orderMap[bn] = i
		}
		sort.SliceStable(pngs, func(i, j int) bool {
			oi, hasI := orderMap[strings.ToLower(pngNames[i])]
			oj, hasJ := orderMap[strings.ToLower(pngNames[j])]
			if hasI && hasJ {
				return oi < oj
			}
			return hasI
		})
		sort.SliceStable(pngNames, func(i, j int) bool {
			oi, hasI := orderMap[strings.ToLower(pngNames[i])]
			oj, hasJ := orderMap[strings.ToLower(pngNames[j])]
			if hasI && hasJ {
				return oi < oj
			}
			return hasI
		})
	}
	return geo, pngs, animJSONs
}

// ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理
func ParseFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	reader, err := sevenzip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		log.Printf("[geometry] 打开 7z 失败: %v", err)
		return nil, nil
	}
	var geo *types.BedrockModel
	var pngs [][]byte
	var pngNames []string
	var modelOrder []string
	var texOrder []string

	for _, f := range reader.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, "ysm.json") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf := readLimitedEntry(rc)
			var ysm struct {
				Properties struct {
					DefaultTexture string `json:"default_texture"`
				} `json:"properties"`
				Files struct {
					Player struct {
						Model   json.RawMessage `json:"model"`
						Texture json.RawMessage `json:"texture"`
					} `json:"player"`
				} `json:"files"`
			}
			if err := json.Unmarshal(buf, &ysm); err != nil {
				log.Printf("[geometry] 7z 解析 ysm.json 失败: %v", err)
			} else {
				// 解析 texture 顺序
				if len(ysm.Files.Player.Texture) > 0 {
					texRaw := string(ysm.Files.Player.Texture)
					if strings.HasPrefix(strings.TrimSpace(texRaw), `[`) {
						var arr []json.RawMessage
						if json.Unmarshal(ysm.Files.Player.Texture, &arr) == nil {
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
										texOrder = append(texOrder, strings.ToLower(tn))
									}
								} else {
									var sval string
									if json.Unmarshal(item, &sval) == nil && sval != "" {
										tn := sval
										if idx := strings.LastIndex(tn, "/"); idx >= 0 {
											tn = tn[idx+1:]
										}
										texOrder = append(texOrder, strings.ToLower(tn))
									}
								}
							}
						}
					}
				}
				raw := strings.TrimSpace(string(ysm.Files.Player.Model))
				if len(raw) > 0 {
					if raw[0] == '[' {
						var arr []json.RawMessage
						if json.Unmarshal(ysm.Files.Player.Model, &arr) == nil {
							for _, item := range arr {
								s := strings.TrimSpace(string(item))
								if len(s) > 0 && s[0] == '{' {
									var obj struct {
										Path string `json:"path"`
										Name string `json:"name"`
									}
									if json.Unmarshal(item, &obj) == nil {
										n := obj.Path
										if n == "" {
											n = obj.Name
										}
										if n != "" {
											modelOrder = append(modelOrder, n)
										}
									}
								} else {
									var sval string
									if json.Unmarshal(item, &sval) == nil && sval != "" {
										modelOrder = append(modelOrder, sval)
									}
								}
							}
						}
					} else if raw[0] == '{' {
						var mm map[string]string
						if json.Unmarshal(ysm.Files.Player.Model, &mm) == nil {
							// P2 修复：map 遍历顺序随机会导致 modelOrder 每次不同、
							// TexSlot 绑定漂移（与 ZIP 路径 archive.go 的 sort.Strings 对齐）
							keys := make([]string, 0, len(mm))
							for k := range mm {
								keys = append(keys, k)
							}
							sort.Strings(keys)
							for _, k := range keys {
								modelOrder = append(modelOrder, mm[k])
							}
						}
					} else {
						var sval string
						if json.Unmarshal(ysm.Files.Player.Model, &sval) == nil && sval != "" {
							modelOrder = append(modelOrder, sval)
						}
					}
				}
			}
			break
		}
	}

	// 按 modelOrder 排序 geo 文件
	type geoEntry struct {
		name string
		data []byte
	}
	var geoFiles []geoEntry
	for _, f := range reader.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, ".json") && !strings.Contains(low, "ysm.json") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf := readLimitedEntry(rc)
			geoFiles = append(geoFiles, geoEntry{name: f.Name, data: buf})
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

	// 建立 texIdx 映射
	texIdxMap := make(map[string]int)
	texCount := len(texOrder)
	if texCount == 0 {
		texCount = len(modelOrder)
	}
	for i, p := range modelOrder {
		p = strings.ReplaceAll(p, "\\", "/")
		if idx := strings.LastIndex(p, "/"); idx >= 0 {
			p = p[idx+1:]
		}
		ti := i
		if ti >= texCount {
			ti = texCount - 1
		}
		texIdxMap[strings.TrimSuffix(p, ".json")] = ti
	}

	// 解析 geometry
	for _, gf := range geoFiles {
		g := ParseBedrockGeometry(gf.data)
		if g == nil || g.BoneCount == 0 {
			continue
		}
		for bi := range g.Bones {
			for ci := range g.Bones[bi].Cubes {
				g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
				g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
			}
		}
		geoName := gf.name
		if idx := strings.LastIndex(geoName, "/"); idx >= 0 {
			geoName = geoName[idx+1:]
		}
		geoName = strings.TrimSuffix(strings.TrimSuffix(geoName, ".json"), ".geo.json")
		if ti, hasTex := texIdxMap[geoName]; hasTex {
			for bi := range g.Bones {
				for ci := range g.Bones[bi].Cubes {
					g.Bones[bi].Cubes[ci].TexSlot = ti
				}
			}
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

	// 提取 PNG
	for _, f := range reader.File {
		low := strings.ToLower(f.Name)
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !f.FileInfo().IsDir() && !strings.Contains(low, "avatar/") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			pngData := readLimitedEntry(rc)
			if len(pngData) > 4096 {
				name := f.Name
				if idx := strings.LastIndex(name, "/"); idx >= 0 {
					name = name[idx+1:]
				}
				if idx := strings.LastIndex(name, "\\"); idx >= 0 {
					name = name[idx+1:]
				}
				name = strings.TrimSuffix(strings.TrimSuffix(name, ".png"), ".jpg")
				pngNames = append(pngNames, name)
				pngs = append(pngs, pngData)
			}
		}
	}
	if len(texOrder) > 0 {
		// P2 修复：orderMap 的 key 必须与查询 key 同口径——
		// texOrder 条目是「小写 basename 含扩展名」（如 tex1.png），而查询 key 是
		// `strings.ToLower(pngNames[i])`（pngNames 已 TrimSuffix 去扩展名，如 tex1），
		// 原实现 key 永不命中 → 「纹理按声明顺序排序」形同死代码，TexSlot 绑定错位。
		orderMap := make(map[string]int, len(texOrder))
		for i, n := range texOrder {
			bn := strings.TrimSuffix(n, ".png")
			bn = strings.TrimSuffix(bn, ".jpg")
			orderMap[bn] = i
		}
		sort.SliceStable(pngs, func(i, j int) bool {
			oi, hasI := orderMap[strings.ToLower(pngNames[i])]
			oj, hasJ := orderMap[strings.ToLower(pngNames[j])]
			if hasI && hasJ {
				return oi < oj
			}
			return hasI
		})
		sort.SliceStable(pngNames, func(i, j int) bool {
			oi, hasI := orderMap[strings.ToLower(pngNames[i])]
			oj, hasJ := orderMap[strings.ToLower(pngNames[j])]
			if hasI && hasJ {
				return oi < oj
			}
			return hasI
		})
	}
	return geo, pngs
}
