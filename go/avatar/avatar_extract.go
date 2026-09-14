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

// modelDoneMarker 记录某模型已整批处理过头像的签名，避免全缓存后重复解码/解压。
// .ysm 是加密容器，作者名单只能经 WASM 解码拿到——无法在解码前判断「是否已全缓存」，
// 故用「模型级 + 文件签名」做已完成标记：二次调用签名命中即短路，不再 spawn 解码子进程
// （探针暴露：全缓存 .ysm 仍每次调用触发 1 次 Node+WASM 解码）。
// 签名 = size+mtime（轻量，不读内容哈希，覆盖文件被替换/改名的常见失效率），
// 模型未变即命中 → 短路；模型变 → 重解重写标记。标记与作者 png 同目录、后缀 .done，
// PurgeAvatarCache 一并清空（缓存失效时同步作废，不残留陈旧标记）。
func modelDoneMarker(cacheDir, modelPath string) string {
	return filepath.Join(cacheDir, SafeName(filepath.Base(modelPath))+".done")
}

// modelProcessedYet 返回该模型是否已按当前签名处理过头像（短路判据）。
func modelProcessedYet(cacheDir, modelPath string) (bool, string) {
	sig := modelSignature(modelPath)
	if sig == "" {
		return false, "" // Stat 失败（文件不可读/缺失）不短路，走失败降级
	}
	b, err := os.ReadFile(modelDoneMarker(cacheDir, modelPath))
	if err != nil {
		return false, sig // 标记缺失：首次处理
	}
	return strings.TrimSpace(string(b)) == sig, sig
}

// markModelDone 记录模型本次处理签名（写入失败仅 log，不阻断——下次会重解，行为等价旧版）。
func markModelDone(cacheDir, modelPath, sig string) {
	if sig == "" {
		return
	}
	if err := fsutil.WriteFileAtomic(modelDoneMarker(cacheDir, modelPath), []byte(sig)); err != nil {
		log.Printf("[avatar] 写入模型头像处理标记失败 %s: %v", modelPath, err)
	}
}

// modelSignature 计算模型 size+mtime 轻量签名；Stat 失败返回空串。
func modelSignature(modelPath string) string {
	fi, err := os.Stat(modelPath)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%d:%d", fi.Size(), fi.ModTime().UnixNano())
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
