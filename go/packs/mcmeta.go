package packs

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types/registry"
)

// 资源包文件大小上限
const (
	maxMcmetaSize = 1 << 20  // pack.mcmeta 1MB（合法文件通常 < 1KB）
	maxPackPng    = 10 << 20 // pack.png 10MB
	maxLangSize   = 1 << 20  // lang 文件 1MB（合法文件通常 < 10KB）
)

// sentinel 错误——调用方用 errors.Is 判断，禁止 strings.Contains(err.Error()) 文本匹配
var (
	// ErrPackMetaNotFound 资源包内没有 pack.mcmeta
	ErrPackMetaNotFound = errors.New("未找到 pack.mcmeta")
	// ErrPackMetaTooLarge pack.mcmeta 超过 1MB 上限
	ErrPackMetaTooLarge = errors.New("pack.mcmeta 超过 1MB 上限")
)

// readCapped 读入上限字节并做 +1 截断探测（ADR-033 统一出口）。
// 返回实际读到的内容与「是否超限」：data 始终是原样读到的字节（超限时为 limit+1 字节），
// 由调用方按各自口径决定丢弃还是据此报错（dir pack.mcmeta 要报实际字节数）。
// err 非 nil 时 data 保留部分读取结果——与原 `data, _ = io.ReadAll(...)` 口径一致。
func readCapped(r io.Reader, limit int64) (data []byte, over bool, err error) {
	buf, err := io.ReadAll(io.LimitReader(r, limit+1))
	return buf, int64(len(buf)) > limit, err
}

// readDirPackMeta 读取目录形态资源包的 pack.mcmeta 与 pack.png。
// 顺序与短路口径与迁移前一致：pack.mcmeta 超限立即返回 ErrPackMetaTooLarge
// （不再尝试读 pack.png）。
func readDirPackMeta(path string) (data, packPng []byte, err error) {
	metaPath := filepath.Join(path, "pack.mcmeta")
	// FIFO/设备文件 os.Open 会阻塞挂起——Stat 预检强制常规文件
	if st, statErr := os.Stat(metaPath); statErr == nil && st.Mode().IsRegular() {
		if meta, openErr := os.Open(metaPath); openErr == nil {
			// 限制 pack.mcmeta 大小（1MB，合法文件通常 < 1KB），防畸形大文件读入内存
			// +1 探测截断（ADR-033）——原 io.ReadAll(io.LimitReader)
			// 恰 1MB 被截断后静默继续，与 pack.png/lang 的 LimitReader+1 口径不一致
			// （对齐 lang 分支的写法：Open + LimitReader + 长度判断）
			var over bool
			data, over, _ = readCapped(meta, maxMcmetaSize)
			_ = meta.Close()
			if over {
				return nil, nil, fmt.Errorf("%w（实际 %d 字节）", ErrPackMetaTooLarge, len(data))
			}
		}
	}
	pngPath := filepath.Join(path, "pack.png")
	// 目录形态 pack.png 与 ZIP 分支对齐 10MB 上限（stat 预检防超大图整读内存）
	// FIFO/设备文件 Stat size==0 会放行后 os.ReadFile 阻塞挂起——
	// 与 lang 分支同款坑（dir lang 分支已专门处理），此处同样改为 Open+LimitReader+1
	if st, statErr := os.Stat(pngPath); statErr == nil && st.Size() <= maxPackPng && st.Mode().IsRegular() {
		if png, openErr := os.Open(pngPath); openErr == nil {
			var over bool
			packPng, over, _ = readCapped(png, maxPackPng)
			_ = png.Close()
			if over {
				packPng = nil // 超限视为无效，缩略图可选
			}
		}
	}
	return data, packPng, nil
}

// readZipPackMeta 读取 ZIP 形态资源包的 pack.mcmeta 与 pack.png。
// 任意层级段匹配（与检测层 MatchZipEntry 的 ADR-082 S1 口径一致）：
// zip 外层套一层目录的资源包（MyPack/pack.mcmeta）也能读到元数据。
func readZipPackMeta(path string) (data, packPng []byte, metaTooLarge bool, err error) {
	r, err := zip.OpenReader(path)
	if err != nil {
		return nil, nil, false, fmt.Errorf("打开资源包 %s: %w", path, err)
	}
	defer func() { _ = r.Close() }()
	for _, f := range r.File {
		low := strings.ToLower(f.Name)
		if low == "pack.mcmeta" || strings.HasSuffix(low, "/pack.mcmeta") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			// 限制 pack.mcmeta 大小（1MB），与 pack.png 的 LimitReader 保护对齐
			// +1 截断探测（ADR-033）——恰 1MB 被截断后静默继续
			readData, over, readErr := readCapped(rc, maxMcmetaSize)
			_ = rc.Close()
			if readErr == nil && !over {
				data = readData
			} else if readErr == nil {
				metaTooLarge = true // 超限（截断探测到 >1MB），文件存在但不可用
			}
		}
		if low == "pack.png" || strings.HasSuffix(low, "/pack.png") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			// limit+1 探测截断（ADR-033 陷阱）——超 10MB 的 pack.png 被截断后
			// readErr==nil，损坏 PNG 会被 base64 包装展示。超限时置空跳过
			readData, over, readErr := readCapped(rc, maxPackPng)
			_ = rc.Close()
			if readErr == nil && !over {
				packPng = readData
			}
		}
	}
	return data, packPng, metaTooLarge, nil
}

