// ===== 从压缩包中提取并解析 Bedrock Geometry =====
// 支持 ZIP（YSM 标准格式）和 7z 格式
package geometry

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
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

// filterArmModels 移除模型顺序表中的第一人称手臂模型占位：
// 避免 arm.json 占据 texIdx 槽位导致 main 纹理错位。
func filterArmModels(order []string) []string {
	out := make([]string, 0, len(order))
	for _, p := range order {
		if !isArmModelName(p) {
			out = append(out, p)
		}
	}
	return out
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
// archiveEntry 统一 zip.File 与 sevenzip.File 的访问（两者 Name 均为字段而非方法，
// 故用 struct 包装 name + file 接口，避免 Go slice 协变与字段/方法差异）。
type archiveEntry struct {
	name string
	file interface {
		FileInfo() fs.FileInfo
		Open() (io.ReadCloser, error)
	}
}

type geoEntry struct {
	name string
	data []byte
}

// collectArchiveFiles 从压缩包收集 ysm.json 映射/模型文件/纹理（合并版与组件版共用）。
// 与 ParseFromZip 原内联逻辑等价，但 geoFiles **不排除 arm**（arm 过滤由合并版调用方
// filterArmModels 做；组件版需要 arm 作为独立组件）。
func collectArchiveFiles(entries []archiveEntry) (modelOrder, texOrder []string, geoFiles []geoEntry, pngs [][]byte, pngNames, animJSONs []string) {
	for _, e := range entries {
		f := e.file
		low := strings.ToLower(e.name)
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
										tn = strings.TrimSuffix(strings.TrimSuffix(strings.ToLower(tn), ".png"), ".jpg")
										texOrder = append(texOrder, tn)
									}
								} else {
									var sval string
									if json.Unmarshal(item, &sval) == nil && sval != "" {
										tn := sval
										if idx := strings.LastIndex(tn, "/"); idx >= 0 {
											tn = tn[idx+1:]
										}
										tn = strings.TrimSuffix(strings.TrimSuffix(strings.ToLower(tn), ".png"), ".jpg")
										texOrder = append(texOrder, tn)
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
						// map 格式：JSON 对象**写入序**即 Bedrock 声明序（main 通常最先声明）。
						// Go map 丢失写入序，必须 json.Decoder Token 流式保序遍历——
						// sort.Strings 键排序会把 main 排到 arm 后，导致 texSlot 绑定错位（P2 修复）。
						dec := json.NewDecoder(bytes.NewReader(ysm.Files.Player.Model))
						if tok, err := dec.Token(); err == nil && tok == json.Delim('{') {
							for dec.More() {
								keyTok, err := dec.Token()
								if err != nil {
									break
								}
								_, _ = keyTok.(string) // 键名仅作引用，写入序即声明序
								var val string
								if err := dec.Decode(&val); err != nil {
									break
								}
								if val != "" {
									modelOrder = append(modelOrder, val)
								}
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

	for _, e := range entries {
		f := e.file
		low := strings.ToLower(e.name)
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
			// 注意：不排除 arm（组件版需要；合并版由调用方 filterArmModels 过滤）
			geoFiles = append(geoFiles, geoEntry{name: e.name, data: buf})
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !f.FileInfo().IsDir() && !strings.Contains(low, "avatar/") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			pngData := readLimitedEntry(rc)
			if len(pngData) > 4096 { // 过滤 <4KB 的头像/预览图
				name := e.name
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
	return modelOrder, texOrder, geoFiles, pngs, pngNames, animJSONs
}

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
						// map 格式：JSON 对象**写入序**即 Bedrock 声明序（main 通常最先声明）。
						// Go map 丢失写入序，必须 json.Decoder Token 流式保序遍历——
						// sort.Strings 键排序会把 main 排到 arm 后，导致 texSlot 绑定错位（P2 修复）。
						dec := json.NewDecoder(bytes.NewReader(ysm.Files.Player.Model))
						if tok, err := dec.Token(); err == nil && tok == json.Delim('{') {
							for dec.More() {
								keyTok, err := dec.Token()
								if err != nil {
									break
								}
								_, _ = keyTok.(string) // 键名仅作引用，写入序即声明序
								var val string
								if err := dec.Decode(&val); err != nil {
									break
								}
								if val != "" {
									modelOrder = append(modelOrder, val)
								}
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
			if isArmModelName(f.Name) {
				continue // 排除第一人称手臂模型 arm.json（与 main 手臂重叠 → 双手臂）
			}
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

	// 移除第一人称手臂模型占位：避免 arm.json 占据 texIdx 槽位导致 main 纹理错位
	modelOrder = filterArmModels(modelOrder)

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
	// 纹理名与 pngs 同序（同一循环收集 + 同一 orderMap 排序），供前端纹理列表显示
	if geo != nil {
		geo.TextureNames = pngNames
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
						// map 格式：JSON 对象**写入序**即 Bedrock 声明序（main 通常最先声明）。
						// Go map 丢失写入序，必须 json.Decoder Token 流式保序遍历——
						// sort.Strings 键排序会把 main 排到 arm 后，导致 texSlot 绑定错位（P2 修复）。
						dec := json.NewDecoder(bytes.NewReader(ysm.Files.Player.Model))
						if tok, err := dec.Token(); err == nil && tok == json.Delim('{') {
							for dec.More() {
								keyTok, err := dec.Token()
								if err != nil {
									break
								}
								_, _ = keyTok.(string) // 键名仅作引用，写入序即声明序
								var val string
								if err := dec.Decode(&val); err != nil {
									break
								}
								if val != "" {
									modelOrder = append(modelOrder, val)
								}
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
	var geoFiles []geoEntry
	for _, f := range reader.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, ".json") && !strings.Contains(low, "ysm.json") && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			buf := readLimitedEntry(rc)
			if isArmModelName(f.Name) {
				continue // 排除第一人称手臂模型 arm.json（与 main 手臂重叠 → 双手臂）
			}
			geoFiles = append(geoFiles, geoEntry{name: f.Name, data: buf})
		}
	}

	// 移除第一人称手臂模型占位：避免 arm.json 占据 texIdx 槽位导致 main 纹理错位
	modelOrder = filterArmModels(modelOrder)

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
	// 纹理名与 pngs 同序，供前端纹理列表显示（与 ParseFromZip 同契约）
	if geo != nil {
		geo.TextureNames = pngNames
	}
	return geo, pngs
}

// IsMainModelName 判断模型文件是否为主组件（main.json / main.geo.json）。
// 导出供 wasm 多组件路径（decodeYSMComponentsViaNodeJS）与 zip 路径统一 main 判定口径。
func IsMainModelName(name string) bool {
	base := strings.ToLower(name)
	if idx := strings.LastIndexAny(base, "/\\"); idx >= 0 {
		base = base[idx+1:]
	}
	base = strings.TrimSuffix(base, ".json")
	return base == "main" || base == "main.geo"
}

// ParseComponentsFromZip 多组件解析（YSMViewer 式）：zip 内每个模型文件独立组件，
// 含 arm/载具等组件（不合并、不排除）；main 优先排序，TexSlot 全局化。
// 供 threejs.BuildMulti 生成多组件 spec。
func ParseComponentsFromZip(data []byte, size int64) ([]types.BedrockModel, []string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil, nil, err
	}
	files := make([]archiveEntry, 0, len(reader.File))
	for _, f := range reader.File {
		files = append(files, archiveEntry{name: f.Name, file: f})
	}
	modelOrder, texOrder, geoFiles, _, _, _ := collectArchiveFiles(files)
	return buildComponents(geoFiles, modelOrder, texOrder)
}

// buildComponents 组件化收集：main 优先排序 + TexSlot 全局化 + 独立解析。
// 与 ParseFromZip 合并逻辑同源（collectArchiveFiles 共享收集），仅解析阶段不合并 bones、
// texSlot 不按 texOrder 钳制（texArr 含全部组件纹理，texSlot = 成功组件序，连续无空洞）。
// 返回 texNames（组件序纹理名，R1 契约校验用）：取「组件在 modelOrder **声明序**中的
// 原始位置 j」的 texOrder[j]（main 优先只影响显示排序，不改变纹理槽基——P2 修复）；
// 无声明/越界用组件 basename（补扫段 texArr 按名排序与组件补扫按名一致）。
func buildComponents(geoFiles []geoEntry, modelOrder, texOrder []string) ([]types.BedrockModel, []string, error) {
	orderMap := make(map[string]int, len(modelOrder))
	for i, p := range modelOrder {
		orderMap[strings.ReplaceAll(p, "\\", "/")] = i
	}
	// 排序：main 优先 + modelOrder 相对序；modelOrder 为空（ysm.json 无 player.model
	// 声明或解析失败）时回退 IsMainModelName 优先 + 路径字典序——与 WASM 路径同口径（P2）。
	sort.SliceStable(geoFiles, func(i, j int) bool {
		mi := IsMainModelName(geoFiles[i].name)
		mj := IsMainModelName(geoFiles[j].name)
		if mi != mj {
			return mi
		}
		if len(modelOrder) > 0 {
			ai, oki := orderMap[strings.ReplaceAll(geoFiles[i].name, "\\", "/")]
			aj, okj := orderMap[strings.ReplaceAll(geoFiles[j].name, "\\", "/")]
			if oki && okj {
				return ai < aj
			}
			if oki != okj {
				return oki
			}
		}
		return geoFiles[i].name < geoFiles[j].name
	})
	var comps []types.BedrockModel
	// texNames = texArr **期望序**（契约校验：前端 texArr 来自元数据，序 = texOrderNames
	// 优先 + 其余按名；texNames[i] = texArr 第 i 个的期望名 = texOrder[i]，越界用 basename）。
	// 注意：texNames 索引是 texArr 连续索引（与组件解析跳过无关——texArr 来自元数据，
	// 不因组件跳过而收缩）；长度 = 成功组件数，契约比对 Math.min 截断，未解析组件槽位不比对。
	// texSlot = 纹理槽（组件贴 texArr[texSlot]）：已声明组件用**声明序位置 j**
	// （texArr 声明段 = texOrderNames 序）；未声明组件 = len(texOrder) + 按名段序号
	// （组件序尾部未声明段按路径排序，与 texArr 按名段一致）。——P2 修复：
	// 之前 texSlot=组件序会让 main 非首位时贴错纹理（如 model:["arm","main"] 时 main 贴 arm）。
	texNames := make([]string, 0, len(geoFiles))
	undeclSeq := 0 // 未声明组件按名段序号（texSlot 基 = len(texOrder)）
	for _, gf := range geoFiles {
		g := ParseBedrockGeometry(gf.data)
		if g == nil || g.BoneCount == 0 {
			continue
		}
		texSlot := len(texOrder) + undeclSeq
		if j, ok := orderMap[strings.ReplaceAll(gf.name, "\\", "/")]; ok && j < len(texOrder) {
			// 已声明且在纹理声明范围内：贴 texArr[j]
			texSlot = j
		} else {
			// 未声明 / 声明序越界（模型多于纹理声明）：降级到按名段
			undeclSeq++
		}
		for bi := range g.Bones {
			for ci := range g.Bones[bi].Cubes {
				g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
				g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				g.Bones[bi].Cubes[ci].TexSlot = texSlot
			}
		}
		// TrimSuffix 先 .geo.json 后 .json：main.geo.json → "main" 而非 "main.geo"（P2）
		geoName := strings.ReplaceAll(gf.name, "\\", "/")
		if idx := strings.LastIndex(geoName, "/"); idx >= 0 {
			geoName = geoName[idx+1:]
		}
		tn := strings.TrimSuffix(strings.TrimSuffix(geoName, ".geo.json"), ".json")
		if len(texNames) < len(texOrder) && texOrder[len(texNames)] != "" {
			tn = texOrder[len(texNames)]
		}
		texNames = append(texNames, tn)
		comps = append(comps, *g)
	}
	return comps, texNames, nil
}

// ParseComponentsFrom7z 多组件解析（7z 版）：与 ParseComponentsFromZip 同构，
// 复用 collectArchiveFiles/buildComponents（含 arm、main 优先、TexSlot 全局化）。
func ParseComponentsFrom7z(data []byte, size int64) ([]types.BedrockModel, []string, error) {
	reader, err := sevenzip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil, nil, err
	}
	files := make([]archiveEntry, 0, len(reader.File))
	for _, f := range reader.File {
		files = append(files, archiveEntry{name: f.Name, file: f})
	}
	modelOrder, texOrder, geoFiles, _, _, _ := collectArchiveFiles(files)
	return buildComponents(geoFiles, modelOrder, texOrder)
}
