// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar_extract.go）：头像提取编排——从模型文件（.ysm/.zip/.json）
// 提取作者头像（ExtractAvatarURI）、批量缓存（CacheAvatarsFromJSON/CacheAvatarsFromModel）、
// 与模型受限读取（readLimitedModel）。拆分自原 avatar.go
// （ADR-040 文件行数治理）。
package avatar

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// ExtractAvatarURI 从模型文件中提取指定所有者的头像 data URI。
// modelPath 支持 .ysm / .zip / .json（解压目录）。
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
		// 2026-09 外部锐评 #13：旧实现的 :55「无 authors 或匹配失败后再无条件
		// 二次 match」为纯冗余——authors 为空时该调用恒空（内部遍历空 authors），
		// authors 非空时与首调完全重复；删除后行为不变。
		return matchAvatarByAuthor(files, authors, safeName)
	}
	// 降级：取 avatar/ 目录第一张（仅 authors 为空时可达，与上分支互斥）
	return extractFallbackAvatarFromDir(files, safeName)
}

// parseYSMJSONAuthors 从 YSM 文件列表中找 ysm.json 并解析 authors。
// 消费 DecodeYSMData 的 []byte 直通形态（2026-09 外部锐评 #2：旧 []int 中间
// 形态每字节膨胀 8× 且需 toBytes 转回，纯为历史签名买单）。
func parseYSMJSONAuthors(files []ysmDecodedFile) []authorEntry {
	for _, f := range files {
		if isYSMJSONPath(f.Path) {
			var root struct {
				Meta struct {
					Authors []authorEntry `json:"authors"`
				} `json:"metadata"`
			}
			if json.Unmarshal(f.Data, &root) == nil {
				return root.Meta.Authors
			}
			break
		}
	}
	return nil
}

// extractFallbackAvatarFromDir 降级路径：取 avatar/ 目录第一张图片。
func extractFallbackAvatarFromDir(files []ysmDecodedFile, safeName string) string {
	// 扩展名口径与 avatarCandidates 对齐：.png/.jpg/.jpeg 均认（原漏 .jpeg
	// 使 avatar/face.jpeg 声明的头像在不走作者匹配的降级路径下被跳过）
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg") && !strings.HasSuffix(low, ".jpeg") {
			continue
		}
		if !strings.HasPrefix(low, "avatar/") && !strings.Contains(low, "/avatar/") {
			continue
		}
		mime := "image/png"
		if strings.HasSuffix(low, ".jpg") || strings.HasSuffix(low, ".jpeg") {
			mime = "image/jpeg"
		}
		return SaveAvatarData(safeName, f.Data, mime)
	}
	return ""
}

// matchAvatarByAuthor 按作者名匹配 avatar 字段，找到对应图片文件后保存。
func matchAvatarByAuthor(files []ysmDecodedFile, authors []authorEntry, safeName string) string {
	for _, f := range files {
		for _, au := range authors {
			if SafeName(au.Name) == safeName && au.Avatar != "" {
				ap := strings.ToLower(au.Avatar)
				if !isSafeAvatarPath(ap) {
					continue
				}
				fp := strings.ToLower(f.Path)
				matched := false
				for _, c := range avatarCandidates(ap) {
					if fp == c || strings.HasSuffix(fp, "/"+c) || strings.HasSuffix(fp, "\\"+c) {
						matched = true
						break
					}
				}
				if matched {
					mime := "image/png"
					if strings.HasSuffix(fp, ".jpg") || strings.HasSuffix(fp, ".jpeg") {
						mime = "image/jpeg"
					}
					return SaveAvatarData(safeName, f.Data, mime)
				}
			}
		}
	}
	return ""
}

// extractAvatarFromArchive 从 .zip/.7z 压缩包提取指定作者的头像。
func extractAvatarFromArchive(modelPath, safeName, ext string) string {
	data, err := readLimitedModel(modelPath)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[avatar] 读取 %s 模型失败 %s: %v", ext, modelPath, err)
		}
		return ""
	}

	var r container.Reader
	switch ext {
	case ".zip":
		r, err = container.OpenZipBytes(data, int64(len(data)))
	case ".7z":
		r, err = container.Open7zBytes(data, int64(len(data)))
	}
	if err != nil {
		log.Printf("[avatar] %s 解析失败 %s: %v", ext, modelPath, err)
		return ""
	}
	defer r.Close()

	return extractAvatarFromContainer(r, safeName)
}

