// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar_extract_container.go）：压缩包（.zip/.7z）头像提取——容器打开
// （openModelContainer）、单作者提取（extractAvatarFromArchive）、批量缓存
// （cacheContainerAvatars）与容器内通用提取（extractAvatarFromContainer*）。
// 拆分自 avatar_extract.go（ADR-040 文件行数治理）。
package avatar

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/types/registry"
)

// openModelContainer 受限整读模型文件并按扩展名打开 zip/7z 容器。
// 单作者提取（extractAvatarFromArchive）与批量缓存（cacheContainerAvatars）共用，
// 消除原先逐行重复的「整读 + switch 开容器」段。未知扩展名返回错误。
func openModelContainer(modelPath, ext string) (container.Reader, error) {
	data, err := readLimitedModel(modelPath)
	if err != nil {
		return nil, err
	}
	switch ext {
	case ".zip":
		return container.OpenZipBytes(data, int64(len(data)))
	case ".7z":
		return container.Open7zBytes(data, int64(len(data)))
	}
	return nil, fmt.Errorf("不支持的容器扩展名: %s", ext)
}

// extractAvatarFromArchive 从 .zip/.7z 压缩包提取指定作者的头像。
func extractAvatarFromArchive(modelPath, safeName, ext string) string {
	r, err := openModelContainer(modelPath, ext)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[avatar] %s 打开失败 %s: %v", ext, modelPath, err)
		}
		return ""
	}
	defer r.Close()

	return extractAvatarFromContainer(r, safeName)
}

// readContainerAuthors 从容器读 ysm.json 并解析作者列表（读不到/解析失败返回 nil）。
// 单作者提取与批量缓存共用的唯一 ysm.json 读取点（P2-8：容器分支只解析一次，
// 不再每作者重复读）。
func readContainerAuthors(r container.Reader) []authorEntry {
	ysmData := ReadFileFromContainer(r, "ysm.json")
	if ysmData == nil {
		return nil
	}
	authors, err := parseMetadataAuthors(ysmData)
	if err != nil {
		log.Printf("[avatar] 容器 ysm.json 作者解析失败")
		return nil
	}
	return authors
}

// cacheContainerAvatars .zip/.7z 单遍缓存：一次受限整读 + 一次开容器 + 一次 ysm.json
// 解析，逐作者复用已打开的容器与已解析作者列表（P2-8：原实现每作者
// extractAvatarFromContainer 重读 ysm.json，7z 固实压缩下 N+1 次解压成本）。
// 语义与旧实现等价：作者声明 avatar 可解析则缓存之；否则降级取容器内 avatar/
// 目录第一张图（extractAvatarFromContainerWithAuthors 同口径——容器分支的降级在
// authors 非空且该作者匹配失败时同样生效，与 .ysm 分支行为不同，这里保持一致）。
func cacheContainerAvatars(modelPath, ext string) {
	cacheDir, ok := avatarCacheDir()
	if !ok {
		return
	}
	r, err := openModelContainer(modelPath, ext)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[avatar] %s 打开失败 %s: %v", ext, modelPath, err)
		}
		return
	}
	defer r.Close()

	authors := readContainerAuthors(r)
	for _, au := range authors {
		if au.Name == "" {
			continue
		}
		safe := SafeName(au.Name)
		if avatarCached(cacheDir, safe) {
			continue // 已缓存，跳过
		}
		// 单作者容器提取（作者匹配 → 降级首图，内部 SaveAvatarData 落盘）；
		// 返回 "" 表示该作者无可提取头像（未声明 avatar 且容器无降级图），补日志便于排查
		if uri := extractAvatarFromContainerWithAuthors(r, authors, safe); uri == "" {
			log.Printf("[avatar] %s 作者 %s 未提取到头像（无 avatar 声明或容器内无候选图）", modelPath, safe)
		}
	}
}

// extractAvatarFromContainer 处理压缩包（zip/7z）头像提取的通用逻辑：
// 解析作者列表 → 按作者名匹配 → avatar/ 目录降级（authors 非空且匹配失败时同样
// 降级首图并按 safeName 落盘，与 .ysm 分支语义分叉——2026-09-14 知识卡记档留待统一）。
func extractAvatarFromContainer(r container.Reader, safeName string) string {
	return extractAvatarFromContainerWithAuthors(r, readContainerAuthors(r), safeName)
}

// extractAvatarFromContainerWithAuthors 复用已解析作者列表的单作者容器提取。
// 批量路径（cacheContainerAvatars）传已解析列表，避免每作者重复读 ysm.json
// （P2-8）。匹配失败时降级取容器内 avatar/ 目录第一张图。
func extractAvatarFromContainerWithAuthors(r container.Reader, authors []authorEntry, safeName string) string {
	// 按作者名匹配头像
	for _, au := range authors {
		if SafeName(au.Name) == safeName && au.Avatar != "" {
			ap := strings.ToLower(au.Avatar)
			if !isSafeAvatarPath(ap) {
				continue
			}
			for _, c := range avatarCandidates(ap) {
				if avatarData := ReadFileFromContainer(r, c); avatarData != nil {
					return SaveAvatarData(safeName, avatarData, textureMimeOrDefault(filepath.Ext(c)))
				}
			}
		}
	}

	// 降级：avatar/ 目录第一张 .png/.jpg/.jpeg
	for _, e := range r.Entries() {
		if e.IsDir() {
			continue
		}
		low := strings.ToLower(e.Name())
		if !registry.IsRenderableTextureExt(filepath.Ext(low)) {
			continue
		}
		if !strings.HasPrefix(low, "avatar/") && !strings.Contains(low, "/avatar/") {
			continue
		}
		rc, oerr := e.Open()
		if oerr != nil {
			continue
		}
		avatarData, rerr := io.ReadAll(io.LimitReader(rc, registry.MaxReadLimit+1))
		rc.Close()
		if rerr != nil || int64(len(avatarData)) > registry.MaxReadLimit {
			continue
		}
		return SaveAvatarData(safeName, avatarData, textureMimeOrDefault(filepath.Ext(low)))
	}

	return ""
}
