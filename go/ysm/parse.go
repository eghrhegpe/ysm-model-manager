package ysm

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types/registry"
)

// YSMModelMeta 模型元数据（从 model.json 提取）
type YSMModelMeta struct {
	Name       string `json:"name"`
	Author     string `json:"author"`
	Version    string `json:"version"`
	Bones      int    `json:"bones"`
	Textures   int    `json:"textures"`
	Animations int    `json:"animations"`
	Vertices   int    `json:"vertices"`
	Faces      int    `json:"faces"`
	HasError   bool   `json:"hasError"`
	ErrorMsg   string `json:"errorMsg,omitempty"`
}

// 内部用——model.json 的完整结构（只关心需要的字段）
type ysmModelJSON struct {
	Name       string          `json:"name"`
	Author     string          `json:"author"`
	Version    string          `json:"version"`
	Bones      json.RawMessage `json:"bones"`      // 数组，取长度
	Textures   json.RawMessage `json:"textures"`   // 数组或对象，取长度
	Animations json.RawMessage `json:"animations"` // 数组，取长度
	Model      *ysmGeometry    `json:"model"`
}

type ysmGeometry struct {
	Vertices json.RawMessage `json:"vertices"` // 数组，取长度
	Faces    json.RawMessage `json:"faces"`    // 数组，取长度
}

// validateYsmModelExt 校验扩展名：.ysm/.zip 直接放行（.ysm 也可能没有扩展名）；
// 其余形态剥离禁用后缀后再查一次。返回 (true, "") 通过，(false, 文案) 拒绝。
func validateYsmModelExt(path string) (ok bool, errMsg string) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".ysm" && ext != ".zip" {
		// 去掉禁用后缀再检查
		if !registry.IsDisableSuffix(path) {
			return false, "不支持的文件类型，仅支持 .ysm"
		}
		base := registry.StripDisableSuffix(path)
		ext2 := strings.ToLower(filepath.Ext(base))
		if ext2 != ".ysm" && ext2 != ".zip" {
			return false, "不支持的文件类型"
		}
	}
	return true, ""
}

// checkZipEntrySizes 校验 ZIP 条目尺寸不超过 registry.MaxImportSize。
// 返回 (true, "") 通过，(false, 文案) 拒绝。
//
// P1 修复：防止恶意构造的多文件 ZIP 撑爆内存。
// int64 溢出防线：单条目 UncompressedSize64 > MaxInt64 时 int64() 转换会回绕为负，
// 使 totalSize 累加后绕过 500MB 上限（zip 中央目录可声明伪造巨型未压缩大小）。
// 先按 uint64 逐条比较（无符号比较不会回绕），再累加 int64 总量。
func checkZipEntrySizes(r container.Reader) (ok bool, errMsg string) {
	var totalSize int64
	for _, f := range r.Entries() {
		uncomp := f.UncompressedSize64()
		if uncomp > uint64(registry.MaxImportSize) {
			return false, fmt.Sprintf("ZIP 包过大（%d MB），超过 %d MB 上限", uncomp/(1024*1024), registry.MaxImportSizeMB)
		}
		totalSize += int64(uncomp)
		if totalSize > int64(registry.MaxImportSize) {
			return false, fmt.Sprintf("ZIP 包过大（%d MB），超过 %d MB 上限", totalSize/(1024*1024), registry.MaxImportSizeMB)
		}
	}
	return true, ""
}

// findZipEntryByBase 按 basename（大小写不敏感）查找容器条目；未找到返回 nil。
// 只匹配 basename——zip 内 model.json 可位于任意子目录。
func findZipEntryByBase(r container.Reader, base string) container.Entry {
	for _, f := range r.Entries() {
		if strings.ToLower(filepath.Base(f.Name())) == base {
			return f
		}
	}
	return nil
}

