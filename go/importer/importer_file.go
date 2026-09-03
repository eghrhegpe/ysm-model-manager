// ===== 文件导入核心（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 importModelFileWithOptions 提取：
// base64 解码 + 类型检测 + 校验 + 写文件；仓库根目录通过 rootFn 回调解析，
// 日志通过 logger 注入（薄壳传 App.logger.Add）。
package importer

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
)

// ZIP/7z 容器魔数（文件头签名）：importFromBuffer 魔数校验与 DetectContainerType 扫描共用
var (
	zipLocalHeaderSig = []byte{0x50, 0x4B, 0x03, 0x04} // ZIP local file header（PK\x03\x04）
	sevenZipSig       = []byte{0x37, 0x7A, 0xBC, 0xAF} // 7z 签名（7z\xBC\xAF）
)

// ImportOptions 导入选项
type ImportOptions struct {
	SkipCheck bool // 跳过魔数校验
	Overwrite bool // 允许覆盖已存在文件
}

// ImportLogger 导入日志回调（薄壳注入 App.logger.Add）
type ImportLogger func(name, src, dst string, size int64, status, msg string)

// ImportFromBase64 从 base64 导入模型文件（校验 + 类型检测 + 写文件）
// rootFn 按资源类型返回仓库根目录（薄壳注入 a.GetRepoRoot）。
// 返回 (destPath, rtype)：落盘绝对路径 + 判定出的资源类型——
// 「先入仓库再推送」组合链路（app 层 ImportFileAndPushToInstance）依赖两者定位产物，
// 类型判定单一事实源仍在本函数，调用方不得自行复刻。
func ImportFromBase64(fileName, base64Data string, opts ImportOptions, rootFn func(rtype string) string, logger ImportLogger) (string, string, error) {
	ext := strings.ToLower(filepath.Ext(fileName))
	if !types.IsSupportedExt(ext) {
		return "", "", types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式"}
	}
	// ysm 包内 json 白名单：.json 仅允许 ysm.json 入口清单，包内 geometry/animation/语言 json 不得单独导入
	// 与 go/scanner/scanner.go:80-87 的 ysm.json 白名单对齐（ADR-038 D2）
	if ext == ".json" && !types.IsYsmEntryJSON(filepath.Base(fileName)) {
		return "", "", types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "仅支持 ysm.json 清单文件", Suggestion: "YSM 包内 json 资源（geometry/animation/语言文件）不可单独导入，请导入 .ysm/.zip/.7z 或解压目录中的 ysm.json"}
	}
	// 路径穿越检测：统一入口 paths.HasTraversal（ADR-038 D2）
	if paths.HasTraversal(fileName) {
		return "", "", types.AppError{Code: types.ErrFileNameInvalid, Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含路径穿越", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	if strings.ContainsAny(fileName, `\/`) {
		return "", "", types.AppError{Code: types.ErrFileNameInvalid, Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含非法路径分隔符", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	// base64 受限解码：预检+解码+复检统一走 fsutil.DecodeBase64Limited
	//（预检避免超大 base64 字符串解码后才命中上限、白白分配内存的峰值尖刺）
	data, err := fsutil.DecodeBase64Limited(base64Data, types.MaxImportSize)
	if errors.Is(err, fsutil.ErrB64TooLarge) {
		return "", "", types.AppError{Code: types.ErrFileTooLarge, Operation: "导入模型", SourcePath: fileName, Reason: fmt.Sprintf("文件大小超过 %dMB 限制", types.MaxImportSizeMB), Suggestion: fmt.Sprintf("请压缩文件至 %dMB 以内", types.MaxImportSizeMB)}
	}
	if err != nil {
		return "", "", types.AppError{Code: types.ErrDecodeFailed, Operation: "导入模型", Reason: "Base64 解码失败", Suggestion: "文件可能已损坏，请重新下载"}
	}
	if len(data) == 0 {
		return "", "", types.AppError{Code: types.ErrFileEmpty, Operation: "导入模型", SourcePath: fileName, Reason: "文件内容为空", Suggestion: "请检查文件是否损坏"}
	}

	// 类型检测：优先内容检测（ZIP/7z 可能为 YSM/资源包/光影包），回退扩展名匹配
	rtype := ""
	// 容器集合单源：types.IsContainerExt
	if types.IsContainerExt(ext) {
		rtype = DetectContainerType(data)
	}
	// DetectContainerType 无特征返回空（ADR-082 续）：扩展名不属于当前 rtype 注册表扩展名集合时，
	// 用扩展名反查真实类型（ADR-065：扩展名列表注册表驱动，消除手写 .zip/.ysm/.7z/.json
	// 字面量漂移）。反查仍无结果 → 识别不出就是识别不出：明确报错，不假装 YSM 导入。
	if rtype == "" {
		if !types.IsContainerExt(ext) {
			rtypes := types.ExtBelongsTo(ext)
			if len(rtypes) >= 1 {
				rtype = rtypes[0]
			}
		}
	}
	if rtype == "" {
		return "", "", types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "无法识别文件类型", Suggestion: "ZIP/7z 内未找到已知资源特征（pack.mcmeta/shaders/ysm.json/模型后缀等），请确认文件格式或改用桌面端导入"}
	}

	targetRoot := rootFn(rtype)
	if targetRoot == "" {
		return "", "", fmt.Errorf("请先设置文件存储路径")
	}

	// 魔数校验
	if !opts.SkipCheck && len(data) >= 4 {
		// logger 为薄壳注入，可能为 nil（如测试/嵌入式调用），nil 时跳过日志不影响导入
		warn := func(msg string) {
			if logger != nil {
				logger(fileName, fileName, targetRoot, 0, "warn", msg)
			}
		}
		if ext == ".zip" || ext == ".ysm" {
			if !bytes.HasPrefix(data, zipLocalHeaderSig) {
				warn("文件头不匹配标准ZIP格式，可能为旧版或非标准YSM文件，已导入")
			}
		} else if ext == ".7z" {
			if !bytes.HasPrefix(data, sevenZipSig) {
				warn("文件头不匹配标准7z格式，已导入")
			}
		}
	}

	destPath := filepath.Join(targetRoot, fileName)
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, fsutil.DirPerms); err != nil {
		return "", "", types.AppError{Code: types.ErrMkdirFailed, Operation: "导入模型", TargetPath: destDir, Reason: "无法创建目标目录", Suggestion: "请检查磁盘权限或空间"}
	}
	if !opts.Overwrite {
		if _, err := os.Stat(destPath); err == nil {
			return "", "", types.AppError{Code: types.ErrFileExists, Operation: "导入模型", SourcePath: fileName, Reason: "文件已存在", Suggestion: "如需替换请先删除原文件"}
		}
	}
	return destPath, rtype, WriteFileAtomic(destPath, data)
}

