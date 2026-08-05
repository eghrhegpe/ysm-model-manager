// ===== 文件导入核心（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 importModelFileWithOptions 提取：
// base64 解码 + 类型检测 + 校验 + 写文件；仓库根目录通过 rootFn 回调解析，
// 日志通过 logger 注入（薄壳传 App.logger.Add）。
package importer

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/types"
)

// ImportOptions 导入选项
type ImportOptions struct {
	SkipCheck bool // 跳过魔数校验
	Overwrite bool // 允许覆盖已存在文件
}

// ImportLogger 导入日志回调（薄壳注入 App.logger.Add）
type ImportLogger func(name, src, dst string, size int64, status, msg string)

// ImportFromBase64 从 base64 导入模型文件（校验 + 类型检测 + 写文件）
// rootFn 按资源类型返回仓库根目录（薄壳注入 a.GetRepoRoot）
func ImportFromBase64(fileName, base64Data string, opts ImportOptions, rootFn func(rtype string) string, logger ImportLogger) error {
	ext := strings.ToLower(filepath.Ext(fileName))
	if !types.IsSupportedExt(ext) {
		return types.AppError{Code: "FILE_TYPE_UNSUPPORTED", Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式"}
	}
	// ysm 包内 json 白名单：.json 仅允许 ysm.json 入口清单，包内 geometry/animation/语言 json 不得单独导入
	// 与 go/scanner/scanner.go 的 ysm.json 白名单对齐（ADR-038 D2）
	if ext == ".json" && !types.IsYsmEntryJSON(filepath.Base(fileName)) {
		return types.AppError{Code: "FILE_TYPE_UNSUPPORTED", Operation: "导入模型", SourcePath: fileName, Reason: "仅支持 ysm.json 清单文件", Suggestion: "YSM 包内 json 资源（geometry/animation/语言文件）不可单独导入，请导入 .ysm/.zip/.7z 或解压目录中的 ysm.json"}
	}
	// 路径穿越检测：仅拦截真正的穿越模式（../、..\\、末尾..），
	// 避免误杀 my..file.ysm 等合法文件名（ADR-038 D2）
	if strings.Contains(fileName, "../") || strings.Contains(fileName, "..\\") || strings.HasSuffix(fileName, "..") {
		return types.AppError{Code: "FILENAME_INVALID", Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含路径穿越", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	if strings.ContainsAny(fileName, `\/`) {
		return types.AppError{Code: "FILENAME_INVALID", Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含非法路径分隔符", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return types.AppError{Code: "DECODE_FAILED", Operation: "导入模型", Reason: "Base64 解码失败", Suggestion: "文件可能已损坏，请重新下载"}
	}
	if len(data) > 500*1024*1024 {
		return types.AppError{Code: "FILE_TOO_LARGE", Operation: "导入模型", SourcePath: fileName, Reason: "文件大小超过 500MB 限制", Suggestion: "请压缩文件至 500MB 以内"}
	}
	if len(data) == 0 {
		return types.AppError{Code: "FILE_EMPTY", Operation: "导入模型", SourcePath: fileName, Reason: "文件内容为空", Suggestion: "请检查文件是否损坏"}
	}

	// 类型检测：优先内容检测（ZIP 可能为 YSM/资源包/光影包），回退扩展名匹配
	rtype := "ysm"
	if ext == ".zip" {
		rtype = DetectZipType(data)
	}
	if rtype == "ysm" && ext != ".zip" && ext != ".ysm" && ext != ".7z" && ext != ".json" {
		rtypes := types.ExtBelongsTo(ext)
		if len(rtypes) > 0 && rtypes[0] != "ysm" {
			rtype = rtypes[0]
		}
	}

	targetRoot := rootFn(rtype)
	if targetRoot == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}

	// 魔数校验
	if !opts.SkipCheck && len(data) >= 4 {
		if ext == ".zip" || ext == ".ysm" {
			if data[0] != 0x50 || data[1] != 0x4B || data[2] != 0x03 || data[3] != 0x04 {
				logger(fileName, fileName, targetRoot, 0, "warn", "文件头不匹配标准ZIP格式，可能为旧版或非标准YSM文件，已导入")
			}
		} else if ext == ".7z" {
			if data[0] != 0x37 || data[1] != 0x7A || data[2] != 0xBC || data[3] != 0xAF {
				logger(fileName, fileName, targetRoot, 0, "warn", "文件头不匹配标准7z格式，已导入")
			}
		}
	}

	destPath := filepath.Join(targetRoot, fileName)
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return types.AppError{Code: "MKDIR_FAILED", Operation: "导入模型", TargetPath: destDir, Reason: "无法创建目标目录", Suggestion: "请检查磁盘权限或空间"}
	}
	if !opts.Overwrite {
		if _, err := os.Stat(destPath); err == nil {
			return types.AppError{Code: "FILE_EXISTS", Operation: "导入模型", SourcePath: fileName, Reason: "文件已存在", Suggestion: "如需替换请先删除原文件"}
		}
	}
	return os.WriteFile(destPath, data, 0644)
}

// DetectZipType 扫描 ZIP local file header 中的文件名识别资源类型
func DetectZipType(data []byte) string {
	idx := 0
	for idx+30 <= len(data) {
		if data[idx] != 0x50 || data[idx+1] != 0x4B || data[idx+2] != 0x03 || data[idx+3] != 0x04 {
			break
		}
		nameLen := int(data[idx+26]) | int(data[idx+27])<<8
		extraLen := int(data[idx+28]) | int(data[idx+29])<<8
		if idx+30+nameLen > len(data) {
			break
		}
		name := strings.ToLower(string(data[idx+30 : idx+30+nameLen]))
		if name == "pack.mcmeta" {
			return "resourcepack"
		}
		if strings.HasPrefix(name, "shaders/") || name == "shaders" {
			return "shaderpack"
		}
		if strings.HasSuffix(name, "ysm.json") || strings.HasPrefix(name, "models/") {
			return "ysm"
		}
		// 跳到下一个 entry（跳过压缩数据）
		compSize := int(data[idx+18]) | int(data[idx+19])<<8 | int(data[idx+20])<<16 | int(data[idx+21])<<24
		idx += 30 + nameLen + extraLen + compSize
	}
	// 默认按 YSM 处理（保守默认）：ZIP 内无任何识别特征时，导入目标路径按 YSM 归类。
	// 影响仅为导入去向，后续以实际内容解析为准；不返回空值以免调用方失去类型上下文
	return "ysm" // 默认 YSM
}
