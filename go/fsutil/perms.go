package fsutil

import "strings"

// DirPerms 目录标准权限（drwxr-xr-x）：os.MkdirAll 全仓 15+ 处手写 0755 收敛于此。
const DirPerms = 0755

// FilePerms 数据文件标准权限（-rw-r--r--）：os.WriteFile/Chmod 全仓 8 处手写 0644 收敛于此。
const FilePerms = 0644

// illegalNameChars Windows/Linux 文件名非法字符集。
// 单一事实来源——fileops/folder_import 的非法字符检测均委托本常量，
// 防多处硬编码 `\/:*?"<>|` 口径漂移。
const illegalNameChars = `\/:*?"<>|`

// winReservedNames Windows 保留设备名（大小写不敏感；带任意扩展名同样保留，
// 如 CON.txt。Windows 11 部分放宽，此处保守全拒——历史版本 Explorer 仍会异常）。
var winReservedNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true,
	"COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true,
	"LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// ContainsIllegalNameChar 检测文件名是否非法（名字保留历史——原仅查字符，
// 现语义已扩至三层，勿按名字推断只查字符；调用方错误文案用「不符合规范」
// 而非「包含非法字符」，避免对保留名/尾随点误报（code_review 04449b48 #3））。
// 单一事实源——fileops.CreateDir/RenameDir/RenameFile/folder_import.WriteModelFolder
// 均委托本函数。三层校验：
//  1. 非法字符 <>:*?"|\
//  2. Windows 保留设备名（剥扩展名后整体匹配，CON.txt 亦拒）
//  3. 尾随点/空格（Windows 落盘时静默剥离 → 用户看到的名字与实际落点漂移）
func ContainsIllegalNameChar(name string) bool {
	if strings.ContainsAny(name, illegalNameChars) {
		return true
	}
	if name != "" && (name[len(name)-1] == '.' || name[len(name)-1] == ' ') {
		return true
	}
	if i := strings.IndexByte(name, '.'); i >= 0 {
		name = name[:i]
	}
	return winReservedNames[strings.ToUpper(name)]
}
