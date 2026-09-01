// ===== 容器内条目枚举 + 体素读取绑定（ADR-132 遗留 1：蓝图/litematic zip 多 nbt 预览）=====
// ListContainerEntries 枚举容器内指定扩展名条目；GetVoxelDataInContainer 读容器内
// gzip NBT 条目并构建体素数据（与 Get*VoxelData 同形状 JSON）。
// 复用 container.Reader（ADR-068），统一支持 .zip / 目录 / .7z；条目读取走
// litematic.OpenGzRootFromBytes（解耦后的「root→voxel」管线，容器内零路径层）。
// 边界：本文件只管「枚举 + 读取」，不做容器格式判定（调用方按容器扩展名路由）。

package app

import (
	"io"
	"log"
	"sort"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/litematic"
	"ysm-model-manager/go/types"
)

// maxContainerEntrySize 单条目读取上限（64MB，对齐 resourcepack_models.maxPackEntrySize
// 口径：体素 NBT 远小于此，zip-bomb 防线由 litematic.readRootCompound 的 100MB 上限二次兜底）。
const maxContainerEntrySize = 64 << 20

// containerEntrySafe 条目路径守卫：禁 .. / 反斜杠 / 绝对路径（防穿越，对齐
// resourcepack_models.packEntrySafe 的口径——但容器条目不必 assets/ 前缀）。
func containerEntrySafe(name string) bool {
	if name == "" {
		return false
	}
	if strings.HasPrefix(name, "/") {
		return false
	}
	if strings.Contains(name, "..") || strings.Contains(name, "\\") {
		return false
	}
	return true
}

// containerExtMatch 判定条目扩展名是否在 exts 白名单内（小写、含点，如 .nbt/.litematic）。
// exts 为空 = 放行全部非目录条目（调用方自行过滤语义）。
func containerExtMatch(name string, exts map[string]bool) bool {
	if len(exts) == 0 {
		return true
	}
	dot := strings.LastIndex(name, ".")
	if dot < 0 {
		return false
	}
	return exts[strings.ToLower(name[dot:])]
}

// parseContainerExts 解析逗号分隔扩展名白名单（".nbt,.litematic,.schematic" → set；
// 空串/空白 → 空 set = 放行全部）。
func parseContainerExts(exts string) map[string]bool {
	out := map[string]bool{}
	for _, e := range strings.Split(exts, ",") {
		e = strings.ToLower(strings.TrimSpace(e))
		if e == "" {
			continue
		}
		// 无点前缀自动补（调用方传 .nbt 或 nbt 均生效）
		if !strings.HasPrefix(e, ".") {
			e = "." + e
		}
		out[e] = true
	}
	return out
}

// ListContainerEntries 枚举容器内匹配扩展名白名单的条目路径（升序）。
// exts 逗号分隔（如 ".nbt,.litematic,.schematic"）；失败 → error。
func (a *App) ListContainerEntries(path string, exts string) ([]string, error) {
	r, err := container.Open(path)
	if err != nil {
		log.Printf("[container] ListContainerEntries 打开失败 %s: %v", path, err)
		return nil, err
	}
	defer r.Close()
	extSet := parseContainerExts(exts)
	seen := map[string]bool{}
	out := []string{}
	for _, e := range r.Entries() {
		if e.IsDir() {
			continue
		}
		n := e.Name()
		if !containerEntrySafe(n) {
			continue
		}
		if !containerExtMatch(n, extSet) {
			continue
		}
		if !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return out, nil
}

// GetVoxelDataInContainer 读取容器内 gzip NBT 条目并构建体素数据（与 Get*VoxelData
// 同形状：成功 → *types.LitematicVoxelData；失败 → error）。
// entry 为容器内条目路径（如 "subdir/a.nbt"）；ext 决定体素构建器分派
// （.nbt → BuildNbtVoxelDataFromRoot / .schematic → BuildSchematicVoxelDataFromRoot /
// 其余 → BuildVoxelDataFromRoot，对齐 VOXEL_RPC_BY_EXT 前端映射）。
func (a *App) GetVoxelDataInContainer(path string, entry string, ext string) (*types.LitematicVoxelData, error) {
	if !containerEntrySafe(entry) {
		log.Printf("[container] GetVoxelDataInContainer 非法条目 %q", entry)
		return nil, errString("非法条目路径")
	}
	r, err := container.Open(path)
	if err != nil {
		log.Printf("[container] GetVoxelDataInContainer 打开失败 %s: %v", path, err)
		return nil, err
	}
	defer r.Close()
	for _, e := range r.Entries() {
		if e.IsDir() || !strings.EqualFold(e.Name(), entry) {
			continue
		}
		if !containerEntrySafe(e.Name()) {
			return nil, errString("条目路径非法")
		}
		rc, oerr := e.Open()
		if oerr != nil {
			return nil, oerr
		}
		data, rerr := io.ReadAll(io.LimitReader(rc, maxContainerEntrySize))
		rc.Close()
		if rerr != nil {
			log.Printf("[container] GetVoxelDataInContainer 读取失败 %s/%s: %v", path, entry, rerr)
			return nil, rerr
		}
		root, derr := litematic.OpenGzRootFromBytes(data)
		if derr != nil {
			log.Printf("[container] GetVoxelDataInContainer NBT 解码失败 %s/%s: %v", path, entry, derr)
			return nil, derr
		}
		var vd *types.LitematicVoxelData
		switch strings.ToLower(ext) {
		case ".nbt":
			vd, derr = litematic.BuildNbtVoxelDataFromRoot(root, a.voxelMaxBlocks())
		case ".schematic":
			vd, derr = litematic.BuildSchematicVoxelDataFromRoot(root, a.voxelMaxBlocks())
		default:
			vd, derr = litematic.BuildVoxelDataFromRoot(root, a.voxelMaxBlocks())
		}
		if derr != nil {
			log.Printf("[container] GetVoxelDataInContainer 体素构建失败 %s/%s: %v", path, entry, derr)
			return nil, derr
		}
		return vd, nil
	}
	log.Printf("[container] GetVoxelDataInContainer 条目不存在 %s/%s", path, entry)
	return nil, errString("容器内不存在该条目")
}

// errString 包装字符串为 error（voxelErrorJSON 入参统一）。
func errString(s string) error {
	return &containerEntryError{s}
}

// containerEntryError 简单字符串错误。
type containerEntryError struct{ s string }

func (e *containerEntryError) Error() string { return e.s }
