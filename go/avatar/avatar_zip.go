// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar_zip.go）：容器内文件受限读取（ReadFileFromContainer）与
// 路径判定（isYSMJSONPath），供提取编排复用。拆分自原 avatar.go
// （ADR-040 文件行数治理）。
package avatar

import (
	"io"
	"log"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/types/registry"
)

// readContainerName 按名读取容器中首个命中条目（扫名走 container.FindEntry，大小受限）。
func readContainerName(r container.Reader, target string) []byte {
	e, ok := container.FindEntry(r, target)
	if !ok {
		return nil
	}
	rc, err := e.Open()
	if err != nil {
		log.Printf("[avatar] 容器条目打开失败 %s: %v", e.Name(), err)
		return nil
	}
	data, rerr := io.ReadAll(io.LimitReader(rc, registry.MaxReadLimit+1))
	_ = rc.Close() // 只读句柄 best-effort 关闭；读错误由下方 rerr 判定为主
	if rerr != nil {
		log.Printf("[avatar] 容器条目读取失败 %s: %v", e.Name(), rerr)
		return nil
	}
	if int64(len(data)) > registry.MaxReadLimit {
		log.Printf("[avatar] 容器条目超限跳过 %s（解压超限）", e.Name())
		return nil
	}
	return data
}

// ReadFileFromContainer 从统一容器读取指定路径的文件（ADR-068：容器打开统一走
// container，替代 zip.NewReader + ReadFileFromZip 的 zip 专用路径；扫名走
// container.FindEntry 收口）。
func ReadFileFromContainer(r container.Reader, target string) []byte {
	return readContainerName(r, target)
}

// isYSMJSONPath 判断解码产物路径是否为 ysm.json 清单：精确名或任意目录下的 ysm.json。
// 原 HasSuffix(low, "ysm.json") 会把 "notysm.json"/"myysm.json" 等误判为清单——若该文件
// 先于真实 ysm.json 出现在文件列表，元数据解析会取到错误内容；zip/容器分支统一走
// container.MatchEntryName 的裸名精确契约，两分支口径已对齐。
// 委托 registry.IsYsmEntryJSON 作为单一事实来源（ADR-038 D2）。
func isYSMJSONPath(p string) bool {
	low := strings.ToLower(filepath.ToSlash(p))
	return registry.IsYsmEntryJSON(low) || registry.IsYsmEntryJSON(filepath.Base(low))
}