// extractAvatarFromJSON 从 .json 模型文件提取指定作者的头像。
// 解析 metadata.authors，按 avatar 字段在模型目录下查找对应图片文件。
func extractAvatarFromJSON(modelPath, safeName string) string {
	data, err := readLimitedModel(modelPath)
	if err != nil {
		// 真 IO 错误补日志（IsNotExist 静默）
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[avatar] 读取 .json 模型失败 %s: %v", modelPath, err)
		}
		return ""
	}
	var root struct {
		Meta struct {
			Authors []authorEntry `json:"authors"`
		} `json:"metadata"`
	}
	if json.Unmarshal(data, &root) != nil {
		return ""
	}

	dir := filepath.Dir(modelPath)
	for _, au := range root.Meta.Authors {
		if SafeName(au.Name) != safeName || au.Avatar == "" {
			continue
		}
		ap := strings.ToLower(au.Avatar)
		// 强校验（Clean + avatar/ 前缀 + 拒绝 ..），防 avatar/../../x 逃逸读任意文件
		if !isSafeAvatarPath(ap) {
			continue
		}
		// 候选列表（含裸文件名补 avatar/ 前缀与标准扩展名变体）逐个尝试——
		// 原实现直接 Join(dir, au.Avatar) 使裸文件名声明（"sdf"）读 dir/sdf 而非
		// dir/avatar/sdf.png，与 .ysm/.zip 分支 avatarCandidates 口径不一致（修复）
		for _, c := range avatarCandidates(au.Avatar) {
			avatarPath := filepath.Join(dir, c)
			// 落盘前 Rel 复查：Join 后必须仍在模型目录内
			if rel, err := filepath.Rel(dir, avatarPath); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				continue
			}
			if avatarData, _ := readLimitedAvatar(avatarPath); avatarData != nil {
				mime := "image/png"
				if strings.HasSuffix(strings.ToLower(c), ".jpg") {
					mime = "image/jpeg"
				}
				return SaveAvatarData(safeName, avatarData, mime)
			}
		}
	}
	return ""
}

func ExtractAvatarURI(modelPath, safeName string) string {
	ext := strings.ToLower(filepath.Ext(modelPath))

	switch ext {
	case ".ysm":
		return extractAvatarFromYSM(modelPath, safeName)
	case ".zip", ".7z":
		return extractAvatarFromArchive(modelPath, safeName, ext)
	case ".json":
		return extractAvatarFromJSON(modelPath, safeName)
	}
	return ""
}

// CacheAvatarsFromJSON 从解压目录的 ysm.json 缓存所有作者头像。
func CacheAvatarsFromJSON(modelPath string) {
	if !strings.HasSuffix(strings.ToLower(modelPath), ".json") {
		return
	}
	data, err := readLimitedModel(modelPath)
	if err != nil {
		// 真 IO 错误补日志（IsNotExist 静默）
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[avatar] CacheAvatarsFromJSON 读取失败 %s: %v", modelPath, err)
		}
		return
	}
	var root struct {
		Meta struct {
			Authors []struct {
				Name   string `json:"name"`
				Avatar string `json:"avatar"`
			} `json:"authors"`
		} `json:"metadata"`
	}
	if json.Unmarshal(data, &root) != nil {
		log.Printf("[avatar] CacheAvatarsFromJSON 解析 ysm.json 失败 %s", modelPath)
		return
	}
	dir := filepath.Dir(modelPath)
	cacheDir := CacheDir()
	if cacheDir == "" {
		return // 平台数据根缺失：no-op
	}
	// MkdirAll 错误不再忽略——与 SaveAvatarData 的
	// log 口径一致（原失败静默，后续 WriteFile 报错被 .corrupt 备份掩盖）
	if err := os.MkdirAll(cacheDir, fsutil.DirPerms); err != nil {
		log.Printf("[avatar] 创建缓存目录失败: %v", err)
		return
	}
	for _, au := range root.Meta.Authors {
		if au.Name == "" || au.Avatar == "" {
			continue
		}
		safe := SafeName(au.Name)
		cachedPath := filepath.Join(cacheDir, safe+".png")
		if _, err := os.Stat(cachedPath); err == nil {
			continue
		}
		ap := au.Avatar
		// 强校验（Clean + avatar/ 前缀 + 拒绝 ..），防逃逸读模型目录外文件并写入缓存
		if !isSafeAvatarPath(ap) {
			continue
		}
		// 候选列表逐个尝试（同 ExtractAvatarURI .json 分支口径）：裸文件名声明
		// （"sdf"）解析到 dir/avatar/sdf.png 而非 dir/sdf（修复）
		for _, c := range avatarCandidates(ap) {
			avatarPath := filepath.Join(dir, c)
			// Rel 复查：Join 后必须仍在模型目录内
			if rel, err := filepath.Rel(dir, avatarPath); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				continue
			}
			if avatarData, _ := readLimitedAvatar(avatarPath); avatarData != nil {
				if err := fsutil.WriteFileAtomic(cachedPath, avatarData); err != nil {
					log.Printf("[avatar] 缓存写入失败 %s: %v", cachedPath, err)
				}
				break // 一个作者只落一张头像
			}
		}
	}
}

