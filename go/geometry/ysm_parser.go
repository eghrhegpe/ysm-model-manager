// ===== ysm.json 解析共享函数（T2 路线 B）=====
// collectArchiveFiles（清单版）与 parseModelFromEntries（模型版）共用本文件的「JSON 结构解码」。
//
// 设计约束（路线 B：纯提取、行为不变）：
//   - 本文件只做结构解码（list/dict/single、数组/对象/字符串多形态），返回**原文**；
//   - lower / 去扩展名 / 去目录等「口径后处理」留回各自调用点，因为两处口径本就不同：
//     collectArchiveFiles 的 player.texture 去扩展名（清单版），
//     parseModelFromEntries 的 player.texture 保留扩展名（模型版）。
//   - 还要保留一个历史不对称：player.texture 的 `{uv}` 对象分支剥反斜杠，裸字符串分支不剥
//     （archive.go 原内联即如此），所以共享层用 playerTex.isUV 标记形态，让调用点原样复刻。
//   - 强统一口径会让 texOrder 中间态漂移（T1 zip/7z 收敛同类教训：输出结构不同禁止参数强统一）。
//
// 只有 projectiles/vehicles/arrow 的纹理口径在两个路径完全相同（去目录+小写+去扩展名），
// 才收敛进 texBasenameNoExt 单点复用。
package geometry

import (
	"bytes"
	"encoding/json"
	"log"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// ysmArchiveData 从 ysm.json 解析得到的**原文**结构数据。
type ysmArchiveData struct {
	ModelOrder   []string          // player.model 原文顺序（路径/名字未加工）
	PlayerTexs   []playerTex       // player.texture 原文（path 未加工；isUV 标记 JSON 形态）
	ProjModels   []projEntry       // projectiles/vehicles/arrow：model + 原文 texName（未 lower/去扩/去目录）
	ModelTexName map[string]string // 模型路径(ToSlash) → 声明的纹理名(小写basename去扩展名)
	Metadata     json.RawMessage   // metadata 段原文（len==0 表示无；调用方自行 unmarshal）
}

// playerTex player.texture 单个条目的原文。
// isUV=true 表示来自 {"uv":"..."} 对象；false 表示裸字符串。
// 调用点据 isUV 决定是否剥反斜杠（uv 剥、字符串不剥），复刻原内联口径。
type playerTex struct {
	path string
	isUV bool
}

// texBasenameNoExt 去目录 + 小写 + 去 .png/.jpg 扩展名（projectiles 纹理的共享口径）。
// 顺序必须先 ToLower 再 TrimSuffix，否则大写扩展名（如 TEX.PNG）去不掉。
func texBasenameNoExt(path string) string {
	tn := path
	if idx := strings.LastIndex(tn, "/"); idx >= 0 {
		tn = tn[idx+1:]
	}
	if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
		tn = tn[idx+1:]
	}
	// 顺序必须先 ToLower 再 TrimSuffix——
	// 旧内联代码（archive.go 旧 L342/791）即此序；反序时大写扩展名（TEX.PNG）
	// 去不掉，texOrder 去重与 texIdxMap 查找失配，texSlot 静默错绑
	tn = trimTexExt(strings.ToLower(tn))
	return tn
}

// extractTexNameRaw 从纹理 RawMessage 提取原文路径（{uv} 对象或裸字符串），不做任何加工。
func extractTexNameRaw(texRaw json.RawMessage) string {
	if len(texRaw) == 0 {
		return ""
	}
	rawTrim := strings.TrimSpace(string(texRaw))
	if strings.HasPrefix(rawTrim, `{`) {
		var obj struct {
			Uv string `json:"uv"`
		}
		if json.Unmarshal(texRaw, &obj) == nil {
			return obj.Uv
		}
		return ""
	}
	var sval string
	if json.Unmarshal(texRaw, &sval) == nil {
		return sval
	}
	return ""
}

