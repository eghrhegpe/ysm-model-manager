// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar.go）：头像缓存核心——缓存目录（CacheDir）、安全文件名/路径校验
// （SafeName/isSafeAvatarPath）、候选路径（avatarCandidates）与缓存读写
// （ReadCachedAvatar/SaveAvatarData/readLimitedAvatar）。提取编排见 avatar_extract.go，
// zip 读取见 avatar_zip.go，Node.js WASM 解码桥见 avatar_decode.go
// （ADR-040 文件行数治理：原 767 行单文件按职责拆分，每文件 ≤400 行，红线 500）。
package avatar

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
)

// CacheDir 返回头像缓存目录。
// 默认走 os.UserConfigDir()/YSM-Model-Manager/creators_cache（与 configDir() 桌面根同口径，ADR-046 P2）：
// avatar 包为叶包、不依赖 Wails runtime，无法复用 pathMgr，故直接取系统配置根。
// 平台配置根缺失时返回空串 fail-fast（与 configDir() 一致），不降级写 exe 旁或 CWD——
// exe 旁在安卓只读 APK 路径下会静默失败；NewApp() 运行期以 pathMgr 沙盒覆盖此默认值（app.go）。
// 外部可覆盖此函数（测试时可设置临时目录）。
var CacheDir = func() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		return "" // 平台配置根不可用：no-op，不降级写 exe 旁/CWD
	}
	return filepath.Join(base, "YSM-Model-Manager", "creators_cache")
}

type authorEntry struct {
	Name   string `json:"name"`
	Role   string `json:"role,omitempty"`
	Avatar string `json:"avatar,omitempty"`
}