// ReadPackMeta 从资源包文件（.zip 或目录）中读取 pack.mcmeta，返回名称和 base64 缩略图
func ReadPackMeta(path string) (*registry.PackMeta, string, error) {
	var data []byte
	var packPng []byte
	var metaTooLarge bool // zip 分支超限 pack.mcmeta 标记（与 dir 分支一致报 ErrPackMetaTooLarge）

	info, err := os.Stat(path)
	if err != nil {
		return nil, "", fmt.Errorf("stat 资源包 %s: %w", path, err)
	}

	if info.IsDir() {
		// 目录格式资源包
		data, packPng, err = readDirPackMeta(path)
		if err != nil {
			return nil, "", err
		}
	} else if strings.HasSuffix(strings.ToLower(path), ".zip") {
		// ZIP 格式资源包
		data, packPng, metaTooLarge, err = readZipPackMeta(path)
		if err != nil {
			return nil, "", err
		}
	}

	if metaTooLarge && len(data) == 0 {
		return nil, "", fmt.Errorf("%w（zip 内 pack.mcmeta 超过 1MB）", ErrPackMetaTooLarge)
	}
	if len(data) == 0 {
		return nil, "", ErrPackMetaNotFound
	}

	var meta registry.PackMeta
	// 去除 UTF-8 BOM（PowerShell 写入的 JSON 可能带 EF BB BF 前缀）
	data = fsutil.StripBOM(data)
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, "", fmt.Errorf("pack.mcmeta 解析失败: %w", err)
	}

	// base64 缩略图
	var thumb string
	if len(packPng) > 0 {
		thumb = "data:image/png;base64," + base64.StdEncoding.EncodeToString(packPng)
	}

	return &meta, thumb, nil
}

// DetectResourceType 识别入口（ADR-144：识别大脑下沉本包后为同包直调，薄壳撤销）。
// 签名保持不变——cli/flow.go classifyForScan / internal/app 直接调用。
func DetectResourceType(path string, registry *registry.ResourceTypeRegistry) string {
	return ClassifyResource(path, registry)
}

// isYsmFile 委托同包 IsYsmFile（ADR-144：识别大脑下沉本包）。
// 保留 packs 包可见性——packs_extra_test.go/mcmeta_test.go 直接引用。
func isYsmFile(path string) bool {
	return IsYsmFile(path)
}

// hasExt 扩展名集合成员判定（测试直接引用，保留）。
func hasExt(ext string, exts []string) bool {
	for _, e := range exts {
		if ext == strings.ToLower(e) {
			return true
		}
	}
	return false
}

// ReadShaderpackLang 从光影包 ZIP 中读取 lang/en_US.lang，尝试提取显示名
// 返回 {name, entries} JSON 串，name 为空时前端用文件名兜底
func ReadShaderpackLang(path string) string {
	name, entries := ReadShaderpackLangParts(path)
	result := map[string]interface{}{
		"name":    name,
		"entries": entries,
	}
	return marshalShaderpackResult(result)
}

// readDirLangFile 读取已解压目录形态的 lang/en_US.lang（空/超限/不可读均返回 nil）。
func readDirLangFile(langPath string) []byte {
	// dir 分支与 zip 分支同用「Open + LimitReader + 截断探测」——
	// 原 os.Stat 预检 + os.ReadFile 是 check-then-act TOCTOU：并发修改时 ReadFile 整读
	// 当前文件绕过大小时限；FIFO/设备文件 Stat.Size()==0 通过预检后 ReadFile 阻塞或无限读。
	// LimitReader 的界在「实际读取」上生效，特殊文件也无法挂起读取。
	// FIFO/设备文件 os.Open 会阻塞挂起——Stat 预检强制常规文件
	if st, err := os.Stat(langPath); err == nil && st.Mode().IsRegular() {
		if lf, err := os.Open(langPath); err == nil {
			data, over, _ := readCapped(lf, maxLangSize)
			_ = lf.Close()
			if over {
				return nil // 超限视为无效，返回空 name（前端用文件名兜底）
			}
			return data
		}
	}
	return nil
}