// CacheAvatarsFromModel 从 .ysm/.zip/.7z/.json 模型缓存所有作者头像。
// 覆盖 CacheAvatarsFromJSON 仅处理解压目录（.json）的局限，使创作者视图头像
// 对压缩包/二进制模型（.ysm/.zip/.7z）同样生效。
// 单遍实现（2026-09 外部锐评 #1）：旧实现先 modelAuthorNames 全量读/解码一次拿
// 作者名，再对每个作者各调 ExtractAvatarURI → 各自再整读/再解码（.ysm N 作者 =
// N+1 次 50MB 级整读 + N+1 次 Node/WASM spawn）。现按格式各只做一次读取/解码/
// 开容器，复用同一份文件列表在内存内逐作者匹配落盘。
func CacheAvatarsFromModel(modelPath string) {
	ext := strings.ToLower(filepath.Ext(modelPath))
	switch ext {
	case ".json":
		CacheAvatarsFromJSON(modelPath)
	case ".ysm":
		cacheYSMavatars(modelPath)
	case ".zip", ".7z":
		cacheContainerAvatars(modelPath, ext)
	}
}

// avatarCacheDir 平台数据根校验 + 缓存目录创建（缓存路径共享 guard）。
// 返回 false 表示 no-op（数据根缺失 / 创建失败，均已留日志）。
func avatarCacheDir() (string, bool) {
	cacheDir := CacheDir()
	if cacheDir == "" {
		return "", false // 平台数据根缺失：no-op
	}
	if err := os.MkdirAll(cacheDir, fsutil.DirPerms); err != nil {
		log.Printf("[avatar] 创建缓存目录失败: %v", err)
		return "", false
	}
	return cacheDir, true
}

// avatarCached 该作者头像是否已落盘缓存。
func avatarCached(cacheDir, safe string) bool {
	_, err := os.Stat(filepath.Join(cacheDir, safe+".png"))
	return err == nil
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
		// extractAvatarFromYSM 单作者路径共用，不重复解码
		_ = matchAvatarByAuthor(files, authors, safe)
	}
}

// cacheContainerAvatars .zip/.7z 单遍缓存：一次受限整读 + 一次开容器，逐作者复用
// 已打开的容器提取（不再每作者重开容器/重读文件）。
// 语义与旧实现等价：作者声明 avatar 可解析则缓存之；否则降级取容器内 avatar/
// 目录第一张图（extractAvatarFromContainer 同口径——容器分支的降级在 authors
// 非空且该作者匹配失败时同样生效，与 .ysm 分支行为不同，这里保持一致）。
func cacheContainerAvatars(modelPath, ext string) {
	cacheDir, ok := avatarCacheDir()
	if !ok {
		return
	}
	data, err := readLimitedModel(modelPath)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[avatar] 读取 %s 模型失败 %s: %v", ext, modelPath, err)
		}
		return
	}
	var r container.Reader
	switch ext {
	case ".zip":
		r, err = container.OpenZipBytes(data, int64(len(data)))
	case ".7z":
		r, err = container.Open7zBytes(data, int64(len(data)))
	}
	if err != nil {
		log.Printf("[avatar] %s 解析失败 %s: %v", ext, modelPath, err)
		return
	}
	defer r.Close()

	for _, name := range containerAuthorNames(r) {
		safe := SafeName(name)
		if avatarCached(cacheDir, safe) {
			continue // 已缓存，跳过
		}
		// 单作者容器提取（作者匹配 → 降级首图，内部 SaveAvatarData 落盘）
		_ = extractAvatarFromContainer(r, safe)
	}
}