// parsePlayerTextures 解析 player.texture 数组：每个条目解为 playerTex（原文 path + isUV）。
// 仅数组形态；非数组（裸字符串/对象/空）返回空——与原内联「只认 `[`」一致。
func parsePlayerTextures(raw json.RawMessage) []playerTex {
	var result []playerTex
	rawTrim := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(rawTrim, `[`) {
		return result
	}
	var arr []json.RawMessage
	if json.Unmarshal(raw, &arr) != nil {
		return result
	}
	for _, item := range arr {
		s := strings.TrimSpace(string(item))
		if s == "" {
			continue
		}
		if s[0] == '{' {
			var obj struct {
				Uv string `json:"uv"`
			}
			if json.Unmarshal(item, &obj) == nil && obj.Uv != "" {
				result = append(result, playerTex{path: obj.Uv, isUV: true})
			}
		} else {
			var sval string
			if json.Unmarshal(item, &sval) == nil && sval != "" {
				result = append(result, playerTex{path: sval, isUV: false})
			}
		}
	}
	return result
}

// parseProjModels 解析 projectiles/vehicles/arrow 段（list/dict/single 三形态），返回原文 projEntry。
// model 或 texName 都可能为 ""（原内联对 projModels 只收 model!=""、对 texOrder 只收 texName!=""，
// 过滤留给调用点），此处保留全量，保证纹理追加不因 model 为空而丢失。
func parseProjModels(raw json.RawMessage) []projEntry {
	var result []projEntry
	rawTrim := strings.TrimSpace(string(raw))
	if strings.HasPrefix(rawTrim, `[`) {
		// list 形态：声明序即切片序
		var projs []struct {
			Model   string          `json:"model"`
			Texture json.RawMessage `json:"texture"`
		}
		if json.Unmarshal(raw, &projs) == nil {
			for _, p := range projs {
				result = append(result, projEntry{model: p.Model, texName: extractTexNameRaw(p.Texture)})
			}
		}
	} else if strings.HasPrefix(rawTrim, `{`) {
		// 区分 dict {minecraft:xxx: {model,texture}} 与 single {model,texture}：
		// 按首个 key 名判别（按首 value 判别会误判：dict 首条被当 single 只收一条、
		// arrow 单对象落 dict 分支收零条）
		dec := json.NewDecoder(bytes.NewReader(raw))
		if tok, err := dec.Token(); err == nil && tok == json.Delim('{') {
			firstKey, err := dec.Token()
			if err == nil {
				if ks, ok := firstKey.(string); ok && (ks == "model" || ks == "texture") {
					// single 形态：{model, texture} 直读整段
					var single struct {
						Model   string          `json:"model"`
						Texture json.RawMessage `json:"texture"`
					}
					if json.Unmarshal(raw, &single) == nil {
						result = append(result, projEntry{model: single.Model, texName: extractTexNameRaw(single.Texture)})
					}
				} else {
					// dict 形态：json.Decoder Token 流保序遍历全部条目
					dec2 := json.NewDecoder(bytes.NewReader(raw))
					if tok2, err := dec2.Token(); err == nil && tok2 == json.Delim('{') {
						for dec2.More() {
							_, _ = dec2.Token() // key（minecraft:xxx）
							var cfg struct {
								Model   string          `json:"model"`
								Texture json.RawMessage `json:"texture"`
							}
							if dec2.Decode(&cfg) == nil {
								result = append(result, projEntry{model: cfg.Model, texName: extractTexNameRaw(cfg.Texture)})
							}
						}
					}
				}
			}
		}
	}
	return result
}

// parseModelOrder 解析 player.model 字段（字符串/数组/对象/map 四格式），返回原文顺序。
func parseModelOrder(raw string) []string {
	var result []string
	if len(raw) == 0 {
		return result
	}
	switch raw[0] {
	case '[':
		var arr []json.RawMessage
		if json.Unmarshal([]byte(raw), &arr) == nil {
			for _, item := range arr {
				s := strings.TrimSpace(string(item))
				if len(s) == 0 {
					continue
				}
				if s[0] == '{' {
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
							result = append(result, n)
						}
					}
				} else {
					var sval string
					if json.Unmarshal(item, &sval) == nil && sval != "" {
						result = append(result, sval)
					}
				}
			}
		}
	case '{':
		// map 格式：JSON 对象写入序即 Bedrock 声明序（Go map 丢失序，必须 Token 流保序）
		dec := json.NewDecoder(bytes.NewReader([]byte(raw)))
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
					result = append(result, val)
				}
			}
		}
	default:
		var sval string
		if json.Unmarshal([]byte(raw), &sval) == nil && sval != "" {
			result = append(result, sval)
		}
	}
	return result
}

