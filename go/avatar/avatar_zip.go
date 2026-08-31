// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar_zip.go）：ZIP 内文件读取（ReadFileFromZip / ReadFileFromContainer）
// 与路径匹配（matchAvatarZipEntry/isYSMJSONPath），供提取编排复用。拆分自原 avatar.go
// （ADR-040 文件行数治理）。
package avatar

import (
	"archive/zip"
	"io"
	"log"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/types"
)

// ReadFileFromZip 从 ZIP 读取指定路径的文件。
func ReadFileFromZip(zr *zip.Reader, target string) []byte {
	target = filepath.ToSlash(target)
	targetLower := strings.ToLower(target)
	for _, f := range zr.File {
		p := filepath.ToSlash(f.Name)
		// 裸 HasSuffix 会让 sub/avatar/alice.png 命中 avatar/alice.png、
		// x/ysm.json 先于根 ysm.json 被取到——改为「精确路径或根下 target/ 前缀」匹配
		if !matchAvatarZipEntry(p, targetLower) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			log.Printf("[avatar] zip 条目打开失败 %s: %v", f.Name, err)
			return nil
		}
		// R32 P2-1：循环内显式 Close，不依赖 defer（defer 要等函数返回才释放，
		// 多条目命中时累积未关闭句柄）。
		data, err := io.ReadAll(io.LimitReader(rc, types.MaxReadLimit+1))
		rc.Close()
		if err != nil {
			log.Printf("[avatar] zip 条目读取失败 %s: %v", f.Name, err)
			return nil
		}
		if int64(len(data)) > types.MaxReadLimit {
			log.Printf("[avatar] zip 条目超限跳过 %s（解压超限）", f.Name)
			return nil
		}
		return data
	}
	return nil
}

// ReadFileFromContainer 从统一容器读取指定路径的文件（ADR-068：
// 容器打开统一走 container，替代 zip.NewReader + ReadFileFromZip 的 zip 专用路径）。
func ReadFileFromContainer(r container.Reader, target string) []byte {
	target = filepath.ToSlash(target)
	targetLower := strings.ToLower(target)
	for _, e := range r.Entries() {
		if e.IsDir() {
			continue
		}
		p := filepath.ToSlash(e.Name())
		if !matchAvatarZipEntry(p, targetLower) {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			log.Printf("[avatar] 容器条目打开失败 %s: %v", e.Name(), err)
			return nil
		}
		data, rerr := io.ReadAll(io.LimitReader(rc, types.MaxReadLimit+1))
		rc.Close()
		if rerr != nil {
			log.Printf("[avatar] 容器条目读取失败 %s: %v", e.Name(), rerr)
			return nil
		}
		if int64(len(data)) > types.MaxReadLimit {
			log.Printf("[avatar] 容器条目超限跳过 %s（解压超限）", e.Name())
			return nil
		}
		return data
	}
	return nil
}

// matchAvatarZipEntry avatar zip 条目路径匹配（与 types.MatchZipEntry 注册表驱动不同：
//   - 精确相等（含目标含路径如 "avatar/alice.png" 时，仅同名同路径命中，杜绝
//     sub/avatar/alice.png 误命中——P3-3 收紧点）
//   - 目标以 "/" 结尾（目录级）→ 根下该目录前缀
//   - 裸文件名（无 "/"，如 "test.png"）→ 任意目录下同名文件（既有契约：avatar/test.png
//     命中 test.png，avatarCandidates 兼容裸文件名引用）
func matchAvatarZipEntry(p, targetLower string) bool {
	low := strings.ToLower(p)
	if low == targetLower {
		return true
	}
	if strings.HasSuffix(targetLower, "/") {
		return strings.HasPrefix(low, targetLower)
	}
	if !strings.Contains(targetLower, "/") {
		return strings.HasSuffix(low, "/"+targetLower)
	}
	return false
}

// isYSMJSONPath 判断解码产物路径是否为 ysm.json 清单：精确名或任意目录下的 ysm.json。
// 原 HasSuffix(low, "ysm.json") 会把 "notysm.json"/"myysm.json" 等误判为清单——若该文件
// 先于真实 ysm.json 出现在文件列表，元数据解析会取到错误内容；zip 分支 matchAvatarZipEntry
// 裸名匹配仅认 "/ysm.json" 后缀，两分支口径不一致（本次对齐）。
// 委托 types.IsYsmEntryJSON 作为单一事实来源（ADR-038 D2）。
func isYSMJSONPath(p string) bool {
	low := strings.ToLower(filepath.ToSlash(p))
	return types.IsYsmEntryJSON(low) || types.IsYsmEntryJSON(filepath.Base(low))
}
