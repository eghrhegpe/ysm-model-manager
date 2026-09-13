// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar_extract_json.go）：解压目录（.json/ysm.json）头像提取——
// 单作者（extractAvatarFromJSON）与批量缓存（CacheAvatarsFromJSON），
// 在模型目录下按 avatar 引用候选定位图片文件（resolveAvatarRef）。
// 拆分自 avatar_extract.go（ADR-040 文件行数治理）。
package avatar

import (
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
)

// resolveAvatarRef 从模型目录 dir 下按 avatar 候选（avatarCandidates）逐个尝试读取头像文件。
// 落盘前 Rel 复查保证 Join 后仍在模型目录内（防逃逸读模型目录外文件）；
// 找不到返回 (nil, "")。extractAvatarFromJSON 与 CacheAvatarsFromJSON 共用
// （P2-5：原「候选 + Rel 复查」循环两处逐行复制）。
func resolveAvatarRef(dir, ref string) ([]byte, string) {
	for _, c := range avatarCandidates(ref) {
		avatarPath := filepath.Join(dir, c)
		if rel, err := filepath.Rel(dir, avatarPath); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		if avatarData, _ := readLimitedAvatar(avatarPath); avatarData != nil {
			return avatarData, textureMimeOrDefault(filepath.Ext(c))
		}
	}
	return nil, ""
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
	authors, _ := parseMetadataAuthors(data)

	dir := filepath.Dir(modelPath)
	for _, au := range authors {
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
		if avatarData, mime := resolveAvatarRef(dir, au.Avatar); avatarData != nil {
			return SaveAvatarData(safeName, avatarData, mime)
		}
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
	authors, err := parseMetadataAuthors(data)
	if err != nil {
		log.Printf("[avatar] CacheAvatarsFromJSON 解析 ysm.json 失败 %s", modelPath)
		return
	}
	dir := filepath.Dir(modelPath)
	cacheDir, ok := avatarCacheDir()
	if !ok {
		return // 平台数据根缺失/创建失败：no-op（已留日志）
	}
	for _, au := range authors {
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
		if avatarData, _ := resolveAvatarRef(dir, ap); avatarData != nil {
			if err := fsutil.WriteFileAtomic(cachedPath, avatarData); err != nil {
				log.Printf("[avatar] 缓存写入失败 %s: %v", cachedPath, err)
			}
			break // 一个作者只落一张头像
		}
	}
}