// parseYsmArchive 统一解析第一条 ysm.json：只解码结构、返回原文（口径后处理留调用方）。
// logPrefix 由调用方传入并直接用于错误日志（collectArchiveFiles 固定 "[geometry]"，
// parseModelFromEntries 按 zip/7z 传 "[geometry]" / "[geometry] 7z"]），此处不重建日志前缀。
func parseYsmArchive(entries []container.Entry, logPrefix string) *ysmArchiveData {
	result := &ysmArchiveData{}
	for _, e := range entries {
		// 与兄弟调用点一致：IsYsmEntryJSON 是整串精确匹配，必须先取 basename，
		// 否则嵌套目录（sub/ysm.json）的 ysm.json 会被静默跳过、元数据丢失。
		if !types.IsYsmEntryJSON(filepath.Base(e.Name())) || e.IsDir() {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			continue
		}
		buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))

		var ysm struct {
			// RawMessage 而非严格类型：松散/畸形 metadata 段不得拖垮核心解析
			// （license 为字符串等会令整个 ysm.json unmarshal 失败）
			Metadata json.RawMessage `json:"metadata"`
			Files    struct {
				Player struct {
					Model   json.RawMessage `json:"model"`
					Texture json.RawMessage `json:"texture"`
				} `json:"player"`
				Projectiles json.RawMessage `json:"projectiles"`
				Vehicles    json.RawMessage `json:"vehicles"`
				Arrow       json.RawMessage `json:"arrow"`
			} `json:"files"`
		}

		if err := json.Unmarshal(buf, &ysm); err != nil {
			log.Printf("%s 解析 ysm.json 失败: %v", logPrefix, err)
			break
		}

		result.Metadata = ysm.Metadata
		result.PlayerTexs = parsePlayerTextures(ysm.Files.Player.Texture)

		for _, sec := range []struct {
			raw json.RawMessage
			sec string
		}{{ysm.Files.Projectiles, "projectile"}, {ysm.Files.Vehicles, "vehicle"}, {ysm.Files.Arrow, "arrow"}} {
			if len(sec.raw) == 0 {
				continue
			}
			for _, pm := range parseProjModels(sec.raw) {
				pm.section = sec.sec
				result.ProjModels = append(result.ProjModels, pm)
			}
		}

		if len(ysm.Files.Player.Model) > 0 {
			raw := strings.TrimSpace(string(ysm.Files.Player.Model))
			result.ModelOrder = append(result.ModelOrder, parseModelOrder(raw)...)
		}

		// 构建 modelTexName：模型路径(ToSlash) → 声明的纹理名(小写basename去扩展名)
		// 用于 buildComponents 直接按 basename 查表，避免 texOrder 去重后索引漂移。
		// Go map 天然去重：多 model 条目指向同一 texName（如 horse+mule→foxcar）时只保留一份。
		result.ModelTexName = make(map[string]string)
		for _, pm := range result.ProjModels {
			if pm.model == "" || pm.texName == "" {
				continue
			}
			bn := filepath.ToSlash(pm.model)
			texBn := texBasenameNoExt(pm.texName)
			result.ModelTexName[bn] = texBn
		}
		// player.model 声明的组件也建映射（player.texture 对应关系靠 texOrder 顺序，
		// 这里用 modelOrder 位置 j 查 texOrder[j]，与现有逻辑一致，供 buildComponents 备用）。
		// 注意：player.model 在 modelOrder 里可能有重复（同文件多实体），Go map 只保留最后一份。
		// 优先级：projModels（vehicles/projectiles/arrow 段）优于 player.model 声明，
		// 避免 player.model 的按序索引覆盖 projModel 的显式纹理绑定。
		texIdx := 0
		for _, mn := range result.ModelOrder {
			if texIdx < len(result.PlayerTexs) {
				// 只填入尚未命中的项（projModel 已绑定的保持不动）
				key := filepath.ToSlash(mn)
				if _, has := result.ModelTexName[key]; !has {
					tn := result.PlayerTexs[texIdx].path
					if idx := strings.LastIndex(tn, "/"); idx >= 0 {
						tn = tn[idx+1:]
					}
					if result.PlayerTexs[texIdx].isUV {
						if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
							tn = tn[idx+1:]
						}
					}
					tn = trimTexExt(strings.ToLower(tn))
					result.ModelTexName[key] = tn
				}
			}
			texIdx++
		}

		break // 只处理第一条 ysm.json
	}
	return result
}