// readZipLangEntry 读取 ZIP 形态光影包内首个 lang/en_us.lang（空/超限/无此条目均返回 nil）。
func readZipLangEntry(path string) []byte {
	r, err := zip.OpenReader(path)
	if err != nil {
		return nil
	}
	defer func() { _ = r.Close() }()
	for _, f := range r.File {
		low := strings.ToLower(f.Name)
		// 统一小写比较——原 `low == "lang/en_US.lang"` 永远不成立
		// （low 已 ToLower，不可能含大写 US），属死代码；
		// 与 ReadPackMeta 的 pack.mcmeta/pack.png 比较口径对齐
		// 任意层级段匹配：套一层目录的光影包（MyPack/lang/en_us.lang）也能读到 lang
		if low == "lang/en_us.lang" || strings.HasSuffix(low, "/lang/en_us.lang") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			// lang 文件设大小上限（limit+1 截断探测，对齐 ADR-033）——
			// 原 io.ReadAll 全量读入，畸形/超大 lang 可拖垮内存，与包内其余 LimitReader 防护不统一
			data, over, _ := readCapped(rc, maxLangSize)
			_ = rc.Close()
			if over {
				return nil // 超限视为无效，返回空 name（前端用文件名兜底）
			}
			return data // 首个匹配条目即返回（原 `break` 跳出 r.File 循环，非 switch）
		}
	}
	return nil
}

// readShaderpackLangBytes 按形态取 lang 原文：目录读 <path>/lang/en_US.lang，zip 读包内条目。
func readShaderpackLangBytes(path string, info os.FileInfo) []byte {
	if info.IsDir() {
		// 已解压的目录格式
		return readDirLangFile(filepath.Join(path, "lang", "en_US.lang"))
	}
	if strings.HasSuffix(strings.ToLower(path), ".zip") {
		return readZipLangEntry(path)
	}
	return nil
}

// parseLangEntries 解析 .lang 的 key=value 文本：返回全量 entries 与首个命中的显示名。
// 只有「含 '=' 且 key、value 均非空」的行入表；空行/'#' 注释/无 '=' 一律跳过。
func parseLangEntries(langData []byte) (string, map[string]string) {
	entries := make(map[string]string)
	var name string
	for _, line := range strings.Split(string(langData), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eqIdx := strings.Index(line, "=")
		if eqIdx < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eqIdx])
		val := strings.TrimSpace(line[eqIdx+1:])
		if key == "" || val == "" {
			continue
		}
		entries[key] = val
		// 常见的显示名 key（精确匹配，避免误匹配 pack.namespace / subtitle 等；
		// 裸 title 是合法 key，测试钉住）
		lowKey := strings.ToLower(key)
		if lowKey == "pack.name" || lowKey == "shaderpack.name" || lowKey == "title" || strings.HasSuffix(lowKey, ".title") {
			if name == "" {
				name = val
			}
		}
	}
	return name, entries
}

// ReadShaderpackLangParts 解析光影包 lang/en_US.lang，返回 name + entries。
// 与 ReadShaderpackLang 共用解析逻辑（后者仅多一层 JSON 序列化，历史契约保留）。
// 三个 helper 各自承载「取字节（路径形态分支）」「解析（.lang 语法）」两类职责：
// 原实现把形态探测与逐行解析堆在一个函数里，任一语法分支写歪都难定位。
func ReadShaderpackLangParts(path string) (string, map[string]string) {
	info, err := os.Stat(path)
	if err != nil {
		return "", map[string]string{}
	}

	langData := readShaderpackLangBytes(path, info)
	if len(langData) == 0 {
		return "", map[string]string{}
	}
	return parseLangEntries(langData)
}

// marshalShaderpackResult 序列化光影包 lang 读取结果（规律六：不吞错）
// json.Marshal 对 map[string]interface{} 几乎不可能失败，但失败时仍返回
// 带 error 字段的合法 JSON，避免前端拿到空串 → JSON.parse("") 抛异常
func marshalShaderpackResult(result map[string]interface{}) string {
	data, err := json.Marshal(result)
	if err != nil {
		return fmt.Sprintf(`{"name":"","entries":{},"error":%q}`, err.Error())
	}
	return string(data)
}
