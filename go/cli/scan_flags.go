// scan_flags.go：目录扫描类命令共用的 flag 定义与解析。
// runScanDir（cli_scan_dir.go）与 runResourceScan（resource.go）原本跨文件逐字复制
// 「定义 dir/output(/detail) → parseFlags → --dir 空校验」块，jscpd 记为新增重复对；
// 收口到此处消除。注册顺序保持原样（dir → [detail] → output），使 --help 输出与治理前逐字一致；
// withDetail=false（resource-scan）时不注册 --detail。
package cli

import "flag"

// scanDirFlags 承载 scan-dir / resource-scan 两个目录扫描命令共用的 flag 指针集。
type scanDirFlags struct {
	dirPath *string
	detail  *bool
	output  *string
}

// newScanDirFlags 在 fs 上注册目录扫描共用 flag 并解析 args。
// dirName 为 --dir 的帮助文案（两命令文案不同，各传各的）；dirDefault 为 --dir 默认值。
// filesRoot 由 parseFlags 附带产出（各命令当前均丢弃）。--dir 为空即返回参数错误。
// 返回的指针在 fs 生命周期内有效。
func newScanDirFlags(fs *flag.FlagSet, dirName, dirDefault string, withDetail bool, args []string) (*scanDirFlags, string, error) {
	f := &scanDirFlags{
		dirPath: fs.String("dir", dirDefault, dirName),
	}
	if withDetail {
		f.detail = fs.Bool("detail", false, "显示详细文件列表")
	}
	f.output = fs.String("output", "", "输出文件路径（JSON 格式）")
	filesRoot, err := parseFlags(fs, args)
	if err != nil {
		return nil, "", err
	}
	if *f.dirPath == "" {
		return nil, "", newParamErrf("--dir 参数不能为空")
	}
	return f, filesRoot, nil
}