// containerAuthorNames 从已打开容器读 ysm.json 的作者名（空名过滤）。
func containerAuthorNames(r container.Reader) []string {
	ysmData := ReadFileFromContainer(r, "ysm.json")
	if ysmData == nil {
		return nil
	}
	var root struct {
		Meta struct {
			Authors []struct {
				Name string `json:"name"`
			} `json:"authors"`
		} `json:"metadata"`
	}
	if json.Unmarshal(ysmData, &root) != nil {
		log.Printf("[avatar] 容器 ysm.json 作者解析失败")
		return nil
	}
	names := make([]string, 0, len(root.Meta.Authors))
	for _, a := range root.Meta.Authors {
		if a.Name != "" {
			names = append(names, a.Name)
		}
	}
	return names
}

// readLimitedModel 受限读取模型文件（.ysm/.zip/.json 可达数百 MB——头像/作者
// 提取只需扫描内容，全量整读内存膨胀；50MB 上限对齐 geometry maxExtractSize 口径，
// 超限返回 error 由调用方按读取失败处理）。
func readLimitedModel(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	data := fsutil.ReadLimitedEntry(f, types.MaxReadLimit)
	if data == nil {
		return nil, fmt.Errorf("模型文件读取失败或超过上限: %s", path)
	}
	return data, nil
}

// extractAvatarFromContainer 处理压缩包（zip/7z）头像提取的通用逻辑
// 包括：解析作者列表、按作者名匹配、以及 avatar/ 目录降级逻辑
func extractAvatarFromContainer(r container.Reader, safeName string) string {
	// 1. 解析作者列表
	var authors []authorEntry
	ysmData := ReadFileFromContainer(r, "ysm.json")
	if ysmData != nil {
		var root struct {
			Meta struct {
				Authors []authorEntry `json:"authors"`
			} `json:"metadata"`
		}
		if json.Unmarshal(ysmData, &root) == nil {
			authors = root.Meta.Authors
		}
	}

	// 2. 按作者名匹配头像
	for _, au := range authors {
		if SafeName(au.Name) == safeName && au.Avatar != "" {
			ap := strings.ToLower(au.Avatar)
			if !isSafeAvatarPath(ap) {
				continue
			}
			for _, c := range avatarCandidates(ap) {
				if avatarData := ReadFileFromContainer(r, c); avatarData != nil {
					mime := "image/png"
					if strings.HasSuffix(strings.ToLower(c), ".jpg") || strings.HasSuffix(strings.ToLower(c), ".jpeg") {
						mime = "image/jpeg"
					}
					return SaveAvatarData(safeName, avatarData, mime)
				}
			}
		}
	}

	// 3. 降级：avatar/ 目录第一张 .png/.jpg/.jpeg
	for _, e := range r.Entries() {
		if e.IsDir() {
			continue
		}
		low := strings.ToLower(e.Name())
		if !strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg") && !strings.HasSuffix(low, ".jpeg") {
			continue
		}
		if !strings.HasPrefix(low, "avatar/") && !strings.Contains(low, "/avatar/") {
			continue
		}
		rc, oerr := e.Open()
		if oerr != nil {
			continue
		}
		avatarData, rerr := io.ReadAll(io.LimitReader(rc, types.MaxReadLimit+1))
		rc.Close()
		if rerr != nil || int64(len(avatarData)) > types.MaxReadLimit {
			continue
		}
		mime := "image/png"
		if strings.HasSuffix(low, ".jpg") || strings.HasSuffix(low, ".jpeg") {
			mime = "image/jpeg"
		}
		return SaveAvatarData(safeName, avatarData, mime)
	}

	return ""
}
