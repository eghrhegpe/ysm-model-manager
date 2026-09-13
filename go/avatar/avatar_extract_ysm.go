// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar_extract_ysm.go）：.ysm 模型包头像提取——单作者
// （extractAvatarFromYSM）与批量缓存（cacheYSMavatars）共用同一份
// WASM 解码产物（DecodeYSMData），按 authors 声明匹配或降级取 avatar/
// 目录首图。拆分自 avatar_extract.go（ADR-040 文件行数治理）。
package avatar

import (
	"errors"
	"io/fs"
	"log"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/types/registry"
)

// extractAvatarFromYSM 从 .ysm 模型包提取指定作者的头像。
// 优先按 ysm.json 中 authors 列表匹配 avatar 字段；
// 匹配失败时降级取 avatar/ 目录第一张图片。
func extractAvatarFromYSM(modelPath, safeName string) string {
	ysmData, err := readLimitedModel(modelPath)
	if err != nil {
		// 缓存 miss 静默，但真 IO 错误（权限/磁盘）补日志便于排障
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[avatar] 读取 .ysm 模型失败 %s: %v", modelPath, err)
		}
		return ""
	}
	files := DecodeYSMData(ysmData)
	if len(files) == 0 {
		return ""
	}

	authors := parseYSMJSONAuthors(files)
	if len(authors) > 0 {
		// 作者声明优先：按 avatar 字段匹配（命中即 SaveAvatarData 落盘）。
		// 旧实现的 :55「无 authors 或匹配失败后再无条件
		// 二次 match」为纯冗余——authors 为空时该调用恒空（内部遍历空 authors），
		// authors 非空时与首调完全重复；删除后行为不变。
		return matchAvatarByAuthor(files, authors, safeName)
	}
	// 降级：取 avatar/ 目录第一张（仅 authors 为空时可达，与上分支互斥）
	return extractFallbackAvatarFromDir(files, safeName)
}

// parseYSMJSONAuthors 从 YSM 文件列表中找 ysm.json 并解析 authors。
// 消费 DecodeYSMData 的 []byte 直通形态（旧 []int 中间
// 形态每字节膨胀 8× 且需 toBytes 转回，纯为历史签名买单）。
// 解析失败静默返回 nil（与旧实现 break 行为一致），元数据声明收敛于 parseMetadataAuthors。
func parseYSMJSONAuthors(files []ysmDecodedFile) []authorEntry {
	for _, f := range files {
		if isYSMJSONPath(f.Path) {
			authors, _ := parseMetadataAuthors(f.Data)
			return authors
		}
	}
	return nil
}

// extractFallbackAvatarFromDir 降级路径：取 avatar/ 目录第一张图片。
func extractFallbackAvatarFromDir(files []ysmDecodedFile, safeName string) string {
	// 扩展名口径与 avatarCandidates 对齐：.png/.jpg/.jpeg 均认（原漏 .jpeg
	// 使 avatar/face.jpeg 声明的头像在不走作者匹配的降级路径下被跳过）
	// 不含 .tga——浏览器不解码，头像 <img> 无法渲染。委托 registry.IsRenderableTextureExt。
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !registry.IsRenderableTextureExt(filepath.Ext(low)) {
			continue
		}
		if !strings.HasPrefix(low, "avatar/") && !strings.Contains(low, "/avatar/") {
			continue
		}
		return SaveAvatarData(safeName, f.Data, registry.TextureMIME(filepath.Ext(low)))
	}
	return ""
}

// matchAvatarByAuthor 按作者名匹配 avatar 字段，找到对应图片文件后保存。
// 先收集 SafeName 匹配的作者再按文件优先比对（P3-10：原实现每文件全扫 authors，
// N 作者 × M 文件 = O(M×N)；作者名各异时匹配集收敛到 1，降为 O(M)，语义不变）。
func matchAvatarByAuthor(files []ysmDecodedFile, authors []authorEntry, safeName string) string {
	var matched []authorEntry
	for _, au := range authors {
		if SafeName(au.Name) == safeName && au.Avatar != "" {
			matched = append(matched, au)
		}
	}
	if len(matched) == 0 {
		return ""
	}
	for _, f := range files {
		fp := strings.ToLower(f.Path)
		for _, au := range matched {
			ap := strings.ToLower(au.Avatar)
			if !isSafeAvatarPath(ap) {
				continue
			}
			for _, c := range avatarCandidates(ap) {
				if fp == c || strings.HasSuffix(fp, "/"+c) || strings.HasSuffix(fp, "\\"+c) {
					return SaveAvatarData(safeName, f.Data, registry.TextureMIME(filepath.Ext(fp)))
				}
			}
		}
	}
	return ""
}

// cacheYSMavatars .ysm 单遍缓存：一次受限整读 + 一次 WASM 解码，遍历作者落盘。
// 语义与旧实现（modelAuthorNames → 每作者 ExtractAvatarURI）等价：authors 非空时
// 仅缓存「声明 avatar 且解码产物中可解析到文件」的作者头像（.ysm 分支无
// avatar/ 目录降级——authors 为空时旧实现本就无作者名可遍历，不会缓存任何内容）。
func cacheYSMavatars(modelPath string) {
	cacheDir, ok := avatarCacheDir()
	if !ok {
		return
	}
	data, err := readLimitedModel(modelPath)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[avatar] 读取 .ysm 模型失败 %s: %v", modelPath, err)
		}
		return
	}
	files := DecodeYSMData(data)
	if len(files) == 0 {
		return
	}
	authors := parseYSMJSONAuthors(files)
	if len(authors) == 0 {
		return // 无 ysm.json/无 authors：与旧实现空作者名列表等价，无缓存动作
	}
	for _, au := range authors {
		if au.Name == "" {
			continue
		}
		safe := SafeName(au.Name)
		if avatarCached(cacheDir, safe) {
			continue // 已缓存，跳过
		}
		// 命中即写缓存，未命中返回 ""（不影响其他作者）——匹配逻辑与
		// extractAvatarFromYSM 单作者路径共用，不重复解码；未命中补日志便于排查
		if matchAvatarByAuthor(files, authors, safe) == "" {
			log.Printf("[avatar] .ysm 作者 %s 未提取到头像（无 avatar 声明或文件缺失）", safe)
		}
	}
}
