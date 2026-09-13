// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar_extract.go）：头像提取入口与共享工具——格式分发
// （ExtractAvatarURI/CacheAvatarsFromModel）、受限读取（readLimitedModel）、
// 缓存目录（avatarCacheDir/avatarCached）与 MIME 兜底（textureMimeOrDefault）。
// 各格式分支拆分：.ysm 见 avatar_extract_ysm.go、容器（.zip/.7z）见
// avatar_extract_container.go、.json 见 avatar_extract_json.go
// （ADR-040 文件行数治理）。
package avatar

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types/registry"
)

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

// CacheAvatarsFromModel 从 .ysm/.zip/.7z/.json 模型缓存所有作者头像。
// 覆盖 CacheAvatarsFromJSON 仅处理解压目录（.json）的局限，使创作者视图头像
// 对压缩包/二进制模型（.ysm/.zip/.7z）同样生效。
// 单遍实现：旧实现先 modelAuthorNames 全量读/解码一次拿
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

// readLimitedModel 受限读取模型文件（.ysm/.zip/.json 可达数百 MB——头像/作者
// 提取只需扫描内容，全量整读内存膨胀；50MB 上限对齐 geometry maxExtractSize 口径，
// 超限返回 error 由调用方按读取失败处理）。
func readLimitedModel(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	data := fsutil.ReadLimitedEntry(f, registry.MaxReadLimit)
	if data == nil {
		return nil, fmt.Errorf("模型文件读取失败或超过上限: %s", path)
	}
	return data, nil
}

// textureMimeOrDefault 扩展名 → MIME；裸文件名等无扩展名场景兜底 image/png
// （P2-5：原 mime 兜底逐行复制三处，收敛为单点）。
func textureMimeOrDefault(ext string) string {
	if mime := registry.TextureMIME(ext); mime != "" {
		return mime
	}
	return "image/png"
}