// WriteFileAtomic 已提升至 go/fsutil（ADR-044 策略 A：基础设施工具收敛，tags/logs/fileops 共用）。
// 本处保留 AppError 包装以维持 importer 的结构化错误契约：
// 临时文件创建阶段失败（目录只读/磁盘满）→ MKDIR_FAILED（与 app_install.go:138 兄弟路径一致），
// 其余（写入/关闭/权限/落地）→ WRITE_FAILED。
func WriteFileAtomic(destPath string, data []byte) error {
	if err := fsutil.WriteFileAtomic(destPath, data); err != nil {
		if errors.Is(err, fsutil.ErrTempCreateFailed) {
			return types.AppError{Code: types.ErrMkdirFailed, Operation: "导入模型", TargetPath: filepath.Dir(destPath), Reason: "无法创建临时文件: " + err.Error(), Suggestion: "请检查磁盘权限或空间"}.WithCause(err)
		}
		return types.AppError{Code: types.ErrWriteFailed, Operation: "导入模型", TargetPath: destPath, Reason: "写入失败: " + err.Error(), Suggestion: "请检查磁盘权限或空间"}.WithCause(err)
	}
	return nil
}

// DetectContainerType 扫描容器条目名识别资源类型
// #5 收敛：收集全部条目名后委托 packs.DetectByEntries 做 (priority desc, id asc)
// 裁决（注册表顺序无关）；无指纹/结果为 "container"/"other" 时返回 ""（未知，
// 由调用方决定报错/降级——ADR-082 续：识别不出就是识别不出，不假装 YSM）。
// DetectByEntries 归属（ADR-144）：识别逻辑随识别大脑下沉 packs。
func DetectContainerType(data []byte) string {
	var (
		r   container.Reader
		err error
	)
	if len(data) >= 4 && bytes.HasPrefix(data, sevenZipSig) {
		r, err = container.Open7zBytes(data, int64(len(data)))
	} else {
		// 锐评 #16：不手写 local-header 游走解析 zip（脆弱——zip64 / data
		// descriptor / 加密等特性会错位漏条目），统一 container.OpenZipBytes
		// （zip.NewReader 走 central directory，与 7z 分支同一 Reader 契约）。
		// 坏/截断 zip → err → ""，与旧实现「无 local header 即 break」口径
		// 等价：识别不出就是识别不出。
		r, err = container.OpenZipBytes(data, int64(len(data)))
	}
	if err != nil {
		return ""
	}
	defer r.Close()
	var entries []string
	for _, e := range r.Entries() {
		entries = append(entries, e.Name())
	}
	if len(entries) == 0 {
		return ""
	}
	id := packs.DetectByEntries(entries, types.LoadRegistry())
	if id == "" || id == packs.ClassContainer || id == packs.ClassOther {
		return ""
	}
	return id
}