// parseMetadataAuthors 解析 ysm.json 的 metadata.authors 列表——全包唯一元数据声明
// （authorEntry 见上）。解析失败返回 error，由各调用点按既有口径处理：批量缓存路径
// （CacheAvatarsFromJSON/containerAuthorNames）log 后返回，单作者提取路径静默
// （与重构前匿名 struct 分支行为一致）；无 authors 字段时返回 nil。
func parseMetadataAuthors(data []byte) ([]authorEntry, error) {
	var root struct {
		Meta struct {
			Authors []authorEntry `json:"authors"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	return root.Meta.Authors, nil
}

// SafeName 将非法文件名字符替换为下划线。
func SafeName(name string) string {
	r := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	)
	safe := r.Replace(name)
	// Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）与尾部点/空格
	// 会导致缓存写失败（"CON.png" 被系统拒绝）；去尾后与保留名比对则加下划线前缀
	safe = strings.TrimRight(safe, " .")
	base := safe
	// 按 '.' 与 '_' 均分割——Windows 保留设备名
	// 无论带什么扩展名/后缀都被系统拒绝（CON.png / COM1.config / CON.Doe），
	// 原实现只按 '_' 分割导致点号变体逃逸
	if idx := strings.IndexAny(base, "._"); idx >= 0 {
		base = base[:idx]
	}
	switch strings.ToUpper(base) {
	case "CON", "PRN", "AUX", "NUL",
		"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return "_" + safe
	}
	return safe
}

// isSafeAvatarPath 强校验头像相对路径：
// Clean 规范化后必须位于 "avatar" 目录下（严格前缀），且不含 ".." 逃逸段。
// 原 HasPrefix("avatar") 弱校验放行 "avatar/../../x" 逃出模型目录，
// 且 "avatars/.."、"avatarx/.." 等非精确目录也会误放行。
// 接受裸文件名（"alice.png" → avatar/alice.png 归一化），
// 兼容 ysm.json 中不带 avatar/ 前缀的旧式声明——安全目标（拒绝 .. 逃逸）不牺牲兼容。
func isSafeAvatarPath(ap string) bool {
	// 先把反斜杠归一化为正斜杠再校验——原新增守卫
	// `strings.Contains(ap, "\\") → return false` 会把 Windows 上合法的 `avatar\alice.png`
	// 分隔写法也拒绝（filepath.Join 在 Windows 上解析到 avatar/ 内，改动前正常工作）；
	// 归一化后合法反斜杠路径放行，逃逸形态 `avatar\..\x` 折叠为 `avatar/../x` 被既有
	// `..` 段检查拒绝（顺带封住 Windows 反斜杠逃逸）
	ap = filepath.ToSlash(ap)
	clean := path.Clean(strings.ToLower(strings.TrimSpace(ap)))
	if clean == "avatar" {
		return true
	}
	if !strings.HasPrefix(clean, "avatar/") {
		// 裸文件名：归一化为 avatar/ 前缀再校验（旧式 ysm.json 声明兼容）。
		// 仅当原始串不含 `/`（确为纯文件名）时才归一化——原实现对任意
		// 非 avatar/ 前缀路径归一化，`avatar/../x` 先被 path.Clean 折叠为 `x`
		// 再归一化为 `avatar/x` 放行，而调用方 filepath.Join(dir, 原始路径)
		// 实际读到 avatar/ 之外、模型目录内的任意文件（违反「严格 avatar/ 前缀」）
		if strings.Contains(ap, "/") {
			return false
		}
		clean = path.Clean("avatar/" + clean)
	}
	// 拒绝任何 ".." 段（Clean 后仍含则说明原路径有逃逸意图）
	for _, seg := range strings.Split(clean, "/") {
		if seg == ".." {
			return false
		}
	}
	return strings.HasPrefix(clean, "avatar/")
}

// avatarCandidates 由 ysm.json 的 avatar 引用生成候选路径列表，用于在前端 WASM 解码产物
// 或 ZIP 内定位真实头像文件。兼容裸文件名（"sdf"）与带 avatar/ 前缀/扩展名的形式
// （"avatar/sdf.png"），覆盖 ysm.json 旧式声明——与 .json 分支 isSafeAvatarPath 口径一致。
func avatarCandidates(ref string) []string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil
	}
	low := strings.ToLower(ref)
	base := filepath.Base(ref)
	ext := strings.ToLower(filepath.Ext(base))
	stem := base
	if ext != "" {
		stem = strings.TrimSuffix(base, ext)
	}
	cands := []string{ref}
	// 裸文件名（无 avatar/ 前缀）→ 补前缀
	if !strings.HasPrefix(low, "avatar/") && !strings.HasPrefix(low, "avatar\\") {
		cands = append(cands, "avatar/"+ref)
	}
	// 补充标准扩展名变体（避免裸 "sdf" 找不到实际 "sdf.png"）
	for _, e := range []string{".png", ".jpg", ".jpeg"} {
		cands = append(cands, "avatar/"+stem+e)
		if !strings.HasPrefix(low, "avatar/") && !strings.HasPrefix(low, "avatar\\") {
			cands = append(cands, stem+e)
		}
	}
	return cands
}

// ReadCachedAvatar 读取缓存中的头像，返回 data URI。
// 缓存未命中时返回 ("", nil)，IO 错误时返回 ("", err)。
func ReadCachedAvatar(authorName string) (string, error) {
	if CacheDir() == "" {
		return "", nil // 平台数据根缺失：no-op（不降级为 CWD 读）
	}
	safe := SafeName(authorName)
	cachedPath := filepath.Join(CacheDir(), safe+".png")
	// 缓存读取套上限（头像数据通常 < 1MB）——防损坏/超大
	// 缓存文件整读内存膨胀（与模型读取同口径）
	data, err := readLimitedAvatar(cachedPath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", nil // 缓存未命中，非错误
		}
		return "", err // IO 错误（权限/磁盘故障等）
	}
	// 按文件头嗅探 mime——原硬编码 `data:image/png`，JPEG 头像以 .png 落盘
	// （SaveAvatarData 恒用 safeName+".png"）读回时 MIME 错误（前端 <img> 仍可显示，
	// 但导出/复制 data URI 给其他工具时 type 不匹配）
	mime := "image/png"
	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		mime = "image/jpeg"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// SaveAvatarData 将头像数据写入缓存。
func SaveAvatarData(safeName string, data []byte, mime string) string {
	dir := CacheDir()
	if dir == "" {
		// 平台数据根缺失：不写磁盘（no-op），仍返回 data URI（即时显示依赖内存）
		return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
	}
	if err := os.MkdirAll(dir, fsutil.DirPerms); err != nil {
		log.Printf("[avatar] 缓存目录创建失败: %v", err)
	}
	// 缓存写收敛 fsutil.WriteFileAtomic（CreateTemp + rename
	// 原子替换）——原 os.WriteFile 并发 SaveAvatarData 同作者时互相截断写坏（半写文件
	// 落盘，下次 ReadCachedAvatar 读到损坏 PNG）；失败不返回错误（有 log，仍返回
	// data URI 即时显示，属有意降级）
	if err := fsutil.WriteFileAtomic(filepath.Join(dir, safeName+".png"), data); err != nil {
		log.Printf("[avatar] 缓存写入失败: %v", err)
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// readLimitedAvatar 受限读取头像文件（头像通常 < 1MB，上限 20MB 兜底防损坏/超大
// 缓存整读内存膨胀）。超限/读取失败返回 error（ReadCachedAvatar 需区分 IsNotExist
// 与 IO 错误；其余调用点忽略错误仅判 nil 跳过）。
func readLimitedAvatar(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	const maxAvatarBytes = 20 << 20
	data := fsutil.ReadLimitedEntry(f, maxAvatarBytes)
	if data == nil {
		return nil, fmt.Errorf("头像文件读取失败或超过上限: %s", path)
	}
	return data, nil
}