// countJSONArrayLen 统计 raw JSON 数组元素数；空 / 非数组 / 非法一律 0
// （调用方按「未声明」处理，不留 NaN 之类的歧义态）。
func countJSONArrayLen(raw json.RawMessage) int {
	if len(raw) == 0 {
		return 0
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		return 0
	}
	return len(arr)
}

// countJSONArrayOrObjectLen 统计 raw JSON 元素数：数组取长度，对象取键数。
// textures 段两种形态都出现过，先后尝试；两者皆非法 → 0。
func countJSONArrayOrObjectLen(raw json.RawMessage) int {
	if len(raw) == 0 {
		return 0
	}
	var arr []json.RawMessage
	if json.Unmarshal(raw, &arr) == nil {
		return len(arr)
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) == nil {
		return len(obj)
	}
	return 0
}

// populateYsmModelCounts 填充 bones/textures/animations/vertices/faces 计数。
func populateYsmModelCounts(meta *YSMModelMeta, m *ysmModelJSON) {
	meta.Bones = countJSONArrayLen(m.Bones)
	meta.Textures = countJSONArrayOrObjectLen(m.Textures)
	meta.Animations = countJSONArrayLen(m.Animations)
	if m.Model != nil {
		meta.Vertices = countJSONArrayLen(m.Model.Vertices)
		meta.Faces = countJSONArrayLen(m.Model.Faces)
	}
}

// AnalyzeYSMModel 解析 .ysm 文件，提取模型元数据
func AnalyzeYSMModel(path string) YSMModelMeta {
	meta := YSMModelMeta{}

	if ok, errMsg := validateYsmModelExt(path); !ok {
		meta.HasError = true
		meta.ErrorMsg = errMsg
		return meta
	}

	// 打开 ZIP
	r, err := container.OpenZipPath(path)
	if err != nil {
		meta.HasError = true
		meta.ErrorMsg = fmt.Sprintf("无法打开文件: %v", err)
		return meta
	}
	defer func() { _ = r.Close() }()

	// P1 修复：检查 ZIP 总大小，防止恶意构造的多文件 ZIP 撑爆内存
	if ok, errMsg := checkZipEntrySizes(r); !ok {
		meta.HasError = true
		meta.ErrorMsg = errMsg
		return meta
	}

	// 查找 model.json
	modelFile := findZipEntryByBase(r, "model.json")
	if modelFile == nil {
		meta.HasError = true
		meta.ErrorMsg = "未找到 model.json（不是有效的 YSM 模型）"
		return meta
	}

	// 读取 model.json
	rc, err := modelFile.Open()
	if err != nil {
		meta.HasError = true
		meta.ErrorMsg = fmt.Sprintf("读取 model.json 失败: %v", err)
		return meta
	}
	// 注：rc 由 fsutil.ReadLimitedEntry 内部 Close（其契约「rc 由本函数 Close」）——
	// 原 defer rc.Close() 已删除，避免双关

	// + ADR-044 策略 A：原 `io.ReadAll(io.LimitReader(rc, 5<<20))` 无 +1 探测——
	// LimitReader 截断后 err==nil 静默，恰 5MB 的 model.json 会被截断继续解析（ADR-033 陷阱）。
	// 统一走 fsutil.ReadLimitedEntry（limit+1 探测，超限/错误返回 nil）
	data := fsutil.ReadLimitedEntry(rc, 5<<20)
	if data == nil {
		meta.HasError = true
		meta.ErrorMsg = "读取 model.json 失败或超过 5MB 上限"
		return meta
	}

	// 解析 JSON
	var m ysmModelJSON
	if err := json.Unmarshal(data, &m); err != nil {
		meta.HasError = true
		meta.ErrorMsg = fmt.Sprintf("解析 model.json 失败: %v", err)
		return meta
	}

	meta.Name = m.Name
	meta.Author = m.Author
	meta.Version = m.Version

	// 统计数组长度
	populateYsmModelCounts(&meta, &m)

	return meta
}
